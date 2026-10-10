<svelte:options css="injected" />

<script lang="ts">
  // The notes view's showcase: the rest of the notebook. The hero is its ink
  // cover, marked up in the margins; turn it over and the pages are cream,
  // ruled in faint petrol with a red-orange margin like an exercise book,
  // written in ink with an orange pen and a petrol one. Every mark is seeded
  // (notes-ink.ts, showcase-notes.ts), so the server and the browser draw
  // the same wobble.
  //
  // The pages, top to bottom (each a <section> with its own h2; the margin
  // carries its kicker; each headline figure counts up the first time it is
  // seen while its underline or ring draws itself in, and the server's HTML
  // shows the final figure, mark drawn):
  //
  //   1  Daydream, "It thinks while nobody's watching" (SnDaydream)
  //      headline  questions it asked itself this week, double underline,
  //                tallied below in gates of five (fifty to a row, "+n" past
  //                four rows)
  //      then      % of rated notes useful, ringed, "of N rated" and up/down;
  //                the next think on a Time Timer (readDaydream); hours on a
  //                shaded clock; look-ups; claims scribbled out "×n"; areas
  //                of life ticked off; twelve weeks of verdicts in pencil;
  //                the rules it keeps, on the lines
  //      floors    the page head (spot 'think'), the verdicts and dial row,
  //                the four small readings, the chart and the rules
  //   2  Health, "My body, on the record" (SnHealth)
  //      headline  steps this year, double underline; km on an odometer
  //      then      bpm with a small inked heartbeat ONLY when fresh (the nib
  //                crosses once or twice and settles); the week's sleep by a
  //                doodled moon, last night and today's recovery as bands;
  //                thirty days of steps on graph paper (best ringed, ten
  //                thousand dashed); recovery as dots in three pencils and
  //                three shapes; today hour by hour in pencil
  //      floors    the page head, the headline block (spot 'gym': he sits
  //                there to check his pulse), sleep, the charts
  //   3  The app, "It lives in my pocket" (SnApp)
  //      headline  doorways from the app into the site, ringed
  //      then      a patent-drawing sketch of the phone and the watch with
  //                numbered leaders, the numbers explained in a list; a
  //                stapled receipt of counts (pinned and tilted, so never a
  //                floor); a margin note back to Daydream's verdict buttons
  //      floors    the page head, the headline, the margin note
  //   4  The builder, "It rewrites itself, then ships" (SnBuild)
  //      headline  releases, double underline; lines written, ringed big
  //      then      today's deploys tallied and the average; the checklist
  //                ticked down with the live bench; Daydream's shipped ideas
  //                on a sticky note (tilted, not a floor)
  //      floors    the page head (spot 'desk'), today's deploys, checklist
  //   5  The rest, "Also in this notebook" (SnCoda)
  //      three links with hand-drawn arrows: canvases, JKAI, the family
  //      floors    the page head, the row of links
  //
  // The fair copy: each page has its readings typed up (SnFair, under its
  // lede). The hero's "fair copy" switch shows them in place of the drawings
  // all the way down (read through the page with :has, so the cover's one
  // switch types up the whole notebook); print always shows them.
  //
  // The join: the cover's ink edge is torn over the first page, with a little
  // shadow where the cover lifts, and the margin rule starts below the tear.
  // Wider than the measure, the paper stops at the measure plus its gutters
  // and lies on the desk, so the ruling has edges.
  import type { ShowcaseProps } from '$lib/landing/showcase';
  import { fairPages } from '$lib/landing/showcase-notes';
  import SnDaydream from './SnDaydream.svelte';
  import SnHealth from './SnHealth.svelte';
  import SnApp from './SnApp.svelte';
  import SnBuild from './SnBuild.svelte';
  import SnCoda from './SnCoda.svelte';

  // `cadence` is the hero's; the build page reads the release record through `build`.
  let { data, build, v, now, pulse, steps, facts }: ShowcaseProps = $props();

  let fair = $derived(fairPages({ data, build, v, now, pulse, steps, facts }));
</script>

