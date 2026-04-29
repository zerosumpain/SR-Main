<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';

  let {
    config,
    onChange,
    definition,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
  } = $props();

  // ---------- Operation (canonical 'get' | 'set') -------------------------
  // The executor leniently absorbs read→get and write→set at runtime, but on
  // save we always normalise to the canonical form so persisted configs stay
  // clean. We also do not auto-write the migration on mount — only when the
  // user touches a control — to avoid spurious "dirty" markers.

  function normaliseOp(raw: unknown): 'get' | 'set' {
    const s = String(raw ?? 'get').toLowerCase().trim();
    if (s === 'read') return 'get';
    if (s === 'write') return 'set';
    if (s === 'set') return 'set';
    return 'get';
  }

  const operation = $derived(normaliseOp(config.operation));

  function set(key: string, value: unknown) {
    // Always normalise operation alongside whatever is being changed so the
    // first save after loading a legacy 'read'/'write' config writes back the
    // canonical form.
    onChange({ ...config, operation, [key]: value });
  }
  function setOperation(next: 'get' | 'set') {
    if (next === 'get') {
      // Switching to Get clears any value-pick state — those keys are Set-only
      // and would just be noise on a Get config.
      onChange({ ...config, operation: 'get' });
    } else {
      onChange({ ...config, operation: 'set' });
    }
  }

  // ---------- Key ---------------------------------------------------------

  const key = $derived(String(config.key ?? ''));
  const keyMissing = $derived(!key.trim());

  // ---------- Value source (Set-only) -------------------------------------
  // Two modes:
  //  - "whole"  → no valuePath; executor falls back to input.value or input.
  //  - "field"  → valuePath is a non-empty dot-path.
  // We auto-detect the mode on load from whether valuePath is set, and
  // remember the last user choice while the panel is mounted.

  const valuePath = $derived(String(config.valuePath ?? ''));
  let valueMode = $state<'whole' | 'field'>(valuePath.trim() ? 'field' : 'whole');
  let valuePathInputEl: HTMLInputElement | null = $state(null);

  function selectValueMode(mode: 'whole' | 'field') {
    valueMode = mode;
    if (mode === 'whole') {
      // Clear valuePath so the executor falls back cleanly.
      onChange({ ...config, operation, valuePath: '' });
    } else {
      // Focus the input on next tick. We don't write anything yet — the user
      // will type and that will populate valuePath via its oninput.
      queueMicrotask(() => valuePathInputEl?.focus());
    }
  }

  // ---------- Existing entries section ------------------------------------
  // Decision: omitted. The workflowId isn't passed into the panel's $props
  // (the shared panel API is { config, onChange, definition }), and resolving
  // it via $page would couple this panel to canvas page-server data shape,
  // making it brittle and harder to reuse outside the canvas. The user can
  // inspect raw entries via pgweb (http://homeserv:8085/pgweb/) on the
  // workflow_data_store table — referenced inline in the help hint below.

  // ---------- Raw JSON ----------------------------------------------------

  let showRawJson = $state(false);

  void definition;
</script>

