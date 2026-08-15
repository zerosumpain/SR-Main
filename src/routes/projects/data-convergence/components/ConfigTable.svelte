<script lang="ts">
  import type { StrandConfig, OutputConfig, ValidationIssue, ResolvedModel, Cadence } from '../lib/types';
  import { cadenceLabel } from '../lib/strands';
  import { STRAND_TEMPLATES } from '../lib/defaults';
  import { newId } from '../lib/storage';

  interface Props {
    strands: StrandConfig[];
    outputs: OutputConfig[];
    model: ResolvedModel;
    onChange: (next: { strands?: StrandConfig[]; outputs?: OutputConfig[] }) => void;
  }
  let { strands, outputs, model, onChange }: Props = $props();

  let mergeOptions = $derived([
    { id: 'spine', name: 'the spine' },
    ...strands.map((s) => ({ id: s.id, name: s.name })),
  ]);

  let issuesByStrand = $derived.by(() => {
    const map = new Map<string, ValidationIssue[]>();
    for (const i of model.issues) {
      if (!i.strandId) continue;
      const arr = map.get(i.strandId) ?? [];
      arr.push(i);
      map.set(i.strandId, arr);
    }
    return map;
  });

  const CADENCES: Cadence[] = ['daily', 'termly', 'biannual', 'annual', 'adhoc', 'continuous'];
  const PALETTE = ['#c0392b','#e67e22','#f1c40f','#d35400','#8e44ad','#9b59b6','#2980b9','#16a085','#27ae60','#34495e'];

  let addOpen = $state(false);
  let expandedSchemas = $state<Set<string>>(new Set());

  function updateStrand(idx: number, patch: Partial<StrandConfig>) {
    const next = [...strands];
    next[idx] = { ...next[idx], ...patch };
    onChange({ strands: next });
  }

  function toggleOutputForStrand(idx: number, outputId: string) {
    const cur = strands[idx].outputs ?? [];
    const next = cur.includes(outputId) ? cur.filter((x) => x !== outputId) : [...cur, outputId];
    updateStrand(idx, { outputs: next });
  }

  function addStrandFromTemplate(templateIdx: number) {
    const t = STRAND_TEMPLATES[templateIdx];
    const id = newId();
    const next: StrandConfig = {
      id,
      name: `New ${t.label.toLowerCase()}`,
      colour: PALETTE[strands.length % PALETTE.length],
      ...t.pattern,
    };
    onChange({ strands: [...strands, next] });
    addOpen = false;
  }

  function removeStrand(idx: number) {
    const next = [...strands];
    const removedId = strands[idx].id;
    next.splice(idx, 1);
    const fixed = next.map((s) => (s.mergeInto === removedId ? { ...s, mergeInto: 'spine' as const } : s));
    onChange({ strands: fixed });
  }

  function moveStrand(idx: number, dir: -1 | 1) {
    const next = [...strands];
    const dst = idx + dir;
    if (dst < 0 || dst >= next.length) return;
    const [item] = next.splice(idx, 1);
    next.splice(dst, 0, item);
    onChange({ strands: next });
  }

  function toggleSchemaEdit(id: string) {
    const next = new Set(expandedSchemas);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedSchemas = next;
  }

  function updateSchema(idx: number, text: string) {
    const fields = text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    updateStrand(idx, { schema: fields });
  }

  function addOutput() {
    const id = `out-${outputs.length + 1}-${Math.random().toString(36).slice(2, 5)}`;
    onChange({
      outputs: [
        ...outputs,
        { id, name: 'New output', colour: PALETTE[(outputs.length + 3) % PALETTE.length], visible: true },
      ],
    });
  }

  function updateOutput(idx: number, patch: Partial<OutputConfig>) {
    const next = [...outputs];
    next[idx] = { ...next[idx], ...patch };
    onChange({ outputs: next });
  }

  function removeOutput(idx: number) {
    const removedId = outputs[idx].id;
    const next = [...outputs];
    next.splice(idx, 1);
    const cleanedStrands = strands.map((s) =>
      s.outputs?.includes(removedId) ? { ...s, outputs: s.outputs.filter((x) => x !== removedId) } : s
    );
    onChange({ outputs: next, strands: cleanedStrands });
  }
</script>