<div class="sn">
  <span class="sn-tear" aria-hidden="true"></span>
  <div class="sn-paper">
    {#if data.fixture}<p class="sn-fixture">preview figures</p>{/if}
    <SnDaydream d={data.daydream} {v} {now} {facts} fair={fair.daydream} />
    <SnHealth h={data.health} {pulse} {steps} {now} fair={fair.health} />
    <SnApp app={data.app} fair={fair.app} />
    <SnBuild b={build} {v} {now} fair={fair.build} />
    <SnCoda {v} {now} fair={fair.rest} />
  </div>
</div>

<style>
  .sn {
    --gut: clamp(16px, 4vw, 64px);
    --mg: clamp(84px, 9vw, 148px);
    /* Where the rule falls in each 32px line: just under the writing's baseline. */
    --rule-y: 23px;
    --rule: rgba(14, 91, 102, 0.16);
    position: relative;
    /* The desk the notebook lies on, seen only past the paper's edges on a wide screen. */
    background: var(--surface-rail-deep);
    color: var(--text-primary);
    overflow-x: clip;
  }
  .sn-paper {
    position: relative;
    max-width: calc(1312px + 2 * var(--gut));
    margin: 0 auto;
    padding: 32px 0 64px;
    background-color: var(--bg);
    box-shadow:
      0 1px 0 rgba(26, 16, 8, 0.08),
      0 24px 48px -24px rgba(26, 16, 8, 0.35);
  }
  /* The margin: a double red-orange rule down the whole notebook, on the
     same line as each page's margin column, starting below the tear. */
  .sn-paper::before {
    content: '';
    position: absolute;
    top: 28px;
    bottom: 0;
    left: calc(max(0px, (100% - 1312px) / 2) + var(--gut) + var(--mg) - 1px);
    width: 4px;
    border-left: 1px solid rgba(196, 87, 10, 0.55);
    border-right: 1px solid rgba(196, 87, 10, 0.35);
    pointer-events: none;
  }
  /* The cover's torn edge laid over the first page, and the shadow where it lifts. */
  .sn-tear {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 1;
    height: 30px;
    pointer-events: none;
    background:
      linear-gradient(135deg, var(--text-primary) 25%, transparent 25%) -6px 0 / 12px 12px repeat-x,
      linear-gradient(225deg, var(--text-primary) 25%, transparent 25%) -6px 0 / 12px 12px repeat-x,
      linear-gradient(rgba(26, 16, 8, 0.18), transparent) 0 0 / 100% 26px no-repeat;
  }
  .sn-fixture {
    position: absolute;
    top: 40px;
    right: max(var(--gut), calc((100% - 1312px) / 2 + var(--gut)));
    z-index: 1;
    margin: 0;
    padding: 3px 8px;
    border: 1px solid var(--line-strong);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: lowercase;
    color: var(--text-muted);
    background: var(--bg);
  }

  /* ---------------------------------- the pen's type, on every page, on the lines
     (held at the lowest weight with :where, so each page can adjust its own) */

  /* Blocks that keep themselves a whole number of rules tall (snap). */
  .sn :global([data-snap]) {
    padding-bottom: var(--snap, 0px);
  }
  /* A small label over a reading: mono caps in petrol, one rule. */
  :global(:where(.sn) .sn-l) {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 32px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent-ink);
  }
  /* A reading: the figure, then its unit, on one rule. Both line boxes are a
     rule tall and start together; each is nudged (without moving the layout)
     so its baseline lands on the line. */
  :global(:where(.sn) .sn-f) {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    column-gap: 10px;
    margin: 0;
  }
  :global(:where(.sn) .sn-f > *) {
    position: relative;
  }
  :global(:where(.sn) .sn-f .sn-n) {
    top: -4px;
  }
  :global(:where(.sn) .sn-f .sn-u) {
    top: 3px;
  }
  :global(:where(.sn) .sn-n) {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(28px, 2.4vw, 34px);
    line-height: 32px;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
  }
  :global(:where(.sn) .sn-u) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 32px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent-hover);
  }
  /* Marginalia: lower case, Fraunces italic, in a softer ink, written on the lines. */
  :global(:where(.sn) .sn-a) {
    margin: 0;
    font-family: var(--fs-serif);
    font-optical-sizing: auto;
    font-style: italic;
    font-size: 17px;
    line-height: 32px;
    color: var(--text-secondary);
  }
  /* A chart's sentence: the drawing in words. */
  :global(:where(.sn) .sn-cap) {
    margin: 0;
    max-width: 60ch;
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    line-height: 32px;
    color: var(--text-muted);
  }
  :global(:where(.sn) .sn-more) {
    display: inline-flex;
    align-items: center;
    gap: 0.5em;
    min-height: 44px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    text-decoration: none;
    color: var(--accent-hover);
    border-bottom: 1px solid currentColor;
  }
  :global(:where(.sn) .sn-more:hover) {
    color: var(--accent-ink);
  }
  :global(:where(.sn) a:focus-visible) {
    outline: 2px solid var(--accent-hover);
    outline-offset: 4px;
    border-radius: 2px;
  }
  :global(:where(.sn) .vh) {
    position: absolute !important;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }

  @media (max-width: 760px) {
    .sn {
      --mg: 30px;
    }
    .sn :global(.sn-a) {
      font-size: 16px;
    }
  }

  @media print {
    .sn,
    .sn-paper {
      background: none;
      box-shadow: none;
      color: #1a1008;
      padding: 0 0 12px;
    }
    .sn-paper::before,
    .sn-tear,
    .sn-fixture {
      display: none;
    }
    .sn :global(.sn-l),
    .sn :global(.sn-u),
    .sn :global(.sn-a),
    .sn :global(.sn-n),
    .sn :global(.sn-cap) {
      color: #1a1008;
    }
  }
</style>
