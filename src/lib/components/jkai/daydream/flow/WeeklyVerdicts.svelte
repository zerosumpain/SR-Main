<script lang="ts">
  // Twelve weeks of notes as stacked bars: worth knowing (petrol), not for me
  // (orange), not answered (hatched outline). One axis — counts — and the week
  // the question-led loop started marked on it, so "is it better than the old
  // engine?" is answered by looking.
  //
  // Colour carries identity only alongside a legend, direct labels on the
  // latest week, and a table view (the dataviz rules). Hover or focus a week
  // for its figures.
  import type { WeekBar } from '$lib/daydream/impact';

  let { weeks, loopStart }: { weeks: WeekBar[]; loopStart: string } = $props();

  // Drawn at the container's real width, so 12px labels stay 12px on a phone
  // instead of shrinking with a scaled viewBox.
  let cw = $state(720);
  const W = $derived(Math.max(300, cw));
  const H = 230;
  const PAD = { l: 34, r: 12, t: 22, b: 34 };
  const iw = $derived(W - PAD.l - PAD.r);
  const ih = H - PAD.t - PAD.b;
  const narrow = $derived(W < 520);

  const max = $derived(Math.max(4, ...weeks.map((w) => w.noticed)));
  const step = $derived(niceStep(max));
  const top = $derived(Math.ceil(max / step) * step);
  const ticks = $derived(Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step));
  const slot = $derived(iw / Math.max(1, weeks.length));
  const bw = $derived(Math.max(6, slot * 0.62));
  const y = (v: number) => PAD.t + ih - (v / top) * ih;
  const loopIndex = $derived(weeks.findIndex((w, i) => {
    const next = weeks[i + 1]?.start;
    return w.start <= loopStart && (!next || next > loopStart);
  }));

  let hover = $state<number | null>(null);

  function niceStep(m: number): number {
    const raw = m / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  }
  function label(start: string): string {
    const d = new Date(`${start}T00:00:00Z`);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
  function rate(w: WeekBar): string {
    const rated = w.useful + w.notUseful;
    return rated ? `${Math.round((w.useful / rated) * 100)}% worth knowing` : 'none answered';
  }
</script>

<figure class="wv">
  <div class="legend" aria-hidden="true">
    <span><i class="sw useful"></i>Worth knowing</span>
    <span><i class="sw no"></i>Not for me</span>
    <span><i class="sw open"></i>Not answered</span>
  </div>
  <div class="plot" bind:clientWidth={cw}>
    <svg width={W} height={H} viewBox="0 0 {W} {H}" role="img" aria-label="Notes per week for {weeks.length} weeks, split by your answer">
      <defs>
        <pattern id="wv-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="5" stroke="var(--text-ghost)" stroke-width="1.2" />
        </pattern>
      </defs>
      {#each ticks as t (t)}
        <line class="grid" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
        <text class="tick" x={PAD.l - 8} y={y(t) + 4} text-anchor="end">{t}</text>
      {/each}
      {#if loopIndex >= 0}
        {@const lx = PAD.l + loopIndex * slot + 1}
        <line class="loop" x1={lx} x2={lx} y1={PAD.t - 8} y2={PAD.t + ih} />
        {@const flip = lx > W - (narrow ? 90 : 190)}
        <text class="loop-t" x={flip ? lx - 5 : lx + 5} y={PAD.t - 10} text-anchor={flip ? 'end' : 'start'}>{flip ? 'New loop starts →' : narrow ? 'New loop →' : 'New question-led loop →'}</text>
      {/if}
      {#each weeks as w, i (w.start)}
        {@const x = PAD.l + i * slot + (slot - bw) / 2}
        {@const hU = (w.useful / top) * ih}
        {@const hN = (w.notUseful / top) * ih}
        {@const hO = (w.undecided / top) * ih}
        {@const base = PAD.t + ih}
        <g class="bar" class:dim={hover != null && hover !== i}>
          {#if w.useful}<rect class="useful" x={x} y={base - hU} width={bw} height={Math.max(0, hU - 1)} />{/if}
          {#if w.notUseful}<rect class="no" x={x} y={base - hU - hN} width={bw} height={Math.max(0, hN - 2)} />{/if}
          {#if w.undecided}
            <rect class="open" x={x + 0.5} y={base - hU - hN - hO + 0.5} width={bw - 1} height={Math.max(0, hO - 3)} />
          {/if}
          {#if i === weeks.length - 1 && w.noticed}
            <text class="direct" x={x + bw / 2} y={base - hU - hN - hO - 6} text-anchor="middle">{w.noticed}</text>
          {/if}
        </g>
        <text class="xl" x={x + bw / 2} y={H - 12} text-anchor="middle">{(narrow ? (weeks.length - 1 - i) % 3 === 0 : (weeks.length - 1 - i) % 2 === 0) ? label(w.start) : ''}</text>
        <rect
          class="hit"
          x={PAD.l + i * slot}
          y={PAD.t - 10}
          width={slot}
          height={ih + 10}
          tabindex="0"
          role="button"
          aria-label="Week of {label(w.start)}: {w.noticed} notes, {w.useful} worth knowing, {w.notUseful} not for me, {w.undecided} not answered"
          onmouseenter={() => (hover = i)}
          onmouseleave={() => (hover = null)}
          onfocus={() => (hover = i)}
          onblur={() => (hover = null)}
        />
      {/each}
      <line class="axis" x1={PAD.l} x2={W - PAD.r} y1={PAD.t + ih} y2={PAD.t + ih} />
    </svg>
    {#if hover != null}
      {@const w = weeks[hover]}
      <div class="tip" style="left: {((PAD.l + hover * slot + slot / 2) / W) * 100}%">
        <p class="tip-h">Week of {label(w.start)}{w.engine === 'legacy' ? ' · old engine' : w.engine === 'mixed' ? ' · both engines' : ''}</p>
        <p><i class="sw useful"></i>{w.useful} worth knowing</p>
        <p><i class="sw no"></i>{w.notUseful} not for me</p>
        <p><i class="sw open"></i>{w.undecided} not answered</p>
        <p class="tip-f">{rate(w)}</p>
      </div>
    {/if}
  </div>
  <details class="table-view">
    <summary>Show as a table</summary>
    <table>
      <thead><tr><th>Week of</th><th>Spotted</th><th>Worth knowing</th><th>Not for me</th><th>Not answered</th><th>Engine</th></tr></thead>
      <tbody>
        {#each weeks as w (w.start)}
          <tr><td>{label(w.start)}</td><td>{w.noticed}</td><td>{w.useful}</td><td>{w.notUseful}</td><td>{w.undecided}</td><td>{w.engine === 'none' ? '—' : w.engine === 'loop' ? 'new loop' : w.engine === 'legacy' ? 'old engine' : 'both'}</td></tr>
        {/each}
      </tbody>
    </table>
  </details>
</figure>

<style>
  .wv {
    margin: 0;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    font-size: var(--fs-label);
    color: var(--text-secondary);
    margin-bottom: 8px;
  }
  .legend span,
  .tip p {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .sw {
    display: inline-block;
    width: 12px;
    height: 12px;
    border-radius: 2px;
  }
  .sw.useful {
    background: var(--accent-ink);
  }
  .sw.no {
    background: var(--accent);
  }
  .sw.open {
    border: 1px solid var(--text-ghost);
    background: repeating-linear-gradient(45deg, var(--text-ghost) 0 1px, transparent 1px 4px);
  }
  .plot {
    position: relative;
  }
  svg {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
  }
  .grid {
    stroke: var(--line-hair);
    stroke-width: 1;
  }
  .axis {
    stroke: var(--text-primary);
    stroke-width: 1;
  }
  .tick,
  .xl {
    font-family: var(--font-mono);
    font-size: 12px;
    fill: var(--text-muted);
  }
  .direct {
    font-family: var(--font-mono);
    font-size: 12px;
    fill: var(--text-primary);
  }
  .loop {
    stroke: var(--text-primary);
    stroke-dasharray: 3 3;
  }
  .loop-t {
    font-family: var(--font-mono);
    font-size: 12px;
    fill: var(--text-primary);
  }
  rect.useful {
    fill: var(--accent-ink);
  }
  rect.no {
    fill: var(--accent);
  }
  rect.open {
    fill: url(#wv-hatch);
    stroke: var(--text-ghost);
    stroke-width: 1;
  }
  .bar {
    transition: opacity 0.12s;
  }
  .bar.dim {
    opacity: 0.35;
  }
  .hit {
    fill: transparent;
    cursor: default;
    outline: none;
  }
  .hit:focus-visible {
    stroke: var(--accent);
    stroke-width: 2;
  }
  .tip {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    pointer-events: none;
    background: var(--text-primary);
    color: var(--bg);
    padding: 8px 12px;
    font-size: var(--fs-label);
    min-width: 170px;
    z-index: 3;
  }
  .tip p {
    margin: 2px 0;
    display: flex;
  }
  .tip-h {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent-on-dark);
  }
  .tip .sw.useful {
    background: var(--accent-ink-on-dark);
  }
  .tip .sw.open {
    border-color: var(--bg);
    background: repeating-linear-gradient(45deg, var(--bg) 0 1px, transparent 1px 4px);
  }
  .tip-f {
    margin-top: 6px !important;
    font-weight: 600;
  }
  .table-view {
    margin-top: 10px;
  }
  .table-view summary {
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 8px;
    font-size: var(--fs-label);
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    text-align: left;
    padding: 5px 8px;
    border-bottom: 1px solid var(--line-hair);
  }
  th {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
</style>
