<script lang="ts">
  /**
   * Steps, person by person: everyone's daily average on one scale, most
   * first, with their weekday and weekend averages beside it, then each
   * person's week as seven small columns on one shared scale, so "who walks
   * most on a Saturday" reads straight across. The pilot keeps one count a
   * day, so these are days' averages, from `steps.mean` and `steps.week`.
   *
   * Weekdays and weekends use the same two hues (and labels) as the times-of-
   * day chart above, so the pair means one thing on the page.
   */
  import type { PersonPattern } from '$lib/home/presence/patterns';

  let { people, focus }: { people: PersonPattern[]; focus: PersonPattern | null } = $props();

  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const rows = $derived(
    people
      .filter((p) => p.steps.days > 0 && p.steps.mean != null)
      .map((p) => {
        const seen = p.steps.week.filter((w) => w.mean > 0);
        return {
          p,
          mean: p.steps.mean!,
          weekday: avg(seen.filter((w) => w.weekday < 5).map((w) => w.mean)),
          weekend: avg(seen.filter((w) => w.weekday >= 5).map((w) => w.mean)),
          week: p.steps.week,
        };
      })
      .sort((a, b) => b.mean - a.mean),
  );
  const household = $derived(avg(rows.map((r) => r.mean)));
  const max = $derived(Math.ceil(Math.max(5000, ...rows.flatMap((r) => [r.mean, r.weekday ?? 0, r.weekend ?? 0])) / 2500) * 2500);
  const weekMax = $derived(Math.max(1, ...rows.flatMap((r) => r.week.map((w) => w.mean))));
  // Who leads each weekday, for the column the eye should land on.
  const leader = $derived(DAYS.map((_, wd) => rows.reduce<string | null>((best, r) => {
    const v = r.week.find((w) => w.weekday === wd)?.mean ?? 0;
    const bv = best ? (rows.find((x) => x.p.subject === best)!.week.find((w) => w.weekday === wd)?.mean ?? 0) : 0;
    return v > bv ? r.p.subject : best;
  }, null)));
  const n = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-GB'));
  const k = (v: number) => (v ? `${(v / 1000).toFixed(1)}k` : '');
</script>

