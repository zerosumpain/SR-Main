<script lang="ts">
  /**
   * Learned routes: every trip as a dot, the middle 80% as a band, the median
   * as a tick — one row per person and direction. Broken trips (an arrival the
   * trail missed) are drawn hollow at the edge and stay out of every number.
   * Select a row to inspect it: when they leave against how long it takes,
   * which answers "does leaving later make it slower?" from their own trips.
   *
   * Identity is the row's printed name, never a colour: five people exceed the
   * site's four-hue categorical ramp, and a name cannot be misread.
   */
  import type { RouteInsight } from '$lib/home/presence/insights';
  import { localClock, type Routine } from '$lib/home/presence/forecast';
  import { clock, dayLabel, hhmm, mins, ofDays } from './format';

  let { routes, routines }: { routes: RouteInsight[]; routines: Routine[] } = $props();

  const shown = $derived(routes.filter((r) => r.samples - r.broken >= 3).slice(0, 14));
  let selectedId = $state<string | null>(null);
  const selected = $derived(shown.find((r) => r.id === selectedId) ?? shown[0] ?? null);
  const routinesOf = (r: RouteInsight) => routines.filter((x) => x.routeId === r.id);

  /** One scale for every strip, so rows compare: to the slowest clean trip, in 15s. */
  const maxMin = $derived(
    Math.max(30, Math.ceil(Math.max(0, ...shown.flatMap((r) => r.trips.filter((t) => !t.broken).map((t) => t.minutes))) / 15) * 15),
  );
  let stripW = $state(0);
  const W = $derived(stripW || 480);
  const PAD = 10;
  const x = (m: number) => PAD + (Math.min(m, maxMin) / maxMin) * (W - 2 * PAD);
  const ticks = $derived(Array.from({ length: maxMin / 15 + 1 }, (_, i) => i * 15));

  // ── Inspector scatter: departure time (x) × minutes (y) ─────────────────
  let scatterW = $state(0);
  const SW = $derived(scatterW || 520);
  const SH = 180;
  const SL = 44;
  const SB = 26;
  const pts = $derived(
    selected
      ? selected.trips.filter((t) => !t.broken).map((t) => ({ t, at: localClock(new Date(t.start)).minute }))
      : [],
  );
  const xDom = $derived.by(() => {
    if (!pts.length) return [0, 1440] as const;
    const lo = Math.floor((Math.min(...pts.map((p) => p.at)) - 20) / 60) * 60;
    const hi = Math.ceil((Math.max(...pts.map((p) => p.at)) + 20) / 60) * 60;
    return [Math.max(0, lo), Math.min(1440, Math.max(hi, lo + 60))] as const;
  });
  const yMax = $derived(Math.max(10, Math.ceil(Math.max(0, ...pts.map((p) => p.t.minutes)) / 5) * 5));
  const sx = (m: number) => SL + ((m - xDom[0]) / (xDom[1] - xDom[0])) * (SW - SL - 28);
  const sy = (v: number) => 8 + (1 - v / yMax) * (SH - SB - 8);
  const xTicks = $derived.by(() => {
    const span = xDom[1] - xDom[0];
    const step = span <= 180 ? 30 : span <= 480 ? 60 : 180;
    const out: number[] = [];
    for (let m = Math.ceil(xDom[0] / step) * step; m <= xDom[1]; m += step) out.push(m);
    return out;
  });
  const yTicks = $derived([0, Math.round(yMax / 2), yMax]);

  function select(id: string) {
    selectedId = id;
  }
</script>

