<svelte:options css="injected" />

<script lang="ts">
  // The health page: steps since January under a double underline that draws
  // itself as the figure counts, a hand-drawn odometer for the kilometres,
  // the heartbeat inked small (only when the watch has just said), a doodled
  // moon for the week's sleep, thirty days of steps as wobbly ink bars on a
  // graph-paper inset (best day ringed and its figure written beside it, ten
  // thousand dashed), recovery as piles of coloured-pencil dots by band, and
  // today hour by hour in pencil.
  //
  // Totals and bands only. A stale pulse is not mentioned at all, and nothing
  // here says when anything last synced.
  import type { HealthShowcase } from '$lib/landing/showcase';
  import type { Pulse } from '$lib/landing/sentence';
  import type { StepsToday } from '$lib/landing/steps';
  import { inkHeart } from '$lib/landing/notes-ink';
  import { scenery } from '$lib/landing/ramblers/scenery';
  import {
    PAGES,
    dotRing,
    fig,
    HOUR_TICKS,
    hourMarks,
    hourly,
    hourlySentence,
    moon,
    nowBinAt,
    odometer,
    recoveryPiles,
    recoverySentence,
    recoveryWords,
    shortDay,
    sleepWords,
    stepChart,
    stepsSentence,
    plural,
    type FairRow,
  } from '$lib/landing/showcase-notes';
  import { formatFigure } from '$lib/landing/showcase-motion';
  import SnPage from './SnPage.svelte';
  import SnFigure from './SnFigure.svelte';
  import SnNum from './SnNum.svelte';
  import { reveal } from './reveal';
  import { snap } from './snap';

  let { h, pulse, steps, now, fair }: { h: HealthShowcase; pulse: Pulse; steps: StepsToday | null; now: number; fair: FairRow[] } = $props();

  let bpm = $derived(pulse.state === 'fresh' ? pulse.bpm : null);
  let heart = $derived(bpm != null ? inkHeart(bpm, 168, 44, 13) : null);
  let beat = $derived(bpm != null ? 60 / Math.min(200, Math.max(30, bpm)) : 1);
  // The nib crosses the line once and settles: never more than five seconds of motion.
  let sweeps = $derived(heart ? Math.max(1, Math.floor(4.8 / (heart.beats * beat))) : 1);

  let odo = $derived(odometer(h.kmYear));

  const GW = 600;
  const GH = 190;
  const VX = -6;
  const VY = -22;
  const VW = GW + 12;
  const VH = GH + 26;
  let chart = $derived(stepChart(h.steps30, GW, GH));

  const HW = 480;
  const HH = 60;
  // Without the phone's bins, "now" still comes from the clock: the hours gone stay bare, only those to come are hatched.
  let nowBin = $derived(steps?.nowBin ?? nowBinAt(now));
  let hours = $derived(hourly(steps && steps.total != null ? steps.bins : null, nowBin));
  let marks = $derived(hourMarks(hours, HW, HH, nowBin));

  let rec = $derived(recoveryPiles(h.recovery30));
  const MOON = moon();
  let sleep = $derived(sleepWords(h.bands.sleep));
  let ready = $derived(recoveryWords(h.bands.recovery));
  const PILE_WORDS = { high: 'good', mid: 'middling', low: 'low' } as const;
</script>