{#if rows.length >= 1}
  <div class="sc">
    <ul class="sc-legend" aria-label="Legend">
      <li><span class="sw mean"></span>Average day</li>
      <li><span class="sw wkdy"></span>Weekdays</li>
      <li><span class="sw wknd"></span>Weekends</li>
      {#if household != null && rows.length > 1}<li class="sc-hh">Household average <b>{n(household)}</b></li>{/if}
    </ul>
    <ol class="sc-rows">
      {#each rows as r, i (r.p.subject)}
        <li class="sc-row" class:lit={focus?.subject === r.p.subject}>
          <span class="sc-name">{r.p.displayName}{#if i === 0 && rows.length > 1}<small>most</small>{/if}</span>
          <span class="sc-bars" role="img" aria-label={`${r.p.displayName}: ${n(r.mean)} steps a day on average; ${n(r.weekday)} on weekdays, ${n(r.weekend)} at weekends; ${r.p.steps.days} days counted`}>
            <span class="bar mean" style:width={`${(r.mean / max) * 100}%`}></span>
            {#if r.weekday != null}<span class="bar wkdy" style:width={`${(r.weekday / max) * 100}%`}></span>{/if}
            {#if r.weekend != null}<span class="bar wknd" style:width={`${(r.weekend / max) * 100}%`}></span>{/if}
            {#if household != null && rows.length > 1}<span class="hh" style:left={`${(household / max) * 100}%`}></span>{/if}
          </span>
          <span class="sc-num"><b>{n(r.mean)}</b> a day<small>{n(r.weekday)} wkdy · {n(r.weekend)} wknd · {r.p.steps.days} days</small></span>
        </li>
      {/each}
    </ol>

    <h3>Each person's week, side by side</h3>
    <p class="sc-cap">Average steps by weekday, one shared scale. The highest on each day is outlined and in bold.</p>
    <div class="sc-wk-wrap">
      <table class="sc-wk">
        <thead><tr><th scope="col"><span class="vh">Person</span></th>{#each DAYS as d (d)}<th scope="col">{d}</th>{/each}</tr></thead>
        <tbody>
          {#each rows as r (r.p.subject)}
            <tr class:lit={focus?.subject === r.p.subject}>
              <th scope="row">{r.p.displayName}</th>
              {#each r.week as w (w.weekday)}
                <td class:top={leader[w.weekday] === r.p.subject && rows.length > 1} title={`${r.p.displayName}, ${DAYS[w.weekday]}: ${n(w.mean)} steps on average`}>
                  <span class="cell">
                    <span class="col" class:wknd={w.weekday >= 5} style:height={`${(w.mean / weekMax) * 100}%`}></span>
                  </span>
                  <span class="cv">{k(w.mean)}</span>
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
{/if}

<style>
  .sc {
    margin-bottom: 20px;
  }
  .sc-legend {
    list-style: none;
    margin: 0 0 10px;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    font: var(--fs-label-xs) var(--font-mono);
    color: var(--text-secondary);
  }
  .sc-legend li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sc-hh b {
    color: var(--text-primary);
  }
  .sw {
    display: inline-block;
    width: 14px;
    height: 8px;
  }
  .sw.mean,
  .bar.mean {
    background: var(--text-primary);
  }
  .sw.wkdy,
  .bar.wkdy {
    background: var(--chart-cat-1);
  }
  .sw.wknd,
  .bar.wknd,
  .col.wknd {
    background: var(--chart-cat-2);
  }
  .sc-rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 10px;
  }
  .sc-row {
    display: grid;
    grid-template-columns: 90px minmax(0, 1fr) minmax(150px, auto);
    gap: 12px;
    align-items: center;
  }
  .sc-name {
    font: 600 var(--fs-label) var(--font-mono);
  }
  .sc-name small {
    display: block;
    font: var(--fs-label-xs) var(--font-mono);
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .sc-row.lit .sc-name {
    color: var(--accent);
  }
  .sc-bars {
    position: relative;
    display: grid;
    gap: 2px;
    padding: 2px 0;
  }
  .bar {
    display: block;
    height: 5px;
  }
  .bar.mean {
    height: 12px;
  }
  .hh {
    position: absolute;
    top: -2px;
    bottom: -2px;
    border-left: 1px dashed var(--text-muted);
  }
  .sc-num {
    font: var(--fs-label) var(--font-mono);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .sc-num b {
    font-size: var(--fs-body-lg);
  }
  .sc-num small {
    display: block;
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  h3 {
    margin: 18px 0 8px;
    font: 600 var(--fs-label) var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-secondary);
  }
  .sc-wk-wrap {
    overflow-x: auto;
  }
  .sc-wk {
    border-collapse: collapse;
    width: 100%;
    table-layout: fixed;
    font: var(--fs-label-xs) var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .sc-cap {
    margin: 0 0 6px;
    font: var(--fs-label-xs) var(--font-body);
    color: var(--text-muted);
  }
  .sc-wk thead th:first-child {
    width: 72px;
  }
  .sc-wk th {
    font-weight: 500;
    color: var(--text-secondary);
    padding: 2px 4px;
  }
  .sc-wk tbody th {
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: left;
    font: 600 var(--fs-label) var(--font-mono);
    color: var(--text-primary);
    white-space: nowrap;
  }
  .sc-wk tr.lit th {
    color: var(--accent);
  }
  .sc-wk td {
    padding: 4px;
    text-align: center;
    vertical-align: bottom;
  }
  /* The day's leader: its bar outlined and its figure in bold (outlining the
     cell merged neighbouring leaders into one box). */
  .sc-wk td.top .col {
    outline: 2px solid var(--text-primary);
    outline-offset: 1px;
  }
  .sc-wk td.top .cv {
    color: var(--text-primary);
    font-weight: 700;
  }
  .cell {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    height: 44px;
  }
  .col {
    display: block;
    width: 60%;
    min-height: 1px;
    background: var(--chart-cat-1);
  }
  .cv {
    display: block;
    margin-top: 2px;
    color: var(--text-secondary);
  }
  .vh {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  @media (max-width: 560px) {
    .sc-wk thead th:first-child {
      width: 56px;
    }
    .sc-wk td {
      padding: 4px 1px;
    }
    .sc-row {
      grid-template-columns: 70px minmax(0, 1fr);
    }
    .sc-num {
      grid-column: 1 / -1;
      text-align: left;
    }
  }
</style>
