<script lang="ts">
  import { onMount } from 'svelte';
  let { value = $bindable(''), disabled = false, dark = false }: { value?: string; disabled?: boolean; dark?: boolean } = $props();
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
<div class="model-choice" class:dark>
  <label><span>Build model</span>
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
  <small>Used to build and refine this feature.</small>
  {#if error}<p role="status">{error} <button type="button" onclick={load} {disabled}>Retry</button></p>{/if}
</div>
<style>
  .model-choice { min-width: 0; max-width: 100%; }
  label { display: flex; flex-direction: column; gap: 8px; }
  label span { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: .15em; text-transform: uppercase; color: var(--text-muted); }
  select { width: 100%; max-width: 100%; min-width: 0; min-height: 48px; box-sizing: border-box; padding: 10px 12px; background: var(--surface-elevated); color: var(--text-primary); border: 1px solid var(--line-strong); border-radius: 0; font: var(--fs-body)/1.5 var(--font-body); }
  small, p { display: block; font-size: var(--fs-label); color: var(--text-secondary); margin-top: 6px; }
  select:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .dark label span, .dark small, .dark p { color: rgba(237, 228, 212, .75); }
</style>
