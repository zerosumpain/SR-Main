<script lang="ts">
  /**
   * The rest of today, one lane per person: where their routines put them
   * (a quiet bar, the place printed in it) and each journey between (petrol,
   * with a whisker for the arrival window). A journey the routine has run
   * fewer than eight times is hatched — the texture says "emerging" without
   * colour having to. A live journey is the site accent.
   *
   * Identity is the printed name, never a colour. Every mark carries its own
   * tooltip, and the same plan is written out as a list for a screen reader.
   */
  import type { AheadSegment, DayAhead } from '$lib/home/presence/forecast';
  import { cap, clock } from './format';

  let { ahead, names, now }: { ahead: DayAhead[]; names: Map<string, string>; now: string } = $props();

  const nameOf = (s: string) => names.get(s) ?? cap(s);
  const start = $derived(Date.parse(now));
  const end = $derived(Math.max(start + 3 * 3_600_000, ...ahead.map((d) => Date.parse(d.until))));

  let laneW = $state(0);
  const W = $derived(laneW || 640);
  const H = 34;
  const x = (t: string | number) => {
    const v = typeof t === 'number' ? t : Date.parse(t);
    return Math.max(0, Math.min(W, ((v - start) / (end - start)) * W));
  };
  /** Hour ticks, every two or three hours depending on how much day is left. */
  const ticks = $derived.by(() => {
    const step = (end - start) / 3_600_000 > 10 ? 3 : 2;
    const out: number[] = [];
    const first = Math.ceil(start / 3_600_000) * 3_600_000;
    for (let t = first; t <= end; t += 3_600_000) {
      const hour = Number(clock(t).slice(0, 2));
      if (hour % step === 0) out.push(t);
    }
    return out;
  });

  const place = (s: Extract<AheadSegment, { kind: 'stay' }>) => s.place || 'a known place';
  const tripTitle = (p: string, s: Extract<AheadSegment, { kind: 'trip' }>) =>
    s.confidence === 'live'
      ? `${p} is on the way to ${s.to}: there ${clock(s.arriveFrom)}–${clock(s.arriveTo)}`
      : `${p} usually leaves ${s.from} at ${clock(s.leave)} for ${s.to}, arriving ${clock(s.arriveFrom)}–${clock(s.arriveTo)}${s.confidence === 'emerging' ? ' (a new habit: fewer than eight runs)' : ''}`;
</script>

