<svelte:options css="injected" />

<script lang="ts">
  // The Daydream page: the week's questions tallied in gates of five under a
  // double underline, the share of my verdicts that said "useful" ringed (and
  // a word on to the builder's page, where the ideas that shipped are), then
  // four small readings (hours on a shaded clock, look-ups, claims scribbled
  // out, areas of life ticked off), twelve weeks of verdicts in pencil, and
  // the rules it keeps: its day on a twenty-four hour face, waking hours
  // hatched and a dot for every chance to think, with the rules written on
  // the lines beside it. The live "next think" stays on the cover; here it is
  // one pencilled line by the face.
  import type { CapabilityFacts } from '$lib/landing/capabilities';
  import type { LandingVitals } from '$lib/landing/live-vitals.svelte';
  import type { DaydreamShowcase } from '$lib/landing/showcase';
  import { daydreamReading } from '$lib/landing/notes';
  import { readDaydream, countWord, londonHour } from '$lib/landing/sentence';
  import { inkLine, inkRing, rng } from '$lib/landing/notes-ink';
  import {
    PAGES,
    TALLY_PITCH,
    TALLY_W,
    areaBoxes,
    clockFace,
    dayFace,
    dayFaceSentence,
    fig,
    percent,
    plural,
    ruleLines,
    scribbles,
    shippedAside,
    shortDay,
    tallyRows,
    thinkingShare,
    trendWords,
    verdictCols,
    verdictSentence,
    type FairRow,
  } from '$lib/landing/showcase-notes';
  import { scenery } from '$lib/landing/ramblers/scenery';
  import SnPage from './SnPage.svelte';
  import SnFigure from './SnFigure.svelte';
  import SnNum from './SnNum.svelte';
  import { reveal } from './reveal';
  import { snap } from './snap';

  let {
    d,
    v,
    now,
    facts,
    fair,
  }: { d: DaydreamShowcase; v: LandingVitals | null; now: number; facts: CapabilityFacts; fair: FairRow[] } = $props();

  let week = $derived(d.week);
  let impact = $derived(d.impact);
  let tally = $derived(tallyRows(week?.questions ?? null));
  let tallyH = $derived(Math.max(1, tally.rows.length) * TALLY_PITCH);

  let hit = $derived(percent(impact?.hitRate));
  let trend = $derived(trendWords(impact?.hitRate ?? null, impact?.previousHitRate ?? null));
  let shipped = $derived(shippedAside(impact?.shipped));

  let reading = $derived(daydreamReading(readDaydream(v, facts.daydream, now), facts.daydream));
  let face = $derived(dayFace(d.rules, londonHour(now)));

  let share = $derived(thinkingShare(week?.hours, d.rules.activeHours));
  let clock = $derived(clockFace(share));
  let marks = $derived(scribbles(week?.struckOut ?? null));
  let boxes = $derived(areaBoxes(week ? week.areasCovered : null, d.rules.areas));

  const CW = 480;
  const CH = 132;
  let cols = $derived(verdictCols(impact?.weeks ?? [], CW, CH));
  let first = $derived(impact?.weeks[0]?.start ?? null);
  let last = $derived(impact?.weeks[impact.weeks.length - 1]?.start ?? null);

  // The magnifying glass beside the look-ups: a ring and its handle.
  const LENS = `${inkRing(rng(301), 22, 22, 14, 14, 1.1, 0.04)} ${inkLine(rng(302), 32, 32, 46, 46, 0.4, 0.02)} ${inkLine(rng(303), 34, 31, 47, 44, 0.4, 0.02)}`;
  const BASE = inkLine(rng(307), 0, CH, CW, CH, 0.4, 0.002);
</script>

