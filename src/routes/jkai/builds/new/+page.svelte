<script lang="ts">
  import { goto } from '$app/navigation';
  import JkaiPageTitle from '$lib/components/jkai/JkaiPageTitle.svelte';
  import ModelPicker from '$lib/components/jkai/ModelPicker.svelte';
  import type { ModelContext } from '$lib/server/models/types';

  let { data } = $props();

  let prompt = $state('');
  let activeMinutesPerHour = $state(15);
  let maxTokensPerHour = $state<number | null>(null);
  let maxIterations = $state<number | null>(null);
  let maxTotalMinutes = $state<number | null>(null);
  let submitting = $state(false);
  let error = $state('');
  let builderModel = $state<ModelContext>({ ...data.defaultBuilderModel });
  // Defaults: prefer the fast path. enforceDesignSystem only matters for
  // SR-internal Svelte projects (the linter skips non-Svelte workspaces
  // anyway as of the host-mode cutover), so leaving it on does no harm
  // for static builds. planFirst, on the other hand, gates a 90-second
  // proposer/critic/revision debate before iteration 1 even starts —
  // unhelpful for 'build me a calculator' shape prompts. Off by default;
  // user can opt in via the checkbox for genuinely complex builds.
  let enforceDesignSystem = $state(true);
  let planFirst = $state(false);
  let thinkingLevel = $state<'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'>('medium');
  // Studio replaces the whole flow below with createStudioBuild's own
  // preconfigured budget/design defaults (see src/lib/jkai/studio.ts) — a
  // plain read-only-in-the-template flag, nothing derived or synced from it.
  let studioMode = $state(false);
  let researchMode = $state<'reuse' | 'extend' | 'fresh'>('extend');

  async function submit() {
    if (!prompt.trim()) return;
    submitting = true;
    error = '';

    if (studioMode) {
      try {
        const res = await fetch('/api/jkai/studio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ challenge: prompt.trim(), researchMode }),
        });
        const data = await res.json();
        if (!res.ok || !data.buildId) {
          error = data.error ?? 'Studio build failed to start';
          return;
        }
        goto(`/jkai/builds/${data.buildId}`);
      } catch (err: any) {
        error = err.message;
      } finally {
        submitting = false;
      }
      return;
    }

    const budgetConfig: Record<string, number> = {};
    if (activeMinutesPerHour) budgetConfig.activeMinutesPerHour = activeMinutesPerHour;
    if (maxTokensPerHour) budgetConfig.maxTokensPerHour = maxTokensPerHour;
    if (maxIterations) budgetConfig.maxIterations = maxIterations;
    if (maxTotalMinutes) budgetConfig.maxTotalMinutes = maxTotalMinutes;

    try {
      const res = await fetch('/api/jkai/builds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          budgetConfig,
          modelProvider: builderModel.provider,
          modelId: builderModel.modelId,
          enforceDesignSystem,
          planFirst,
          thinkingLevel,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        error = data.error || 'Failed to create build';
        return;
      }

      const build = await res.json();
      goto(`/jkai/builds/${build.id}`);
    } catch (err: any) {
      error = err.message;
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>New Build — JKAI</title>
</svelte:head>

<JkaiPageTitle title="NEW BUILD" titleHref="/jkai/builds" />

<div class="p-6 sm:p-10 max-w-2xl mx-auto">
  <form onsubmit={(e) => { e.preventDefault(); submit(); }}>
    <div class="mb-6">
      <label for="prompt" class="block text-sm font-medium mb-2" style="color: var(--text-secondary);">
        {studioMode ? 'Challenge Statement' : 'Development Objective'}
      </label>
      <textarea
        id="prompt"
        bind:value={prompt}
        rows={5}
        placeholder={studioMode
          ? 'What should the reader understand by the end? Name a subject and the counter-intuitive thing about it, e.g. "Explain how the National Funding Formula decides what a school receives, and why two schools of the same size get different budgets."'
          : 'Describe what you want to build...'}
        class="w-full rounded-[var(--radius-round)] border p-3 text-base resize-y"
        style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary);"
      ></textarea>
    </div>

    <div class="mb-6 p-4 rounded-[var(--radius-round)] border" style="background: var(--card-bg); border-color: var(--card-border);">
      <label class="flex items-center gap-2 text-sm" style="color: var(--text-primary);">
        <input type="checkbox" bind:checked={studioMode} />
        Studio — multi-chapter interactive explainer
      </label>
      {#if studioMode}
        <p class="text-xs mt-2" style="color: var(--text-ghost);">
          Plans a 6–10 chapter spine, then builds one complete chapter per iteration. Budget and
          design settings below are replaced by the Studio defaults.
        </p>
        <div class="mt-3">
          <label class="text-xs block mb-1" for="studio-evidence" style="color: var(--text-ghost);">Evidence</label>
          <select
            id="studio-evidence"
            bind:value={researchMode}
            class="w-full text-sm p-2 rounded-[var(--radius-round)] border"
            style="background: var(--bg); border-color: var(--card-border); color: var(--text-primary);"
          >
            <option value="extend">Extend — reuse what is known, research only the gaps (default)</option>
            <option value="reuse">Reuse only — existing research, no new session (seconds, free)</option>
            <option value="fresh">Fresh — ignore prior research, full Deep Dive (30–90 min)</option>
          </select>
          <p class="text-xs mt-1" style="color: var(--text-ghost);">
            {researchMode === 'reuse'
              ? 'Fails fast if the corpus does not already hold enough sourced facts on this topic.'
              : researchMode === 'fresh'
                ? 'Always starts a new Deep Dive, even if this topic is already covered.'
                : 'Searches existing research first; only starts a Deep Dive if it falls short, seeded with what was found.'}
          </p>
        </div>
      {/if}
    </div>

    <div class="mb-6 p-4 rounded-[var(--radius-round)] border" style="background: var(--card-bg); border-color: var(--card-border);" class:opacity-50={studioMode}>
      <h2 class="text-sm font-medium mb-4" style="color: var(--text-secondary);">Budget</h2>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block text-xs mb-1" style="color: var(--text-ghost);">
            Active minutes per hour
          </label>
          <input type="range" min="1" max="60" bind:value={activeMinutesPerHour} class="w-full" />
          <span class="text-xs" style="color: var(--text-ghost); font-family: var(--font-mono);">{activeMinutesPerHour}m</span>
        </div>

        <div>
          <label class="block text-xs mb-1" style="color: var(--text-ghost);">Max tokens per hour</label>
          <input type="number" bind:value={maxTokensPerHour} placeholder="Unlimited"
            class="w-full rounded border px-2 py-1 text-base"
            style="background: var(--bg); border-color: var(--card-border); color: var(--text-primary);" />
        </div>

        <div>
          <label class="block text-xs mb-1" style="color: var(--text-ghost);">Max iterations</label>
          <input type="number" bind:value={maxIterations} placeholder="Unlimited"
            class="w-full rounded border px-2 py-1 text-base"
            style="background: var(--bg); border-color: var(--card-border); color: var(--text-primary);" />
        </div>

        <div>
          <label class="block text-xs mb-1" style="color: var(--text-ghost);">Total time cap (minutes)</label>
          <input type="number" bind:value={maxTotalMinutes} placeholder="Unlimited"
            class="w-full rounded border px-2 py-1 text-base"
            style="background: var(--bg); border-color: var(--card-border); color: var(--text-primary);" />
        </div>
      </div>
    </div>

    <div class="mb-6" class:opacity-50={studioMode}>
      <ModelPicker bind:value={builderModel} label="Model" />
    </div>

    <div class="mb-6 p-4 rounded-[var(--radius-round)] border" style="background: var(--card-bg); border-color: var(--card-border);" class:opacity-50={studioMode}>
      <h2 class="text-sm font-medium mb-3" style="color: var(--text-secondary);">Strategy</h2>
      <label class="flex items-center gap-2 mb-3 text-sm" style="color: var(--text-primary);">
        <input type="checkbox" bind:checked={enforceDesignSystem} />
        Enforce site design system (recommended)
      </label>
      <label class="flex items-center gap-2 mb-3 text-sm" style="color: var(--text-primary);">
        <input type="checkbox" bind:checked={planFirst} />
        Require plan approval before iterations begin (recommended)
      </label>
      <label class="block text-xs mb-1" style="color: var(--text-ghost);">Thinking level</label>
      <select bind:value={thinkingLevel}
        class="w-full rounded border px-2 py-1 text-sm"
        style="background: var(--bg); border-color: var(--card-border); color: var(--text-primary);">
        {#each ['off','minimal','low','medium','high','xhigh'] as lv}
          <option value={lv}>{lv}</option>
        {/each}
      </select>
    </div>

    {#if error}
      <p class="text-sm mb-4" style="color: var(--error);">{error}</p>
    {/if}

    <button type="submit" disabled={!prompt.trim() || submitting}
      class="px-6 py-2.5 rounded-[var(--radius-round)] text-sm font-medium transition-opacity disabled:opacity-50"
      style="background: var(--accent); color: white;">
      {submitting ? 'Starting…' : studioMode ? 'Start Studio Build' : 'Start Build'}
    </button>
  </form>
</div>