{#if !ahead.length}
  <p class="ta-empty">Nobody's day can be laid out yet: that needs someone at a known place with a routine from it, or on a journey the forecast recognises.</p>
{:else}
  <div class="ta" role="group" aria-label="The rest of today, by person">
    <div class="ta-row ta-axis" aria-hidden="true">
      <span></span>
      <svg width="100%" height="18" viewBox={`0 0 ${W} 18`} preserveAspectRatio="none">
        {#each ticks as t (t)}
          <text x={x(t)} y="13" text-anchor={x(t) > W - 24 ? 'end' : x(t) < 24 ? 'start' : 'middle'}>{clock(t)}</text>
        {/each}
      </svg>
    </div>
    {#each ahead as day (day.subject)}
      {@const p = nameOf(day.subject)}
      <div class="ta-row">
        <strong class="ta-name">{p}</strong>
        <div class="ta-lane" bind:clientWidth={laneW}>
          <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
            <defs>
              <pattern id="ta-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" class="ta-hatch-bg" />
                <line x1="0" y1="0" x2="0" y2="6" class="ta-hatch-line" />
              </pattern>
            </defs>
            {#each ticks as t (t)}<line x1={x(t)} x2={x(t)} y1="0" y2={H} class="ta-grid" />{/each}
            {#each day.segments as s, i (i)}
              {#if s.kind === 'stay'}
                {@const w = x(s.to) - x(s.from)}
                <g>
                  <title>{p} at {place(s)} {s.open ? `from ${clock(s.from)}` : `${clock(s.from)}–${clock(s.to)}`}</title>
                  <rect x={x(s.from) + 1} y="9" width={Math.max(0, w - 2)} height="16" class="ta-stay" />
                  {#if w > 64}<text x={x(s.from) + 6} y="21" class="ta-label">{place(s)}</text>{/if}
                </g>
              {:else}
                {@const x0 = x(s.leave)}
                {@const x1 = Math.max(x0 + 3, x(s.arrive))}
                <g>
                  <title>{tripTitle(p, s)}</title>
                  <rect x={x0} y="5" width={x1 - x0} height="24" class="ta-trip" class:live={s.confidence === 'live'}
                    fill={s.confidence === 'emerging' ? 'url(#ta-hatch)' : undefined} />
                  <line x1={x(s.arriveFrom)} x2={Math.max(x(s.arriveFrom) + 1, x(s.arriveTo))} y1="17" y2="17" class="ta-window" />
                  <line x1={x(s.arriveTo)} x2={x(s.arriveTo)} y1="12" y2="22" class="ta-window" />
                </g>
              {/if}
            {/each}
            <line x1="1" x2="1" y1="0" y2={H} class="ta-now" />
          </svg>
        </div>
      </div>
      <ol class="sr-only" aria-label={`${p}'s rest of today`}>
        {#each day.segments as s, i (i)}
          <li>{s.kind === 'stay' ? `At ${place(s)} ${s.open ? `from ${clock(s.from)}` : `until ${clock(s.to)}`}` : tripTitle(p, s)}</li>
        {/each}
      </ol>
    {/each}
    <ul class="ta-legend" aria-label="Key">
      <li><span class="sw stay"></span>Where they usually are</li>
      <li><span class="sw trip"></span>Journey, from a settled routine</li>
      <li><span class="sw emerging"></span>Journey, a newer habit</li>
      <li><span class="sw live"></span>On the way now</li>
      <li><span class="sw window"></span>Arrival window, four in five</li>
    </ul>
  </div>
{/if}

<style>
  .ta-empty {
    color: var(--text-muted);
    max-width: 70ch;
  }
  .ta-row {
    display: grid;
    grid-template-columns: 110px minmax(0, 1fr);
    gap: 12px;
    align-items: center;
    padding: 4px 0;
  }
  .ta-axis {
    padding-bottom: 0;
  }
  .ta-axis text {
    font: var(--fs-label-xs) var(--font-mono);
    fill: var(--text-muted);
  }
  .ta-name {
    font-size: var(--fs-nav);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ta-lane {
    min-width: 0;
  }
  .ta-lane svg {
    display: block;
    overflow: visible;
  }
  .ta-grid {
    stroke: var(--line);
    stroke-width: 1;
  }
  .ta-stay {
    fill: rgb(from var(--text-primary) r g b / 9%);
    rx: 2px;
  }
  .ta-label {
    font: var(--fs-label-xs) var(--font-mono);
    fill: var(--text-secondary);
  }
  .ta-trip {
    fill: var(--accent-ink);
    stroke: var(--bg);
    stroke-width: 2;
    rx: 2px;
  }
  .ta-trip.live {
    fill: var(--accent);
  }
  .ta-hatch-bg {
    fill: rgb(from var(--accent-ink) r g b / 22%);
  }
  .ta-hatch-line {
    stroke: var(--accent-ink);
    stroke-width: 2.5;
  }
  .ta-window {
    stroke: var(--text-primary);
    stroke-width: 2;
  }
  .ta-now {
    stroke: var(--accent);
    stroke-width: 2;
  }
  .ta-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
    font: var(--fs-label-xs) var(--font-mono);
    color: var(--text-muted);
  }
  .ta-legend li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sw {
    display: inline-block;
    width: 18px;
    height: 10px;
    border-radius: 2px;
  }
  .sw.stay {
    background: rgb(from var(--text-primary) r g b / 9%);
  }
  .sw.trip {
    background: var(--accent-ink);
  }
  .sw.emerging {
    background: repeating-linear-gradient(45deg, var(--accent-ink) 0 2px, rgb(from var(--accent-ink) r g b / 22%) 2px 5px);
  }
  .sw.live {
    background: var(--accent);
  }
  .sw.window {
    height: 2px;
    background: var(--text-primary);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  @media (max-width: 600px) {
    .ta-row {
      grid-template-columns: 72px minmax(0, 1fr);
      gap: 8px;
    }
  }
</style>
