<script lang="ts">
  // A combo picker for "which upstream field do I want?" where the field
  // set is discovered from real run data. Three render modes:
  //   - upstream is empty           → plain text input + "no upstream data
  //                                    yet" hint
  //   - upstream has fields, value
  //     matches a known field       → dropdown
  //   - upstream has fields, value
  //     is a custom path            → dropdown with the typed value as a
  //                                    "Custom: ..." pinned option
  //
  // The picker writes a plain string back to the parent. Callers use it
  // anywhere the underlying config is `input.<dot.path>` style — e.g.
  // data-store `valuePath`, conditional rule field, validator rule field,
  // text-parser `inputField`. For values that may also be JS expressions
  // (`input.foo > 10`), pass `allowCustom={true}` so the dropdown shows a
  // "Type custom expression…" option that switches to a free-text input.

  let {
    value,
    upstreamFields = [],
    onChange,
    placeholder = 'pick a field',
    allowCustom = true,
    label,
  }: {
    value: string;
    upstreamFields?: string[];
    onChange: (next: string) => void;
    placeholder?: string;
    allowCustom?: boolean;
    label?: string;
  } = $props();

  const hasUpstream = $derived(upstreamFields.length > 0);
  const isKnown = $derived(hasUpstream && value !== '' && upstreamFields.includes(value));
  const isCustom = $derived(hasUpstream && value !== '' && !isKnown);

  // When the user picks "__custom__" from the dropdown we flip to free
  // text mode so they can type. Once they type something non-empty we
  // remember they're in custom mode for this session.
  let customMode = $state(isCustom);
  $effect(() => { if (isCustom) customMode = true; });

  function onSelect(e: Event) {
    const selected = (e.currentTarget as HTMLSelectElement).value;
    if (selected === '__custom__') {
      customMode = true;
      // Don't clobber the existing value — just reveal the input.
      return;
    }
    customMode = false;
    onChange(selected);
  }
</script>

<div class="ufp">
  {#if label}<span class="ufp-label">{label}</span>{/if}

  {#if !hasUpstream}
    <input
      type="text"
      class="ufp-input"
      spellcheck="false"
      placeholder={placeholder}
      {value}
      oninput={(e) => onChange((e.currentTarget as HTMLInputElement).value)}
    />
    <span class="ufp-hint">No upstream run data yet — type the path manually.</span>
  {:else if customMode}
    <div class="ufp-row">
      <input
        type="text"
        class="ufp-input"
        spellcheck="false"
        placeholder={placeholder}
        {value}
        oninput={(e) => onChange((e.currentTarget as HTMLInputElement).value)}
      />
      <button type="button" class="ufp-mini" onclick={() => { customMode = false; }}>
        ↶ Use list
      </button>
    </div>
    <span class="ufp-hint">Custom path. Click "Use list" to switch back to the upstream field dropdown.</span>
  {:else}
    <select class="ufp-select" value={isKnown ? value : ''} onchange={onSelect}>
      <option value="" disabled>— {placeholder} —</option>
      {#each upstreamFields as f (f)}
        <option value={f}>{f}</option>
      {/each}
      {#if allowCustom}
        <option disabled>──────</option>
        <option value="__custom__">Type custom path…</option>
      {/if}
    </select>
    <span class="ufp-hint">{upstreamFields.length} field{upstreamFields.length === 1 ? '' : 's'} available from upstream nodes.</span>
  {/if}
</div>

<style>
  .ufp { display: flex; flex-direction: column; gap: 4px; }
  .ufp-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .ufp-input, .ufp-select {
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
  .ufp-input:focus, .ufp-select:focus { border-color: var(--text-muted); }
  .ufp-row { display: flex; gap: 4px; align-items: stretch; }
  .ufp-row .ufp-input { flex: 1; }
  .ufp-mini {
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
  .ufp-mini:hover { color: var(--text-primary); }
  .ufp-hint { font-size: var(--fs-label); color: var(--text-ghost); }
</style>
