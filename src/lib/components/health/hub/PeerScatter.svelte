<script lang="ts">
  // The matrix: one cohort on two axes, with this outing lit inside it.
  //
  // The strip above it says where the outing sits; this says what that cost.
  // Two runs at 5:30 /km, one at 148 bpm and one at 171, are the same dot on a
  // pace strip and two completely different runs.
  //
  // Same visual language as `PeerPlot` on purpose — hairline frame, ghosted
  // dots, the subject in the accent, every point a target. The two charts sit
  // in one panel and must read as two views of one cohort, not as two charts.
  //
  // THE VIEWBOX IS PADDED. Axis labels are drawn outside the plot on three
  // sides, and it is the VIEWPORT that clips them, not CSS, so no amount of
  // `overflow` on the parent gets them back.
  import type { PeerMatrix, ScatterPoint } from '$lib/health/activity-peers';

  interface Props {
    matrix: PeerMatrix;
    onpick?: (point: ScatterPoint) => void;
    onhover?: (point: ScatterPoint | null) => void;
  }

  let { matrix, onpick, onhover }: Props = $props();

  const W = 600;
  const H = 300;
  const R = 4.6;

  let svgEl: SVGSVGElement | null = $state(null);

  const xSpan = $derived(matrix.xDomain.hi - matrix.xDomain.lo || 1);
  const ySpan = $derived(matrix.yDomain.hi - matrix.yDomain.lo || 1);

  /**
   * Placed, and CLAMPED to the frame.
   *
   * The axes take the same outlier cut the strip does, so a cohort can hold a
   * point outside its own frame. Clamping keeps it visible and countable at the
   * edge; letting it draw outside would put dots over the axis labels, and
   * dropping it would quietly shrink the cohort the chart claims to show.
   */
  const dots = $derived(
    matrix.points
      .map((point) => ({
        point,
        cx: Math.min(W, Math.max(0, ((point.x - matrix.xDomain.lo) / xSpan) * W)),
        cy: Math.min(H, Math.max(0, H - ((point.y - matrix.yDomain.lo) / ySpan) * H)),
      }))
      // The subject is painted LAST so it is always on top and always
      // reachable — in the middle of a cloud it would otherwise be buried under
      // whichever outing happened to come after it.
      .sort((a, b) => Number(a.point.subject) - Number(b.point.subject)),
  );

  const beyond = $derived(
    matrix.xDomain.beyondHi +
      matrix.xDomain.beyondLo +
      matrix.yDomain.beyondHi +
      matrix.yDomain.beyondLo,
  );

  /** One tab stop — the subject — and the arrows walk the rest. See PeerPlot. */
  const entry = $derived.by(() => {
    const i = dots.findIndex((d) => d.point.subject);
    return i >= 0 ? i : 0;
  });

  function step(from: number, delta: number) {
    if (!svgEl) return;
    const next = Math.min(dots.length - 1, Math.max(0, from + delta));
    if (next === from) return;
    svgEl.querySelectorAll<SVGGElement>('g.ps-hit')[next]?.focus();
    onhover?.(dots[next].point);
  }

  function onDotKey(e: KeyboardEvent, index: number) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onpick?.(dots[index].point);
      return;
    }
    const delta =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : e.key === 'Home'
            ? -dots.length
            : e.key === 'End'
              ? dots.length
              : 0;
    if (!delta) return;
    e.preventDefault();
    step(index, delta);
  }

  function title(p: ScatterPoint): string {
    return `${p.name} · ${p.day} · ${matrix.x.format(p.x)} at ${matrix.y.format(p.y)}`;
  }
</script>

<svg
  bind:this={svgEl}
  class="ps"
  viewBox="-64 -14 {W + 84} {H + 48}"
  role="group"
  aria-label="{matrix.x.label} against {matrix.y.label}, {matrix.n} outings"
