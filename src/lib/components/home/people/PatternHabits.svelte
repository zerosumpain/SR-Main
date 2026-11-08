<script lang="ts">
  /**
   * Habits: what happens on which weekday (the share of each weekday seen
   * that had that kind of place, its usual arrival printed in the cell), the
   * routines that clear the bar, what an outing from home is like and what
   * goes into one, and when in the day each kind of place is visited. One
   * hue, light to dark, with the figure in every non-empty cell, so nothing
   * rests on colour alone.
   */
  import { categoryLabel } from '$lib/home/presence/patterns';
  import { LONG_OUTING_MINS, WEEKDAYS, partPhrase, type Habits } from '$lib/home/presence/habits';
  import { hhmm, mins } from './format';

  let { habits, who }: { habits: Habits; who: string } = $props();

  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const HOURS = Array.from({ length: 18 }, (_, i) => i + 6);
  /** Ink on light cells, paper on dark ones: 55% is where cream clears 4.5:1. */
  const shade = (v: number, peak: number) => (v ? 18 + Math.round((v / Math.max(peak, 1e-9)) * 72) : 0);
  const fill = (s: number) => (s ? `color-mix(in srgb, var(--accent) ${s}%, var(--surface-card))` : undefined);

  const weekPeak = $derived(Math.max(0.01, ...habits.week.flatMap((r) => r.days.map((d) => d.rate))));
  const times = $derived(habits.times.filter((t) => t.category !== 'far'));
  const hourPeak = $derived(Math.max(1, ...times.flatMap((t) => HOURS.map((h) => t.hours[h] ?? 0))));
  const o = $derived(habits.outings);
  // One row per pair: A→B and B→A carry the same "both"; keep the one that says more.
  const pairs = $derived.by(() => {
    const seen = new Set<string>();
    return o.pairs.filter((p) => {
      const k = [p.a, p.b].sort().join('|');
      if (seen.has(k) || p.lift === 1) return false;
      seen.add(k);
      return true;
    }).slice(0, 6);
  });
</script>

