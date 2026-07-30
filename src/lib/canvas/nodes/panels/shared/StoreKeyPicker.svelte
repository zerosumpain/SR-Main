<script lang="ts">
  // A picker for "which key in some backing store do I want?". Fetches
  // the list of existing keys from a caller-supplied async function on
  // mount. Two modes:
  //   - read mode (`mode="get"`): dropdown of existing keys; no create
  //     option. The caller's value must match one of them, or fall
  //     through to a free-text input as a custom (templated) key.
  //   - write mode (`mode="set"`): dropdown of existing keys PLUS a
  //     "+ New key…" option that swaps to a free-text input.
  //
  // Templated keys (containing `{{...}}`) bypass the dropdown entirely
  // and render as free-text — they're dynamic by definition.

  interface KeyEntry { key: string; meta?: string }

  let {
    value,
    mode,
    fetcher,
    onChange,
    placeholder = 'pick a key',
    label,
  }: {
    value: string;
    mode: 'get' | 'set';
    /** Async loader returning the list of existing keys. Called once on mount. */
    fetcher: () => Promise<KeyEntry[]>;
    onChange: (next: string) => void;
    placeholder?: string;
    label?: string;
  } = $props();

  let keys = $state<KeyEntry[] | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);

  async function load() {
    if (loading || keys !== null) return;
    loading = true;
    try {
      keys = await fetcher();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }
  $effect(() => { void load(); });

  // Templated values are always free-text.
  const isTemplated = $derived(value.includes('{{') || value.includes('}}'));

  // Custom mode = "user is typing a new key" (set only).
  let customMode = $state(false);
  // Auto-enable custom mode if the value is non-empty AND not in the
  // fetched list AND not templated (means user typed something custom).
  $effect(() => {
    if (mode !== 'set') return;
    if (!keys) return;
    if (isTemplated) { customMode = false; return; }
    if (value && !keys.some((k) => k.key === value)) customMode = true;
  });

  function onSelect(e: Event) {
    const sel = (e.currentTarget as HTMLSelectElement).value;
    if (sel === '__new__') {
      customMode = true;
      onChange('');
      return;
    }
    if (sel === '__template__') {
      customMode = true;
      // Pre-fill a template hint.
      onChange('my_key_{{input.field}}');
      return;
    }
    customMode = false;
    onChange(sel);
  }

  function refresh() {
    keys = null;
    error = null;
    void load();
  }
</script>

<div class="skp">
  {#if label}<span class="skp-label">{label}</span>{/if}

  {#if loading}
    <div class="skp-row">
      <select class="skp-select" disabled><option>Loading…</option></select>
    </div>
  {:else if error}
    <div class="skp-row">
      <input
        type="text"
        class="skp-input"
        spellcheck="false"
        placeholder={placeholder}
        {value}
        oninput={(e) => onChange((e.currentTarget as HTMLInputElement).value)}
      />
      <button type="button" class="skp-mini" onclick={refresh}>↻ Retry</button>
    </div>
    <span class="skp-hint skp-err">Couldn't load existing keys: {error}. You can still type one manually.</span>
  {:else if isTemplated || customMode}
    <div class="skp-row">
      <input
        type="text"
        class="skp-input"
        spellcheck="false"
        placeholder={placeholder}
        {value}
        oninput={(e) => onChange((e.currentTarget as HTMLInputElement).value)}
      />
      {#if !isTemplated}
        <button type="button" class="skp-mini" onclick={() => { customMode = false; onChange(''); }}>
          ↶ Pick existing
        </button>
      {/if}
    </div>
    {#if isTemplated}
      <span class="skp-hint">Templated key — resolved at run time.</span>
    {:else}
      <span class="skp-hint">{mode === 'set' ? 'Creating a new key.' : 'Custom key.'} Click "Pick existing" to use the list.</span>
    {/if}
  {:else if !keys || keys.length === 0}
    <div class="skp-row">
      <input
        type="text"
        class="skp-input"
        spellcheck="false"
        placeholder={placeholder}
        {value}
        oninput={(e) => onChange((e.currentTarget as HTMLInputElement).value)}
      />
    </div>
    <span class="skp-hint">No keys yet in this store — type a new one.</span>
  {:else}
    <div class="skp-row">
      <select class="skp-select" value={value} onchange={onSelect}>
        <option value="" disabled>— {placeholder} —</option>
        {#each keys as k (k.key)}
          <option value={k.key}>{k.key}{k.meta ? ` · ${k.meta}` : ''}</option>
        {/each}
        <option disabled>──────</option>
        {#if mode === 'set'}
          <option value="__new__">+ New key…</option>
        {/if}
        <option value="__template__">{`{{template-driven key}}…`}</option>
      </select>
      <button type="button" class="skp-mini" onclick={refresh} title="Refresh from server">↻</button>
    </div>
    <span class="skp-hint">{keys.length} existing key{keys.length === 1 ? '' : 's'} in this store.</span>
  {/if}
</div>

<style>
  .skp { display: flex; flex-direction: column; gap: 4px; }
  .skp-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .skp-row { display: flex; gap: 4px; align-items: stretch; }
  .skp-row .skp-input, .skp-row .skp-select { flex: 1; }
  .skp-input, .skp-select {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    box-sizing: border-box;
    outline: none;
  }
  .skp-input:focus, .skp-select:focus { border-color: var(--text-muted); }
  .skp-mini {
    padding: 2px 8px;
    background: var(--bg);
    color: var(--text-muted);
    border: 1px dashed var(--card-border);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    cursor: pointer;
    white-space: nowrap;
  }
  .skp-mini:hover { color: var(--text-primary); }
  .skp-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .skp-hint.skp-err { color: var(--status-error, #c0392b); }
</style>
