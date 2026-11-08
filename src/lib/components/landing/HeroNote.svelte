<svelte:options css="injected" />

<script lang="ts" module>
  import type { StepsToday } from '$lib/landing/steps';
  import type { CalendarMonth, DayCount, Think } from '$lib/landing/rhythm';

  /** The small exact picture each footnote carries. */
  export type NoteVisual =
    | { kind: 'pulse'; bpm: number | null }
    | { kind: 'steps'; steps: StepsToday | null }
    | { kind: 'daydream'; thinks: Think[]; off: boolean }
    | { kind: 'ship'; days: DayCount[] }
    | { kind: 'releases'; months: CalendarMonth[] };
</script>

<script lang="ts">
  // One footnote of the landing sentence. It sits inside the paragraph, right
  // after its clause's punctuation, so it is the next thing a screen reader
  // reads after the word that opened it; closed, it is display:none and its link
  // leaves the tab order. Everything is a <span> because it lives in a <p>.
  // Print opens all five (see the print rule in HeroSentence).
  import { ecgTrace, rulerNow, rulerTicks, spikeTrace, stepsTrace } from '$lib/landing/traces';
  import { calendarSummary, dayName, stepsSummary } from '$lib/landing/rhythm';

  let {
    id,
    n,
    open,
    tone,
    head,
    text,
    href,
    cta,
    visual,
  }: {
    id: string;
    n: number;
    open: boolean;
    tone: 'accent' | 'ink';
    head: string;
    text: string;
    href: string;
    cta: string;
    visual: NoteVisual;
  } = $props();

  const HOURS = [0, 6, 12, 18, 24];
  const pct = (x: number) => `${x / 10}%`;
  /**
   * How much of the ruler is still to come, as a tier the stylesheet matches
   * against the ruler's width: the hatch is lettered only when "the rest is
   * pending" fits inside it, and captioned underneath otherwise.
   */
  const fit = (now: number) => {
    const rest = (1000 - now) / 1000;
    return rest >= 0.66 ? 'fit-a' : rest >= 0.4 ? 'fit-b' : rest >= 0.25 ? 'fit-c' : 'fit-d';
  };
</script>

