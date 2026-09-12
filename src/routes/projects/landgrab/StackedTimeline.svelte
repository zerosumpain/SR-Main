<script lang="ts">
  /**
   * Cells held per player over one region, stacked, oldest on the left.
   *
   * The x axis is the POINT INDEX, not the date. `regionHistory` emits a point
   * only on a day something changed hands (plus one at today), so a time axis
   * would draw eight months of nothing between two flips and squeeze the whole
   * fight into four pixels. Evenly spaced points give every handover the same
   * room, and the label row underneath says which days those are — the chart
   * answers "who held it, in what order", not "how long each spell lasted".
   *
   * The viewBox is padded in `TraceChart`'s manner: 42 user units on the left
   * for the value labels, 10 above the top gridline, and a row below the plot
   * for the dates. Both are drawn OUTSIDE the 600x160 plot, and it is the
   * viewport that would clip them, so no `overflow` on the parent gets them
   * back.
   */
  import { UNCLAIMED_IDENTITY, identityMap, titleCase } from './identity';
  import type { PlayerIdentity } from './identity';
  import type { TimelinePoint } from './types';

  let {
    timeline,
    players,
    label,
  }: {
    /** One point per day something changed hands, plus one at today. Oldest first. */
    timeline: TimelinePoint[];
    players: PlayerIdentity[];
    /** The accessible name for the plot. */
    label: string;
  } = $props();

  const W = 600;
  const TOP = 0;
  const FLOOR = 160;
  /** The date row, below the plot and inside the padded box. */
  const AXIS_Y = 180;

  const byId = $derived(identityMap(players));

  /**
   * Two points is a claim and today — a line between them says nothing that a
   * flat band does not. Under three, the band is the last point held across
   * the width and the note underneath says why it is flat.
   */
  const flat = $derived(timeline.length > 0 && timeline.length < 3);
  const points = $derived(
    flat ? [timeline[timeline.length - 1], timeline[timeline.length - 1]] : timeline,
  );

  /** Largest holder at the last point first — the biggest band sits on the floor. */
  const order = $derived.by(() => {
    if (!timeline.length) return [] as string[];
    const last = timeline[timeline.length - 1].cells;
    const seen = new Set<string>();
    for (const p of timeline) for (const s of Object.keys(p.cells)) seen.add(s);
    return [...seen].sort((a, b) => (last[b] ?? 0) - (last[a] ?? 0) || a.localeCompare(b));
  });

  const maxTotal = $derived.by(() => {
    let max = 0;
    for (const p of points) {
      let total = 0;
      for (const s of order) total += p.cells[s] ?? 0;
      if (total > max) max = total;
    }
    return max > 0 ? max : 1;
  });

  const xAt = (i: number): number => (points.length < 2 ? 0 : (i / (points.length - 1)) * W);
  const yAt = (value: number): number => FLOOR - (value / maxTotal) * (FLOOR - TOP);

  interface Band {
    subject: string;
    name: string;
    initial: string;
    colour: string;
    d: string;
    /** Where the band's right edge sits, so an end label can measure itself. */
    endTop: number;
    endBottom: number;
  }

  const bands = $derived.by(() => {
    const n = points.length;
    if (!n) return [] as Band[];
    const lower = new Array<number>(n).fill(0);
    const out: Band[] = [];
    for (const subject of order) {
      const upper = points.map((p, i) => lower[i] + (p.cells[subject] ?? 0));
      // Nobody held anything here at any DRAWN point — under three points that
      // is everybody but the current holder, and a zero-height path is ink for
      // no data.
      if (upper.every((v, i) => v === lower[i])) continue;
      const top = upper.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`);
      const bottom: string[] = [];
      for (let i = n - 1; i >= 0; i--) bottom.push(`${xAt(i).toFixed(1)},${yAt(lower[i]).toFixed(1)}`);
      const who = byId.get(subject);
      out.push({
        subject,
        name: who?.name ?? titleCase(subject),
        initial: who?.initial ?? '?',
        // The roster's own hue. Data, not a token — the five player colours are
        // the one exception the design system makes.
        colour: who?.colour ?? UNCLAIMED_IDENTITY.colour,
        d: `M${top.join(' L')} L${bottom.join(' L')} Z`,
        endTop: yAt(upper[n - 1]),
        endBottom: yAt(lower[n - 1]),
      });
      for (let i = 0; i < n; i++) lower[i] = upper[i];
    }
    return out;
  });

  const yTicks = $derived([
    { value: maxTotal, at: TOP },
    { value: maxTotal / 2, at: (TOP + FLOOR) / 2 },
    { value: 0, at: FLOOR },
  ]);

  const dayFmt = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  /** `2026-09-12` → `12 Sep`. UTC, because the days are UTC days. */
  function fmtDay(day: string): string {
    const t = Date.parse(`${day}T00:00:00Z`);
    return Number.isFinite(t) ? dayFmt.format(new Date(t)) : day;
  }

  const xTicks = $derived.by(() => {
    const n = timeline.length;
    if (!n) return [] as Array<{ text: string; x: number; anchor: 'start' | 'middle' | 'end' }>;
    if (n === 1) {
      return [{ text: fmtDay(timeline[0].day), x: W / 2, anchor: 'middle' as const }];
    }
    const first = { text: fmtDay(timeline[0].day), x: 0, anchor: 'start' as const };
    const last = { text: fmtDay(timeline[n - 1].day), x: W, anchor: 'end' as const };
    if (n === 2) return [first, last];
    const mid = Math.floor((n - 1) / 2);
    return [
      first,
      { text: fmtDay(timeline[mid].day), x: xAt(mid), anchor: 'middle' as const },
      last,
    ];
  });

  const round = (v: number) => Math.round(v).toLocaleString('en-GB');
</script>

{#if bands.length}
  <svg class="st" viewBox="-42 -10 654 200" role="img" aria-label={label}>
    {#each yTicks as tick, i (i)}
      <line class="st-grid" class:floor={tick.at === FLOOR} x1="0" y1={tick.at} x2={W} y2={tick.at} />
      <text class="st-tick" x="-6" y={tick.at + 4} text-anchor="end">{round(tick.value)}</text>
    {/each}

    {#each bands as band (band.subject)}
      <path
        class="st-band"
        d={band.d}
        style="fill: {band.colour}; stroke: {band.colour}"
      ><title>{band.name}</title></path>
    {/each}

    <!-- A direct label per band, but only where the band is tall enough at the
         right edge to hold it — a clipped initial is worse than none, and the
         battle table underneath names everybody anyway. Ink, never the band's
         own hue: text does not wear the data colour. -->
    {#each bands as band (band.subject)}
      {#if band.endBottom - band.endTop >= 16}
        <text class="st-end" x={W - 6} y={(band.endTop + band.endBottom) / 2 + 4} text-anchor="end"
          >{band.initial}</text
        >
      {/if}
    {/each}

    {#each xTicks as tick, i (i)}
      <text class="st-tick" x={tick.x} y={AXIS_Y} text-anchor={tick.anchor}>{tick.text}</text>
    {/each}
  </svg>
{/if}

{#if flat || !bands.length}
  <p class="st-note">Nothing has changed hands here yet.</p>
{/if}

<style>
  .st {
    width: 100%;
    height: auto;
    display: block;
  }

  .st-grid {
    stroke: var(--line-hair);
    stroke-width: 1;
  }
  .st-grid.floor {
    stroke: var(--card-border);
  }

  /* Fill and stroke are the same hue: the stroke is what keeps two adjacent
     bands apart where a handover makes them meet, and 0.55 keeps the gridlines
     readable through the stack. */
  .st-band {
    fill-opacity: 0.55;
    stroke-width: 1.5;
    stroke-linejoin: round;
  }

  /* svg-user-units: viewBox -42 -10 654 200, rendered ~660px wide inside the
     drill panel, so a 12-unit label is ~12px on screen — at the floor rather
     than under it. Inside a viewBox a "px" is a user unit, not a screen pixel,
     and the floor is about what the reader's eye gets. */
  .st-tick {
    font-family: var(--font-mono);
    font-size: 12px; /* svg-user-units */
    letter-spacing: 0.6px;
    fill: var(--text-ghost);
  }
  .st-end {
    font-family: var(--font-mono);
    font-size: 12px; /* svg-user-units */
    letter-spacing: 0.6px;
    fill: var(--text-primary);
  }

  .st-note {
    margin: 8px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-ghost);
  }
</style>
