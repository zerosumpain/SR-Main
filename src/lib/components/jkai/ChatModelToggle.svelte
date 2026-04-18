<script lang="ts">
  import { GLM_MODELS } from '$lib/constants/glm-models';
  import type { ModelContext } from '$lib/server/models/types';

  let {
    conversationId,
    modelProvider,
    modelId,
    messageCount,
    altOpenRouterModel,
    defaultGlmModelId,
    onChanged,
  }: {
    conversationId: string;
    modelProvider: 'zai' | 'openrouter';
    modelId: string;
    messageCount: number;
    altOpenRouterModel: ModelContext | null;
    defaultGlmModelId: string;
    onChanged?: (ctx: ModelContext) => void;
  } = $props();

  let locked = $state(false);
  $effect(() => {
    // Once locked, stay locked (preserve locked state across prop refreshes).
    if (messageCount > 0) locked = true;
  });

  let glmPillLabel = $derived(
    GLM_MODELS.find((m) => m.id === defaultGlmModelId)?.label ?? defaultGlmModelId,
  );
  let orLabel = $state<string | null>(null);
  let pending = $state(false);
  let error = $state<string | null>(null);

  // Load a human-readable name for the OR alt, if any.
  $effect(() => {
    if (!altOpenRouterModel) {
      orLabel = null;
      return;
    }
    const id = altOpenRouterModel.modelId;
    fetch(`/api/admin/models/openrouter?q=${encodeURIComponent(id)}&pageSize=5`)
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        const rows = (data?.rows ?? []) as Array<{ id: string; name: string }>;
        const row = rows.find((r) => r.id === id);
        orLabel = row?.name ?? id;
      })
      .catch(() => {
        orLabel = id;
      });
  });

  async function choose(ctx: ModelContext) {
    if (locked || pending) return;
    if (ctx.provider === modelProvider && ctx.modelId === modelId) return;
    pending = true;
    error = null;
    try {
      const res = await fetch(`/api/jkai/conversations/${conversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelProvider: ctx.provider, modelId: ctx.modelId }),
      });
      if (res.status === 409) {
        // Got locked in the meantime — treat as locked.
        error = 'This conversation already has messages — model is locked.';
        locked = true;
        return;
      }
      if (!res.ok) {
        error = `Couldn't switch model (${res.status}).`;
        return;
      }
      onChanged?.(ctx);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Network error';
    } finally {
      pending = false;
    }
  }

  function currentLabel(): string {
    if (modelProvider === 'zai') return `GLM · ${modelId}`;
    return `OR · ${modelId}`;
  }
</script>

{#if locked}
  <div class="flex items-center gap-2">
    <span
      class="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px]"
      style="background: var(--surface-overlay); color: var(--text-secondary); font-family: var(--font-mono);"
    >
      {currentLabel()}
    </span>
    <span class="text-[10px]" style="color: var(--text-ghost);">locked</span>
  </div>
{:else}
  <div class="flex items-center gap-1 flex-wrap">
    <span
      class="text-[10px] uppercase tracking-wider mr-1"
      style="color: var(--text-ghost); font-family: var(--font-mono);"
    >
      model
    </span>

    <button
      type="button"
      disabled={pending}
      aria-pressed={modelProvider === 'zai'}
      onclick={() => choose({ provider: 'zai', modelId: defaultGlmModelId })}
      class="rounded-full px-3 py-1 text-[11px] transition-colors"
      style={
        modelProvider === 'zai'
          ? 'background: var(--accent); color: white; border: 1px solid var(--accent);'
          : 'background: var(--surface-overlay); color: var(--text-secondary); border: 1px solid var(--card-border);'
      }
    >
      {glmPillLabel}
    </button>

    <button
      type="button"
      disabled={pending || !altOpenRouterModel}
      aria-pressed={modelProvider === 'openrouter'}
      title={altOpenRouterModel ? undefined : 'Set an OpenRouter alternate in admin'}
      onclick={() => altOpenRouterModel && choose(altOpenRouterModel)}
      class="rounded-full px-3 py-1 text-[11px] transition-colors"
      style={
        !altOpenRouterModel
          ? 'background: transparent; color: var(--text-ghost); border: 1px dashed var(--card-border); cursor: not-allowed;'
          : modelProvider === 'openrouter'
            ? 'background: var(--accent); color: white; border: 1px solid var(--accent);'
            : 'background: var(--surface-overlay); color: var(--text-secondary); border: 1px solid var(--card-border);'
      }
    >
      {altOpenRouterModel ? (orLabel ?? altOpenRouterModel.modelId) : 'OpenRouter (not set)'}
    </button>

    {#if error}
      <span class="text-[10px] ml-2" style="color: #c44;">{error}</span>
    {/if}
  </div>
{/if}
