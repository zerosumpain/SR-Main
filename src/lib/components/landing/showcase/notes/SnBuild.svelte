<svelte:options css="injected" />

<script lang="ts">
  // The builder's page: every release since the first deploy under a double
  // underline, today's deploys tallied beneath it, the builder's checklist
  // ticked down with the live bench at its foot, the lines it has written
  // circled smaller under the list, and the Daydream ideas that shipped on a
  // sticky note. With no release record at all the page says so once, under
  // one dash, and keeps only the checklist.
  import type { BuildShowcase } from '$lib/landing/showcase';
  import type { LandingVitals } from '$lib/landing/live-vitals.svelte';
  import { scenery } from '$lib/landing/ramblers/scenery';
  import { rng } from '$lib/landing/notes-ink';
  import { formatFigure } from '$lib/landing/showcase-motion';
  import { PAGES, checklist, deployTally, fig, inkBox, inkTick, perDayWords, plural, sinceLine, type FairRow } from '$lib/landing/showcase-notes';
  import SnPage from './SnPage.svelte';
  import SnFigure from './SnFigure.svelte';
  import SnNum from './SnNum.svelte';
  import { reveal } from './reveal';
  import { snap } from './snap';

  let { b, v, now, fair }: { b: BuildShowcase; v: LandingVitals | null; now: number; fair: FairRow[] } = $props();

  let none = $derived(b.releases == null && b.linesWritten == null && b.deploysToday == null);
  let since = $derived(sinceLine(b.firstDeploy, b.days, now));
  let tally = $derived(deployTally(b.deploysToday));
  let perDay = $derived(perDayWords(b.deploysPerDay));
  let list = $derived(checklist(v));
  const BOXES = Array.from({ length: 7 }, (_, i) => {
    const r = rng(331 + i);
    return { box: inkBox(r, 2, 2, 18, 18, 0.5), tick: inkTick(r, 3, 2, 17) };
  });
</script>

{#snippet sticky(n: number)}
  <!-- A sticky note, stuck on a little crooked: never a floor. -->
  <div class="bd-sticky">
    <span class="bd-sticky-n">{formatFigure(n)}</span>
    <span class="bd-sticky-t">{plural(n, 'idea that started as a daydream and shipped as code', 'ideas that started as daydreams and shipped as code')}</span>
  </div>
{/snippet}

<SnPage id="bd" page={PAGES.build} spot="desk" {fair}>
  <div class="bd">
    <div class="bd-l">
      <div class="bd-hl" use:scenery use:snap>
        <SnFigure f={fig(b.releases, 0, 'no count')} unit={plural(b.releases, 'release', 'releases')} seed={41} />
        {#if since}<p class="sn-a bd-since">{since}, each one written up from its own commits.</p>
        {:else if b.releases == null}<p class="sn-a bd-since">the release record isn’t answering just now.</p>{/if}
      </div>

      {#if b.linesWritten == null && b.fromDaydream != null && b.fromDaydream > 0}
        <div class="bd-lines" use:snap>{@render sticky(b.fromDaydream)}</div>
      {/if}

      {#if !none}
        <div class="bd-today" use:scenery use:snap>
          <p class="sn-f">
            <SnNum f={fig(b.deploysToday)} />
            <span class="sn-u">{plural(b.deploysToday, 'deploy today', 'deploys today')}</span>
          </p>
          {#if tally}
            <svg class="bd-tally" viewBox="-2 -2 124 26" aria-hidden="true" focusable="false"><path d={tally} /></svg>
          {:else if b.deploysToday === 0}
            <p class="sn-a">none yet. the day is young.</p>
          {/if}
          {#if perDay}<p class="sn-a">{perDay}.</p>{/if}
        </div>
      {/if}
    </div>

    <div class="bd-r">
      <div class="bd-check" use:scenery use:snap>
        <p class="sn-l">Every change, every time</p>
        <ol use:reveal>
          {#each list.steps as s, i (s)}
            <li style:--i={i}>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="bx" d={BOXES[i].box} /><path class="tk" d={BOXES[i].tick} pathLength="1" /></svg>
              <span>{s}</span>
            </li>
          {/each}
        </ol>
        {#if list.bench}
          <p class="bd-bench" class:live={list.bench.live}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="bx" d={BOXES[6].box} /></svg>
            <span>{list.bench.text}</span>
          </p>
        {/if}
      </div>

      {#if b.linesWritten != null}
        <div class="bd-lines" use:snap>
          <SnFigure f={fig(b.linesWritten)} unit="lines of code written" mark="ring" tone="accent" size="md" seed={47} />
          {#if b.fromDaydream != null && b.fromDaydream > 0}{@render sticky(b.fromDaydream)}{/if}
        </div>
      {/if}
    </div>
  </div>
</SnPage>

<style>
  .bd {
    display: grid;
    grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
    column-gap: clamp(24px, 3vw, 48px);
    align-items: start;
    margin-top: 64px;
  }
  .bd-l,
  .bd-r {
    display: flex;
    flex-direction: column;
    gap: 64px;
    min-width: 0;
  }
  .bd-since {
    margin-top: 32px;
    max-width: 34ch;
  }
  .bd-tally {
    display: block;
    width: 248px;
    max-width: 100%;
    height: 48px;
    margin: 8px 0;
    overflow: visible;
  }
  .bd-tally path {
    fill: none;
    stroke: var(--text-primary);
    stroke-width: 1.5;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }

  .bd-lines {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 32px clamp(24px, 3vw, 48px);
  }
  /* The sticky note: pale orange, a degree or two off. */
  .bd-sticky {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: min(100%, 220px);
    padding: 18px 18px 22px;
    box-sizing: border-box;
    background: linear-gradient(160deg, #f7d9b4, #f2c99a);
    color: var(--text-primary);
    transform: rotate(-2.2deg);
  }
  .bd-sticky-n {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 40px;
    line-height: 1;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
  }
  .bd-sticky-t {
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 17px;
    line-height: 1.3;
  }

  /* The checklist, ticked down the page's own lines. */
  .bd-check ol {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .bd-check li,
  .bd-bench {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr);
    column-gap: 12px;
    align-items: baseline;
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 17px;
    line-height: 32px;
    color: var(--text-primary);
  }
  .bd-check svg,
  .bd-bench svg {
    width: 22px;
    height: 22px;
    overflow: visible;
    transform: translateY(5px);
  }
  .bd-check path,
  .bd-bench path {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .bx {
    stroke: var(--text-primary);
    stroke-width: 1.3;
  }
  .tk {
    stroke: var(--accent);
    stroke-width: 2.4;
    stroke-dasharray: 1 1.05;
  }
  .bd-check ol:global([data-armed]) .tk {
    stroke-dashoffset: 1.03;
  }
  .bd-check ol:global([data-seen]) .tk {
    stroke-dashoffset: 0;
    transition: stroke-dashoffset 300ms ease-out calc(200ms + var(--i) * 200ms);
  }
  .bd-bench {
    margin: 0;
    font-family: var(--font-mono);
    font-style: normal;
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .bd-bench.live {
    color: var(--accent-hover);
  }
  .bd-bench.live .bx {
    stroke: var(--accent);
    stroke-dasharray: 3 3;
  }

  @media (max-width: 1100px) {
    .bd {
      grid-template-columns: minmax(0, 1fr);
      row-gap: 64px;
    }
    .bd-check {
      max-width: 520px;
    }
  }
</style>