<span class="fn" class:open {id} role="note" aria-label="Footnote {n}" data-tone={tone}>
  <span class="fn-card">
    <span class="fn-head">{n} · {head}</span>
    <span class="fn-grid">
      <span class="fn-copy">
        <span class="fn-text">{text}</span>
        <a class="fn-link" {href}>{cta} <span aria-hidden="true">→</span></a>
      </span>
      {#if visual.kind === 'pulse'}
        <span class="fn-vis" aria-hidden="true">
          <svg class="strip" viewBox="0 0 1000 60" preserveAspectRatio="none" focusable="false">
            <path d={visual.bpm != null ? ecgTrace(visual.bpm) : 'M0,40 L1000,40'} />
          </svg>
          <span class="cap">{visual.bpm != null ? `six seconds at ${visual.bpm} bpm` : 'nothing to draw yet'}</span>
        </span>
      {:else if visual.kind === 'steps'}
        {@const s = visual.steps}
        {@const now = rulerNow(s?.nowBin ?? 0)}
        <span class="vh">{stepsSummary(s)}</span>
        <span class="fn-vis steps {fit(now)}" aria-hidden="true">
          <span class="ruler">
            <svg viewBox="0 0 1000 60" preserveAspectRatio="none" focusable="false">
              <path class="bars" d={s ? stepsTrace(s.bins, s.nowBin) : 'M0,54 L1000,54'} />
              <path class="ticks" d={rulerTicks()} />
            </svg>
            <span class="pending" style:left={pct(now)}><span class="pend-in">the rest is pending</span></span>
            <span class="now" style:left={pct(now)}>now-ish</span>
          </span>
          <span class="hours">
            {#each HOURS as h (h)}<span style:left="{(h / 24) * 100}%">{String(h).padStart(2, '0')}</span>{/each}
          </span>
          {#if now < 1000}<span class="cap pend-out">the hatched rest of the day is pending</span>{/if}
        </span>
      {:else if visual.kind === 'daydream'}
        {@const rows = [
          { k: 'earlier', ts: visual.thinks.filter((t) => t.state === 'earlier') },
          { k: 'next', ts: visual.thinks.filter((t) => t.state === 'next') },
          { k: 'to come', ts: visual.thinks.filter((t) => t.state === 'later') },
        ]}
        <span class="fn-vis sched" class:off={visual.off}>
          {#each rows as r (r.k)}
            {#if r.ts.length}
              <!-- A long morning folds to its first slot and its last three. -->
              {@const more = r.k === 'earlier' && r.ts.length > 5 ? r.ts.length - 4 : 0}
              <span class="sched-row" class:next={r.k === 'next'}>
                <span class="sched-k">{r.k}</span>
                <span class="sched-t"
                  >{#if more}<span>{r.ts[0].at}</span><span class="sched-gap"
                      ><span aria-hidden="true">…</span><span class="vh">and {more} more, then</span></span
                    >{#each r.ts.slice(-3) as t (t.at)}<span>{t.at}</span>{/each}{:else}{#each r.ts as t (t.at)}<span
                        >{t.at}</span
                      >{/each}{/if}</span
                >
              </span>
            {/if}
          {/each}
        </span>
      {:else if visual.kind === 'ship'}
        <span class="fn-vis" aria-hidden="true">
          <svg class="strip" viewBox="0 0 1000 60" preserveAspectRatio="none" focusable="false">
            <path d={spikeTrace(visual.days.map((d) => d.count))} />
          </svg>
          <span class="cap ends"><span>{visual.days.length ? dayName(visual.days[0].date) : ''}</span><span>today</span></span>
        </span>
      {:else if visual.kind === 'releases'}
        {@const peak = Math.max(1, ...visual.months.flatMap((m) => m.days.map((d) => d ?? 0)))}
        <span class="vh">Releases a month: {calendarSummary(visual.months)}.</span>
        <span class="fn-vis cal" aria-hidden="true">
          {#each visual.months as m (m.key)}
            <span class="cal-row">
              <span class="cal-m">{m.label}</span>
              <span class="cal-days"
                >{#each m.days as d, i (i)}<span
                    class="cal-d"
                    class:off={d == null}
                    class:z={d === 0}
                    style:--a={d ? (0.25 + 0.75 * Math.sqrt(d / peak)).toFixed(2) : null}
                  ></span>{/each}</span
              >
              <span class="cal-t">{m.total}</span>
            </span>
          {/each}
        </span>
      {/if}
    </span>
  </span>
</span>

<style>
  .fn {
    --tone: var(--accent-on-dark);
    display: block;
    margin: 0.3em 0 0.5em;
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    font-weight: 400;
    font-style: normal;
    line-height: 1.5;
    letter-spacing: 0;
    white-space: normal;
    color: var(--on-ink-80);
  }
  /* Closed: out of the layout, the accessibility tree and the tab order. A
     class, not the hidden attribute, so print can still open every note. */
  .fn:not(.open) {
    display: none;
  }
  .fn[data-tone='ink'] {
    --tone: var(--accent-ink-on-dark);
  }
  /* Capped so an open note never shoves the page far: the tallest, on a
     phone, still fits; anything longer scrolls inside rather than out. */
  .fn-card {
    display: block;
    max-height: 17rem;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 10px 0 8px 18px;
    border-left: 2px solid var(--tone);
    animation: fn-in var(--t-slow, 360ms) var(--ease-out, ease-out) both;
  }
  @keyframes fn-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
  .fn-head,
  .fn-link,
  .cap,
  .hours,
  .now,
  .pending,
  .sched-k,
  .cal-m,
  .cal-t {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .fn-head {
    display: block;
    margin-bottom: 6px;
    color: var(--tone);
  }
  .fn-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
    gap: 6px 32px;
    align-items: start;
  }
  .fn-copy,
  .fn-text,
  .fn-vis {
    display: block;
  }
  .fn-link {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    color: var(--bg);
    text-decoration: none;
  }
  .fn-link:hover {
    color: var(--tone);
  }
  .fn-link:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: 2px;
  }
  .fn-vis {
    padding-top: 4px;
  }
  .vh {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }

  /* Hairline charts in the box traces.ts draws them in. */
  svg {
    display: block;
    width: 100%;
    overflow: visible;
  }
  path {
    fill: none;
    vector-effect: non-scaling-stroke;
  }
  .strip {
    height: 46px;
  }
  .strip path {
    stroke: var(--tone);
    stroke-width: 1.25;
    stroke-linejoin: round;
  }
  .cap {
    display: flex;
    margin-top: 6px;
    color: var(--on-ink-55);
  }
  .cap.ends {
    justify-content: space-between;
  }

  /* The ruler of the day: midnight to midnight, bars so far, the rest hatched. */
  .ruler {
    position: relative;
    display: block;
    height: 52px;
  }
  .ruler svg {
    height: 100%;
  }
  .bars {
    stroke: var(--tone);
    stroke-width: 3;
  }
  .ticks {
    stroke: var(--on-ink-45);
    stroke-width: 1;
  }
  .pending {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 7px;
    display: flex;
    align-items: center;
    padding-left: 10px;
    background: repeating-linear-gradient(-45deg, var(--on-ink-12) 0 1px, transparent 1px 6px);
    color: var(--on-ink-55);
    white-space: nowrap;
    overflow: hidden;
  }
  .now {
    position: absolute;
    top: -4px;
    transform: translateX(-50%) translateY(-100%);
    color: var(--bg);
    white-space: nowrap;
  }
  .now::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 100%;
    width: 1px;
    height: 52px;
    background: var(--on-ink-55);
  }
  .hours {
    position: relative;
    display: block;
    height: 18px;
    margin-top: 4px;
    color: var(--on-ink-55);
  }
  .hours span {
    position: absolute;
    transform: translateX(-50%);
  }
  .hours span:first-child {
    transform: none;
  }
  .hours span:last-child {
    transform: translateX(-100%);
  }

  /* Today's thinks, set as a timetable. */
  .sched {
    display: grid;
    gap: 4px;
  }
  .sched-row {
    display: grid;
    grid-template-columns: 7.5em minmax(0, 1fr);
    align-items: baseline;
  }
  .sched-k {
    color: var(--on-ink-55);
  }
  .sched-t {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-variant-numeric: tabular-nums;
    color: var(--on-ink-55);
    line-height: 1.7;
  }
  .sched-t {
    display: flex;
    flex-wrap: wrap;
    gap: 0 1.1ch;
  }
  .sched-t span {
    white-space: nowrap;
  }
  .sched-row:last-child .sched-t {
    color: var(--on-ink-80);
  }
  .sched-row.next .sched-k,
  .sched-row.next .sched-t {
    color: var(--tone);
    font-weight: 500;
  }
  /* Switched off: struck through, not faded, so the times stay readable. */
  .sched.off .sched-t span {
    text-decoration: line-through;
    text-decoration-color: var(--on-ink-45);
  }
  .sched.off .sched-row.next .sched-t,
  .sched.off .sched-row:last-child .sched-t {
    color: var(--on-ink-55);
  }
  .sched-gap {
    color: var(--on-ink-55);
  }

  /* Every release day since the first, a month to a row. */
  .cal {
    display: grid;
    gap: 3px;
  }
  .cal-row {
    display: grid;
    grid-template-columns: 3.2em minmax(0, 277px) 3.5em;
    align-items: center;
    justify-content: start;
    gap: 10px;
    line-height: 1;
  }
  .cal-m,
  .cal-t {
    color: var(--on-ink-55);
  }
  .cal-t {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  /* Fluid: 31 slots share whatever width the column has, up to 7px a day. */
  .cal-days {
    display: grid;
    grid-template-columns: repeat(31, minmax(0, 1fr));
    gap: 2px;
  }
  .cal-d {
    aspect-ratio: 1;
    background: rgba(127, 184, 192, var(--a, 0));
  }
  .cal-d.z {
    background: var(--on-ink-08);
  }
  .cal-d.off {
    background: none;
  }

  /* The hatch is lettered only when the words fit inside it (see fit()):
     otherwise the caption under the ruler says it. */
  .steps {
    container: ruler / inline-size;
  }
  .pend-in {
    display: none;
  }
  @container ruler (min-width: 270px) {
    .fit-a .pend-in {
      display: inline;
    }
    .fit-a .pend-out {
      display: none;
    }
  }
  @container ruler (min-width: 445px) {
    .fit-b .pend-in {
      display: inline;
    }
    .fit-b .pend-out {
      display: none;
    }
  }
  @container ruler (min-width: 705px) {
    .fit-c .pend-in {
      display: inline;
    }
    .fit-c .pend-out {
      display: none;
    }
  }
  @media (max-width: 760px) {
    .fn-card {
      max-height: min(26rem, 70vh);
    }
    .fn-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .fn-card {
      padding-left: 14px;
    }
    .fn-vis {
      order: -1;
      padding: 2px 0 4px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .fn-card {
      animation: none;
    }
  }
  @media print {
    .fn,
    .fn:not(.open) {
      display: block;
      color: #1a1008;
      break-inside: avoid;
    }
    .fn-card {
      max-height: none;
      overflow: visible;
      animation: none;
      border-left-color: currentColor;
    }
    .fn-head,
    .fn-link,
    .cap,
    .hours,
    .now,
    .pending,
    .sched-k,
    .sched-t,
    .cal-m,
    .cal-t {
      color: #1a1008;
    }
    .sched-row .sched-t,
    .sched-row.next .sched-k,
    .sched-row.next .sched-t,
    .sched-row:last-child .sched-t,
    .sched.off .sched-row .sched-t,
    .sched.off .sched-row.next .sched-t,
    .sched.off .sched-row:last-child .sched-t,
    .sched-gap {
      color: #1a1008;
    }
    .now::after {
      background: #1a1008;
    }
    .pending {
      background: repeating-linear-gradient(-45deg, rgba(26, 16, 8, 0.3) 0 1px, transparent 1px 6px);
    }
    .strip path,
    .bars,
    .ticks {
      stroke: #1a1008;
    }
    .cal-d {
      background: rgba(26, 16, 8, var(--a, 0));
    }
  }
</style>
