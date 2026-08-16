<script lang="ts">
  import type { YearResult } from '../lib/types';
  import { OUTCOMES_BY_ID, SCORECARD_IDS, OUTCOME_ELI5, OUTCOME_ELI5_LABEL } from '../lib/outcomes';
  import { fmtNum } from '../lib/format';
  import { app } from '../lib/appState.svelte';
  const meaning = (id: string) => (app.narrative === 'eli5' ? OUTCOME_ELI5[id] ?? '' : OUTCOMES_BY_ID[id]?.blurb ?? '');
  const lbl = (id: string) => (app.narrative === 'eli5' ? OUTCOME_ELI5_LABEL[id] ?? OUTCOMES_BY_ID[id]?.label : OUTCOMES_BY_ID[id]?.label);

  interface Props {
    sim: YearResult[];
    baseSim: YearResult[];
    horizon: number; // year to headline (e.g. 2040)
  }
  let { sim, baseSim, horizon }: Props = $props();

  const row = (s: YearResult[], yr: number) => s.find((y) => y.year === yr) ?? s[s.length - 1];

  const cards = $derived(SCORECARD_IDS.map((id) => {
    const m = OUTCOMES_BY_ID[id];
    const yNow = row(sim, sim[0].year);
    const yEnd = row(sim, horizon);
    const yMid = row(sim, 2030);
    const bEnd = row(baseSim, horizon);
    const val = (yEnd as any)[id] as number;
    const base = (bEnd as any)[id] as number;
    const mid = (yMid as any)[id] as number;
    const start = (yNow as any)[id] as number;
    const delta = val - base;                 // vs status-quo baseline
    const good = m.neutral ? null : ((delta > 0) === m.goodIfUp);
    return { m, val, base, mid, start, delta, good };
  }));

  function tone(good: boolean | null): string {
    if (good === null) return 'neutral';
    return good ? 'good' : 'bad';
  }
</script>

<div class="scorecard">
  <p class="sc-note">
    Outcomes in <b>{horizon}</b> for your policy package. The chip shows the change vs the
    <b>status-quo</b> trajectory (doing nothing new). Green = better, red = worse.
  </p>
  <div class="grid">
    {#each cards as c (c.m.id)}
      <div class="card tone-{tone(c.good)}" title={meaning(c.m.id)}>
        <div class="c-label">{lbl(c.m.id)}<span class="c-q">?</span></div>
        <div class="c-main">
          <span class="c-val">{fmtNum(c.val, c.m.dp)}</span>
          <span class="c-unit">{c.m.unit}</span>
        </div>
        <div class="c-foot">
          {#if c.m.id !== 'cumulativeCost'}
            <span class="c-delta tone-{tone(c.good)}">
              {c.delta > 0 ? '▲' : c.delta < 0 ? '▼' : '–'} {fmtNum(Math.abs(c.delta), c.m.dp)} vs status quo
            </span>
          {:else}
            <span class="c-delta neutral">total additional spend</span>
          {/if}
          <span class="c-start">{fmtNum(c.start, c.m.dp)} in {sim[0].year}</span>
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .scorecard { display: flex; flex-direction: column; gap: 10px; }
  .sc-note { margin: 0; font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.65); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 8px; }
  .card {
    background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.12);
    border-radius: var(--radius-sharp); padding: 9px 10px; border-left-width: 3px;
  }
  .card.tone-good { border-left-color: var(--success); }
  .card.tone-bad { border-left-color: var(--error); }
  .card.tone-neutral { border-left-color: rgba(28,22,17,0.35); }
  .card { cursor: help; }
  .c-label { font-size: var(--fs-label-xs); line-height: 1.3; color: rgba(28,22,17,0.72); min-height: 28px; display: flex; align-items: flex-start; gap: 4px; }
  .c-q { display: inline-flex; align-items: center; justify-content: center; width: 12px; height: 12px; border-radius: var(--radius-pill); flex-shrink: 0;
    border: 1px solid rgba(28,22,17,0.3); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); margin-top: 1px; }
  .c-main { display: flex; align-items: baseline; gap: 4px; margin: 3px 0 4px; }
  .c-val { font-family: var(--fs-serif); font-weight: 600; font-size: 23px; color: var(--ink); line-height: 1; }
  .c-unit { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); }
  .c-foot { display: flex; flex-direction: column; gap: 2px; }
  .c-delta { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; }
  .c-delta.tone-good { color: var(--success); }
  .c-delta.tone-bad { color: var(--error); }
  .c-delta.neutral { color: rgba(28,22,17,0.5); font-weight: 500; }
  .c-start { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.4); }
</style>
