<svelte:options css="injected" />

<script lang="ts">
  // The last forty days of deploys tallied on the wall: a stroke per deploy,
  // a gate for every five, a week to a line (Monday first, so the quiet
  // weekends line up) and today ringed. The strokes are 3px apart so a day
  // can be counted by eye; the exact figure is on hover and on focus.
  //
  // One tab stop, not forty, as in ShipRhythm: it is a slider, so the arrow
  // keys step a day (up and down a week), Home and End jump to the ends, and
  // a screen reader hears each day as "Tue 7 Oct · 3 deploys". A finger picks
  // a day by tapping it, and the day stays picked until the wall loses focus.
  //
  // Under the wall, its caption: the view's aside about today and yesterday,
  // or the day under the pointer or the keys. One line either way, so the
  // band keeps its height whatever the numbers say. The tops of its letters
  // are a ledge for the rambler, halfway down the sheet on a phone.
  import { dayLabel, type DayCount } from '$lib/landing/rhythm';
  import { wallWeeks } from '$lib/landing/notes';
  import { inkRing, inkTally, rng } from '$lib/landing/notes-ink';
  import { scenery } from '$lib/landing/ramblers/scenery';

  let {
    days,
    caption,
  }: {
    days: DayCount[];
    /** Said under the wall while no day is picked. */
    caption: string;
  } = $props();

  const PITCH = 50;
  const CELL = 46;
  const ROW = 15;
  const DAYS = ['m', 't', 'w', 't', 'f', 's', 's'];
  const WIDE = 7 * PITCH;

  let weeks = $derived(wallWeeks(days));
  let cells = $derived(weeks.flatMap((w, row) => w.map((d, col) => (d ? { ...d, x: col * PITCH, y: row * ROW } : null))));
  let last = $derived(days.length - 1);
  let today = $derived(cells.find((c) => c?.i === last));
  let marks = $derived(
    cells.flatMap((c) => (c ? [{ c, t: c.count > 0 ? inkTally(c.count, CELL, ROW - 3, c.i + 1) : null }] : [])),
  );
  // Seven lines always: forty days span six or seven weeks, and the band
  // should not change height with the day of the week.
  const rows = 7;
  let ring = $derived(today ? inkRing(rng(17), today.x + CELL / 2, today.y + ROW / 2 + 1, CELL / 2 + 3, ROW / 2 + 3, 1.08, 0.04) : '');

  // The wall scales with its column; the overflow count is set so it never
  // reads smaller than 12px however narrow the column gets.
  let shown = $state(WIDE);
  let small = $derived(12 * Math.max(1, WIDE / Math.max(1, shown)));

  let picked = $state<number | null>(null);
  let at = $derived(Math.min(picked ?? last, last));

  function onkeydown(e: KeyboardEvent) {
    const step: Record<string, number> = {
      ArrowLeft: at - 1,
      ArrowRight: at + 1,
      ArrowUp: at - 7,
      ArrowDown: at + 7,
      Home: 0,
      End: last,
      PageUp: at - 7,
      PageDown: at + 7,
    };
    if (!(e.key in step)) return;
    e.preventDefault();
    picked = Math.max(0, Math.min(last, step[e.key]));
  }

  // A pointer on a day shows it; the days themselves are not separate controls.
  function pick(e: PointerEvent) {
    const i = (e.target as HTMLElement).closest<HTMLElement>('[data-i]')?.dataset.i;
    if (i != null) picked = Number(i);
  }
  // A mouse moving off lets go; a finger lifting off is how a tap ends, so it keeps the day.
  function onpointerleave(e: PointerEvent) {
    if (e.pointerType === 'mouse') picked = null;
  }
</script>

<div class="tw">
  <div
    class="tw-wall"
    role="slider"
    tabindex="0"
    aria-label="Deploys a day over the last {days.length} days"
    aria-valuemin={1}
    aria-valuemax={days.length}
    aria-valuenow={at + 1}
    aria-valuetext={dayLabel(days[at])}
    {onkeydown}
    onpointerover={pick}
    onpointerdown={pick}
    {onpointerleave}
    onblur={() => (picked = null)}
  >
    <div class="tw-head" aria-hidden="true">{#each DAYS as d, i (i)}<span>{d}</span>{/each}</div>
    <div class="tw-body" bind:clientWidth={shown}>
      <svg viewBox="-2 -3 {7 * PITCH} {rows * ROW + 4}" focusable="false" aria-hidden="true">
        {#each marks as { c, t } (c.i)}
          {#if t}
            <path class="tw-s" class:now={c.i === last} d={t.d} transform="translate({c.x},{c.y + 2})" />
            {#if t.more}<text x={c.x + t.moreX - 1} y={c.y + ROW - 2} style:font-size="{small.toFixed(2)}px">+{t.more}</text>{/if}
          {:else}
            <circle class="tw-z" cx={c.x + 4} cy={c.y + ROW / 2 + 1} r="1.3" />
          {/if}
        {/each}
        {#if ring}<path class="tw-ring" d={ring} />{/if}
      </svg>
      <div class="tw-hit" aria-hidden="true">
        {#each cells as c, k (k)}<span data-i={c?.i} class:on={c != null && picked === c.i}></span>{/each}
      </div>
    </div>
  </div>
  <p class="tw-read" class:aside={picked == null} aria-hidden="true">
    <span use:scenery={{ text: true }}>{picked != null ? dayLabel(days[at]) : caption}</span>
  </p>
</div>

<style>
  .tw {
    max-width: 350px;
  }
  .tw-wall {
    outline: none;
    cursor: default;
  }
  .tw-wall:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: 3px;
    border-radius: 2px;
  }
  .tw-head,
  .tw-hit {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }
  .tw-head {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    color: var(--on-ink-55);
  }
  .tw-body {
    position: relative;
  }
  svg {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
  }
  path {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .tw-s {
    stroke: var(--on-ink-70);
    stroke-width: 1.4;
  }
  .tw-s.now {
    stroke: var(--accent-on-dark);
  }
  /* A quiet day: a pencil dot, so it reads as none rather than as missing. */
  .tw-z {
    fill: var(--on-ink-45);
  }
  .tw-ring {
    stroke: var(--accent-on-dark);
    stroke-width: 1.6;
  }
  text {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: -0.04em;
    fill: var(--on-ink-80);
  }
  /* The hit grid lies over the strokes: a cell per day, lit on hover or key. */
  .tw-hit {
    position: absolute;
    inset: 0;
    grid-template-rows: repeat(7, minmax(0, 1fr));
  }
  .tw-hit span {
    margin: 0 4px 0 -2px;
  }
  .tw-hit span[data-i] {
    cursor: pointer;
  }
  .tw-hit span.on {
    background: var(--on-ink-08);
    border-bottom: 1px solid var(--accent-on-dark-40);
  }
  /* One line at a fixed height, in either voice. */
  .tw-read {
    height: 22px;
    margin: 2px 0 0;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 22px;
    letter-spacing: 0.06em;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--on-ink-55);
  }
  /* The aside, as pencilled beside the other marks. */
  .tw-read.aside {
    font-family: var(--fs-serif);
    font-optical-sizing: auto;
    font-style: italic;
    font-size: 15px;
    letter-spacing: 0;
    color: var(--on-ink-70);
  }
  @media print {
    .tw-s,
    .tw-s.now,
    .tw-ring {
      stroke: #1a1008;
    }
    .tw-z {
      fill: rgba(26, 16, 8, 0.5);
    }
    text {
      fill: #1a1008;
    }
    .tw-head,
    .tw-read {
      color: #1a1008;
    }
  }
</style>
