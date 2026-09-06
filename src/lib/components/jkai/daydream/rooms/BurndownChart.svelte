<script lang="ts">
  // Is the queue actually getting smaller?
  //
  // The room could say how big the pile is and, since the inflow strip, what
  // went in and out over thirty days. It could not say what SHAPE that was:
  // 413 open with 95 settled reads the same whether the queue has been flat
  // all year or doubled this fortnight, and they are different problems.
  //
  // ── Two exhibits, never one ────────────────────────────────────────────
  //
  // The standing queue runs 0–450 and the daily flow runs 0–30. Putting both
  // on one frame needs a second y-axis, which is the single most common way a
  // chart lies — the crossing point of the two lines would be an artefact of
  // where the axes were pinned. So: one chart for the level, one for the flow,
  // sharing an x-axis and one hover index.
  //
  // ── The colours were validated, not chosen ─────────────────────────────
  //
  // The instinct was `--accent` against `--good`, which is the pair the inflow
  // meter already uses. The palette validator fails it at **ΔE 5.2 (protan)** —
  // a red-green reader cannot separate those two bars. `--accent` against
  // `--accent-ink`, the site's designated counter-accent, scores 14.4 protan
  // and 27.3 normal and passes in both themes.
  //
  // Hue follows meaning rather than series order: orange is the pile and what
  // feeds it, petrol is what takes work out of it. Position carries it too —
  // added above the baseline, settled below — so identity never rests on
  // colour alone.
  import { niceTicks } from '$lib/presentation/chartkit';
  import { BURNDOWN_RANGES, type BurndownView } from '$lib/selfimprove/board';

  interface Props {
    view: BurndownView;
  }

  let { view }: Props = $props();

  // Bound with `bind:clientWidth` rather than a fixed viewBox scaled with
  // `preserveAspectRatio="none"`: that stretches the axis text along with the
  // marks, and this chart has labels on both axes.
  let boxWidth = $state(0);
  let table = $state(false);
  /** Days shown. The server sends ninety and this slices them — 90 numbers is
   *  nothing against a payload already in the hundreds of kilobytes, and a
   *  round trip for a control somebody presses three times is not worth it. */
  let range = $state<number>(BURNDOWN_RANGES[0]);
  /** Which day the crosshair is on. Shared by both exhibits, so reading the
   *  level and the flow for one day is one gesture. */
  let hover = $state<number | null>(null);

  const PAD_L = 46;
  const PAD_R = 14;
  const PAD_T = 12;
  const PAD_B = 24;
  const QUEUE_H = 176;
  const FLOW_H = 132;

  /** The ranges there is actually data for. Offering "90 days" against a
   *  sixty-day record would draw a third of an axis out of nothing. */
  const ranges = $derived(BURNDOWN_RANGES.filter((r, i) => r <= view.days.length || i === BURNDOWN_RANGES.length - 1));
  /** Clamped on READ, so a `range` the view cannot serve lights the chip for
   *  what is actually drawn rather than lighting none of them. Clamping by
   *  writing `range` from an effect would be the read-own-write loop. */
  const shownRange = $derived(ranges.includes(range as (typeof BURNDOWN_RANGES)[number]) ? range : (ranges[0] ?? range));
  const days = $derived(view.days.slice(-shownRange));
  const openThen = $derived(days.length ? days[0].open : 0);
  /** Recorded against inferred over the days ON SCREEN, not over the window
   *  the server computed — the sentence under the chart describes the curve
   *  the reader is looking at. */
  const dated = $derived(
    days.reduce(
      (acc, d) => ({ recorded: acc.recorded + d.recorded, inferred: acc.inferred + d.inferred }),
      { recorded: 0, inferred: 0 },
    ),
  );
  const width = $derived(Math.max(320, boxWidth || 900));
  const plotW = $derived(width - PAD_L - PAD_R);
  const bandW = $derived(days.length ? plotW / days.length : plotW);

  /** Centre of the band for day `i` — where the line's vertex sits. */
  function cx(i: number): number {
    return PAD_L + i * bandW + bandW / 2;
  }

  // ── Exhibit 1: the standing queue ───────────────────────────────────────
  const queueMax = $derived(Math.max(1, ...days.map((d) => d.open)));
  // `niceTicks` stops at or below the maximum, so scaling to its last tick
  // pins the peak against the top edge of the box. Extended by one step so the
  // line always has headroom and the top gridline sits above it.
  const queueTicks = $derived.by(() => {
    const ticks = niceTicks(0, queueMax, 3);
    const step = ticks.length > 1 ? ticks[1] - ticks[0] : Math.max(1, queueMax);
    const out = [...ticks];
    while ((out[out.length - 1] ?? 0) < queueMax) out.push((out[out.length - 1] ?? 0) + step);
    return out;
  });
  const queueTop = $derived(queueTicks[queueTicks.length - 1] || 1);
  function qy(v: number): number {
    return QUEUE_H - PAD_B - (v / queueTop) * (QUEUE_H - PAD_T - PAD_B);
  }

  const queueLine = $derived(days.map((d, i) => `${i === 0 ? 'M' : 'L'} ${cx(i)} ${qy(d.open)}`).join(' '));
  const queueArea = $derived(
    days.length
      ? `M ${cx(0)} ${QUEUE_H - PAD_B} ${days
          .map((d, i) => `L ${cx(i)} ${qy(d.open)}`)
          .join(' ')} L ${cx(days.length - 1)} ${QUEUE_H - PAD_B} Z`
      : '',
  );

  // ── Exhibit 2: what went in and what came out ───────────────────────────
  // Scaled to the busiest day in either direction, so the two halves share one
  // magnitude and a tall `in` bar cannot be read against a differently-scaled
  // `out` bar underneath it.
  const flowTop = $derived(Math.max(1, ...days.map((d) => Math.max(d.added, d.settled))));
  const zeroY = $derived(PAD_T + (FLOW_H - PAD_T - PAD_B) / 2);
  const halfH = $derived((FLOW_H - PAD_T - PAD_B) / 2);
  function barH(v: number): number {
    return v <= 0 ? 0 : Math.max(1.5, (v / flowTop) * halfH);
  }
  /** A 2px surface gap between adjacent bars, and never wider than the band. */
  const barW = $derived(Math.max(1.5, Math.min(14, bandW - 2)));

  // ── Axis labels ─────────────────────────────────────────────────────────
  function shortDay(iso: string): string {
    const d = new Date(`${iso}T00:00:00.000Z`);
    return `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
  }

  /** About six dates, whatever the window length, always including the last. */
  const xLabels = $derived.by(() => {
    if (days.length === 0) return [] as Array<{ i: number; text: string }>;
    const step = Math.max(1, Math.ceil(days.length / 6));
    const out: Array<{ i: number; text: string }> = [];
    for (let i = days.length - 1; i >= 0; i -= step) out.unshift({ i, text: shortDay(days[i].day) });
    return out;
  });

  const point = $derived(hover != null ? (days[hover] ?? null) : null);

  // A plain handler reading a plain rect: nothing here is $state that another
  // handler writes, so there is no read-own-write cycle to loop on.
  function onMove(ev: MouseEvent) {
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const x = ev.clientX - rect.left - PAD_L;
    if (days.length === 0 || bandW <= 0) return;
    hover = Math.min(days.length - 1, Math.max(0, Math.floor(x / bandW)));
  }

  const verdict = $derived.by(() => {
    if (days.length === 0) return 'Nothing in the queue has a date to place on a timeline.';
    if (view.outlook === 'growing') {
      return `Growing by ${view.netPerWeek} a week. At this rate nothing clears — closing work out is the only lever that moves this line.`;
    }
    if (view.outlook === 'draining' && view.daysToClear != null) {
      return `Draining by ${Math.abs(view.netPerWeek)} a week. ${view.openNow} open would clear in about ${view.daysToClear} days if that held.`;
    }
    return 'Level. Roughly as much goes in as comes out, so the pile stays the size it is.';
  });

  const tone = $derived(
    view.outlook === 'growing' ? 'urgent' : view.outlook === 'draining' ? 'good' : 'watch',
  );
</script>

<div class="bd">
  <div class="bd-head">
    <div class="bd-fig t-{tone}">
      <span class="fig">{view.openNow}</span>
      <span class="fig-lab">open now</span>
      <span class="fig-sub">
        {#if openThen === view.openNow}
          unchanged over {days.length} days
        {:else if view.openNow > openThen}
          up {view.openNow - openThen} in {days.length} days
        {:else}
          down {openThen - view.openNow} in {days.length} days
        {/if}
      </span>
    </div>
    <dl class="bd-rates">
      <div><dt>In</dt><dd>{view.addedPerWeek}<span class="unit">/wk</span></dd></div>
      <div><dt>Out</dt><dd>{view.settledPerWeek}<span class="unit">/wk</span></dd></div>
      <div class="net t-{tone}">
        <dt>Net</dt>
        <dd>{view.netPerWeek > 0 ? '+' : ''}{view.netPerWeek}<span class="unit">/wk</span></dd>
      </div>
    </dl>
    <div class="bd-controls">
      <div class="seg" role="group" aria-label="How many days to show">
        {#each ranges as r (r)}
          <button
            type="button"
            class="chip"
            class:on={shownRange === r}
            aria-pressed={shownRange === r}
            onclick={() => (range = r)}
          >{r}d</button>
        {/each}
      </div>
      <button type="button" class="btn sm" aria-pressed={table} onclick={() => (table = !table)}>
        {table ? 'Chart' : 'Table'}
      </button>
    </div>
  </div>

  <p class="verdict t-{tone}">{verdict}</p>

  {#if days.length === 0}
    <p class="note">Nothing to draw.</p>
  {:else if table}
    <!-- The same numbers, reachable without reading a picture. -->
    <div class="tbl-wrap">
      <table class="tbl compact">
        <thead>
          <tr><th>Day</th><th class="right">Open</th><th class="right">In</th><th class="right">Out</th></tr>
        </thead>
        <tbody>
          {#each [...days].reverse() as d (d.day)}
            <tr>
              <td class="nowrap">{shortDay(d.day)}</td>
              <td class="right num">{d.open}</td>
              <td class="right num">{d.added || '—'}</td>
              <td class="right num">{d.settled || '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="plots"
      bind:clientWidth={boxWidth}
      onmousemove={onMove}
      onmouseleave={() => (hover = null)}
    >
      <svg
        class="plot"
        viewBox="0 0 {width} {QUEUE_H}"
        style="height:{QUEUE_H}px"
        role="img"
        aria-label="Standing queue over {days.length} days, {openThen} to {view.openNow} open"
      >
        {#each queueTicks as t (t)}
          <line class="grid" x1={PAD_L} x2={width - PAD_R} y1={qy(t)} y2={qy(t)} />
          <text class="ax" x={PAD_L - 8} y={qy(t) + 4} text-anchor="end">{t}</text>
        {/each}
        <path class="q-area" d={queueArea} />
        <path class="q-line" d={queueLine} />
        {#if hover != null && point}
          <line class="cross" x1={cx(hover)} x2={cx(hover)} y1={PAD_T} y2={QUEUE_H - PAD_B} />
          <circle class="q-dot" cx={cx(hover)} cy={qy(point.open)} r="4" />
        {/if}
        <!-- The one direct label that earns its place: where the line ends. -->
        <circle class="q-end" cx={cx(days.length - 1)} cy={qy(days[days.length - 1].open)} r="3.5" />
      </svg>

      <svg
        class="plot"
        viewBox="0 0 {width} {FLOW_H}"
        style="height:{FLOW_H}px"
        role="img"
        aria-label="Queued and settled per day: {view.addedPerWeek} in and {view.settledPerWeek} out per week"
      >
        <line class="zero" x1={PAD_L} x2={width - PAD_R} y1={zeroY} y2={zeroY} />
        <!-- Signed, because the same number appears twice: above the line is
             work arriving, below it is work leaving. -->
        <text class="ax" x={PAD_L - 8} y={zeroY - halfH + 4} text-anchor="end">+{flowTop}</text>
        <text class="ax" x={PAD_L - 8} y={zeroY + 4} text-anchor="end">0</text>
        <text class="ax" x={PAD_L - 8} y={zeroY + halfH + 4} text-anchor="end">−{flowTop}</text>
        {#each days as d, i (d.day)}
          {#if d.added}
            <rect class="f-in" x={cx(i) - barW / 2} y={zeroY - barH(d.added)} width={barW} height={barH(d.added)} rx="1" />
          {/if}
          {#if d.settled}
            <rect class="f-out" x={cx(i) - barW / 2} y={zeroY} width={barW} height={barH(d.settled)} rx="1" />
          {/if}
        {/each}
        {#if hover != null}
          <line class="cross" x1={cx(hover)} x2={cx(hover)} y1={PAD_T} y2={FLOW_H - PAD_B} />
        {/if}
        {#each xLabels as l (l.i)}
          <text class="ax" x={cx(l.i)} y={FLOW_H - 6} text-anchor="middle">{l.text}</text>
        {/each}
      </svg>

      {#if hover != null && point}
        <div class="tip" style="left:{(cx(hover) / width) * 100}%">
          <b>{shortDay(point.day)}</b>
          <span>{point.open} open</span>
          {#if point.added}<span>+{point.added} queued</span>{/if}
          {#if point.settled}<span>−{point.settled} settled</span>{/if}
        </div>
      {/if}
    </div>

    <div class="legend">
      <span class="key"><i class="sw in"></i>queued</span>
      <span class="key"><i class="sw out"></i>settled — shipped, parked or folded</span>
      <span class="key"><i class="sw line"></i>still open at the end of that day</span>
    </div>
  {/if}

  <p class="note">
    Reconstructed, not recorded: nothing has ever snapshotted the queue size, so each day
    counts the rows created by then that had not settled by then.
    {#if dated.inferred > 0}
      {#if dated.recorded === 0}
        All <strong>{dated.inferred}</strong> items that settled in the days shown
      {:else}
        <strong>{dated.inferred}</strong> of the {dated.inferred + dated.recorded}
        items that settled in the days shown
      {/if}
      carry no settled date and are placed by <code>updatedAt</code>, which a priority edit
      also moves — rows settling from now on are stamped properly, so the curve gets more
      truthful every night.
    {:else if dated.recorded > 0}
      All {dated.recorded} items that settled in the days shown carry a recorded date.
    {/if}
    {#if view.truncated}
      The queue is younger than the {view.windowDays}-day record, so the earliest days
      describe a shorter history than the axis suggests.
    {/if}
  </p>
</div>

<style>
  .bd {
    border: 1px solid var(--card-border);
    background: var(--surface-card);
    padding: 18px 20px 16px;
  }
  .bd-head {
    display: flex;
    align-items: flex-start;
    gap: 20px;
    flex-wrap: wrap;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--line-hair);
  }
  .bd-fig {
    --tone: var(--accent-ink);
    display: grid;
    grid-template-columns: auto auto;
    align-items: baseline;
    gap: 0 10px;
    flex: 0 0 auto;
  }
  .bd-fig.t-urgent {
    --tone: var(--error);
  }
  .bd-fig.t-good {
    --tone: var(--good);
  }
  .bd-fig.t-watch {
    --tone: var(--warn);
  }
  .fig {
    font-family: var(--font-display);
    font-size: 40px;
    line-height: 0.9;
    letter-spacing: -0.02em;
    color: var(--tone);
  }
  .fig-lab {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .fig-sub {
    grid-column: 1 / -1;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.05em;
    color: var(--text-ghost);
    margin-top: 6px;
  }
  .bd-rates {
    display: flex;
    gap: 22px;
    margin: 0;
    flex: 1 1 auto;
  }
  .bd-rates div {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .bd-rates dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .bd-rates dd {
    margin: 0;
    font-family: var(--font-display);
    font-size: 20px;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
  }
  .bd-rates .net.t-urgent dd {
    color: var(--error);
  }
  .bd-rates .net.t-good dd {
    color: var(--good);
  }
  .unit {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    margin-left: 2px;
  }
  .bd-controls {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 0 0 auto;
  }
  .seg {
    display: inline-flex;
  }
  .chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    padding: 5px 10px;
    border: 1px solid var(--card-border);
    border-radius: 0;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    white-space: nowrap;
  }
  .chip + .chip {
    margin-left: -1px;
  }
  .chip:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .chip.on {
    background: var(--text-primary);
    border-color: var(--text-primary);
    color: var(--bg);
  }
  .chip:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .verdict {
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-secondary);
    margin: 14px 0 8px;
    max-width: 92ch;
  }
  .verdict.t-urgent {
    color: var(--error);
  }

  .plots {
    position: relative;
    width: 100%;
    cursor: crosshair;
  }
  .plot {
    display: block;
    width: 100%;
    overflow: visible;
  }
  .grid {
    stroke: var(--card-border);
    stroke-width: 1;
  }
  .zero {
    stroke: var(--line-strong);
    stroke-width: 1;
  }
  .ax {
    font-family: var(--font-mono);
    /* The 12px floor holds inside an SVG too — the font-size gate scans this
       file, and a reader's browser preference is no less relevant on an axis
       label than on a paragraph. */
    font-size: var(--fs-label-xs);
    fill: var(--text-ghost);
  }
  .q-line {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .q-area {
    fill: var(--accent);
    opacity: 0.1;
  }
  .q-end,
  .q-dot {
    fill: var(--accent);
    stroke: var(--surface-card);
    stroke-width: 2;
  }
  .cross {
    stroke: var(--text-muted);
    stroke-width: 1;
    stroke-dasharray: 3 3;
  }
  .f-in {
    fill: var(--accent);
  }
  .f-out {
    fill: var(--accent-ink);
  }

  .tip {
    position: absolute;
    top: 0;
    transform: translate(-50%, -6px);
    background: var(--text-primary);
    color: var(--bg);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    padding: 5px 9px;
    display: flex;
    gap: 10px;
    white-space: nowrap;
    pointer-events: none;
    z-index: 3;
  }
  /* No hue inside the tooltip. Its ground is `--text-primary`, which is dark
     ink in the light theme and near-white in the dark one, so any fixed accent
     that reads there reads as nothing in the other. The sign and the word
     carry it — `+3 queued` against `−1 settled` needs no colour. */

  .legend {
    display: flex;
    gap: 18px;
    flex-wrap: wrap;
    margin-top: 10px;
  }
  .key {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }
  .sw {
    width: 12px;
    height: 12px;
    display: inline-block;
  }
  .sw.in {
    background: var(--accent);
  }
  .sw.out {
    background: var(--accent-ink);
  }
  .sw.line {
    height: 2px;
    background: var(--accent);
  }
  .note code {
    font-family: var(--font-code);
  }
</style>