<h3>The week</h3>
{#if habits.week.length}
  <div class="hb-wrap">
    <table class="hb-grid wk">
      <caption>Share of each weekday seen with a visit to that kind of place; the usual arrival beneath.</caption>
      <thead><tr><th scope="col"><span class="sr">Kind of place</span></th>{#each DAYS as d (d)}<th scope="col">{d}</th>{/each}</tr></thead>
      <tbody>
        {#each habits.week as r (r.category)}
          <tr>
            <th scope="row">{categoryLabel(r.category)}</th>
            {#each r.days as d, i (i)}
              {@const s = shade(d.rate, weekPeak)}
              <td style:background={fill(s)} class:dark={s >= 55} title={`${categoryLabel(r.category)} on ${WEEKDAYS[i]}s: ${d.hits} of ${d.of} seen${d.usual ? `, usually about ${d.usual}` : ''}`}>
                {#if d.hits}<strong>{pct(d.rate)}</strong><small>{d.usual}</small>{/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{:else}
  <p class="hb-empty">Not enough visits yet to see a week's shape.</p>
{/if}

{#if habits.routines.length}
  <h3>Routines</h3>
  <ul class="rows">
    {#each habits.routines.slice(0, 6) as r (`${r.category}|${r.weekday}`)}
      <li>
        <span>
          <strong>{categoryLabel(r.category)} on {WEEKDAYS[r.weekday]}s</strong>
          <small>usually about {r.usual} {partPhrase(r.part)}{r.places.length ? ` · ${r.places.join(', ')}` : ''}{r.people.length > 1 ? ` · ${r.people.join(', ')}` : ''}</small>
        </span>
        <span class="num">{r.hits} of {r.of} · {pct(r.rate)}</span>
      </li>
    {/each}
  </ul>
{/if}

<h3>Outings</h3>
{#if o.about}
  <p class="strap">From leaving home to coming back, when the trail saw most of it. {o.counted} outings in all; these {o.about.outings} are {who} out and about, so not school, work or a holiday.</p>
  <dl class="stats">
    <div><dt>Median length</dt><dd>{mins(o.about.medianMinutes)}</dd></div>
    <div><dt>Past {LONG_OUTING_MINS / 60} hours</dt><dd>{pct(o.about.longShare)}</dd></div>
    <div><dt>On foot</dt><dd>{mins(o.about.medianOnFoot)}</dd><small>median; {pct(o.about.walkShare)} walk an hour or more</small></div>
    <div><dt>Somewhere to eat</dt><dd>{pct(o.about.foodShare)}</dd></div>
    <div><dt>Leaves</dt><dd>{o.about.starts}</dd><small>{pct(o.about.weekendShare)} at the weekend</small></div>
  </dl>
  {#if o.byAnchor.length}
    <div class="hb-wrap">
      <table class="out">
        <caption>By the kind of place that took most of the outing's time.</caption>
        <thead><tr><th scope="col">Mostly at</th><th scope="col">Outings</th><th scope="col">Length</th><th scope="col">Past 3 h</th><th scope="col">On foot</th><th scope="col">With food</th><th scope="col">Leaves</th><th scope="col">Weekend</th></tr></thead>
        <tbody>
          {#each o.byAnchor as a (a.anchor)}
            <tr>
              <th scope="row">{a.anchor ? categoryLabel(a.anchor) : 'All'}</th>
              <td>{a.outings}</td><td>{mins(a.medianMinutes)}</td><td>{pct(a.longShare)}</td><td>{mins(a.medianOnFoot)}</td>
              <td>{pct(a.foodShare)}</td><td>{a.starts}</td><td>{pct(a.weekendShare)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
  <h3>What goes together</h3>
  {#if pairs.length || o.sequences.length}
    <ul class="rows">
      {#each pairs as p (`${p.a}|${p.b}`)}
        <li>
          <span><strong>{categoryLabel(p.a)} with {categoryLabel(p.b).toLowerCase()}</strong><small>{p.both} of {p.ofA} outings with {categoryLabel(p.a).toLowerCase()} took it in, against {pct(p.base)} of all outings</small></span>
          <span class="num">{p.lift}× {p.lift > 1 ? 'more' : 'less'} likely</span>
        </li>
      {/each}
      {#each o.sequences.slice(0, 4) as s (`${s.from}|${s.to}`)}
        <li><span><strong>{categoryLabel(s.from)}, then {categoryLabel(s.to).toLowerCase()}</strong><small>one straight after the other on the same outing</small></span><span class="num">{s.n} times</span></li>
      {/each}
    </ul>
  {:else}
    <p class="hb-empty">Too few outings with more than one stop to say what goes together yet.</p>
  {/if}
{:else}
  <p class="hb-empty">Too few complete outings in this window.</p>
{/if}

<h3>When in the day</h3>
{#if times.length}
  <div class="hb-wrap">
    <table class="hb-grid hr">
      <caption>Arrivals by hour, 06:00 to midnight; under each kind, its visits and usual stay. The busiest two hours of each are on the right.</caption>
      <thead>
        <tr>
          <th scope="col"><span class="sr">Kind of place</span></th>
          {#each HOURS as h (h)}<th scope="col">{h % 3 === 0 ? String(h).padStart(2, '0') : ''}<span class="sr">{h % 3 === 0 ? '' : hhmm(h * 60)}</span></th>{/each}
          <th scope="col" class="pk">Busiest</th>
        </tr>
      </thead>
      <tbody>
        {#each times as t (t.category)}
          <tr>
            <th scope="row">{categoryLabel(t.category)}<small>{t.visits} · stays {mins(t.medianStay)}</small></th>
            {#each HOURS as h (h)}
              {@const v = t.hours[h] ?? 0}
              {@const s = shade(v, hourPeak)}
              <td style:background={fill(s)} class:dark={s >= 55} title={`${categoryLabel(t.category)}, ${hhmm(h * 60)}: ${v} ${v === 1 ? 'arrival' : 'arrivals'}`}>{v || ''}</td>
            {/each}
            <td class="pk">{t.peak.from}–{t.peak.to}<small>{pct(t.peak.share)} · {pct(t.weekendShare)} wknd</small></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  h3 {
    margin: 18px 0 8px;
    font: 600 var(--fs-label) var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  h3:first-child {
    margin-top: 0;
  }
  .hb-wrap {
    overflow-x: auto;
  }
  table {
    width: 100%;
    font-variant-numeric: tabular-nums;
  }
  caption {
    text-align: left;
    padding-bottom: 8px;
    font: var(--fs-label) var(--font-body);
    color: var(--text-muted);
  }
  .hb-grid {
    border-collapse: separate;
    border-spacing: 2px;
    table-layout: fixed;
    font: var(--fs-label-xs) var(--font-mono);
  }
  .hb-grid th {
    font-weight: 500;
    color: var(--text-muted);
    text-align: center;
  }
  /* A fixed-layout table takes its column widths from the first row: the header's. */
  .hb-grid thead th:first-child {
    width: 170px;
  }
  @media (max-width: 700px) {
    .hb-grid thead th:first-child {
      width: 120px;
    }
  }
  .hb-grid tbody th {
    text-align: left;
    font: var(--fs-label) var(--font-body);
    color: var(--text-primary);
  }
  .hb-grid tbody th small,
  .hb-grid td small,
  .out small,
  .stats small {
    display: block;
    font: 12px var(--font-mono);
    color: var(--text-muted);
  }
  .hb-grid td {
    text-align: center;
    background: var(--surface-rail);
    color: var(--text-primary);
    border-radius: 1px;
  }
  .hb-grid td.dark,
  .hb-grid td.dark small {
    color: var(--bg);
  }
  .wk {
    min-width: 560px;
  }
  .wk td {
    height: 44px;
  }
  .wk td strong {
    display: block;
    font-weight: 600;
  }
  .hr {
    min-width: 760px;
  }
  .hr td {
    height: 34px;
  }
  .hr th.pk,
  .hr td.pk {
    width: 110px;
    background: transparent;
    text-align: right;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 12px;
    margin: 0 0 14px;
  }
  .stats div {
    border-top: 1px solid var(--line);
    padding-top: 6px;
  }
  .stats dt {
    font: var(--fs-label-xs) var(--font-mono);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .stats dd {
    margin: 2px 0 0;
    font: var(--fs-body) var(--font-display);
  }
  .out {
    min-width: 640px;
    border-collapse: collapse;
    font-size: var(--fs-body-sm);
  }
  .out th,
  .out td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--line);
    text-align: right;
  }
  .out th:first-child {
    text-align: left;
  }
  .out thead th {
    font: var(--fs-label-xs) var(--font-mono);
    color: var(--text-muted);
    font-weight: 500;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line);
  }
  .rows li {
    display: flex;
    justify-content: space-between;
    gap: 4px 12px;
    padding: 8px 0;
    border-bottom: 1px solid var(--line);
  }
  .rows small {
    display: block;
    font-size: var(--fs-label);
    color: var(--text-muted);
  }
  .num {
    font: var(--fs-label) var(--font-mono);
    white-space: nowrap;
  }
  .strap {
    margin: 0 0 10px;
    font-size: var(--fs-body-sm);
    color: var(--text-muted);
  }
  .hb-empty {
    color: var(--text-muted);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
