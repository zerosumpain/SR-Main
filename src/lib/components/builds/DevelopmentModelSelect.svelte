<script lang="ts">
  import { onMount } from 'svelte';
  let { value = $bindable(''), disabled = false }: { value?: string; disabled?: boolean } = $props();
  let models = $state<Array<{ id: string; name: string; provider: string }>>([]);
  let defaultId = $state(''); let error = $state('');
  async function load() {
    error = '';
    try {
      const response = await fetch('/api/jkai/development/models');
      if (!response.ok) throw new Error('Model catalogue unavailable. Your current choice is retained.');
      const result = await response.json(); models = result.models; defaultId = result.defaultModel.modelId;
    } catch (e) { error = (e as Error).message; }
  }
  onMount(() => { void load(); });
</script>
<div class="model-choice">
  <label>Build model
    <select bind:value {disabled} aria-label="Build model">
      <option value="">Builder default{defaultId ? ` · ${defaultId}` : ''}</option>
      {#if value && !models.some(m => m.id === value)}<option value={value}>{value} (saved choice)</option>{/if}
      {#each ['codex', 'openrouter'] as provider}
        <optgroup label={provider === 'codex' ? 'Codex' : 'OpenRouter'}>
          {#each models.filter(m => m.provider === provider) as model}<option value={model.id}>{model.name}</option>{/each}
        </optgroup>
      {/each}
    </select>
  </label>
  <small>Saved for this build. The worker needs access to the selected provider.</small>
  {#if error}<p role="status">{error} <button type="button" onclick={load} {disabled}>Retry</button></p>{/if}
</div>
<style>
  .model-choice { min-width: 0; max-width: 100%; }
  label { display: flex; flex-direction: column; gap: 7px; font-size: var(--fs-nav); }
  select { width: 100%; max-width: 100%; min-width: 0; padding: 10px; background: var(--surface-elevated); color: var(--text-primary); border: 1px solid var(--line-strong); font: inherit; }
  small, p { display: block; font-size: var(--fs-label); color: var(--text-secondary); margin-top: 6px; }
  select:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
</style>