<SnPage id="dd" page={PAGES.daydream} spot="think" {fair}>
  <div class="dd">
    <!-- The headline: this week's questions, tallied. -->
    <div class="dd-hl" use:scenery use:snap>
      <SnFigure f={fig(week?.questions)} unit={plural(week?.questions ?? null, 'question it asked itself this week', 'questions it asked itself this week')} seed={3} />
      {#if tally.rows.length}
        <div class="dd-tally" use:reveal>
          <svg viewBox="-2 -2 {TALLY_W + 4} {tallyH}" preserveAspectRatio="none" style:height="{tally.rows.length * 64}px" aria-hidden="true" focusable="false">
            {#each tally.rows as row, i (i)}<g transform="translate(0,{row.y})"><path d={row.d} style:--i={i} /></g>{/each}
          </svg>
          {#if tally.more}<span class="dd-more">+{tally.more.toLocaleString('en-GB')}</span>{/if}
        </div>
        <p class="sn-a">a stroke a question, a gate for every five. Nobody else was asking.</p>
      {:else if week}
        <p class="sn-a">none this week. even daydreamers take a week off.</p>
      {/if}
    </div>

    <!-- The verdicts: what share of its notes I marked useful. -->
    <div class="dd-hit" use:scenery use:snap>
      <p class="sn-l">My verdicts</p>
      <SnFigure f={fig(hit, 0, 'nothing rated yet')} unit="useful" mark="ring" tone="ink" suffix="%" size="lg" seed={9} />
      {#if impact}
        <p class="sn-a">
          of {impact.rated.toLocaleString('en-GB')} rated in the last {countWord(d.rules.windowDays)} days{#if trend}, <span class="dd-trend" data-dir={trend.dir}><span aria-hidden="true">{trend.dir === 'up' ? '↗' : trend.dir === 'down' ? '↘' : '→'}</span> {trend.words}</span>{/if}.
        </p>
        {#if shipped}<p class="sn-a dd-ship"><span class="dd-down" aria-hidden="true">↓</span>{shipped}</p>{/if}
      {:else}
        <p class="sn-a">the ratings aren’t answering just now.</p>
      {/if}
    </div>

    <!-- Four small readings in a row: the floor runs along their tops. -->
    <div class="dd-four" use:scenery>
      <div class="dd-small" use:snap>
        <svg class="dd-clock" viewBox="0 0 80 80" aria-hidden="true" focusable="false">
          <defs>
            <pattern id="sn-clock-hatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">
              <path d="M0,0 L0,3" />
            </pattern>
          </defs>
          {#if clock.wedge}<path class="wedge" d={clock.wedge} />{/if}
          <path class="rim" d={clock.rim} />
          <path class="face" d={clock.face} />
          <path class="ticks" d={clock.ticks} />
        </svg>
        <p class="sn-f"><SnNum f={fig(week?.hours, 1)} /> <span class="sn-u">{plural(week?.hours ?? null, 'hour thinking', 'hours thinking')}</span></p>
        <p class="sn-a">shaded, its share of the waking week.</p>
      </div>

      <div class="dd-small" use:snap>
        <svg class="dd-lens" viewBox="0 0 52 52" aria-hidden="true" focusable="false"><path d={LENS} /></svg>
        <p class="sn-f"><SnNum f={fig(week?.lookups)} /> <span class="sn-u">{plural(week?.lookups ?? null, 'look-up made', 'look-ups made')}</span></p>
        <p class="sn-a">across every think this week.</p>
      </div>

      <div class="dd-small" use:snap>
        {#if marks.lines.length}
          <svg class="dd-scrib" viewBox="0 0 176 {marks.lines.length * 18 + 4}" aria-hidden="true" focusable="false" use:reveal>
            {#each marks.lines as l, i (i)}<path class="line" d={l} /><path class="strike" d={marks.strikes[i]} pathLength="1" style:--i={i} />{/each}
          </svg>
        {:else}
          <span class="dd-blank" aria-hidden="true"></span>
        {/if}
        <p class="sn-f">
          {#if week}<span class="dd-x" aria-hidden="true">×</span>{/if}<SnNum f={fig(week?.struckOut)} />
          <span class="sn-u">{plural(week?.struckOut ?? null, 'claim struck out', 'claims struck out')}</span>
        </p>
        <p class="sn-a">by its own auditor, for want of a source.</p>
      </div>

      <div class="dd-small" use:snap>
        <svg class="dd-boxes" viewBox="0 0 {Math.max(1, boxes.length) * 26} 30" aria-hidden="true" focusable="false" use:reveal>
          {#each boxes as b, i (i)}<path class="box" d={b.box} />{#if b.tick}<path class="tick" d={b.tick} pathLength="1" style:--i={i} />{/if}{/each}
        </svg>
        <p class="sn-f">
          {#if week}<span class="sn-n">{week.areasCovered.toLocaleString('en-GB')}</span> <span class="sn-of">of {d.rules.areas.toLocaleString('en-GB')}</span>{:else}<SnNum f={fig(null)} />{/if}
          <span class="sn-u">areas of my life</span>
        </p>
        <p class="sn-a">each looked at least once this week.</p>
      </div>
    </div>

    <!-- Twelve weeks of verdicts, in pencil. -->
    <figure class="dd-weeks" use:scenery use:snap>
      <p class="sn-l">Twelve weeks of verdicts</p>
      {#if cols.length}
        <svg viewBox="-4 -4 {CW + 8} {CH + 8}" preserveAspectRatio="none" aria-hidden="true" focusable="false" use:reveal>
          <defs>
            <pattern id="sn-useful" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <path d="M0,0 L0,4" />
            </pattern>
          </defs>
          {#each cols as c, i (c.start)}
            <g style:--i={i}>
              {#if c.useful}<path class="w-u" d={c.useful.fill} /><path class="v-u" d={c.useful.d} />{/if}
              {#if c.notUseful}<path class="w-n" d={c.notUseful.fill} /><path class="v-n" d={c.notUseful.d} />{/if}
              {#if c.undecided}<path class="v-d" d={c.undecided.d} />{/if}
            </g>
          {/each}
          <path class="v-base" d={BASE} />
        </svg>
        <div class="dd-axis" aria-hidden="true"><span>{first ? shortDay(first) : ''}</span><span>{last ? `week of ${shortDay(last)}` : ''}</span></div>
        <ul class="dd-key" aria-hidden="true">
          <li><i class="k-u"></i>useful</li>
          <li><i class="k-n"></i>not useful</li>
          <li><i class="k-d"></i>waiting on me</li>
        </ul>
        <figcaption class="sn-cap">{verdictSentence(impact?.weeks ?? [])}</figcaption>
      {:else}
        <p class="sn-a">no verdicts to draw just now.</p>
      {/if}
    </figure>

    <!-- Its day on a twenty-four hour face, and the rules written on the lines. -->
    <div class="dd-rules" use:scenery use:snap>
      <p class="sn-l">The rules it keeps</p>
      <div class="dd-day">
        <svg class="dd-face" viewBox="0 0 80 80" aria-hidden="true" focusable="false">
          <defs>
            <pattern id="sn-day-hatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(40)">
              <path d="M0,0 L0,3" />
            </pattern>
          </defs>
          {#if face.wedge}<path class="wedge" d={face.wedge} />{/if}
          <path class="rim" d={face.rim} />
          <path class="ticks" d={face.ticks} />
          {#each face.slots as [x, y], i (i)}<circle class="slot" cx={x} cy={y} r="1.5" />{/each}
          {#if face.hand}<path class="hand" d={face.hand} /><circle class="pin" cx="40" cy="40" r="1.8" />{/if}
        </svg>
        <p class="vh">{dayFaceSentence(d.rules)}</p>
        <p class="sn-a dd-now">{reading.lead} <span class="dd-val">{reading.value}</span>.</p>
      </div>
      <ol>
        {#each ruleLines(d.rules) as line (line)}<li>{line}</li>{/each}
      </ol>
    </div>
  </div>
</SnPage>

<style>
  /* Every gap, line and drawing here is a whole number of the page's 32px rules. */
  .dd {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    grid-template-areas:
      'hl hl hl hl hl hl hl hit hit hit hit hit'
      'fr fr fr fr fr fr fr fr fr fr fr fr'
      'wk wk wk wk wk wk wk ru ru ru ru ru';
    column-gap: clamp(24px, 3vw, 48px);
    row-gap: 64px;
    align-items: start;
    margin-top: 64px;
  }
  .dd-hl {
    grid-area: hl;
  }
  .dd-hit {
    grid-area: hit;
  }
  .dd-four {
    grid-area: fr;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    column-gap: clamp(24px, 3vw, 48px);
    row-gap: 32px;
    align-items: start;
  }
  .dd-weeks {
    grid-area: wk;
    margin: 0;
  }
  .dd-rules {
    grid-area: ru;
  }

  /* The tallies: a row of ten gates per fifty questions, two rules a row, inked in row by row. */
  .dd-tally {
    position: relative;
    width: min(100%, 308px);
    margin-top: 32px;
  }
  .dd-tally svg {
    display: block;
    width: 100%;
    overflow: visible;
  }
  .dd-tally path {
    fill: none;
    stroke: var(--text-primary);
    stroke-width: 1.6;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }
  .dd-more {
    position: absolute;
    right: -4px;
    bottom: 8px;
    transform: translateX(100%);
    padding-left: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--accent-hover);
  }
  .dd-hl .sn-a {
    max-width: 34ch;
  }
  .dd-tally:global([data-armed]) path {
    opacity: 0;
    transform: translateY(4px);
  }
  .dd-tally:global([data-seen]) path {
    opacity: 1;
    transform: none;
    transition:
      opacity 260ms ease-out calc(var(--i) * 140ms),
      transform 260ms ease-out calc(var(--i) * 140ms);
  }

  .dd-trend {
    white-space: nowrap;
  }
  .dd-trend[data-dir='up'] {
    color: var(--accent-ink);
  }
  .dd-ship {
    color: var(--accent-hover);
  }
  .dd-down {
    margin-right: 0.35em;
    font-style: normal;
  }

  /* The small drawings, each two rules tall above its figure. */
  .dd-small svg,
  .dd-blank {
    display: block;
    height: 56px;
    width: auto;
    max-width: 100%;
    margin-bottom: 8px;
    overflow: visible;
  }
  .dd-small path {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .dd-clock .rim {
    stroke: var(--text-primary);
    stroke-width: 1.7;
  }
  .dd-clock .face {
    stroke: var(--text-ghost);
    stroke-width: 1;
  }
  .dd-clock .ticks {
    stroke: var(--text-primary);
    stroke-width: 1.3;
  }
  .dd-clock pattern path {
    stroke: var(--accent);
    stroke-width: 1.1;
  }
  .dd-clock .wedge {
    fill: url(#sn-clock-hatch);
    stroke: var(--accent);
    stroke-width: 1.2;
  }
  .dd-lens path {
    stroke: var(--accent-ink);
    stroke-width: 2;
  }
  .dd-scrib .line {
    stroke: rgba(26, 16, 8, 0.55);
    stroke-width: 1.3;
  }
  .dd-scrib .strike {
    stroke: var(--accent);
    stroke-width: 2;
    stroke-dasharray: 1 1.05;
  }
  .dd-x {
    top: -4px;
    margin-right: -6px;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(28px, 2.4vw, 34px);
    line-height: 32px;
    color: var(--accent-hover);
  }
  .dd-boxes .box {
    stroke: var(--text-primary);
    stroke-width: 1.3;
  }
  .dd-boxes .tick {
    stroke: var(--accent-ink);
    stroke-width: 2.4;
    stroke-dasharray: 1 1.05;
  }
  .dd-scrib:global([data-armed]) .strike,
  .dd-boxes:global([data-armed]) .tick {
    stroke-dashoffset: 1.03;
  }
  .dd-scrib:global([data-seen]) .strike,
  .dd-boxes:global([data-seen]) .tick {
    stroke-dashoffset: 0;
    transition: stroke-dashoffset 420ms ease-out calc(200ms + var(--i) * 160ms);
  }
  .sn-of {
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 20px;
    line-height: 32px;
    color: var(--text-secondary);
  }

  /* The verdicts in pencil: useful hatched in orange, not useful in ink, undecided dotted. */
  .dd-weeks svg {
    display: block;
    width: 100%;
    height: 160px;
    overflow: visible;
  }
  .dd-weeks path {
    fill: none;
    stroke-linejoin: round;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }
  .dd-weeks pattern path {
    stroke: var(--accent);
    stroke-width: 1.2;
  }
  .dd-weeks .w-u {
    fill: url(#sn-useful);
  }
  .dd-weeks .w-n {
    fill: rgba(26, 16, 8, 0.06);
  }
  .v-u {
    stroke: var(--accent);
    stroke-width: 1.4;
  }
  .v-n {
    stroke: var(--text-primary);
    stroke-width: 1.4;
  }
  .v-d {
    stroke: rgba(26, 16, 8, 0.58);
    stroke-width: 1.3;
    stroke-dasharray: 2 3;
  }
  .v-base {
    stroke: var(--text-primary);
    stroke-width: 1.2;
  }
  .dd-weeks svg:global([data-armed]) > g {
    opacity: 0;
    transform: translateY(6px);
  }
  .dd-weeks svg:global([data-seen]) > g {
    opacity: 1;
    transform: none;
    transition:
      opacity 300ms ease-out calc(var(--i) * 60ms),
      transform 300ms ease-out calc(var(--i) * 60ms);
  }
  .dd-axis {
    display: flex;
    justify-content: space-between;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 32px;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .dd-key {
    display: flex;
    flex-wrap: wrap;
    column-gap: 20px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 32px;
    letter-spacing: 0.06em;
    color: var(--text-secondary);
  }
  .dd-key li {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .dd-key i {
    display: inline-block;
    width: 14px;
    height: 14px;
    box-sizing: border-box;
  }
  .k-u {
    border: 1.5px solid var(--accent);
    background: repeating-linear-gradient(-45deg, var(--accent) 0 1.2px, transparent 1.2px 4px);
  }
  .k-n {
    border: 1.5px solid var(--text-primary);
  }
  .k-d {
    border: 1.5px dashed rgba(26, 16, 8, 0.58);
  }

  /* Its day on one face, hatched for its waking hours, a dot for each chance to think. */
  .dd-day {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr);
    column-gap: 20px;
    align-items: start;
    height: 96px;
  }
  .dd-now {
    margin-top: 32px;
  }
  .dd-face {
    display: block;
    width: 96px;
    height: 96px;
    overflow: visible;
  }
  .dd-face path {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .dd-face .rim {
    stroke: var(--accent-ink);
    stroke-width: 1.6;
  }
  .dd-face .ticks {
    stroke: var(--accent-ink);
    stroke-width: 1;
  }
  .dd-face pattern path {
    stroke: var(--accent-ink);
    stroke-width: 0.9;
    opacity: 0.75;
  }
  .dd-face .wedge {
    fill: url(#sn-day-hatch);
  }
  .dd-face .slot {
    fill: var(--accent);
  }
  .dd-face .hand {
    stroke: var(--text-primary);
    stroke-width: 1.8;
  }
  .dd-face .pin {
    fill: var(--text-primary);
  }
  .dd-val {
    font-style: normal;
    font-family: var(--font-display);
    font-weight: 800;
    letter-spacing: -0.02em;
    color: var(--accent-ink);
  }

  /* The rules, written on the page's own lines, numbered in the margin's orange. */
  .dd-rules ol {
    margin: 0;
    padding: 0;
    list-style: none;
    counter-reset: rule;
  }
  .dd-rules li {
    position: relative;
    padding-left: 36px;
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 18px;
    line-height: 32px;
    color: var(--text-primary);
    counter-increment: rule;
  }
  .dd-rules li::before {
    content: counter(rule, lower-roman) '.';
    position: absolute;
    left: 0;
    top: 0;
    font-family: var(--font-mono);
    font-style: normal;
    font-size: var(--fs-label-xs);
    color: var(--accent-hover);
  }

  @media (max-width: 1100px) {
    .dd {
      grid-template-areas:
        'hl hl hl hl hl hl hl hit hit hit hit hit'
        'fr fr fr fr fr fr fr fr fr fr fr fr'
        'wk wk wk wk wk wk wk wk wk wk wk wk'
        'ru ru ru ru ru ru ru ru ru ru ru ru';
    }
    .dd-four {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 760px) {
    .dd {
      grid-template-areas: 'hl' 'hit' 'fr' 'wk' 'ru';
      grid-template-columns: minmax(0, 1fr);
      margin-top: 64px;
    }
    .dd-four {
      column-gap: 20px;
    }
    .dd-weeks svg {
      height: 128px;
    }
    .dd-rules li {
      font-size: 17px;
    }
  }
</style>
