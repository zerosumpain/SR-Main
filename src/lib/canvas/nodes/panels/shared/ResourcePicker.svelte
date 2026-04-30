<script lang="ts">
  // Generic resource picker. Fetches a list of {value, label, meta?}
  // entries on mount and renders a dropdown. Falls back to a free-text
  // input when:
  //   - the fetcher fails
  //   - the list is empty
  //   - the current value is templated ({{...}})
  //   - the user clicks "type custom value"

  interface ResourceEntry { value: string; label: string; meta?: string }

  let {
    value,
    fetcher,
    onChange,
    placeholder = 'pick one',
    label,
    allowCustom = true,
    emptyHint,
  }: {
    value: string;
    fetcher: () => Promise<ResourceEntry[]>;
    onChange: (next: string) => void;
    placeholder?: string;
    label?: string;
    allowCustom?: boolean;
    emptyHint?: string;
  } = $props();

  let items = $state<ResourceEntry[] | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);

  async function load() {
    if (loading || items !== null) return;
    loading = true;
    try {
      items = await fetcher();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }
  $effect(() => { void load(); });

  const isTemplated = $derived(value.includes('{{') || value.includes('}}'));

  let customMode = $state(false);
  $effect(() => {
    if (!items) return;
    if (isTemplated) { customMode = false; return; }
    if (value && !items.some((it) => it.value === value)) customMode = true;
  });

  function onSelect(e: Event) {
    const sel = (e.currentTarget as HTMLSelectElement).value;
    if (sel === '__custom__') { customMode = true; onChange(''); return; }
    if (sel === '__template__') { customMode = true; onChange('{{input.field}}'); return; }
    customMode = false;
    onChange(sel);
  }

  function refresh() {
    items = null;
    error = null;
    void load();
  }
</script>

<div class="rp">
  {#if label}<span class="rp-label">{label}</span>{/if}

  {#if loading}
    <select class="rp-select" disabled><option>Loading…</option></select>
  {:else if error}
    <div class="rp-row">
      <input type="text" class="rp-input" spellcheck="false" placeholder={placeholder}
        {value}
        oninput={(e) => onChange((e.currentTarget as HTMLInputElement).value)} />
      <button type="button" class="rp-mini" onclick={refresh}>↻ Retry</button>
    </div>
    <span class="rp-hint rp-err">Couldn't load: {error}. Type one manually.</span>
  {:else if isTemplated || customMode}
    <div class="rp-row">
      <input type="text" class="rp-input" spellcheck="false" placeholder={placeholder}
        {value}
        oninput={(e) => onChange((e.currentTarget as HTMLInputElement).value)} />
      {#if !isTemplated && items && items.length > 0}
        <button type="button" class="rp-mini" onclick={() => { customMode = false; onChange(''); }}>↶ Pick</button>
      {/if}
    </div>
    {#if isTemplated}
      <span class="rp-hint">Templated — resolved at run time.</span>
    {:else}
      <span class="rp-hint">Custom value.</span>
    {/if}
  {:else if !items || items.length === 0}
    <div class="rp-row">
      <input type="text" class="rp-input" spellcheck="false" placeholder={placeholder}
        {value}
        oninput={(e) => onChange((e.currentTarget as HTMLInputElement).value)} />
    </div>
    <span class="rp-hint">{emptyHint ?? 'Nothing available — type a value.'}</span>
  {:else}
    <div class="rp-row">
      <select class="rp-select" value={value} onchange={onSelect}>
        <option value="" disabled>— {placeholder} —</option>
        {#each items as it (it.value)}
          <option value={it.value}>{it.label}{it.meta ? ` · ${it.meta}` : ''}</option>
        {/each}
        <option disabled>──────</option>
        {#if allowCustom}
          <option value="__custom__">+ Custom value…</option>
        {/if}
        <option value="__template__">{`{{template}}…`}</option>
      </select>
      <button type="button" class="rp-mini" onclick={refresh} title="Refresh from server">↻</button>
    </div>
    <span class="rp-hint">{items.length} option{items.length === 1 ? '' : 's'}.</span>
  {/if}
</div>

<style>
  .rp { display: flex; flex-direction: column; gap: 4px; }
  .rp-label {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .rp-row { display: flex; gap: 4px; align-items: stretch; }
  .rp-row .rp-input, .rp-row .rp-select { flex: 1; }
  .rp-input, .rp-select {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    font-family: var(--font-mono);
    font-size: 11px;
    box-sizing: border-box;
    outline: none;
  }
  .rp-input:focus, .rp-select:focus { border-color: var(--text-muted); }
  .rp-mini {
    padding: 2px 8px;
    background: var(--bg);
    color: var(--text-muted);
    border: 1px dashed var(--card-border);
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    cursor: pointer;
    white-space: nowrap;
  }
  .rp-mini:hover { color: var(--text-primary); }
  .rp-hint { font-size: 11px; color: var(--text-ghost); }
  .rp-hint.rp-err { color: var(--status-error, #c0392b); }
</style>
