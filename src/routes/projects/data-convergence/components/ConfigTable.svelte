<script lang="ts">
  import type { StrandConfig, ValidationIssue, ResolvedModel } from '../lib/types';

  interface Props {
    config: StrandConfig[];
    model: ResolvedModel;
    onChange: (next: StrandConfig[]) => void;
  }
  let { config, model, onChange }: Props = $props();

  let mergeOptions = $derived([
    { id: 'spine', name: 'the spine' },
    ...config.map((s) => ({ id: s.id, name: s.name })),
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

  function updateRow(idx: number, patch: Partial<StrandConfig>) {
    const next = [...config];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  }

  function addRow() {
    const newId = uniqueId();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 2);
    const mergeDate = new Date();
    mergeDate.setFullYear(mergeDate.getFullYear() + 1);
    const colours = ['#b95431','#c98a2a','#4a6b8a','#6a8f4f','#7a4a8c','#356b6b','#8a6f3a','#9b3a55'];
    onChange([
      ...config,
      {
        id: newId,
        name: 'New source',
        colour: colours[config.length % colours.length],
        startDate: startDate.toISOString().slice(0, 10),
        mergeDate: mergeDate.toISOString().slice(0, 10),
        mergeInto: 'spine',
        users: 100,
        frequency: 1,
        frequencyPeriod: 'day',
      },
    ]);
  }

  function removeRow(idx: number) {
    const next = [...config];
    next.splice(idx, 1);
    // Repoint anyone whose mergeInto pointed at the removed strand.
    const removedId = config[idx].id;
    const fixed = next.map((s) => (s.mergeInto === removedId ? { ...s, mergeInto: 'spine' as const } : s));
    onChange(fixed);
  }

  function uniqueId(): string {
    const base = 'src-';
    let i = config.length + 1;
    while (config.some((s) => s.id === base + i)) i++;
    return base + i;
  }
</script>

<div class="cfg">
  <header>
    <h3>Sources</h3>
    <button class="add" onclick={addRow} type="button">+ Add source</button>
  </header>

  <div class="rows" role="table">
    <div class="row header" role="row">
      <span class="col-colour" role="columnheader" aria-label="Colour"></span>
      <span class="col-name" role="columnheader">Name</span>
      <span class="col-start" role="columnheader">Start</span>
      <span class="col-merge" role="columnheader">Merge</span>
      <span class="col-into" role="columnheader">Into</span>
      <span class="col-users" role="columnheader">Users</span>
      <span class="col-freq" role="columnheader">Frequency</span>
      <span class="col-del" role="columnheader" aria-label="Remove"></span>
    </div>

    {#each config as row, i (row.id)}
      {@const issues = issuesByStrand.get(row.id) ?? []}
      <div class="row" class:has-error={issues.some((x) => x.level === 'error')} role="row">
        <input
          class="col-colour"
          type="color"
          value={row.colour}
          oninput={(e) => updateRow(i, { colour: (e.currentTarget as HTMLInputElement).value })}
          aria-label="Colour"
        />
        <input
          class="col-name"
          type="text"
          value={row.name}
          oninput={(e) => updateRow(i, { name: (e.currentTarget as HTMLInputElement).value })}
          placeholder="Source name"
        />
        <input
          class="col-start"
          type="date"
          value={row.startDate.slice(0, 10)}
          oninput={(e) => updateRow(i, { startDate: (e.currentTarget as HTMLInputElement).value })}
        />
        <input
          class="col-merge"
          type="date"
          value={row.mergeDate.slice(0, 10)}
          oninput={(e) => updateRow(i, { mergeDate: (e.currentTarget as HTMLInputElement).value })}
        />
        <select
          class="col-into"
          value={row.mergeInto}
          onchange={(e) => updateRow(i, { mergeInto: (e.currentTarget as HTMLSelectElement).value })}
        >
          {#each mergeOptions.filter((o) => o.id !== row.id) as opt}
            <option value={opt.id}>{opt.name}</option>
          {/each}
        </select>
        <input
          class="col-users"
          type="number"
          min="0"
          step="1"
          value={row.users}
          oninput={(e) => updateRow(i, { users: Number((e.currentTarget as HTMLInputElement).value) })}
        />
        <span class="col-freq">
          <input
            type="number"
            min="0"
            step="0.1"
            value={row.frequency}
            oninput={(e) => updateRow(i, { frequency: Number((e.currentTarget as HTMLInputElement).value) })}
            aria-label="Frequency value"
          />
          <span class="sl">/</span>
          <select
            value={row.frequencyPeriod}
            onchange={(e) => updateRow(i, { frequencyPeriod: (e.currentTarget as HTMLSelectElement).value as any })}
            aria-label="Frequency period"
          >
            <option value="day">day</option>
            <option value="week">week</option>
            <option value="month">month</option>
            <option value="quarter">quarter</option>
          </select>
        </span>
        <button class="col-del" type="button" onclick={() => removeRow(i)} aria-label="Remove">×</button>
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

  {#if model.issues.filter((i) => !i.strandId).length > 0}
    <div class="global-issues">
      {#each model.issues.filter((i) => !i.strandId) as iss}
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
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }
  h3 {
    font-family: 'Fraunces', serif;
    font-size: 18px;
    font-weight: 500;
    letter-spacing: 0.01em;
    margin: 0;
  }
  .add {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 11px;
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
      28px            /* colour */
      minmax(110px, 1.4fr) /* name */
      130px           /* start */
      130px           /* merge */
      minmax(120px, 1fr) /* into */
      80px            /* users */
      minmax(140px, 1fr) /* freq */
      28px;           /* delete */
    gap: 6px;
    align-items: center;
    padding: 4px 6px;
    border-radius: 4px;
    transition: background 0.14s;
  }
  .row.header {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.55);
    padding: 4px 6px 2px;
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
    height: 24px;
    cursor: pointer;
    width: 24px;
    border-radius: 50%;
    overflow: hidden;
    background: transparent;
  }
  input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
  input[type="color"]::-webkit-color-swatch { border: 1px solid rgba(28, 22, 17, 0.25); border-radius: 50%; }
  input[type="color"]::-moz-color-swatch { border: 1px solid rgba(28, 22, 17, 0.25); border-radius: 50%; }

  .col-freq {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .col-freq .sl {
    color: rgba(28, 22, 17, 0.45);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 13px;
  }
  .col-freq input { flex: 1 1 60px; max-width: 72px; }

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

  @media (max-width: 880px) {
    /* Stack each row into a card on narrow screens. */
    .row.header { display: none; }
    .row {
      grid-template-columns: 28px 1fr 28px;
      grid-auto-rows: auto;
      grid-template-areas:
        'colour name del'
        'start start start'
        'merge merge merge'
        'into into into'
        'users users users'
        'freq freq freq';
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
    .col-freq { grid-area: freq; }
    .col-del { grid-area: del; }
    .col-start::before { content: 'starts ' ; color: rgba(28, 22, 17, 0.4); }
  }
</style>