<div class="cfg">
  <section>
    <header>
      <h3>Sources</h3>
      <div class="add-wrap">
        <button class="add" type="button" onclick={() => (addOpen = !addOpen)}>+ Add source</button>
        {#if addOpen}
          <div class="add-menu">
            {#each STRAND_TEMPLATES as t, i}
              <button type="button" class="add-item" onclick={() => addStrandFromTemplate(i)}>
                <span class="add-label">{t.label}</span>
                <span class="add-desc">{t.description}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </header>

    <div class="rows" role="table">
      <div class="row header" role="row">
        <span class="col-vis" aria-label="Visible"></span>
        <span class="col-colour"></span>
        <span class="col-name">Name</span>
        <span class="col-start">Start</span>
        <span class="col-merge">Merge</span>
        <span class="col-into">Into</span>
        <span class="col-users">Volume</span>
        <span class="col-cad">Cadence</span>
        <span class="col-ref">Ref</span>
        <span class="col-out">Outputs</span>
        <span class="col-move" aria-label="Move"></span>
        <span class="col-del"></span>
      </div>

      {#each strands as row, i (row.id)}
        {@const issues = issuesByStrand.get(row.id) ?? []}
        <div class="row" class:has-error={issues.some((x) => x.level === 'error')} class:hidden-row={row.visible === false} role="row">
          <label class="col-vis" title={row.visible === false ? 'Hidden' : 'Visible'}>
            <input type="checkbox" checked={row.visible !== false}
              onchange={(e) => updateStrand(i, { visible: (e.currentTarget as HTMLInputElement).checked })} />
          </label>
          <input class="col-colour" type="color" value={row.colour}
            oninput={(e) => updateStrand(i, { colour: (e.currentTarget as HTMLInputElement).value })} aria-label="Colour" />
          <input class="col-name" type="text" value={row.name} placeholder="Source name"
            oninput={(e) => updateStrand(i, { name: (e.currentTarget as HTMLInputElement).value })} />
          <input class="col-start" type="date" value={row.startDate.slice(0, 10)}
            oninput={(e) => updateStrand(i, { startDate: (e.currentTarget as HTMLInputElement).value })} />
          <input class="col-merge" type="date" value={row.mergeDate.slice(0, 10)}
            oninput={(e) => updateStrand(i, { mergeDate: (e.currentTarget as HTMLInputElement).value })} />
          <select class="col-into" value={row.mergeInto}
            onchange={(e) => updateStrand(i, { mergeInto: (e.currentTarget as HTMLSelectElement).value })}>
            {#each mergeOptions.filter((o) => o.id !== row.id) as opt}
              <option value={opt.id}>{opt.name}</option>
            {/each}
          </select>
          <input class="col-users" type="number" min="0" step="1" value={row.users}
            oninput={(e) => updateStrand(i, { users: Number((e.currentTarget as HTMLInputElement).value) })} />
          <select class="col-cad" value={row.cadence}
            onchange={(e) => updateStrand(i, { cadence: (e.currentTarget as HTMLSelectElement).value as Cadence })}>
            {#each CADENCES as c}
              <option value={c}>{cadenceLabel(c)}</option>
            {/each}
          </select>
          <label class="col-ref" title="Continuous reference-data feed">
            <input type="checkbox" checked={!!row.isReference}
              onchange={(e) => updateStrand(i, { isReference: (e.currentTarget as HTMLInputElement).checked })} />
          </label>
          <div class="col-out chips">
            {#each outputs as o}
              <button
                type="button"
                class="chip"
                class:active={row.outputs?.includes(o.id)}
                onclick={() => toggleOutputForStrand(i, o.id)}
                title={o.name}
                style="--c:{o.colour}"
              >
                <span class="chip-dot"></span>
                <span class="chip-label">{o.name}</span>
              </button>
            {/each}
          </div>
          <div class="col-move">
            <button type="button" onclick={() => moveStrand(i, -1)} disabled={i === 0} title="Move up">▲</button>
            <button type="button" onclick={() => moveStrand(i, 1)} disabled={i === strands.length - 1} title="Move down">▼</button>
          </div>
          <button class="col-del" type="button" onclick={() => removeStrand(i)} aria-label="Remove">×</button>
        </div>

        <div class="schema-row">
          <button type="button" class="schema-toggle" onclick={() => toggleSchemaEdit(row.id)}>
            {expandedSchemas.has(row.id) ? '▾' : '▸'} schema
            <span class="schema-summary">
              {(row.schema ?? []).join(' · ') || 'no fields defined'}
            </span>
          </button>
          {#if expandedSchemas.has(row.id)}
            <textarea
              class="schema-input"
              placeholder="comma- or newline-separated fields, e.g. pupilUPN, urn, sessionDate"
              value={(row.schema ?? []).join(', ')}
              oninput={(e) => updateSchema(i, (e.currentTarget as HTMLTextAreaElement).value)}
            ></textarea>
          {/if}
        </div>

        {#if issues.length}
          <div class="issues" role="row">
            {#each issues as iss}
              <div class={`iss ${iss.level}`}>{iss.message}</div>
            {/each}
          </div>
        {/if}
      {/each}
    </div>
  </section>

  <section class="outs">
    <header>
      <h3>Outputs (annual collections)</h3>
      <button class="add" type="button" onclick={addOutput}>+ Add output</button>
    </header>
    <div class="rows" role="table">
      <div class="row header out-header" role="row">
        <span class="col-vis"></span>
        <span class="col-colour"></span>
        <span class="col-name">Name</span>
        <span class="col-side">Side</span>
        <span class="col-anchor">Anchor (optional)</span>
        <span class="col-del"></span>
      </div>
      {#each outputs as row, i (row.id)}
        <div class="row out-row" class:hidden-row={row.visible === false} role="row">
          <label class="col-vis" title={row.visible === false ? 'Hidden' : 'Visible'}>
            <input type="checkbox" checked={row.visible !== false}
              onchange={(e) => updateOutput(i, { visible: (e.currentTarget as HTMLInputElement).checked })} />
          </label>
          <input class="col-colour" type="color" value={row.colour}
            oninput={(e) => updateOutput(i, { colour: (e.currentTarget as HTMLInputElement).value })} aria-label="Colour" />
          <input class="col-name" type="text" value={row.name}
            oninput={(e) => updateOutput(i, { name: (e.currentTarget as HTMLInputElement).value })} />
          <select class="col-side" value={row.side ?? ''}
            onchange={(e) => updateOutput(i, { side: ((e.currentTarget as HTMLSelectElement).value || undefined) as 'above' | 'below' | undefined })}>
            <option value="">auto</option>
            <option value="above">above</option>
            <option value="below">below</option>
          </select>
          <input class="col-anchor" type="date" value={row.anchorDate ?? ''}
            oninput={(e) => updateOutput(i, { anchorDate: (e.currentTarget as HTMLInputElement).value || undefined })} />
          <button class="col-del" type="button" onclick={() => removeOutput(i)} aria-label="Remove">×</button>
        </div>
      {/each}
    </div>
  </section>

  {#if model.issues.filter((i) => !i.strandId && !i.outputId).length > 0}
    <div class="global-issues">
      {#each model.issues.filter((i) => !i.strandId && !i.outputId) as iss}
        <div class={`iss ${iss.level}`}>{iss.message}</div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .cfg {
    color: var(--ink);
    font-family: var(--font-body);
  }
  section { margin-bottom: 26px; }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }
  h3 {
    font-family: var(--fs-serif);
    font-size: var(--fs-body);
    font-weight: 500;
    margin: 0;
  }
  .add-wrap { position: relative; }
  .add {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    background: rgba(255, 255, 255, 0.4);
    color: var(--ink);
    border: 1px dashed rgba(28, 22, 17, 0.35);
    padding: 6px 10px;
    border-radius: var(--radius-sharp);
    cursor: pointer;
    text-transform: uppercase;
  }
  .add:hover { background: rgba(255,255,255,0.7); }
  .add-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    background: var(--paper);
    border: 1px solid rgba(28, 22, 17, 0.18);
    border-radius: var(--radius-sharp);
    min-width: 280px;
    z-index: 5;
    padding: 4px;
  }
  .add-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    padding: 8px 10px;
    border: none;
    background: transparent;
    color: var(--ink);
    border-radius: var(--radius-sharp);
    font-family: inherit;
    cursor: pointer;
    text-align: left;
  }
  .add-item:hover { background: rgba(28, 22, 17, 0.07); }
  .add-label { font-weight: 500; font-size: var(--fs-label); }
  .add-desc { font-size: var(--fs-label-xs); color: rgba(28, 22, 17, 0.6); margin-top: 2px; }

  .rows { display: flex; flex-direction: column; gap: 4px; }

  .row {
    display: grid;
    grid-template-columns:
      22px              /* vis */
      22px              /* colour */
      minmax(110px, 1.3fr)  /* name */
      120px             /* start */
      120px             /* merge */
      minmax(110px, 0.9fr)  /* into */
      70px              /* users */
      120px             /* cadence */
      32px              /* ref */
      minmax(160px, 1.4fr)  /* outputs */
      40px              /* move */
      22px;             /* delete */
    gap: 6px;
    align-items: center;
    padding: 4px 6px;
    border-radius: var(--radius-sharp);
    transition: opacity 0.12s;
  }
  .row.hidden-row { opacity: 0.4; }
  .row.header {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.55);
    padding-top: 4px;
  }
  .row.has-error { background: rgba(177, 60, 48, 0.06); }
  .row:hover:not(.header) { background: rgba(28, 22, 17, 0.03); }

  input, select, textarea {
    font: inherit;
    color: var(--ink);
    background: rgba(255, 255, 255, 0.55);
    border: 1px solid rgba(28, 22, 17, 0.15);
    padding: 6px 8px;
    border-radius: var(--radius-sharp);
    font-size: var(--fs-label);
    min-width: 0;
    width: 100%;
  }
  input:focus, select:focus, textarea:focus {
    outline: 2px solid rgba(28, 22, 17, 0.35);
    outline-offset: -1px;
  }
  input[type="color"] {
    padding: 0;
    height: 22px;
    cursor: pointer;
    width: 22px;
    border-radius: var(--radius-pill);
    overflow: hidden;
    background: transparent;
  }
  input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
  input[type="color"]::-webkit-color-swatch { border: 1px solid rgba(28, 22, 17, 0.25); border-radius: var(--radius-pill); }
  input[type="color"]::-moz-color-swatch { border: 1px solid rgba(28, 22, 17, 0.25); border-radius: var(--radius-pill); }
  input[type="checkbox"] { width: 16px; height: 16px; }

  .col-vis, .col-ref { display: flex; justify-content: center; align-items: center; }

  .col-out {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    border-radius: var(--radius-pill);
    border: 1px solid rgba(28, 22, 17, 0.18);
    background: rgba(255, 255, 255, 0.45);
    font-size: var(--fs-label-xs);
    cursor: pointer;
    color: var(--ink);
    transition: background 0.12s;
  }
  .chip:hover { background: rgba(255, 255, 255, 0.8); }
  .chip.active {
    background: var(--c);
    color: white;
    border-color: var(--c);
  }
  .chip-dot {
    width: 7px;
    height: 7px;
    border-radius: var(--radius-pill);
    background: var(--c);
    border: 1px solid rgba(28, 22, 17, 0.15);
  }
  .chip.active .chip-dot {
    background: rgba(255, 255, 255, 0.85);
    border-color: transparent;
  }
  .chip-label {
    max-width: 100px;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
  }

  .col-move {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .col-move button {
    width: 22px;
    height: 14px;
    padding: 0;
    border: 1px solid rgba(28, 22, 17, 0.15);
    background: rgba(255, 255, 255, 0.55);
    color: rgba(28, 22, 17, 0.6);
    font-size: var(--fs-label-xs);
    border-radius: var(--radius-sharp);
    cursor: pointer;
  }
  .col-move button:hover:not(:disabled) { background: rgba(255, 255, 255, 0.9); color: var(--ink); }
  .col-move button:disabled { opacity: 0.3; cursor: default; }

  .out-header, .out-row {
    grid-template-columns: 22px 22px 1.4fr 100px 140px 22px;
  }

  .col-del {
    border: none;
    background: transparent;
    color: rgba(28, 22, 17, 0.4);
    cursor: pointer;
    font-size: 20px;
    line-height: 1;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sharp);
    padding: 0;
  }
  .col-del:hover {
    background: var(--error-bg);
    color: var(--error);
  }

  .schema-row {
    padding: 0 6px 4px 56px;
  }
  .schema-toggle {
    background: transparent;
    border: none;
    color: rgba(28, 22, 17, 0.55);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    cursor: pointer;
    padding: 1px 0;
  }
  .schema-toggle:hover { color: var(--ink); }
  .schema-summary {
    color: rgba(28, 22, 17, 0.6);
    margin-left: 6px;
    text-transform: none;
    letter-spacing: 0;
  }
  .schema-input {
    margin-top: 4px;
    min-height: 48px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    resize: vertical;
  }

  .issues {
    padding: 2px 6px 6px 56px;
  }
  .iss {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    padding: 2px 6px;
    border-radius: var(--radius-sharp);
  }
  .iss.error { color: var(--error); background: var(--error-bg); }
  .iss.warning { color: var(--warn); background: var(--warn-bg); }

  .global-issues {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  @media (max-width: 980px) {
    .row.header { display: none; }
    .row {
      grid-template-columns: 22px 22px 1fr 22px;
      grid-template-areas:
        'vis colour name del'
        'start start start start'
        'merge merge merge merge'
        'into into into into'
        'users users users users'
        'cad cad cad cad'
        'ref ref ref ref'
        'out out out out'
        'move move move move';
      padding: 8px;
      background: rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(28, 22, 17, 0.08);
    }
    .col-vis { grid-area: vis; }
    .col-colour { grid-area: colour; }
    .col-name { grid-area: name; }
    .col-start { grid-area: start; }
    .col-merge { grid-area: merge; }
    .col-into { grid-area: into; }
    .col-users { grid-area: users; }
    .col-cad { grid-area: cad; }
    .col-ref { grid-area: ref; }
    .col-out { grid-area: out; }
    .col-move { grid-area: move; flex-direction: row; justify-content: flex-end; }
    .col-del { grid-area: del; }
    .out-row {
      grid-template-columns: 22px 22px 1fr 22px;
      grid-template-areas:
        'vis colour name del'
        'side side side side'
        'anchor anchor anchor anchor';
    }
    .col-side { grid-area: side; }
    .col-anchor { grid-area: anchor; }
    .schema-row { padding-left: 8px; }
  }
</style>
