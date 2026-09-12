<script lang="ts">
  // One metric's cohort, as an axis with the outings piled beneath it.
  //
  // Hand-authored SVG rather than a chart component, for the reason `chart.ts`
  // gives for every other figure on this hub: what the shared components draw
  // is a different chart. This one is a beeswarm strip — the distribution IS
  // the picture, and the subject is one lit dot inside it.
  //
  // THE VIEWBOX IS PADDED. The axis end labels are drawn at x = 0 and x = W with
  // start/end anchors, the subject's callout sits above the axis, and the swarm
  // grows downward by however many rows the cohort needs. An unpadded box clips
  // all three, and it is the VIEWPORT doing the clipping, so no amount of
  // `overflow` on the parent gets them back.
  //
  // Drawn identically in the hover card and in the drill. The only differences
  // are the dot size and whether the dots are buttons — a reader who saw a
  // distribution in the card and a differently-shaped one in the modal would
  // have been shown two cohorts.
  import { swarm, swarmRows, type PeerPoint, type PeerReading } from '$lib/health/activity-peers';

  interface Props {
    reading: PeerReading;
    /** Bigger dots and clickable points — the drill. */
    interactive?: boolean;
    /** Radius in user units. */
    radius?: number;
    /** Chosen in the drill, so the readout can follow the pointer. */
    onpick?: (point: PeerPoint) => void;
    onhover?: (point: PeerPoint | null) => void;
  }

  let { reading, interactive = false, radius = 3.2, onpick, onhover }: Props = $props();

  const W = 600;
  let svgEl: SVGSVGElement | null = $state(null);
  /** Where the axis rule sits; the callout goes above it, the swarm below. */
  const AXIS_Y = 0;

  const spacing = $derived(radius * 2 + 1.4);
  const rowH = $derived(radius * 2 + 1.4);
  const dots = $derived(swarm(reading.points, reading.domain, W, spacing));
  const depth = $derived(swarmRows(dots));
  /** First row of dots clears the axis rule and its tick marks. */
  const TOP_GAP = $derived(radius + 7);
  const height = $derived(TOP_GAP + depth * rowH + radius + 4);

  const span = $derived(reading.domain.hi - reading.domain.lo || 1);
  function xOf(value: number): number {
    return ((value - reading.domain.lo) / span) * W;
  }

  const subjectX = $derived(reading.value == null ? null : xOf(reading.value));
  const medianX = $derived(reading.median == null ? null : xOf(reading.median));

  /**
   * The viewBox's top edge.
   *
   * 20 user units of headroom for the subject's tick and the two axis-end
   * labels, which are drawn ABOVE the rule so the swarm below stays unbroken.
   */
  const TOP = -20;

  function title(p: PeerPoint): string {
    return `${p.name} · ${p.day} · ${reading.metric.format(p.value)}`;
  }

  /**
   * The mark for an outing that is off the end of the axis.
   *
   * A chevron rather than a dot, because these are pinned to the edge and a
   * pile of circles there would read as a real cluster at that value. It points
   * the way the value went.
   */
  function chevron(x: number, y: number, r: number, side: 'hi' | 'lo'): string {
    const d = side === 'hi' ? r : -r;
    return `M${(x - d).toFixed(2)},${(y - r).toFixed(2)} L${(x + d).toFixed(2)},${y.toFixed(2)} L${(x - d).toFixed(2)},${(y + r).toFixed(2)}`;
  }

  /**
   * A ROVING TABINDEX, because a cohort is not a toolbar.
   *
   * The production cohort is 85 walks, and making every dot a tab stop would
   * put 85 of them between the top of the modal and the buttons at the bottom.
   * One dot is in the tab order — the subject, which is the one the reader came
   * to look at — and the arrow keys walk the rest, which is what a reader
   * expects of a row of related things and what ARIA's own composite-widget
   * guidance asks for.
   */
  const entry = $derived.by(() => {
    const i = dots.findIndex((d) => d.point.subject);
    return i >= 0 ? i : 0;
  });

  function step(from: number, delta: number) {
    if (!svgEl) return;
    const next = Math.min(dots.length - 1, Math.max(0, from + delta));
    if (next === from) return;
    const groups = svgEl.querySelectorAll<SVGGElement>('g.pp-hit');
    groups[next]?.focus();
    onhover?.(dots[next].point);
  }

  function onDotKey(e: KeyboardEvent, index: number) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onpick?.(dots[index].point);
      return;
    }
    const delta =
      e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'Home' ? -dots.length : e.key === 'End' ? dots.length : 0;
    if (!delta) return;
    e.preventDefault();
    step(index, delta);
  }
</script>

<svg
  bind:this={svgEl}
  class="pp"
  class:interactive
  viewBox="-8 {TOP} {W + 16} {height - TOP + 4}"
  role={interactive ? 'group' : 'img'}
  aria-label="{reading.metric.label} against {reading.n} outings"
