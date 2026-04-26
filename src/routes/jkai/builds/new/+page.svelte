<script lang="ts">
  import { goto } from '$app/navigation';
  import PageHeader from '$lib/components/PageHeader.svelte';
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
  let enforceDesignSystem = $state(true);
  let planFirst = $state(true);
  let thinkingLevel = $state<'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'>('medium');

  async function submit() {
    if (!prompt.trim()) return;
    submitting = true;
    error = '';

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

<PageHeader title="NEW BUILD" titleHref="/jkai/builds" />

<div class="p-6 sm:p-10 max-w-2xl mx-auto">
  <form onsubmit={(e) => { e.preventDefault(); submit(); }}>
    <div class="mb-6">
      <label for="prompt" class="block text-sm font-medium mb-2" style="color: var(--text-secondary);">
        Development Objective
      </label>
      <textarea
        id="prompt"
        bind:value={prompt}
        rows={5}
        placeholder="Describe what you want to build..."
        class="w-full rounded-lg border p-3 text-sm resize-y"
        style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary);"
      ></textarea>
    </div>

    <div class="mb-6 p-4 rounded-lg border" style="background: var(--card-bg); border-color: var(--card-border);">
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
            class="w-full rounded border px-2 py-1 text-sm"
            style="background: var(--bg); border-color: var(--card-border); color: var(--text-primary);" />
        </div>

        <div>
          <label class="block text-xs mb-1" style="color: var(--text-ghost);">Max iterations</label>
          <input type="number" bind:value={maxIterations} placeholder="Unlimited"
            class="w-full rounded border px-2 py-1 text-sm"
            style="background: var(--bg); border-color: var(--card-border); color: var(--text-primary);" />
        </div>

        <div>
          <label class="block text-xs mb-1" style="color: var(--text-ghost);">Total time cap (minutes)</label>
          <input type="number" bind:value={maxTotalMinutes} placeholder="Unlimited"
            class="w-full rounded border px-2 py-1 text-sm"
            style="background: var(--bg); border-color: var(--card-border); color: var(--text-primary);" />
        </div>
      </div>
    </div>

    <div class="mb-6">
      <ModelPicker bind:value={builderModel} label="Model" />
    </div>

    <div class="mb-6 p-4 rounded-lg border" style="background: var(--card-bg); border-color: var(--card-border);">
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
      <p class="text-sm mb-4" style="color: #b43232;">{error}</p>
    {/if}

    <button type="submit" disabled={!prompt.trim() || submitting}
      class="px-6 py-2.5 rounded-lg text-sm font-medium transition-opacity disabled:opacity-50"
      style="background: var(--accent); color: white;">
      {submitting ? 'Starting...' : 'Start Build'}
    </button>
  </form>
</div>
