<script lang="ts">
  import type { StrandConfig, OutputConfig, ValidationIssue, ResolvedModel, Cadence } from '../lib/types';
  import { cadenceLabel } from '../lib/strands';

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

  function addStrand() {
    const newId = `src-${strands.length + 1}-${Math.random().toString(36).slice(2, 6)}`;
    const start = new Date(); start.setFullYear(start.getFullYear() - 2);
    const merge = new Date(); merge.setFullYear(merge.getFullYear() + 1);
    const colours = ['#c0392b','#e67e22','#8e44ad','#16a085','#2980b9','#27ae60','#34495e','#d35400'];
    onChange({
      strands: [
        ...strands,
        {
          id: newId,
          name: 'New source',
          colour: colours[strands.length % colours.length],
          startDate: start.toISOString().slice(0, 10),
          mergeDate: merge.toISOString().slice(0, 10),
          mergeInto: 'spine',
          users: 100,
          cadence: 'annual',
          outputs: [],
          isReference: false,
        },
      ],
    });
  }

  function removeStrand(idx: number) {
    const next = [...strands];
    const removedId = strands[idx].id;
    next.splice(idx, 1);
    const fixed = next.map((s) => (s.mergeInto === removedId ? { ...s, mergeInto: 'spine' as const } : s));
    onChange({ strands: fixed });
  }

  function addOutput() {
    const id = `out-${outputs.length + 1}-${Math.random().toString(36).slice(2, 5)}`;
    const colours = ['#c0392b','#e67e22','#8e44ad','#16a085','#2980b9','#27ae60','#34495e'];
    onChange({
      outputs: [
        ...outputs,
        { id, name: 'New output', colour: colours[outputs.length % colours.length] },
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
    // Also strip from strand.outputs
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
      <button class="add" type="button" onclick={addStrand}>+ Add source</button>
    </header>

    <div class="rows" role="table">
      <div class="row header" role="row">
        <span class="col-colour" role="columnheader" aria-label="Colour"></span>
        <span class="col-name">Name</span>
        <span class="col-start">Start</span>
        <span class="col-merge">Merge</span>
        <span class="col-into">Into</span>
        <span class="col-users">Volume</span>
        <span class="col-cad">Cadence</span>
        <span class="col-ref">Ref</span>
        <span class="col-out">Outputs</span>
        <span class="col-del" aria-label="Remove"></span>
      </div>

      {#each strands as row, i (row.id)}
        {@const issues = issuesByStrand.get(row.id) ?? []}
        <div class="row" class:has-error={issues.some((x) => x.level === 'error')} role="row">
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
          <label class="col-ref" title="Treat as continuous reference-data feed">
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
          <button class="col-del" type="button" onclick={() => removeStrand(i)} aria-label="Remove">×</button>
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
      <h3>Outputs (business activities)</h3>
      <button class="add" type="button" onclick={addOutput}>+ Add output</button>
    </header>
    <div class="rows" role="table">
      <div class="row header out-header" role="row">
        <span class="col-colour"></span>
        <span class="col-name">Name</span>
        <span class="col-side">Side</span>
        <span class="col-anchor">Anchor</span>
        <span class="col-del"></span>
      </div>
      {#each outputs as row, i (row.id)}
        <div class="row out-row" role="row">
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
    font-family: 'DM Sans', system-ui, sans-serif;
  }
  section { margin-bottom: 26px; }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }
  h3 {
    font-family: 'Fraunces', serif;
    font-size: 16px;
    font-weight: 500;
    margin: 0;
  }
  .add {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 10.5px;
    letter-spacing: 0.08em;
    background: rgba(255, 255, 255, 0.4);
    color: var(--ink);
    border: 1px dashed rgba(28, 22, 17, 0.35);
    padding: 6px 10px;
    border-radius: 4px;
    cursor: pointer;
    text-transform: uppercase;
  }
  .add:hover { background: rgba(255,255,255,0.7); }

  .rows { display: flex; flex-direction: column; gap: 4px; }

  .row {
    display: grid;
    grid-template-columns:
      24px              /* colour */
      minmax(110px, 1.4fr)  /* name */
      124px             /* start */
      124px             /* merge */
      minmax(110px, 0.9fr)  /* into */
      72px              /* users */
      120px             /* cadence */
      40px              /* ref */
      minmax(160px, 1.4fr)  /* outputs */
      24px;             /* delete */
    gap: 6px;
    align-items: center;
    padding: 4px 6px;
    border-radius: 4px;
  }
  .row.header {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.55);
    padding-top: 4px;
  }
  .row.has-error { background: rgba(177, 60, 48, 0.06); }
  .row:hover:not(.header) { background: rgba(28, 22, 17, 0.03); }

  input, select {
    font: inherit;
    color: var(--ink);
    background: rgba(255, 255, 255, 0.55);
    border: 1px solid rgba(28, 22, 17, 0.15);
    padding: 6px 8px;
    border-radius: 4px;
    font-size: 12.5px;
    min-width: 0;
    width: 100%;
  }
  input:focus, select:focus {
    outline: 2px solid rgba(28, 22, 17, 0.35);
    outline-offset: -1px;
  }
  input[type="color"] {
    padding: 0;
    height: 22px;
    cursor: pointer;
    width: 22px;
    border-radius: 50%;
    overflow: hidden;
    background: transparent;
  }
  input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
  input[type="color"]::-webkit-color-swatch { border: 1px solid rgba(28, 22, 17, 0.25); border-radius: 50%; }
  input[type="color"]::-moz-color-swatch { border: 1px solid rgba(28, 22, 17, 0.25); border-radius: 50%; }

  .col-ref { display: flex; justify-content: center; }
  .col-ref input[type="checkbox"] { width: 16px; height: 16px; }

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
    border-radius: 12px;
    border: 1px solid rgba(28, 22, 17, 0.18);
    background: rgba(255, 255, 255, 0.45);
    font-size: 10.5px;
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
    border-radius: 50%;
    background: var(--c);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.15);
  }
  .chip.active .chip-dot {
    background: rgba(255, 255, 255, 0.85);
    box-shadow: none;
  }
  .chip-label {
    max-width: 96px;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
  }

  /* Output rows have fewer columns */
  .out-header, .out-row {
    grid-template-columns: 24px 1.4fr 100px 140px 24px;
  }

  .col-del {
    border: none;
    background: transparent;
    color: rgba(28, 22, 17, 0.4);
    cursor: pointer;
    font-size: 20px;
    line-height: 1;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    padding: 0;
  }
  .col-del:hover {
    background: rgba(177, 60, 48, 0.12);
    color: #b13c30;
  }

  .issues {
    padding: 2px 6px 6px 36px;
  }
  .iss {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 10.5px;
    letter-spacing: 0.04em;
    padding: 2px 6px;
    border-radius: 3px;
  }
  .iss.error { color: #b13c30; background: rgba(177, 60, 48, 0.06); }
  .iss.warning { color: #8a6f3a; background: rgba(138, 111, 58, 0.08); }

  .global-issues {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  @media (max-width: 980px) {
    .row.header { display: none; }
    .row {
      grid-template-columns: 24px 1fr 24px;
      grid-template-areas:
        'colour name del'
        'start start start'
        'merge merge merge'
        'into into into'
        'users users users'
        'cad cad cad'
        'ref ref ref'
        'out out out';
      padding: 8px;
      background: rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(28, 22, 17, 0.08);
    }
    .col-colour { grid-area: colour; }
    .col-name { grid-area: name; }
    .col-start { grid-area: start; }
    .col-merge { grid-area: merge; }
    .col-into { grid-area: into; }
    .col-users { grid-area: users; }
    .col-cad { grid-area: cad; }
    .col-ref { grid-area: ref; }
    .col-out { grid-area: out; }
    .col-del { grid-area: del; }
    .out-row {
      grid-template-columns: 24px 1fr 24px;
      grid-template-areas:
        'colour name del'
        'side side side'
        'anchor anchor anchor';
    }
    .col-side { grid-area: side; }
    .col-anchor { grid-area: anchor; }
  }
</style>