>
  <!-- A frame rather than a full grid: three hairlines are enough to read a
       position against, and a ruled field would compete with the dots. -->
  <line class="ps-rule" x1="0" y1="0" x2={W} y2="0" />
  <line class="ps-rule mid" x1="0" y1={H / 2} x2={W} y2={H / 2} />
  <line class="ps-rule floor" x1="0" y1={H} x2={W} y2={H} />
  <line class="ps-rule floor" x1="0" y1="0" x2="0" y2={H} />

  <text class="ps-tick" x="-8" y="5" text-anchor="end">
    {matrix.y.tick(matrix.yDomain.hi)}{matrix.yDomain.beyondHi ? '+' : ''}
  </text>
  <text class="ps-tick" x="-8" y={H / 2 + 5} text-anchor="end">
    {matrix.y.tick((matrix.yDomain.hi + matrix.yDomain.lo) / 2)}
  </text>
  <text class="ps-tick" x="-8" y={H + 5} text-anchor="end">
    {matrix.y.tick(matrix.yDomain.lo)}{matrix.yDomain.beyondLo ? '−' : ''}
  </text>

  <text class="ps-tick" x="0" y={H + 24} text-anchor="start">
    {matrix.x.tick(matrix.xDomain.lo)}{matrix.xDomain.beyondLo ? '−' : ''}
  </text>
  <text class="ps-tick" x={W} y={H + 24} text-anchor="end">
    {matrix.x.tick(matrix.xDomain.hi)}{matrix.xDomain.beyondHi ? '+' : ''}
  </text>

  {#if matrix.subject}
    <!-- Crosshairs to the axes, so the lit dot can be read off both scales
         without tracing it by eye across a field of other outings. -->
    {@const sx = Math.min(W, Math.max(0, ((matrix.subject.x - matrix.xDomain.lo) / xSpan) * W))}
    {@const sy = Math.min(
      H,
      Math.max(0, H - ((matrix.subject.y - matrix.yDomain.lo) / ySpan) * H),
    )}
    <line class="ps-here" x1={sx} y1={sy} x2={sx} y2={H} />
    <line class="ps-here" x1="0" y1={sy} x2={sx} y2={sy} />
  {/if}

  {#each dots as dot, i (dot.point.id)}
    <g
      class="ps-hit"
      role="button"
      tabindex={i === entry ? 0 : -1}
      aria-label={title(dot.point)}
      onclick={() => onpick?.(dot.point)}
      onkeydown={(e) => onDotKey(e, i)}
      onmouseenter={() => onhover?.(dot.point)}
      onmouseleave={() => onhover?.(null)}
      onfocus={() => onhover?.(dot.point)}
      onblur={() => onhover?.(null)}
    >
      <title>{title(dot.point)}</title>
      <!-- Barely wider than the dot itself. A generous transparent disc is
           kinder to a mouse right up until the cloud is dense, at which point
           it covers its neighbours and the readout names an outing the reader
           is not pointing at — and then opens THAT one on click. You hit what
           you point at here, or you hit nothing. -->
      <circle class="ps-target" cx={dot.cx} cy={dot.cy} r={R * 1.25} />
      <circle
        class="ps-dot"
        class:subject={dot.point.subject}
        cx={dot.cx}
        cy={dot.cy}
        r={dot.point.subject ? R * 1.45 : R}
      />
    </g>
  {/each}
</svg>

<p class="ps-foot">
  {matrix.y.label} up the side · {matrix.x.label} across · {matrix.n} of {matrix.of}
  {matrix.n === matrix.of ? 'outings' : 'carry both'}{beyond ? ` · ${beyond} pinned to an edge` : ''}
</p>

<style>
  .ps {
    width: 100%;
    height: auto;
    display: block;
    overflow: visible;
  }

  .ps-rule {
    stroke: var(--line-hair);
    stroke-width: 1;
  }
  .ps-rule.mid {
    stroke-dasharray: 3 4;
  }
  .ps-rule.floor {
    stroke: var(--card-border);
  }

  .ps-here {
    stroke: var(--accent);
    stroke-width: 1;
    stroke-dasharray: 3 3;
    opacity: 0.7;
  }

  /* svg-user-units: the viewBox is ~684 wide and renders at about 710 screen
     px inside the drill, so a 13-unit label is ~13.5 screen px. */
  .ps-tick {
    font-family: var(--font-mono);
    font-size: 13px; /* svg-user-units */
    letter-spacing: 0.5px;
    fill: var(--text-ghost);
  }

  .ps-dot {
    fill: var(--text-primary);
    opacity: 0.3;
  }
  .ps-dot.subject {
    fill: var(--accent);
    opacity: 1;
    stroke: var(--bg);
    stroke-width: 1.4;
  }

  .ps-target {
    fill: transparent;
  }
  .ps-hit {
    cursor: pointer;
    outline: none;
  }
  .ps-hit:hover .ps-dot,
  .ps-hit:focus-visible .ps-dot {
    fill: var(--accent-ink);
    opacity: 1;
  }
  .ps-hit:hover .ps-dot.subject,
  .ps-hit:focus-visible .ps-dot.subject {
    fill: var(--accent);
  }
  .ps-hit:focus-visible .ps-target {
    fill: var(--accent-ink-tint-12);
  }

  .ps-foot {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 10px 0 0;
  }
</style>