<div class="rs">
  {#if !shown.length}
    <p class="rs-empty">No route has three clean trips in this window yet. Routes appear once someone makes the same journey between two named places three times.</p>
  {:else}
    <div class="rs-axis" aria-hidden="true">
      <span></span>
      <svg width="100%" height="18" viewBox={`0 0 ${W} 18`}>
        {#each ticks as t (t)}
          <text x={x(t)} y="13" text-anchor="middle">{t === maxMin ? `${t}+` : t}</text>
        {/each}
      </svg>
      <span class="rs-unit">minutes</span>
    </div>
    <ul class="rs-list" role="listbox" aria-label="Learned routes">
      {#each shown as r (r.id)}
        {@const ours = routinesOf(r)}
        <li
          class="rs-row"
          role="option"
          aria-selected={selected?.id === r.id}
          tabindex="0"
          onclick={() => select(r.id)}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              select(r.id);
            }
          }}
        >
          <div class="rs-name">
            <strong>{r.person} · {r.from} → {r.to}</strong>
            <small>
              {#if ours.length}
                {ours.map((o) => `${o.dayType}s, leaves ${o.departure}`).join(' · ')}
              {:else}
                varied times · {r.mode === 'vehicle' ? 'by vehicle' : 'on foot or bike'}
              {/if}
            </small>
          </div>
          <div class="rs-strip" bind:clientWidth={stripW}>
            <svg width="100%" height="34" viewBox={`0 0 ${W} 34`} role="img" aria-label={`${r.samples} trips, median ${mins(r.median)}`}>
              <line x1={PAD} x2={W - PAD} y1="17" y2="17" class="rs-base" />
              <rect x={x(r.low)} y="7" width={Math.max(2, x(r.high) - x(r.low))} height="20" class="rs-band" />
              {#each r.trips as t, i (t.start)}
                {#if t.broken}
                  <circle cx={W - PAD - 4} cy={17 + ((i % 3) - 1) * 7} r="4" class="rs-broken"><title>{dayLabel(t.start)} {clock(t.start)} · {mins(t.minutes)} · arrival missed, not counted</title></circle>
                {:else}
                  <circle cx={x(t.minutes)} cy={17 + ((i % 3) - 1) * 7} r="4" class="rs-dot"><title>{dayLabel(t.start)} {clock(t.start)} · {mins(t.minutes)}</title></circle>
                {/if}
              {/each}
              <line x1={x(r.median)} x2={x(r.median)} y1="3" y2="31" class="rs-median" />
            </svg>
          </div>
          <div class="rs-figure">
            <strong>{mins(r.median)}</strong>
            <small>{Math.round(r.low)}–{Math.round(r.high)} · {r.samples - r.broken} trips</small>
          </div>
        </li>
      {/each}
    </ul>

    {#if selected}
      {@const ours = routinesOf(selected)}
      <div class="rs-inspect" aria-live="polite">
        <div class="rs-inspect-copy">
          <p class="rs-kicker">Selected route</p>
          <h3>{selected.person} · {selected.from} → {selected.to}</h3>
          <p>
            {selected.samples - selected.broken} clean trips: median {mins(selected.median)}, four in five between
            {Math.round(selected.low)} and {Math.round(selected.high)} min.
            {#if selected.broken}{selected.broken} {selected.broken === 1 ? 'trip' : 'trips'} with a missed arrival left out.{/if}
          </p>
          {#each ours as o (o.id)}
            <p>
              <strong>{o.dayType === 'weekday' ? 'Weekdays' : 'Weekends'}:</strong> leaves {hhmm(o.window[0])}–{hhmm(o.window[1])},
              usually {o.departure} ({ofDays(o.days, o.of, o.dayType)}). To arrive on time, leave {Math.ceil(o.minutes.p80)} min ahead: four trips in five made it.
            </p>
          {:else}
            <p>No regular departure time yet: trips on this route start at different times of day.</p>
          {/each}
        </div>
        <figure class="rs-scatter" bind:clientWidth={scatterW}>
          <svg width="100%" height={SH} viewBox={`0 0 ${SW} ${SH}`} role="img" aria-label="Departure time against journey minutes">
            {#each yTicks as t (t)}
              <line x1={SL} x2={SW - 12} y1={sy(t)} y2={sy(t)} class="rs-grid" />
              <text x={SL - 6} y={sy(t) + 4} text-anchor="end">{t}</text>
            {/each}
            {#each xTicks as t (t)}
              <text x={sx(t)} y={SH - 6} text-anchor="middle">{hhmm(t)}</text>
            {/each}
            {#each pts as p (p.t.start)}
              <circle cx={sx(p.at)} cy={sy(p.t.minutes)} r="5" class="rs-dot"><title>{dayLabel(p.t.start)} · left {clock(p.t.start)} · {mins(p.t.minutes)}</title></circle>
            {/each}
          </svg>
          <figcaption>Each dot is a trip: when it left (across) and how long it took (up, minutes).</figcaption>
        </figure>
      </div>
    {/if}
  {/if}
</div>

<style>
  .rs-empty {
    color: var(--text-muted);
    max-width: 70ch;
  }
  .rs-axis,
  .rs-row {
    display: grid;
    grid-template-columns: minmax(0, 250px) minmax(0, 1fr) 110px;
    gap: 6px 16px;
    align-items: center;
  }
  .rs-axis text,
  .rs-scatter text {
    font: var(--fs-label-xs) var(--font-mono);
    fill: var(--text-muted);
  }
  .rs-unit {
    font: var(--fs-label-xs) var(--font-mono);
    color: var(--text-muted);
  }
  .rs-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .rs-row {
    padding: 10px 6px;
    border-top: 1px solid var(--line);
    cursor: pointer;
  }
  .rs-row:hover {
    background: rgb(from var(--accent) r g b / 6%);
  }
  .rs-row[aria-selected='true'] {
    background: rgb(from var(--accent-ink) r g b / 8%);
    box-shadow: inset 3px 0 0 var(--accent-ink);
  }
  .rs-row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .rs-name strong {
    display: block;
    font-size: var(--fs-nav);
  }
  small {
    display: block;
    margin-top: 2px;
    font-size: var(--fs-label);
    color: var(--text-muted);
  }
  .rs-figure {
    text-align: right;
  }
  .rs-figure strong {
    font: var(--fs-body-lg) var(--font-display);
  }
  .rs-base {
    stroke: var(--line-strong);
    stroke-width: 1;
  }
  .rs-band {
    fill: rgb(from var(--accent-ink) r g b / 14%);
  }
  .rs-dot {
    fill: var(--accent-ink);
    fill-opacity: 0.85;
    stroke: var(--bg);
    stroke-width: 1.5;
  }
  .rs-broken {
    fill: none;
    stroke: var(--text-muted);
    stroke-width: 1.5;
  }
  .rs-median {
    stroke: var(--text-primary);
    stroke-width: 2;
  }
  .rs-grid {
    stroke: var(--line);
  }
  .rs-inspect {
    margin-top: 16px;
    padding: 16px;
    background: var(--surface-rail);
    border-left: 3px solid var(--accent-ink);
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
    gap: 20px;
  }
  .rs-kicker {
    margin: 0;
    font: 600 var(--fs-label-xs) var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent-ink);
  }
  .rs-inspect h3 {
    margin: 4px 0 8px;
    font: var(--fs-display-xs) var(--font-display);
  }
  .rs-inspect p {
    margin: 0 0 8px;
    font-size: var(--fs-body-sm);
    line-height: 1.55;
  }
  figure {
    margin: 0;
    min-width: 0;
  }
  figcaption {
    font-size: var(--fs-label);
    color: var(--text-muted);
  }
  @media (max-width: 820px) {
    .rs-axis,
    .rs-row {
      grid-template-columns: minmax(0, 1fr) 90px;
    }
    .rs-axis span:first-child {
      display: none;
    }
    .rs-axis svg {
      grid-column: 1;
    }
    .rs-strip {
      grid-column: 1 / -1;
      grid-row: 2;
    }
    .rs-inspect {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
