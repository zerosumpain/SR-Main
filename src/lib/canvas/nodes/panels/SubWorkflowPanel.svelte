<script lang="ts">
  import RawConfigEditor from './shared/RawConfigEditor.svelte';
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import ResourcePicker from './shared/ResourcePicker.svelte';

  let {
    config,
    onChange,
    definition,
    workflowId: currentWorkflowId,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
    workflowId?: string;
  } = $props();

  // `definition` is referenced for type carry-through only; the canvas page
  // owns the "What this does" preview line so we don't duplicate it.
  void definition;

  // ---------- Workflow picker -------------------------------------------
  // Fetch all workflows for ResourcePicker. We filter out the current
  // workflow itself so the user can't accidentally wire a node to its
  // own canvas (which would recurse forever).

  async function fetchWorkflows(): Promise<Array<{ value: string; label: string; meta?: string }>> {
    const res = await fetch('/api/workflows');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error('Expected array');
    return rows
      .filter((r) => r && typeof r.id === 'string')
      // Prevent recursion: don't let a workflow target itself.
      .filter((r) => r.id !== currentWorkflowId)
      .map((r) => {
        const id = r.id as string;
        const name = typeof r.name === 'string' ? r.name : id;
        const description = typeof r.description === 'string' ? r.description.trim() : '';
        const label = description || name;
        return { value: id, label, meta: id.slice(0, 8) };
      });
  }

  const workflowId = $derived(String(config.workflowId ?? ''));

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // ---------- Input mapping ---------------------------------------------
  // Stored as `inputMapping`: { [inputFieldName]: upstreamPath }
  // e.g. { "userId": "input.user.id", "topic": "previous.topic" }

  type MapRow = { k: string; v: string };

  function parseMapping(raw: unknown): MapRow[] {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return Object.entries(raw as Record<string, unknown>).map(([k, v]) => ({ k, v: String(v ?? '') }));
    }
    if (typeof raw === 'string' && raw.trim()) {
      try {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          return Object.entries(obj as Record<string, unknown>).map(([k, v]) => ({ k, v: String(v ?? '') }));
        }
      } catch { /* fall through */ }
    }
    return [];
  }

  function rowsToMapping(rows: MapRow[]): Record<string, string> {
    const obj: Record<string, string> = {};
    for (const r of rows) {
      const k = r.k.trim();
      if (k) obj[k] = r.v;
    }
    return obj;
  }

  const mapRows = $derived(parseMapping(config.inputMapping));

  function setMapRows(rows: MapRow[]) {
    onChange({ ...config, inputMapping: rowsToMapping(rows) });
  }
  function addMapRow() { setMapRows([...mapRows, { k: '', v: '' }]); }
  function updateMapRow(i: number, k: string, v: string) {
    const next = mapRows.slice();
    next[i] = { k, v };
    setMapRows(next);
  }
  function removeMapRow(i: number) {
    const next = mapRows.slice();
    next.splice(i, 1);
    setMapRows(next);
  }

  // ---------- Wait for completion --------------------------------------
  // Default true: matches existing executor behaviour (awaits sub-run).

  const waitForCompletion = $derived(config.waitForCompletion !== false);

  // ---------- Raw JSON --------------------------------------------------
</script>

