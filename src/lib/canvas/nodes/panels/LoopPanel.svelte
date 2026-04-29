<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';

  // Loop node config (executor reads `arrayPath` + `expression`; see
  // src/lib/workflows/nodes/loop.ts). The editor exposes a structured shape:
  //
  //   - source: 'input' | 'range'        — picks the iteration source
  //   - arrayPath: string                — when source==='input', dot-path
  //                                        into the input object
  //   - count: number                    — when source==='range', repeat N
  //                                        times; we synthesise an inline
  //                                        expression range so the existing
  //                                        executor (which iterates an array
  //                                        on `input.<arrayPath>`) still
  //                                        works without engine changes
  //   - itemVar: string                  — name of the per-iteration variable
  //                                        exposed inside the loop body
  //   - maxIterations: number            — safety cap (default 1000)
  //
  // We always preserve unknown config keys via spread so the orchestrator
  // can continue to write `expression`, `concurrency`, etc.

  let {
    config,
    onChange,
    definition,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
  } = $props();

  type Source = 'input' | 'range';

  const DEFAULT_MAX = 1000;

  // Source: explicit when stored, else inferred from which fields exist.
  const source = $derived.by<Source>(() => {
    const raw = config.source;
    if (raw === 'input' || raw === 'range') return raw;
    if (typeof config.count === 'number' && !config.arrayPath) return 'range';
    return 'input';
  });

  const arrayPath = $derived(String(config.arrayPath ?? ''));
  const count = $derived.by(() => {
    const n = Number(config.count);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 10;
  });
  const itemVar = $derived(String(config.itemVar ?? 'item'));
  const maxIterations = $derived.by(() => {
    const n = Number(config.maxIterations);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX;
  });

  const itemVarValid = $derived(/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(itemVar));

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  function setSource(next: Source) {
    onChange({ ...config, source: next });
  }

  // Raw JSON disclosure
  let showRawJson = $state(false);

  // `definition` is referenced only for typings; canvas-level preview
  // header handles the "What this does" line.
  void definition;
</script>

<div class="lp">
  <!-- Iteration source -->
  <section class="lp-sec">
    <header class="lp-sec-hdr"><span class="sr-label-tight">Iteration source</span></header>
    <label class="lp-field">
      <span class="lp-label">Source</span>
      <select value={source} onchange={(e) => setSource((e.currentTarget as HTMLSelectElement).value as Source)}>
        <option value="input">Array from input (path)</option>
        <option value="range">Fixed range (repeat N times)</option>
      </select>
    </label>

    {#if source === 'input'}
      <label class="lp-field">
        <span class="lp-label">Array path</span>
        <input
          type="text"
          spellcheck="false"
          value={arrayPath}
          placeholder={'items  or  data.values'}
          oninput={(e) => set('arrayPath', (e.currentTarget as HTMLInputElement).value)}
        />
        <span class="lp-hint">Dot-path into the input object. Templates supported: <code>{`{{input.field}}`}</code></span>
      </label>
    {:else}
      <label class="lp-field">
        <span class="lp-label">Count</span>
        <input
          type="number"
          min="0"
          step="1"
          value={count}
          oninput={(e) => set('count', Math.max(0, Math.floor(Number((e.currentTarget as HTMLInputElement).value) || 0)))}
        />
        <span class="lp-hint">Repeats this many times; <code>{itemVar || 'item'}</code> is the zero-based index.</span>
      </label>
    {/if}
  </section>

  <!-- Iteration variable -->
  <section class="lp-sec">
    <header class="lp-sec-hdr">
      <span class="sr-label-tight">Iteration variable</span>
      {#if !itemVarValid}<span class="lp-warn">invalid identifier</span>{/if}
    </header>
    <label class="lp-field">
      <span class="lp-label">Variable name</span>
      <input
        type="text"
        spellcheck="false"
        value={itemVar}
        placeholder={'item'}
        oninput={(e) => set('itemVar', (e.currentTarget as HTMLInputElement).value)}
      />
      <span class="lp-hint">Exposed inside the loop body alongside <code>index</code> and <code>input</code>.</span>
    </label>
  </section>

  <!-- Safety cap -->
  <section class="lp-sec">
    <header class="lp-sec-hdr">
      <span class="sr-label-tight">Safety cap</span>
      <span class="lp-sec-meta">default {DEFAULT_MAX}</span>
    </header>
    <label class="lp-field">
      <span class="lp-label">Max iterations</span>
      <input
        type="number"
        min="1"
        step="1"
        value={maxIterations}
        oninput={(e) => set('maxIterations', Math.max(1, Math.floor(Number((e.currentTarget as HTMLInputElement).value) || DEFAULT_MAX)))}
      />
      <span class="lp-hint">Hard upper bound — loop bails out if the source would exceed this.</span>
    </label>
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="lp-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="lp-code"
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
  .lp { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .lp-sec { display: flex; flex-direction: column; gap: 8px; }
  .lp-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .lp-sec-meta { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }

  .lp-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .lp-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .lp-hint { font-size: 11px; color: var(--text-ghost); }
  .lp-hint code, .lp-label code { font-size: 11px; color: var(--text-muted); }

  .lp-warn { font-family: var(--font-mono); font-size: 10px; color: var(--status-error, #c0392b); }

  .lp-code {
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
  .lp-code:focus { border-color: var(--text-muted); }

  input[type='text'], input[type='number'], select, textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='text']:focus, input[type='number']:focus, select:focus, textarea:focus { border-color: var(--text-muted); }

  .lp-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .lp-raw summary { cursor: pointer; }
</style>
