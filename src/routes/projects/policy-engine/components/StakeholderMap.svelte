<script lang="ts">
  // StakeholderMap — who owns what across the NEET system: life stage × function,
  // with the documented coordination failures marked as numbered fault lines.
  import { app } from '../lib/appState.svelte';

  const eli = $derived(app.narrative === 'eli5');

  const ORG_COLOUR: Record<string, string> = {
    DfE: '#2f6f97', DWP: '#7a5aa6', LA: '#b4632e', MCA: '#9a7b1f',
    CEC: '#3f7d6e', 'Colleges/ITPs': '#566a8c', NHS: '#b1455e', YFF: '#4a7c7c', Employers: '#5a6b3a',
  };

  const FUNCTIONS = ['Tracking', 'Funding', 'Delivery', 'Careers', 'Health', 'Evidence'];
  interface Row { stage: string; eli5: string; cells: Record<string, { orgs: string[]; faults?: number[] }> }
  const ROWS: Row[] = [
    {
      stage: 'Pre-16', eli5: 'At school',
      cells: {
        Tracking: { orgs: ['DfE'] },
        Funding: { orgs: ['DfE'] },
        Delivery: { orgs: ['DfE', 'LA'] },
        Careers: { orgs: ['CEC'], faults: [] },
        Health: { orgs: ['NHS'], faults: [2] },
        Evidence: { orgs: ['DfE', 'YFF'] },
      },
    },
    {
      stage: '16–18', eli5: 'Leaving school',
      cells: {
        Tracking: { orgs: ['LA'], faults: [3] },
        Funding: { orgs: ['DfE'] },
        Delivery: { orgs: ['Colleges/ITPs', 'Employers'], faults: [4] },
        Careers: { orgs: ['CEC', 'LA'] },
        Health: { orgs: ['NHS'], faults: [2] },
        Evidence: { orgs: ['YFF'] },
      },
    },
    {
      stage: '18–24', eli5: 'After 18',
      cells: {
        Tracking: { orgs: [], faults: [1] },
        Funding: { orgs: ['DWP', 'MCA'] },
        Delivery: { orgs: ['DWP', 'MCA', 'Employers'], faults: [5] },
        Careers: { orgs: ['DWP'] },
        Health: { orgs: ['NHS'], faults: [2] },
        Evidence: { orgs: ['YFF'] },
      },
    },
  ];

  const FAULTS = [
    {
      n: 1,
      text: 'The tracking duty dies at 18 (dropped 2016) while NEET peaks at 18–24 — institutions relinquish responsibility without anyone picking it up.',
      eli5: 'No one is responsible for tracking anyone over 18 — exactly when most young people become NEET.',
    },
    {
      n: 2,
      text: 'DfE’s data-sharing guidance tells LAs to agree flows with education providers but omits Jobcentres and integrated care boards — the health signal never reaches the risk lists.',
      eli5: 'The official data-sharing rules forgot to include job centres and the NHS.',
    },
    {
      n: 3,
      text: '“Destination not known” rates vary from ~1% to >20% between LAs, corrupting local NEET comparisons and any targeting built on them.',
      eli5: 'Some councils lose track of 1 in 5 of their school-leavers, so the local numbers can’t be trusted.',
    },
    {
      n: 4,
      text: 'SEND transitions fragment across school, college, LA and health at exactly the point EHCP holders face the highest NEET risk (~⅔ ever-NEET at 20–24).',
      eli5: 'Support for special-needs young people is split between four different organisations right when they need it most.',
    },
    {
      n: 5,
      text: 'No single owner of the 16–24 outcome: DfE owns 16–18 education, DWP owns 18+ benefits and employment, LAs track to 18, MCAs hold pieces of skills — a core Milburn theme.',
      eli5: 'Four different bodies each own a piece of the problem; nobody owns the whole young person.',
    },
  ];
</script>

<div class="shm">
  <div class="grid-scroll">
    <table>
      <thead>
        <tr><th class="stage-h"></th>{#each FUNCTIONS as f (f)}<th>{f}</th>{/each}</tr>
      </thead>
      <tbody>
        {#each ROWS as r (r.stage)}
          <tr>
            <td class="stage">{eli ? r.eli5 : r.stage}</td>
            {#each FUNCTIONS as f (f)}
              {@const cell = r.cells[f]}
              <td class:fault={!!cell.faults?.length}>
                {#if cell.orgs.length === 0}
                  <span class="nobody">{eli ? 'no one' : '— none —'}</span>
                {:else}
                  {#each cell.orgs as o (o)}<span class="org" style="--c:{ORG_COLOUR[o]}">{o}</span>{/each}
                {/if}
                {#if cell.faults?.length}
                  {#each cell.faults as fn (fn)}<span class="fmark" title={FAULTS[fn - 1].text}>⚠{fn}</span>{/each}
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <ol class="faults">
    {#each FAULTS as f (f.n)}
      <li><span class="fnum">⚠{f.n}</span> {eli ? f.eli5 : f.text}</li>
    {/each}
  </ol>
</div>

<style>
  .shm { display: flex; flex-direction: column; gap: 12px; }
  .grid-scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; min-width: 640px; }
  th { text-align: left; font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em;
    color: rgba(28,22,17,0.5); padding: 4px 10px 6px 6px; border-bottom: 1px solid rgba(28,22,17,0.18); }
  td { padding: 8px 10px 8px 6px; border-bottom: 1px solid rgba(28,22,17,0.08); vertical-align: top; }
  td.fault { background: var(--error-bg); }
  .stage { font-family: 'Fraunces', serif; font-weight: 600; font-size: 13px; color: var(--ink); white-space: nowrap; }
  .org { display: inline-block; margin: 1px 3px 1px 0; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; font-weight: 600;
    color: var(--c); background: color-mix(in srgb, var(--c) 12%, transparent); border: 1px solid color-mix(in srgb, var(--c) 35%, transparent);
    border-radius: var(--radius-round); padding: 2px 6px; white-space: nowrap; }
  .nobody { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #8a2d3a; font-style: italic; }
  .fmark { display: inline-block; margin-left: 3px; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: #8a2d3a; cursor: help; }
  .faults { margin: 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
  .faults li { font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.74); padding-left: 8px; border-left: 2px solid var(--error-border); }
  .fnum { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; color: #8a2d3a; margin-right: 4px; }
</style>