<div class="sw">
  <!-- Workflow picker -->
  <section class="sw-sec">
    <header class="sw-sec-hdr">
      <span class="sr-label-tight">Sub-workflow</span>
    </header>
    <ResourcePicker
      value={workflowId}
      fetcher={fetchWorkflows}
      onChange={(v) => set('workflowId', v)}
      label="Workflow"
      placeholder="select a workflow"
      emptyHint="No other workflows available — create one first."
    />
  </section>

  <!-- Input mapping -->
  <section class="sw-sec">
    <header class="sw-sec-hdr">
      <span class="sr-label-tight">Input mapping</span>
      <span class="sw-meta">{mapRows.length} {mapRows.length === 1 ? 'field' : 'fields'}</span>
    </header>
    <p class="sw-hint">
      Maps sub-workflow input field names to upstream paths. Leave empty to forward this
      node's input as-is.
    </p>
    {#if mapRows.length === 0}
      <p class="sw-empty">No mapping rows.</p>
    {:else}
      <div class="sw-kv-grid">
        <div class="sw-kv-head">Sub-workflow field</div>
        <div class="sw-kv-head">Upstream path</div>
        <div></div>
        {#each mapRows as row, i (i)}
          <input
            type="text"
            class="sw-kv-input"
            placeholder="userId"
            value={row.k}
            oninput={(e) => updateMapRow(i, (e.currentTarget as HTMLInputElement).value, row.v)}
          />
          <input
            type="text"
            class="sw-kv-input"
            placeholder={'input.user.id or {{previous.value}}'}
            value={row.v}
            oninput={(e) => updateMapRow(i, row.k, (e.currentTarget as HTMLInputElement).value)}
          />
          <button type="button" class="sw-kv-rm" onclick={() => removeMapRow(i)} aria-label="remove">×</button>
        {/each}
      </div>
    {/if}
    <button type="button" class="sw-add" onclick={addMapRow}>+ Add mapping</button>
  </section>

  <!-- Wait for completion -->
  <section class="sw-sec">
    <header class="sw-sec-hdr"><span class="sr-label-tight">Execution mode</span></header>
    <label class="sw-toggle">
      <input
        type="checkbox"
        checked={waitForCompletion}
        onchange={(e) => set('waitForCompletion', (e.currentTarget as HTMLInputElement).checked)}
      />
      <span class="sw-toggle-text">
        <strong>Wait for completion</strong>
        <span class="sw-hint">
          {waitForCompletion
            ? 'Block until the sub-workflow finishes; pass its sink-node output downstream.'
            : 'Fire-and-forget — start the sub-workflow and continue immediately with empty output.'}
        </span>
      </span>
    </label>
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <RawConfigEditor {config} {onChange} />
</div>

<style>
  .sw { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .sw-sec { display: flex; flex-direction: column; gap: 8px; }
  .sw-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .sw-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  .sw-field { display: flex; flex-direction: column; gap: 4px; }
  .sw-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .sw-hint { font-size: var(--fs-label); color: var(--text-ghost); margin: 0; }
  .sw-empty { margin: 0; font-size: var(--fs-label); color: var(--text-ghost); }
  .sw-warn { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--status-error, #c0392b); }

  .sw-chip-row { margin: 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .sw-chip {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 3px 8px;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
    font-size: var(--fs-label);
    font-family: var(--font-mono);
    border-radius: 2px;
  }
  .sw-chip-dot { font-size: var(--fs-label-xs); line-height: 1; }
  .sw-chip-id { font-size: var(--fs-label-xs); color: var(--text-ghost); font-family: var(--font-mono); }

  .sw-kv-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr) 24px;
    gap: 4px;
  }
  .sw-kv-head {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted);
  }
  .sw-kv-input {
    padding: 5px 7px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: var(--fs-label);
    box-sizing: border-box;
    outline: none;
  }
  .sw-kv-input:focus { border-color: var(--text-muted); }
  .sw-kv-rm {
    background: transparent; color: var(--text-muted);
    border: 1px solid var(--card-border); cursor: pointer;
  }
  .sw-kv-rm:hover { color: var(--status-error, #c0392b); }
  .sw-add {
    align-self: flex-start;
    padding: 4px 10px;
    background: var(--bg); color: var(--text-muted);
    border: 1px dashed var(--card-border);
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
  }
  .sw-add:hover { color: var(--text-primary); }

  .sw-toggle {
    display: flex; align-items: flex-start; gap: 10px;
    padding: 8px 10px;
    border: 1px solid var(--card-border);
    background: var(--bg);
    cursor: pointer;
  }
  .sw-toggle input[type='checkbox'] {
    margin-top: 3px;
    width: 14px; height: 14px;
    accent-color: var(--accent);
    flex: 0 0 auto;
  }
  .sw-toggle-text { display: flex; flex-direction: column; gap: 3px; font-size: var(--fs-label); }
  .sw-toggle-text strong { color: var(--text-primary); }

  .sw-code {
    width: 100%;
    padding: 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-code); font-size: var(--fs-label);
    box-sizing: border-box;
    outline: none;
    resize: vertical;
  }
  .sw-code:focus { border-color: var(--text-muted); }

  input[type='text'], select, textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='text']:focus, select:focus, textarea:focus { border-color: var(--text-muted); }
</style>
