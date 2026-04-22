<script lang="ts">
  import type { FailureEnvelope } from '$lib/jkai/types';

  interface Props {
    buildId: string;
    failure: FailureEnvelope | null;
    currentProvider: string;
    currentModelId: string;
    onContinued?: () => void;
  }

  let { buildId, failure, currentProvider, currentModelId, onContinued }: Props = $props();

  const MODEL_OPTIONS = [
    { provider: 'zai', modelId: 'glm-5-turbo', label: 'zai / glm-5-turbo (recommended — avoids glm-5.1 rate limit)' },
    { provider: 'zai', modelId: 'glm-4.6', label: 'zai / glm-4.6' },
    { provider: 'zai', modelId: 'glm-5.1', label: 'zai / glm-5.1' },
    { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-4.5', label: 'openrouter / claude-sonnet-4.5' },
    { provider: 'openrouter', modelId: 'anthropic/claude-opus-4.7', label: 'openrouter / claude-opus-4.7' },
  ];

  // Default to glm-5-turbo when the current model is glm-5.1 (rate-limit / stall
  // prone) — the most common recovery path right now.
  const suggestedKey =
    currentProvider === 'zai' && currentModelId === 'glm-5.1'
      ? 'zai::glm-5-turbo'
      : `${currentProvider}::${currentModelId}`;
  let selectedKey = $state(suggestedKey);
  let improvementPrompt = $state('');
  let submitting = $state(false);
  let error = $state<string | null>(null);
  let showDetails = $state(false);

  // Render even when failure is null — builds killed by a service restart
  // (recoverOnStartup) are marked `failed` with no envelope, and the user
  // still needs a continue path.
  const effectiveFailure = $derived<FailureEnvelope>(
    failure ?? {
      kind: 'nonzero_exit',
      message: 'Build was terminated without a structured failure signal. Most commonly this is a service restart mid-run.',
      attempts: 1,
    },
  );

  const showForm = $derived(effectiveFailure.kind !== 'auth_failed');

  const defaultPrompt = $derived(
    `Continue where the last run left off — the previous attempt failed with: ${effectiveFailure.message}`
  );

  async function submit() {
    if (submitting) return;
    submitting = true;
    error = null;
    try {
      const [provider, modelId] = selectedKey.split('::');
      const res = await fetch(`/api/jkai/builds/${buildId}/continue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: improvementPrompt.trim() || defaultPrompt,
          modelProvider: provider,
          modelId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      onContinued?.();
    } catch (err: any) {
      error = err.message ?? String(err);
    } finally {
      submitting = false;
    }
  }

  function kindLabel(kind: string): string {
    return kind.replace(/_/g, ' ');
  }
</script>

<div
  class="mb-6 rounded border p-4"
    style="border-color: #b94b4b; background: rgba(185, 75, 75, 0.06);"
  >
    <div class="flex items-start gap-3">
      <span
        class="text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded shrink-0"
        style="font-family: var(--font-mono); background: #b94b4b; color: white;"
      >
        {kindLabel(effectiveFailure.kind)}
      </span>
      <div class="flex-1 min-w-0">
        <p class="text-sm" style="color: var(--text-primary);">{effectiveFailure.message}</p>
        <p class="text-xs mt-1" style="color: var(--text-ghost);">
          Build aborted on {currentProvider} / {currentModelId}
          {#if effectiveFailure.lastEventAgeMs != null}
            · idle {(effectiveFailure.lastEventAgeMs / 1000).toFixed(0)}s before kill
          {/if}
          {#if effectiveFailure.tokensBeforeStall != null}
            · {effectiveFailure.tokensBeforeStall} tokens before stall
          {/if}
          {#if effectiveFailure.httpStatus != null}
            · HTTP {effectiveFailure.httpStatus}
          {/if}
        </p>
        {#if effectiveFailure.providerErrorCode || effectiveFailure.stderrTail}
          <button
            type="button"
            class="text-xs mt-2 underline"
            style="color: var(--text-ghost);"
            onclick={() => (showDetails = !showDetails)}
          >
            {showDetails ? 'Hide' : 'Show'} details
          </button>
          {#if showDetails}
            <div class="mt-2 text-xs" style="color: var(--text-ghost); font-family: var(--font-mono);">
              {#if effectiveFailure.providerErrorCode}
                <div>providerErrorCode: {effectiveFailure.providerErrorCode}</div>
              {/if}
              {#if effectiveFailure.stderrTail}
                <pre class="whitespace-pre-wrap mt-1 p-2 rounded" style="background: rgba(0,0,0,0.2); max-height: 200px; overflow: auto;">{effectiveFailure.stderrTail}</pre>
              {/if}
            </div>
          {/if}
        {/if}
      </div>
    </div>

    {#if !showForm}
      <p class="text-xs mt-3 pl-[72px]" style="color: var(--text-ghost);">
        Fix <code>keys.json</code> on the VPS and retry — continuing with a different model won't resolve an API key problem.
      </p>
    {:else}
      <div class="mt-4 space-y-3">
        <div>
          <label for="failure-banner-model" class="block text-[10px] uppercase tracking-[0.2em] mb-1" style="color: var(--text-ghost); font-family: var(--font-mono);">
            Model
          </label>
          <select
            id="failure-banner-model"
            bind:value={selectedKey}
            class="w-full rounded border px-2 py-1 text-sm"
            style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary);"
          >
            {#each MODEL_OPTIONS as opt}
              <option value={`${opt.provider}::${opt.modelId}`}>{opt.label}</option>
            {/each}
          </select>
        </div>

        <div>
          <label for="failure-banner-prompt" class="block text-[10px] uppercase tracking-[0.2em] mb-1" style="color: var(--text-ghost); font-family: var(--font-mono);">
            Corrective prompt (optional)
          </label>
          <textarea
            id="failure-banner-prompt"
            bind:value={improvementPrompt}
            placeholder={defaultPrompt}
            rows="3"
            class="w-full rounded border px-2 py-1 text-sm"
            style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary);"
          ></textarea>
        </div>

        {#if error}
          <p class="text-xs" style="color: #b94b4b;">{error}</p>
        {/if}

        <div class="flex justify-end">
          <button
            type="button"
            onclick={submit}
            disabled={submitting}
            class="px-4 py-1.5 rounded text-[11px] uppercase tracking-wider border transition-colors"
            style="border-color: var(--accent); color: var(--accent); opacity: {submitting ? 0.5 : 1};"
          >
            {submitting ? 'Continuing...' : 'Continue with selected model'}
          </button>
        </div>
      </div>
    {/if}
  </div>