<SnPage id="hl" page={PAGES.health} {fair}>
  <div class="he">
    <!-- The headline, and the rambler's seat for checking his pulse. -->
    <div class="he-hl" use:scenery={{ spot: 'gym', at: 0.3 }} use:snap>
      <SnFigure f={fig(h.stepsYear)} unit={plural(h.stepsYear, 'step this year', 'steps this year')} seed={21} />
      <p class="sn-a he-hl-a">since January, every one counted by the phone in my pocket.</p>

      <div class="he-odo">
        {#if odo}
          <span class="he-wheels" aria-hidden="true" use:reveal>
            {#each odo.whole as n, i (i)}{#if n === ','}<span class="he-sep">,</span>{:else}<span class="he-w" style:--i={i}><span>{n}</span></span>{/if}{/each}<span class="he-pt">.</span><span class="he-w he-tenth" style:--i={odo.whole.length}><span>{odo.tenth}</span></span>
          </span>
          <span class="vh">{formatFigure(h.kmYear ?? 0, 1)}</span>
        {:else}
          <SnNum f={fig(null)} />
        {/if}
        <span class="sn-u">km on foot this year</span>
      </div>
    </div>

    <div class="he-side" use:scenery>
      {#if heart && bpm != null}
        <!-- Only when the watch has just said. Otherwise nothing about the watch at all. -->
        <div class="he-pulse" style:--beat="{beat.toFixed(3)}s" style:--sweep="{(beat * heart.beats).toFixed(3)}s" style:--n={sweeps} use:reveal use:snap>
          <svg viewBox="0 0 168 44" aria-hidden="true" focusable="false">
            <path class="hb" d={heart.d} />
            <path class="nib" d={heart.d} pathLength="1" />
          </svg>
          <p class="sn-f"><span class="sn-n he-bpm">{formatFigure(bpm)}</span> <span class="sn-u">bpm, as my watch last read it</span></p>
        </div>
      {/if}

      <div class="he-sleep" use:snap>
        <svg class="he-moon" viewBox="0 0 80 64" aria-hidden="true" focusable="false"><path class="mb" d={MOON.body} /><path class="ms" d={MOON.stars} /></svg>
        <div>
          <p class="sn-f">
            <SnNum f={fig(h.sleepAvg7, 1)} />
            <span class="sn-u">hours a night</span>
          </p>
          <p class="sn-a">asleep, on average, over the last seven nights.</p>
          {#if sleep || ready}
            <ul class="he-bands">
              {#if sleep}<li><span class="sn-l">last night</span> <span class="he-band">{sleep}</span></li>{/if}
              {#if ready}<li><span class="sn-l">today’s recovery</span> <span class="he-band">{ready}</span></li>{/if}
            </ul>
          {/if}
        </div>
      </div>
    </div>

    <!-- Thirty days of steps on graph paper. -->
    <figure class="he-graph" use:scenery use:snap>
      <p class="sn-l">Steps a day, the last thirty days with readings</p>
      {#if chart}
        <div class="he-paper">
          <div class="he-plot">
            <svg viewBox="{VX} {VY} {VW} {VH}" preserveAspectRatio="none" aria-hidden="true" focusable="false" use:reveal>
              <path class="ten" d={chart.line} />
              {#each chart.bars as b, i (b.i)}{#if b.d}<g class="bar" class:best={b.best} style:--i={i}><path class="wash" d={b.fill} /><path d={b.d} /></g>{/if}{/each}
              {#if chart.ring}<path class="ring" d={chart.ring} pathLength="1" />{/if}
            </svg>
            {#if chart.bestAt}
              <span
                class="he-best"
                data-side={chart.bestAt.side}
                style:left="{((chart.bestAt.x - VX) / VW) * 100}%"
                style:top="{((chart.bestAt.y - VY) / VH) * 100}%"
                aria-hidden="true">{formatFigure(chart.bestAt.steps)}</span
              >
            {/if}
          </div>
        </div>
        <div class="he-axis" aria-hidden="true"><span>oldest</span><span>latest</span></div>
        <ul class="he-key" aria-hidden="true">
          <li><i class="k-ten"></i>ten thousand a day</li>
          <li><i class="k-best"></i>the best of them</li>
        </ul>
        <figcaption class="sn-cap">{stepsSentence(h.steps30)} The best of them is ringed.</figcaption>
      {:else}
        <p class="sn-a">no complete days to draw just now.</p>
      {/if}
    </figure>

    <!-- Thirty days of recovery as coloured-pencil dots, piled by band: shape as well as colour. -->
    <figure class="he-rec" use:scenery use:snap>
      <p class="sn-l">Recovery, the last thirty days</p>
      {#if rec}
        <div class="he-piles" style:max-width="{rec.w}px" use:snap>
          <svg viewBox="0 0 {rec.w} {rec.h}" aria-hidden="true" focusable="false" use:reveal>
            {#each rec.piles as p, g (g)}
              {#each p.dots as [cx, cy], i (i)}
                <g class="dot {p.band ?? 'none'}" style:--i={g * 6 + i}>
                  {#if p.band === 'high'}<circle {cx} {cy} r="8" /><path d={dotRing(g * 40 + i, cx, cy, 9)} />
                  {:else if p.band === 'mid'}<path class="half" d="M{cx - 8},{cy} A8,8 0 0 0 {cx + 8},{cy} Z" /><path d={dotRing(g * 40 + i, cx, cy, 9)} />
                  {:else if p.band === 'low'}<path d={dotRing(g * 40 + i, cx, cy, 8)} /><path d="M{cx - 4.5},{cy + 4.5} L{cx + 4.5},{cy - 4.5}" />
                  {:else}<circle class="nil" {cx} {cy} r="1.6" />{/if}
                </g>
              {/each}
            {/each}
          </svg>
          <div class="he-pile-n" aria-hidden="true">
            {#each rec.piles as p, g (g)}<span style:left="{(p.x / rec.w) * 100}%">{formatFigure(p.count)}</span>{/each}
          </div>
        </div>
        <ul class="he-key" aria-hidden="true">
          {#each rec.piles as p, g (g)}{#if p.band}<li><i class="k {p.band}"></i>{PILE_WORDS[p.band]}</li>{:else}<li><i class="k none"></i>no reading</li>{/if}{/each}
        </ul>
        <figcaption class="sn-cap">{recoverySentence(h.recovery30)}</figcaption>
      {:else}
        <p class="sn-a">no recovery readings to draw just now.</p>
      {/if}
    </figure>

    <!-- Today, hour by hour, in pencil; the hours to come are hatched. -->
    <figure class="he-today" use:scenery use:snap>
      <p class="sn-l">Today, hour by hour</p>
      <svg viewBox="0 -4 {HW} {HH + 4}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path class="hatch" d={marks.hatch} />
        <path class="pencil" d={marks.strokes} />
        <path class="floor" d="M0,{HH} L{HW},{HH}" />
      </svg>
      <div class="he-axis he-hours" aria-hidden="true">
        {#each HOUR_TICKS as hr (hr)}<span>{String(hr).padStart(2, '0')}</span>{/each}
      </div>
      <figcaption class="sn-cap">{hourlySentence(hours, steps?.total ?? null)}</figcaption>
    </figure>

    <!-- Two more figures from the year. -->
    <div class="he-year" use:scenery use:snap>
      <p class="sn-f">
        <SnNum f={fig(h.daysOver10k)} />
        <span class="sn-u">{plural(h.daysOver10k, 'day', 'days')} over ten thousand this year</span>
      </p>
      {#if h.bestDay}
        <p class="sn-f">
          <span class="sn-n">{formatFigure(h.bestDay.steps)}</span>
          <span class="sn-u">steps on my best day, {shortDay(h.bestDay.date)}</span>
        </p>
      {/if}
    </div>
  </div>
</SnPage>

<style>
  /* Every gap, line and drawing here is a whole number of the page's 32px rules. */
  .he {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    grid-template-areas:
      'hl hl hl hl hl hl hl sd sd sd sd sd'
      'gr gr gr gr gr gr gr gr rc rc rc rc'
      'td td td td td td td td yr yr yr yr';
    column-gap: clamp(24px, 3vw, 48px);
    row-gap: 64px;
    align-items: start;
    margin-top: 64px;
  }
  .he-hl {
    grid-area: hl;
  }
  .he-side {
    grid-area: sd;
    display: flex;
    flex-direction: column;
    gap: 32px;
  }
  .he-graph {
    grid-area: gr;
    margin: 0;
  }
  .he-rec {
    grid-area: rc;
    margin: 0;
  }
  .he-today {
    grid-area: td;
    margin: 0;
  }
  .he-year {
    grid-area: yr;
    display: flex;
    flex-direction: column;
    gap: 32px;
  }
  .he-hl-a {
    margin-top: 32px;
    max-width: 36ch;
  }

  /* The odometer: a wheel per digit with a fixed comma between the thousands,
     the tenth in orange, rolled in on first sight. Two rules tall. */
  .he-odo {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: 16px;
    min-height: 64px;
    margin-top: 32px;
  }
  .he-wheels {
    display: inline-flex;
    align-items: stretch;
    height: 48px;
    padding: 4px;
    box-sizing: border-box;
    border: 2px solid var(--text-primary);
    border-radius: 2px;
    background: var(--surface-card);
  }
  .he-w {
    display: inline-block;
    overflow: hidden;
    width: 1.05em;
    border-right: 1px solid var(--line-strong);
    font-family: var(--font-mono);
    font-weight: 500;
    font-size: 26px;
    line-height: 36px;
    text-align: center;
    color: var(--text-primary);
    background: linear-gradient(var(--line-hair), transparent 30%, transparent 70%, var(--line-hair));
  }
  .he-w > span {
    display: block;
  }
  .he-tenth {
    border-right: 0;
    border-left: 2px solid var(--text-primary);
    color: var(--surface-card);
    background: var(--accent-hover);
  }
  .he-sep,
  .he-pt {
    align-self: flex-end;
    padding: 0 2px;
    font-family: var(--font-mono);
    font-weight: 500;
    font-size: 26px;
    line-height: 30px;
    color: var(--text-primary);
  }
  .he-wheels:global([data-armed]) .he-w > span {
    transform: translateY(100%);
  }
  .he-wheels:global([data-seen]) .he-w > span {
    transform: none;
    transition: transform 520ms cubic-bezier(0.2, 0.8, 0.2, 1) calc(var(--i) * 90ms);
  }

  /* The heartbeat, inked small; the nib crosses it once a beat, a few times, then rests. */
  .he-pulse svg {
    display: block;
    width: 168px;
    max-width: 100%;
    height: 44px;
    overflow: visible;
    margin-bottom: 20px;
  }
  .he-pulse path {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .hb {
    stroke: var(--accent);
    stroke-width: 1.8;
  }
  .nib {
    stroke: var(--text-primary);
    stroke-width: 2.6;
    stroke-dasharray: 0.04 0.96;
    stroke-dashoffset: 0.04;
    opacity: 0;
  }
  .he-pulse:global([data-seen]) .nib {
    animation: he-nib var(--sweep) linear var(--n);
  }
  @keyframes he-nib {
    0% {
      stroke-dashoffset: 0.04;
      opacity: 1;
    }
    96% {
      opacity: 1;
    }
    100% {
      stroke-dashoffset: -0.96;
      opacity: 0;
    }
  }
  .he-bpm {
    color: var(--accent-hover);
  }

  .he-sleep {
    display: grid;
    grid-template-columns: 80px minmax(0, 1fr);
    column-gap: 18px;
    align-items: start;
  }
  .he-moon {
    width: 80px;
    height: 64px;
    overflow: visible;
  }
  .he-moon path {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .he-moon .mb {
    stroke: var(--accent-ink);
    stroke-width: 1.8;
    fill: rgba(14, 91, 102, 0.14);
  }
  .ms {
    stroke: var(--accent);
    stroke-width: 1.4;
  }
  .he-bands {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    column-gap: 16px;
    align-items: start;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .he-bands .sn-l {
    position: relative;
    top: 3px;
  }
  .he-bands li {
    display: contents;
  }
  .he-band {
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 17px;
    line-height: 32px;
    color: var(--text-primary);
  }

  /* Graph paper: a petrol grid on the page's own rule pitch, a darker line every five. */
  .he-paper {
    height: 224px;
    box-sizing: border-box;
    padding: 16px 14px;
    background-color: var(--surface-card);
    background-image:
      linear-gradient(rgba(14, 91, 102, 0.18) 1px, transparent 1px),
      linear-gradient(90deg, rgba(14, 91, 102, 0.18) 1px, transparent 1px),
      linear-gradient(rgba(14, 91, 102, 0.07) 1px, transparent 1px),
      linear-gradient(90deg, rgba(14, 91, 102, 0.07) 1px, transparent 1px);
    background-size:
      80px 80px,
      80px 80px,
      16px 16px,
      16px 16px;
    border: 1px solid rgba(14, 91, 102, 0.3);
  }
  .he-plot {
    position: relative;
    height: 100%;
  }
  .he-plot svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .he-plot path {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .bar path {
    stroke: var(--text-primary);
    stroke-width: 1.5;
  }
  .he-plot .bar .wash {
    stroke: none;
    fill: rgba(14, 91, 102, 0.12);
  }
  .he-plot .bar.best .wash {
    fill: rgba(196, 87, 10, 0.32);
  }
  .ten {
    stroke: var(--accent-ink);
    stroke-width: 1.4;
    stroke-dasharray: 6 5;
  }
  .ring {
    stroke: var(--accent);
    stroke-width: 2.2;
  }
  /* The best day's figure, written beside its ring in the orange pen. */
  .he-best {
    position: absolute;
    transform: translateY(-50%);
    padding: 0 4px;
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 16px;
    line-height: 1;
    white-space: nowrap;
    color: var(--accent-hover);
    background: var(--surface-card);
  }
  .he-best[data-side='left'] {
    transform: translate(-100%, -50%);
  }
  .k-ten {
    width: 22px !important;
    height: 0 !important;
    border-top: 1.5px dashed var(--accent-ink);
  }
  .k-best {
    width: 20px !important;
    height: 12px !important;
    border: 2px solid var(--accent);
    border-radius: 100px;
  }
  .he-plot svg:global([data-armed]) .bar {
    opacity: 0;
    transform: translateY(8px);
  }
  .he-plot svg:global([data-seen]) .bar {
    opacity: 1;
    transform: none;
    transition:
      opacity 260ms ease-out calc(var(--i) * 28ms),
      transform 260ms ease-out calc(var(--i) * 28ms);
  }
  .he-plot:has(svg:global([data-armed])) .ring,
  .he-plot:has(svg:global([data-armed])) .he-best {
    opacity: 0;
  }
  .he-plot:has(svg:global([data-seen])) .ring,
  .he-plot:has(svg:global([data-seen])) .he-best {
    opacity: 1;
    transition: opacity 400ms ease-out 900ms;
  }
  .he-axis {
    display: flex;
    justify-content: space-between;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 32px;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  /* Recovery dots, piled by band. Three pencils (olive, ochre, red) and three shapes. */
  .he-piles {
    position: relative;
  }
  .he-piles svg {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
  }
  .he-pile-n {
    position: relative;
    height: 32px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 32px;
    color: var(--text-secondary);
  }
  .he-pile-n span {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    font-variant-numeric: tabular-nums;
  }
  .dot path {
    fill: none;
    stroke-width: 1.5;
    stroke-linecap: round;
  }
  .dot.high {
    --c: var(--good);
  }
  .dot.mid {
    --c: #8c6a12;
  }
  .dot.low {
    --c: var(--status-fail, #b3261e);
  }
  .dot circle {
    fill: var(--c);
  }
  .dot path {
    stroke: var(--c);
  }
  .dot .half {
    fill: var(--c);
    stroke: none;
  }
  .dot .nil {
    fill: var(--text-ghost);
  }
  .he-piles svg:global([data-armed]) .dot {
    opacity: 0;
  }
  .he-piles svg:global([data-seen]) .dot {
    opacity: 1;
    transition: opacity 200ms ease-out calc(var(--i) * 24ms);
  }
  .he-key {
    display: flex;
    flex-wrap: wrap;
    column-gap: 18px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 32px;
    letter-spacing: 0.06em;
    color: var(--text-secondary);
  }
  .he-key li {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .he-key i {
    display: inline-block;
    box-sizing: border-box;
  }
  .k {
    display: inline-block;
    width: 14px;
    height: 14px;
    box-sizing: border-box;
    border-radius: 100px;
  }
  .k.high {
    background: var(--good);
  }
  .k.mid {
    border: 1.5px solid #8c6a12;
    background: linear-gradient(transparent 50%, #8c6a12 50%);
  }
  .k.low {
    border: 1.5px solid var(--status-fail, #b3261e);
    background: linear-gradient(-45deg, transparent 45%, var(--status-fail, #b3261e) 45% 58%, transparent 58%);
  }
  .k.none {
    width: 4px;
    height: 4px;
    background: var(--text-ghost);
  }

  .he-today svg {
    display: block;
    width: 100%;
    height: 64px;
    overflow: visible;
  }
  .he-today path {
    fill: none;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }
  .pencil {
    stroke: rgba(26, 16, 8, 0.62);
    stroke-width: 1;
  }
  .hatch {
    stroke: var(--text-ghost);
    stroke-width: 0.8;
    opacity: 0.6;
  }
  .floor {
    stroke: var(--text-primary);
    stroke-width: 1.2;
  }

  @media (max-width: 1100px) {
    .he {
      grid-template-areas:
        'hl hl hl hl hl hl hl hl hl hl hl hl'
        'sd sd sd sd sd sd sd sd sd sd sd sd'
        'gr gr gr gr gr gr gr gr gr gr gr gr'
        'rc rc rc rc rc rc yr yr yr yr yr yr'
        'td td td td td td td td td td td td';
    }
    .he-side {
      flex-direction: row;
      flex-wrap: wrap;
      gap: 32px 48px;
    }
  }
  @media (max-width: 760px) {
    .he {
      grid-template-areas: 'hl' 'sd' 'gr' 'rc' 'yr' 'td';
      grid-template-columns: minmax(0, 1fr);
    }
    .he-paper {
      height: 192px;
      padding: 12px 8px;
    }
    .he-bands {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
