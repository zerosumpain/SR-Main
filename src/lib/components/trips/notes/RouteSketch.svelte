<script lang="ts">
  // The plan sketched by hand on graph paper, for when there is no map (no
  // map token on this server, or the tiles will not load): every stop as a
  // numbered pencil dot where it really is (north up, the city kept in
  // shape), each day's walk between them as a wobbly pen line in that day's
  // colour, dashed when the leg has not been routed. Not a map — no streets,
  // no scale — and it says so in its caption. Labels read day·stop, as on the
  // real map, so colour is never the only code.
  import { inkLine, rng } from '$lib/landing/notes-ink';
  import type { MapDay } from '../TripMap.svelte';
  import { sketchPoints } from './notes';

  let { days, focus = null }: { days: MapDay[]; focus?: string | null } = $props();

  // Drawn at the figure's own width, so labels stay their real size on a phone.
  let width = $state(640);
  const W = $derived(Math.max(300, Math.round(width) || 640));
  const H = $derived(Math.round(Math.min(380, Math.max(240, W * 0.56))));
  const PAD = 30;

  const sketch = $derived.by(() => {
    const shown = days.map((d, i) => ({ d, i })).filter(({ d }) => !focus || d.date === focus);
    const all = shown.flatMap(({ d }) => [...d.stops.map((s) => s.location), ...d.legs.flatMap((l) => [l.from, l.to])]);
    const pts = sketchPoints(all, W, H, PAD);
    let k = 0;
    const out = shown.map(({ d, i }) => {
      const stops = d.stops.map((s) => ({ ...s, p: pts[k++] }));
      const legs = d.legs.map((l, li) => {
        const a = pts[k++];
        const b = pts[k++];
        return { a, b, path: inkLine(rng(i * 97 + li * 13 + 1), a.x, a.y, b.x, b.y, 0.8, 0.04), routed: !!(l.line && l.line.length > 1) };
      });
      // Where a leg starts or ends at no numbered stop, it is the stay (or a meal held there): a small square.
      const near = (p: { x: number; y: number }) => stops.some((s) => Math.hypot(s.p.x - p.x, s.p.y - p.y) < 2);
      const ends = new Map<string, { x: number; y: number }>();
      for (const l of legs) for (const p of [l.a, l.b]) if (!near(p)) ends.set(`${p.x},${p.y}`, p);
      return { date: d.date, slot: (i % 4) + 1, dashed: i >= 4, n: i + 1, stops, legs, homes: [...ends.values()] };
    });
    return out;
  });
  const count = $derived(sketch.reduce((s, d) => s + d.stops.length, 0));
  const homes = $derived(sketch.some((d) => d.homes.length > 0));
</script>

{#if count}
  <figure class="sketch np-graph" bind:clientWidth={width}>
    <svg viewBox="0 0 {W} {H}" role="img" aria-label="A sketch of where the {count} stops are, north up. Each day has its own colour; labels read day·stop.">
      {#each sketch as d (d.date)}
        <g style:--day="var(--chart-cat-{d.slot})">
          {#each d.legs as l, li (li)}
            <path class="leg" class:unrouted={!l.routed || d.dashed} d={l.path} />
          {/each}
          {#each d.homes as h (`${h.x},${h.y}`)}<rect class="home" x={h.x - 5} y={h.y - 5} width="10" height="10" />{/each}
          {#each d.stops as s (s.id)}
            <g class="stop" transform="translate({s.p.x} {s.p.y})">
              <circle r="9" />
              <text y="4">{s.n}</text>
              <text class="lab" class:left={s.p.x > W * 0.62} x={s.p.x > W * 0.62 ? -13 : 13} y="-9">{focus ? s.title : `${d.n}·${s.n}`}</text>
            </g>
          {/each}
        </g>
      {/each}
    </svg>
    <figcaption>A sketch, not a map — where each stop is, north up{homes ? '; squares are where you stay' : ''}. The map loads where a map key is set.</figcaption>
  </figure>
{/if}

<style>
  .sketch {
    margin: 0;
    padding: 8px;
  }
  svg {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
  }
  .leg {
    fill: none;
    stroke: var(--day);
    stroke-width: 2.5;
    stroke-linecap: round;
    opacity: 0.85;
  }
  .leg.unrouted {
    stroke-dasharray: 2 6;
  }
  .stop circle {
    fill: var(--np-card, var(--surface-card));
    stroke: var(--day);
    stroke-width: 2;
  }
  .stop text {
    font-family: var(--font-mono);
    font-size: 12px;
    text-anchor: middle;
    fill: var(--text-primary);
  }
  .home {
    fill: var(--day);
    opacity: 0.8;
  }
  .stop .lab.left {
    text-anchor: end;
  }
  .stop .lab {
    text-anchor: start;
    font-family: var(--font-body);
    font-size: 13px;
    paint-order: stroke;
    stroke: var(--np-card, var(--surface-card));
    stroke-width: 4px;
    stroke-linejoin: round;
  }
  figcaption {
    margin-top: 4px;
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: var(--fs-label);
    color: var(--text-secondary);
  }
</style>
