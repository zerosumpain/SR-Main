<svelte:options css="injected" />

<script lang="ts">
  // The last forty days of shipping as a line of type under the sentence: a
  // numeral per day, a dot for a quiet one, brighter for busier, today
  // underlined. One tab stop, not forty: it is a slider, so the arrow keys,
  // Home and End step through the days and a screen reader hears each as
  // "Tue 7 Oct · 3 deploys" (aria-valuetext). A faint playhead steps one day
  // per heartbeat while the hero is moving; it is CSS, timed off --beat.
  //
  // Not scenery: it sits a line under the sentence, too close for the rambler
  // (78px tall) to stand on without covering the words above.
  import { dayLabel, type DayCount } from '$lib/landing/rhythm';

  let { days, moving }: { days: DayCount[]; moving: boolean } = $props();

  let picked = $state<number | null>(null);
  let at = $derived(Math.min(picked ?? days.length - 1, days.length - 1));
  let peak = $derived(Math.max(1, ...days.map((d) => d.count)));

  function onkeydown(e: KeyboardEvent) {
    const last = days.length - 1;
    const step: Record<string, number> = { ArrowLeft: at - 1, ArrowDown: at - 1, ArrowRight: at + 1, ArrowUp: at + 1, Home: 0, End: last, PageUp: at + 7, PageDown: at - 7 };
    if (!(e.key in step)) return;
    e.preventDefault();
    picked = Math.max(0, Math.min(last, step[e.key]));
  }

  // A click on a day picks it; the days themselves are not separate controls.
  function onclick(e: MouseEvent) {
    const i = (e.target as HTMLElement).closest<HTMLElement>('[data-i]')?.dataset.i;
    if (i != null) picked = Number(i);
  }
</script>

<div class="rh">
  <div
    class="rh-days"
    role="slider"
    tabindex="0"
    aria-label="Deploys a day over the last {days.length} days"
    aria-valuemin={1}
    aria-valuemax={days.length}
    aria-valuenow={at + 1}
    aria-valuetext={dayLabel(days[at])}
    {onkeydown}
    {onclick}
    onblur={() => (picked = null)}
  >
    {#each days as d, i (d.date)}
      <span
        class="rh-d"
        class:z={d.count === 0}
        class:two={d.count > 9}
        class:busy={d.count > 0 && d.count >= peak / 2}
        class:today={i === days.length - 1}
        class:on={picked === i}
        data-i={i}
        style:--a={(0.8 + 0.2 * (d.count / peak)).toFixed(2)}>{d.count || '·'}</span
      >
    {/each}
    {#if moving}<span class="rh-play" data-beat></span>{/if}
  </div>
  <p class="rh-read" aria-hidden="true">
    {picked != null ? dayLabel(days[at]) : `deploys a day, last ${days.length}`}
  </p>
</div>

<style>
  .rh {
    --cell: 2.6ch;
    font-family: var(--font-mono);
    font-size: 13px;
  }
  .rh-days {
    position: relative;
    display: grid;
    grid-template-columns: repeat(40, minmax(0, 1fr));
    max-width: calc(40 * var(--cell));
    padding: 3px 0 6px;
    cursor: default;
    outline: none;
  }
  .rh-days:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: 4px;
  }
  .rh-d {
    position: relative;
    z-index: 1;
    text-align: center;
    line-height: 1.5;
    font-variant-numeric: tabular-nums;
    /* Busier is brighter and heavier, but never below 4.5:1 on the ink: the
       quietest day with a deploy is still a number someone has to read. */
    color: rgba(232, 134, 58, var(--a));
    cursor: pointer;
  }
  .rh-d.busy {
    font-weight: 500;
  }
  /* Two digits in a one-digit cell: pull them together so "3 11" never reads "311". */
  .rh-d.two {
    letter-spacing: -0.16em;
    /* Letter-spacing trails the last digit too; pad it back to the centre. */
    padding-left: 0.16em;
  }
  .rh-d.z {
    color: var(--on-ink-55);
  }
  .rh-d.today {
    color: var(--bg);
  }
  .rh-d.today::after {
    content: '';
    position: absolute;
    left: 22%;
    right: 22%;
    bottom: -3px;
    height: 1px;
    background: currentColor;
  }
  .rh-d:hover,
  .rh-d.on {
    color: var(--bg);
    background: var(--on-ink-12);
  }
  /* One day per beat, oldest to today, landing on the R wave like the sweep. */
  .rh-play {
    position: absolute;
    top: 3px;
    bottom: 6px;
    left: 0;
    width: calc(100% / 40);
    background: var(--on-ink-08);
    border-bottom: 1px solid var(--accent-on-dark-40);
    box-sizing: border-box;
    animation: rh-play calc(var(--beat, 1s) * 40) steps(40, end) calc(var(--beat, 1s) * var(--peak, 0)) infinite;
    pointer-events: none;
  }
  @keyframes rh-play {
    to {
      transform: translateX(4000%);
    }
  }
  .rh-read {
    margin: 2px 0 0;
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: var(--on-ink-55);
  }
  /* Wide desktop: the readout takes the margin column, level with the
     numerals, so the row costs one line. Narrower, the numerals keep the full
     width so each day's cell stays wide enough for two digits. */
  @media (min-width: 1100px) {
    .rh {
      display: grid;
      grid-template-columns: var(--margin) minmax(0, 1fr);
      column-gap: 32px;
      align-items: baseline;
    }
    .rh-read {
      order: -1;
      margin: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .rh-play {
      display: none;
    }
  }
  /* A phone gets two rows of twenty; the playhead, which walks one row, sits out. */
  @media (max-width: 760px) {
    .rh {
      font-size: var(--fs-label-xs);
    }
    .rh-days {
      grid-template-columns: repeat(20, minmax(0, 1fr));
      row-gap: 6px;
      max-width: none;
    }
    .rh-play {
      display: none;
    }
  }
  @media print {
    .rh-play {
      display: none;
    }
    .rh-d,
    .rh-d.today,
    .rh-read {
      color: #1a1008;
    }
    .rh-d.z {
      color: rgba(26, 16, 8, 0.7);
    }
  }
</style>
