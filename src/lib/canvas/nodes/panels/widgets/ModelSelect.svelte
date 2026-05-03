<script lang="ts">
  // LLM model selector. Two modes:
  //   - static `options` prop  → native <select> with custom-id fallback
  //   - dynamic `fetcher` prop → ResourcePicker (used by OpenRouter, etc.)
  //
  // Either mode tolerates a "custom" model id the orchestrator wrote that
  // isn't in the curated list. Static mode renders it as a "Custom: …"
  // option; ResourcePicker has its own custom-input fallback.

  import ResourcePicker from '../shared/ResourcePicker.svelte';

  export interface ModelOption {
    value: string;
    label: string;
  }

  let {
    value,
    onChange,
    options,
    fetcher,
    label = 'Model',
    hint,
    placeholder = 'pick a model',
    allowCustom = true,
    emptyHint,
  }: {
    value: string;
    onChange: (v: string) => void;
    /** Static list of options (rendered as native <select>). */
    options?: ModelOption[];
    /** Async fetcher (rendered via ResourcePicker). Mutually exclusive with options. */
    fetcher?: () => Promise<Array<{ value: string; label: string; meta?: string }>>;
    label?: string;
    /** Optional hint text below the select. */
    hint?: string;
    placeholder?: string;
    allowCustom?: boolean;
    /** Forwarded to ResourcePicker when the dynamic mode finds no options. */
    emptyHint?: string;
  } = $props();

  const modelInList = $derived(
    options ? options.some((o) => o.value === value) : true,
  );
</script>

<section class="ms-sec">
  <div class="ms-field">
    <span class="ms-label">{label}</span>
    {#if fetcher}
      <ResourcePicker
        value={value}
        fetcher={fetcher}
        onChange={onChange}
        {placeholder}
        {allowCustom}
        {emptyHint}
      />
    {:else if options}
      <select value={value} onchange={(e) => onChange((e.currentTarget as HTMLSelectElement).value)}>
        {#if !modelInList && value}
          <option value={value}>Custom: {value}</option>
        {/if}
        {#each options as opt (opt.value)}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
    {/if}
    {#if hint}<span class="ms-hint">{@html hint}</span>{/if}
  </div>
</section>

<style>
  .ms-sec { display: flex; flex-direction: column; gap: 8px; }
  .ms-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .ms-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .ms-hint { font-size: 11px; color: var(--text-ghost); }
  .ms-hint :global(code) { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }
  select {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  select:focus { border-color: var(--text-muted); }
</style>