<div class="ds">
  <!-- Operation -->
  <section class="ds-sec">
    <header class="ds-sec-hdr">
      <span class="sr-label-tight">Operation</span>
    </header>
    <div class="ds-pillbar" role="radiogroup" aria-label="Operation">
      <button
        type="button"
        role="radio"
        aria-checked={operation === 'get'}
        class="ds-pill"
        class:ds-pill-active={operation === 'get'}
        onclick={() => setOperation('get')}
      >Get</button>
      <button
        type="button"
        role="radio"
        aria-checked={operation === 'set'}
        class="ds-pill"
        class:ds-pill-active={operation === 'set'}
        onclick={() => setOperation('set')}
      >Set</button>
    </div>
    <p class="ds-caption">
      {#if operation === 'get'}
        Read a previously stored value. Outputs <code>{`{ value, found }`}</code>.
      {:else}
        Write a value to the store. Outputs <code>{`{ saved, key, value }`}</code>.
      {/if}
    </p>
  </section>

  <!-- Key -->
  <section class="ds-sec">
    <header class="ds-sec-hdr">
      <span class="sr-label-tight">Key</span>
      {#if keyMissing}<span class="ds-warn">⚠ key is required</span>{/if}
    </header>
    <textarea
      class="ds-key-input"
      rows="1"
      spellcheck="false"
      placeholder={`last_run_timestamp  or  forecast_{{input.date}}`}
      value={key}
      oninput={(e) => set('key', (e.currentTarget as HTMLTextAreaElement).value)}
    ></textarea>
    <span class="ds-hint">
      Templates: <code>{`{{input.field}}`}</code>. Keys are scoped to this workflow.
    </span>
  </section>

  <!-- Value to store (Set-only) -->
  {#if operation === 'set'}
    <section class="ds-sec">
      <header class="ds-sec-hdr">
        <span class="sr-label-tight">Value to store</span>
      </header>
      <div class="ds-mode-list">
        <label class="ds-mode-row">
          <input
            type="radio"
            name="ds-value-mode"
            value="whole"
            checked={valueMode === 'whole'}
            onchange={() => selectValueMode('whole')}
          />
          <span class="ds-mode-text">
            <span class="ds-mode-title">Whole input</span>
            <span class="ds-mode-sub">Stores <code>input.value</code> if present, otherwise the entire input object.</span>
          </span>
        </label>
        <label class="ds-mode-row">
          <input
            type="radio"
            name="ds-value-mode"
            value="field"
            checked={valueMode === 'field'}
            onchange={() => selectValueMode('field')}
          />
          <span class="ds-mode-text">
            <span class="ds-mode-title">Pick a field</span>
            <span class="ds-mode-sub">Pull a specific value out of the input by dot-path.</span>
          </span>
        </label>
      </div>
      {#if valueMode === 'field'}
        <label class="ds-field">
          <span class="ds-label">Value path</span>
          <input
            bind:this={valuePathInputEl}
            type="text"
            spellcheck="false"
            placeholder="data.count"
            value={valuePath}
            oninput={(e) => set('valuePath', (e.currentTarget as HTMLInputElement).value)}
          />
          <span class="ds-hint">
            Dot-path into the input. Leading <code>input.</code> is optional. Use
            <code>body.results.0.id</code> to walk into arrays/objects.
          </span>
        </label>
      {/if}
    </section>
  {/if}

  <!-- Existing entries: omitted by design (see comment in script). -->
  <p class="ds-inspect-note">
    Inspect stored entries on the
    <code>workflow_data_store</code> table via pgweb
    (<code>http://homeserv:8085/pgweb/</code>) — entries are scoped by
    <code>(workflowId, key)</code>.
  </p>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="ds-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="ds-code"
      rows="10"
      spellcheck="false"
      value={JSON.stringify(config, null, 2)}
      oninput={(e) => {
        try {
          const next = JSON.parse((e.currentTarget as HTMLTextAreaElement).value);
          if (next && typeof next === 'object') onChange(next as Record<string, unknown>);
        } catch { /* invalid — keep typing */ }
      }}
    ></textarea>
  </details>
</div>

<style>
  .ds { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .ds-sec { display: flex; flex-direction: column; gap: 8px; }
  .ds-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }

  /* Operation pillbar */
  .ds-pillbar {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    border: 1px solid var(--card-border);
    background: var(--bg);
  }
  .ds-pill {
    padding: 10px 14px;
    background: transparent;
    color: var(--text-muted);
    border: none;
    font-family: var(--font-mono);
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    cursor: pointer;
    outline: none;
  }
  .ds-pill + .ds-pill { border-left: 1px solid var(--card-border); }
  .ds-pill:hover { color: var(--text-primary); }
  .ds-pill-active {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--accent);
  }
  .ds-pill-active:hover { color: var(--accent); }

  .ds-caption {
    margin: 0;
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.45;
  }
  .ds-caption code { font-size: 11px; color: var(--text-primary); }

  /* Key textarea */
  .ds-key-input {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    font-family: var(--font-mono);
    font-size: 12px;
    box-sizing: border-box;
    outline: none;
    resize: vertical;
    min-height: 32px;
  }
  .ds-key-input:focus { border-color: var(--text-muted); }

  /* Value mode radios */
  .ds-mode-list { display: flex; flex-direction: column; gap: 4px; }
  .ds-mode-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 8px;
    border: 1px solid var(--card-border);
    background: var(--bg);
    cursor: pointer;
  }
  .ds-mode-row:hover { border-color: var(--text-muted); }
  .ds-mode-row input[type='radio'] { margin-top: 3px; }
  .ds-mode-text { display: flex; flex-direction: column; gap: 2px; }
  .ds-mode-title {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-primary);
  }
  .ds-mode-sub { font-size: 11px; color: var(--text-muted); line-height: 1.4; }
  .ds-mode-sub code { font-size: 11px; color: var(--text-primary); }

  /* Generic field */
  .ds-field { display: flex; flex-direction: column; gap: 4px; }
  .ds-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }

  .ds-hint { font-size: 11px; color: var(--text-ghost); }
  .ds-hint code { font-size: 11px; color: var(--text-muted); }

  .ds-warn {
    font-family: var(--font-mono); font-size: 10px;
    color: var(--status-error, #c0392b);
  }

  .ds-inspect-note {
    margin: 0;
    font-size: 11px;
    color: var(--text-ghost);
    line-height: 1.5;
    border-left: 2px solid var(--card-border);
    padding: 4px 8px;
  }
  .ds-inspect-note code { font-size: 11px; color: var(--text-muted); }

  /* Raw JSON */
  .ds-code {
    width: 100%;
    padding: 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: 11px;
    box-sizing: border-box;
    outline: none;
    resize: vertical;
  }
  .ds-code:focus { border-color: var(--text-muted); }

  .ds-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .ds-raw summary { cursor: pointer; }

  input[type='text'], textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='text']:focus, textarea:focus { border-color: var(--text-muted); }
</style>
