<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import UpstreamFieldPicker from './shared/UpstreamFieldPicker.svelte';
  import ResourcePicker from './shared/ResourcePicker.svelte';

  // Loop node config (executor reads `mode`, `arrayPath`, and per-mode fields;
  // see src/lib/workflows/nodes/loop.ts).
  //
  // MAP mode (default) — pure per-item transform:
  //   - source: 'input' | 'range'   — picks the iteration source
  //   - arrayPath: string           — dot-path into input when source==='input'
  //   - count: number               — repeat N times when source==='range'
  //   - itemVar: string             — per-iteration variable name
  //   - maxIterations: number       — safety cap (default 1000)
  //
  // SUBWORKFLOW mode — invoke a saved workflow per item:
  //   - subWorkflowId: string       — the workflow to run per item
  //   - arrayPath: string           — dot-path into input to the array
  //   - concurrency: number         — items in flight (default 3, max 10)
  //   - failurePolicy: 'continue'|'stop'
  //   - maxItems: number            — hard cap (default 50)
  //
  // Unknown config keys are preserved via spread so the orchestrator can keep
  // writing `expression`, `concurrency`, etc.

  let {
    config,
    onChange,
    definition,
    workflowId: currentWorkflowId,
    upstreamFields = [],
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
    workflowId?: string;
    upstreamFields?: string[];
  } = $props();

  type Source = 'input' | 'range';
  type Mode = 'map' | 'subworkflow';

  const DEFAULT_MAX = 1000;

  const mode = $derived<Mode>(config.mode === 'subworkflow' ? 'subworkflow' : 'map');

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

  // ---- subworkflow-mode derived values ----------------------------------
  const subWorkflowId = $derived(String(config.subWorkflowId ?? ''));
  const failurePolicy = $derived(config.failurePolicy === 'stop' ? 'stop' : 'continue');
  const concurrency = $derived.by(() => {
    const n = Number(config.concurrency);
    return Number.isFinite(n) && n >= 1 ? Math.min(10, Math.floor(n)) : 3;
  });
  const maxItems = $derived.by(() => {
    const n = Number(config.maxItems);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 50;
  });

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  function setSource(next: Source) {
    onChange({ ...config, source: next });
  }

  function setMode(next: Mode) {
    onChange({ ...config, mode: next });
  }

  // Workflow list for the sub-workflow picker. Filters out the current
  // workflow so a loop can't fan out into itself (self-recursion is also
  // rejected at run time).
  async function fetchWorkflows(): Promise<Array<{ value: string; label: string; meta?: string }>> {
    const res = await fetch('/api/workflows');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error('Expected array');
    return rows
      .filter((r) => r && typeof r.id === 'string')
      .filter((r) => r.id !== currentWorkflowId)
      .map((r) => {
        const id = r.id as string;
        const name = typeof r.name === 'string' ? r.name : id;
        const description = typeof r.description === 'string' ? r.description.trim() : '';
        const label = description || name;
        return { value: id, label, meta: id.slice(0, 8) };
      });
  }

  // Raw JSON disclosure
  let showRawJson = $state(false);

  // `definition` is referenced only for typings; canvas-level preview
  // header handles the "What this does" line.
  void definition;
</script>

<div class="lp">
  <!-- Mode -->
  <section class="lp-sec">
    <header class="lp-sec-hdr"><span class="sr-label-tight">Mode</span></header>
    <label class="lp-field">
      <span class="lp-label">Iteration mode</span>
      <select value={mode} onchange={(e) => setMode((e.currentTarget as HTMLSelectElement).value as Mode)}>
        <option value="map">Map — transform each item</option>
        <option value="subworkflow">Sub-workflow — run a workflow per item</option>
      </select>
      <span class="lp-hint">
        {mode === 'subworkflow'
          ? 'Runs a saved workflow once per item (per-item side effects, bounded concurrency).'
          : 'Applies a JS expression to each item and returns { results, count } once.'}
      </span>
    </label>
  </section>

  {#if mode === 'map'}
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
        <div class="lp-field">
          <span class="lp-label">Array path</span>
          <UpstreamFieldPicker
            value={arrayPath}
            upstreamFields={upstreamFields}
            onChange={(v) => set('arrayPath', v)}
            placeholder={'items  or  data.values'}
            allowCustom={true}
          />
          <span class="lp-hint">Dot-path into the input object. Templates supported: <code>{`{{input.field}}`}</code></span>
        </div>
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
  {:else}
    <!-- Sub-workflow picker -->
    <section class="lp-sec">
      <header class="lp-sec-hdr"><span class="sr-label-tight">Sub-workflow</span></header>
      <ResourcePicker
        value={subWorkflowId}
        fetcher={fetchWorkflows}
        onChange={(v) => set('subWorkflowId', v)}
        label="Workflow (run per item)"
        placeholder="select a workflow"
        emptyHint="No other workflows available — create one first."
      />
      <span class="lp-hint">Invoked once per item with input <code>{`{ item, index }`}</code>. Cannot be this workflow.</span>
    </section>

    <!-- Array path -->
    <section class="lp-sec">
      <header class="lp-sec-hdr"><span class="sr-label-tight">Items</span></header>
      <div class="lp-field">
        <span class="lp-label">Array path</span>
        <UpstreamFieldPicker
          value={arrayPath}
          upstreamFields={upstreamFields}
          onChange={(v) => set('arrayPath', v)}
          placeholder={'items  or  data.values'}
          allowCustom={true}
        />
        <span class="lp-hint">Dot-path into the input object holding the list to fan out.</span>
      </div>
    </section>

    <!-- Fan-out controls -->
    <section class="lp-sec">
      <header class="lp-sec-hdr"><span class="sr-label-tight">Fan-out</span></header>
      <label class="lp-field">
        <span class="lp-label">Concurrency</span>
        <input
          type="number"
          min="1"
          max="10"
          step="1"
          value={concurrency}
          oninput={(e) => set('concurrency', Math.min(10, Math.max(1, Math.floor(Number((e.currentTarget as HTMLInputElement).value) || 3))))}
        />
        <span class="lp-hint">Items in flight at once (default 3, max 10).</span>
      </label>
      <label class="lp-field">
        <span class="lp-label">On item failure</span>
        <select value={failurePolicy} onchange={(e) => set('failurePolicy', (e.currentTarget as HTMLSelectElement).value)}>
          <option value="continue">Continue — record and keep going</option>
          <option value="stop">Stop — halt on first failure</option>
        </select>
      </label>
      <label class="lp-field">
        <span class="lp-label">Max items</span>
        <input
          type="number"
          min="1"
          step="1"
          value={maxItems}
          oninput={(e) => set('maxItems', Math.max(1, Math.floor(Number((e.currentTarget as HTMLInputElement).value) || 50)))}
        />
        <span class="lp-hint">Hard cap (default 50). Extra items are truncated and logged.</span>
      </label>
    </section>
  {/if}

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
  .lp-sec-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  .lp-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .lp-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .lp-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .lp-hint code, .lp-label code { font-size: var(--fs-label); color: var(--text-muted); }

  .lp-warn { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--status-error, #c0392b); }

  .lp-code {
    width: 100%;
    padding: 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: var(--fs-label);
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