>
  <!-- The axis: ends capped so "0 km → 21.4 km" reads as a bounded scale rather
       than a line that happens to stop. -->
  <line class="pp-axis" x1="0" y1={AXIS_Y} x2={W} y2={AXIS_Y} />
  <line class="pp-cap" x1="0" y1={AXIS_Y - 4} x2="0" y2={AXIS_Y + 4} />
  <line class="pp-cap" x1={W} y1={AXIS_Y - 4} x2={W} y2={AXIS_Y + 4} />

  {#if medianX != null}
    <!-- The cohort's middle. A hairline, not a label: the number that matters
         is the subject's, and a second figure on the axis competes with it. -->
    <line class="pp-median" x1={medianX} y1={AXIS_Y - 3} x2={medianX} y2={AXIS_Y + 3} />
  {/if}

  <text class="pp-end" x="0" y={AXIS_Y - 8} text-anchor="start">
    {reading.metric.tick(reading.domain.lo)}{reading.domain.beyondLo ? '−' : ''}
  </text>
  <text class="pp-end" x={W} y={AXIS_Y - 8} text-anchor="end">
    {reading.metric.tick(reading.domain.hi)}{reading.domain.beyondHi ? '+' : ''}
  </text>

  {#if subjectX != null}
    <line class="pp-here" x1={subjectX} y1={AXIS_Y - 6} x2={subjectX} y2={height} />
  {/if}

  {#each dots as dot, i (dot.point.id)}
    {@const cy = TOP_GAP + dot.row * rowH}
    {@const beyond = dot.beyond}
    {#if interactive}
      <!-- A circle inside a <g role="button"> rather than a <button>: Safari
           will not lay a foreign-object button out inside an SVG, and every
           other shape on this page is drawn, not composed. -->
      <g
        class="pp-hit"
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
        <!-- Barely wider than the dot. It was 2.4×, which is kinder to a mouse
             and covers the neighbours either side: rows are spaced 2r + 1.4
             apart, so a 2.4r disc reaches well into the next dot's, and the
             readout then names an outing the reader is not pointing at. -->
        <circle class="pp-target" cx={dot.x} cy={cy} r={radius * 1.25} />
        {#if beyond}
          <path class="pp-over" d={chevron(dot.x, cy, radius, beyond)} />
        {:else}
          <circle
            class="pp-dot"
            class:subject={dot.point.subject}
            cx={dot.x}
            cy={cy}
            r={dot.point.subject ? radius * 1.45 : radius}
          />
        {/if}
      </g>
    {:else if beyond}
      <path class="pp-over" d={chevron(dot.x, cy, radius, beyond)} />
    {:else}
      <circle
        class="pp-dot"
        class:subject={dot.point.subject}
        cx={dot.x}
        cy={cy}
        r={dot.point.subject ? radius * 1.45 : radius}
      />
    {/if}
  {/each}
</svg>

<style>
  .pp {
    width: 100%;
    height: auto;
    display: block;
    overflow: visible;
  }

  .pp-axis {
    stroke: var(--card-border);
    stroke-width: 1;
  }
  .pp-cap {
    stroke: var(--card-border);
    stroke-width: 1;
  }
  .pp-median {
    stroke: var(--text-ghost);
    stroke-width: 1;
  }

  /* The subject's own position, carried the full depth of the swarm so the lit
     dot can be found in a crowded pile without hunting for it. */
  .pp-here {
    stroke: var(--accent);
    stroke-width: 1;
    stroke-dasharray: 3 3;
    opacity: 0.7;
  }

  /* svg-user-units: the viewBox is ~616 wide and renders between 280 and 660
     screen px, so a 10-unit label lands between 4.5 and 10.7 screen px. That is
     under the 12px floor the site gates, which is why these are the ONLY text
     in the component and both are duplicated as real text in the card's head. */
  .pp-end {
    font-family: var(--font-mono);
    font-size: 13px; /* svg-user-units */
    letter-spacing: 0.5px;
    fill: var(--text-ghost);
  }

  .pp-dot {
    fill: var(--text-primary);
    opacity: 0.28;
  }
  .pp-dot.subject {
    fill: var(--accent);
    opacity: 1;
    stroke: var(--bg);
    stroke-width: 1.2;
  }

  /* Off the end of the axis. Same weight as a dot, different shape, so the
     edge reads as "and more beyond" rather than as a spike in the data. */
  .pp-over {
    fill: none;
    stroke: var(--text-primary);
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.4;
  }

  .pp-target {
    fill: transparent;
  }
  .pp-hit {
    cursor: pointer;
    outline: none;
  }
  .pp-hit:hover .pp-dot,
  .pp-hit:focus-visible .pp-dot {
    fill: var(--accent-ink);
    opacity: 1;
  }
  .pp-hit:hover .pp-dot.subject,
  .pp-hit:focus-visible .pp-dot.subject {
    fill: var(--accent);
  }
  .pp-hit:focus-visible .pp-target {
    fill: var(--accent-ink-tint-12);
  }
</style>
