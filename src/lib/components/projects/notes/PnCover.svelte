<svelte:options css="injected" />

<script lang="ts">
  // The notebook's ink cover (NotesProjects): the landing hero's notes view,
  // turned to the workbench. The title stays put and the bench is inked round
  // it as marginalia: today stamped in the corner, the whole bench ringed in
  // orange, the families tallied in gates of five with an aside each, and the
  // hand-built count on a cream card pinned at the end of the row.
  //
  // All of it is static ink: every stroke's wobble is seeded (notes-ink), so
  // the server and the browser draw the same marks and nothing moves.
  import type { Snippet } from 'svelte';
  import { GATE_PITCH, inkLine, inkRing, inkTally, rng } from '$lib/landing/notes-ink';
  import { benchAside, handAside, tallyRows } from '$lib/projects/notes';
  import type { ProjectCounts } from '$lib/projects/views';
  import PnDot from './PnDot.svelte';

  let {
    counts,
    handCount,
    showAgent,
    owner,
    dateline,
    switcher,
  }: {
    counts: ProjectCounts;
    handCount: number;
    showAgent: boolean;
    owner: boolean;
    dateline: string;
    switcher: Snippet;
  } = $props();

  const STAMP = [
    inkLine(rng(43), 2, 2, 98, 2.5, 0.3, 0.004),
    inkLine(rng(44), 98, 2, 97.5, 38, 0.3, 0.01),
    inkLine(rng(45), 98, 38, 2, 37.5, 0.3, 0.004),
    inkLine(rng(46), 2, 38, 2.5, 2, 0.3, 0.01),
  ].join(' ');
  /** The ring round the bench count, drawn once. */
  const RING = inkRing(rng(31), 58, 47, 52, 40, 1.12);
  /** The loop round "some", looser and a touch flatter than the bench's. */
  const SOME = inkRing(rng(59), 60, 30, 57, 27, 1.1, 0.05);
  const TALLY_H = 18;

  let rows = $derived(
    tallyRows(counts, showAgent).map((r, i) => {
      const w = Math.max(1, Math.ceil(r.count / 5)) * GATE_PITCH;
      return { ...r, w, d: inkTally(r.count, w, TALLY_H, 17 + i * 7).d };
    }),
  );
  let tallyW = $derived(Math.max(...rows.map((r) => r.w)));
</script>

<section class="pc" aria-labelledby="pn-title">
  <div class="pc-in">
    <div class="pc-switch">{@render switcher()}</div>

    <div class="pc-grid">
      <div class="pc-mast">
        <div class="pc-h">
        <h1 id="pn-title">
          Things I’ve built.<br /><span class="pc-out"
            ><span class="pc-some"
              >Some<svg viewBox="0 0 120 60" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d={SOME} /></svg
              ></span
            > of them work.</span
          >
        </h1>
        <!-- The day, rubber-stamped beside the title. Rotated: decoration, plus the date. -->
        <p class="pc-stamp">
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d={STAMP} /></svg>
          <span class="pc-stamp-s">stocktake</span><span class="vh">, </span><span class="pc-stamp-d">{dateline}</span>
        </p>
        </div>
        <p class="pc-lede">
          Interactive field studies, strategy games and data tools, several of them digging into how government and education
          data fits together. {#if counts.agent > 0}Some made by hand, some built by an agent from a single prompt; those are
            kept on their own page at the back.{:else}All of them made by hand.{/if}
        </p>
      </div>

      <!-- The whole bench, ringed. -->
      <div class="pc-bench">
        <p class="pc-ring">
          <svg viewBox="0 0 116 94" aria-hidden="true" focusable="false"><path d={RING} /></svg>
          <span class="pc-ring-n">{counts.bench}</span>
          <span class="pc-ring-t">
            <span class="pc-unit">on the bench</span>
            <span class="pc-aside">{benchAside(counts, owner)}</span>
          </span>
        </p>
      </div>

      <!-- The families, tallied in gates of five. -->
      <div class="pc-tally">
        <p class="pc-label">by kind</p>
        <ul class="pc-rows" role="list" style:--tw="{tallyW}px">
          {#each rows as r (r.family)}
            <li class="pc-row">
              <span class="pc-n">{r.count}</span>
              <svg class="pc-marks" viewBox="0 0 {r.w} {TALLY_H}" width={r.w} height={TALLY_H} aria-hidden="true" focusable="false"
                ><path d={r.d} /></svg
              >
              <span class="pc-what"><PnDot family={r.family} on="ink" />{r.label}</span>
              <span class="pc-aside">{r.aside}</span>
            </li>
          {/each}
        </ul>
      </div>

      <!-- The hand-built count on a cream card, pinned. -->
      <div class="pc-card-at">
        <div class="pc-card">
          <span class="pc-pin" aria-hidden="true"></span>
          <p class="pc-card-l">built by hand</p>
          <p class="pc-card-n">{handCount}</p>
          <p class="pc-card-a">{handAside(counts.agent, showAgent)}</p>
          <a class="pc-card-go" href="#pn-contents">the contents <span aria-hidden="true">↓</span></a>
        </div>
      </div>

      <p class="pc-foot">every count here is read off the cards below</p>
    </div>
  </div>
</section>

<style>
  .pc {
    --gut: clamp(16px, 4vw, 64px);
    position: relative;
    color: var(--bg);
    background-color: var(--text-primary);
    /* The cover is ruled too, faintly, behind everything. */
    background-image: repeating-linear-gradient(to bottom, transparent 0 31px, var(--on-ink-05) 31px 32px);
    background-position: 0 14px;
    padding-bottom: 56px;
  }
  .pc-in {
    max-width: 1312px;
    margin: 0 auto;
    padding: clamp(18px, 3vh, 30px) var(--gut) 0;
  }
  .vh {
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
  .pc-switch {
    display: flex;
    justify-content: flex-end;
    min-height: 22px;
  }

  .pc-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'mast' 'bench' 'tally' 'card' 'foot';
    row-gap: 30px;
    margin-top: 18px;
  }
  .pc-mast {
    grid-area: mast;
    position: relative;
  }
  .pc-bench {
    grid-area: bench;
  }
  .pc-tally {
    grid-area: tally;
  }
  .pc-card-at {
    grid-area: card;
  }
  .pc-foot {
    grid-area: foot;
  }

  /* ------------------------------------------------------------ the title */

  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(var(--fs-display-sm), 5vw, var(--fs-display-md));
    line-height: 0.92;
    letter-spacing: -0.04em;
    text-transform: uppercase;
    color: var(--bg);
  }
  /* The second line in outline, as the page always had it. */
  .pc-out {
    color: transparent;
    -webkit-text-stroke: 1.5px var(--bg);
  }
  /* "Some", looped in the orange pen. */
  .pc-some {
    position: relative;
    display: inline-block;
  }
  .pc-some svg {
    position: absolute;
    left: -0.16em;
    top: -0.1em;
    width: calc(100% + 0.32em);
    height: 1.1em;
    overflow: visible;
    pointer-events: none;
  }
  .pc-some path {
    fill: none;
    stroke: var(--accent-on-dark);
    stroke-width: 2.4;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }
  .pc-lede {
    max-width: 60ch;
    margin: 22px 0 0;
    font-size: var(--fs-body-lg);
    line-height: 1.5;
    color: var(--on-ink-80);
  }

  /* ------------------------------------------------------------ the stamp */

  .pc-stamp {
    position: relative;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    margin: 22px 0 0 4px;
    padding: 7px 14px 8px;
    transform: rotate(-4deg);
    font-family: var(--font-mono);
    text-transform: uppercase;
    color: var(--accent-on-dark);
  }
  .pc-stamp svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .pc-stamp path {
    fill: none;
    stroke: var(--accent-on-dark);
    stroke-width: 1.5;
    opacity: 0.7;
    vector-effect: non-scaling-stroke;
  }
  /* The word on the stamp's top line, the date big under it, as a dated
     rubber stamp reads; the reading order is the same. */
  .pc-stamp-s {
    font-size: var(--fs-label-xs);
    line-height: 1.3;
    letter-spacing: 0.2em;
  }
  .pc-stamp-d {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 21px;
    line-height: 1.1;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }

  /* ---------------------------------------------------------- the marks */

  .pc-unit,
  .pc-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .pc-label {
    margin: 0 0 10px;
    color: var(--on-ink-55);
  }
  /* Marginalia: lower case, Fraunces italic, in a softer ink. */
  .pc-aside {
    margin: 0;
    font-family: var(--fs-serif);
    font-optical-sizing: auto;
    font-style: italic;
    font-size: 16px;
    line-height: 1.3;
    color: var(--on-ink-70);
  }

  /* The bench, ringed. */
  .pc-ring {
    position: relative;
    display: flex;
    align-items: flex-start;
    min-height: 94px;
    margin: 0;
    padding-left: 130px;
  }
  .pc-ring svg {
    position: absolute;
    left: 0;
    top: 0;
    width: 116px;
    height: 94px;
    overflow: visible;
  }
  .pc-ring path {
    fill: none;
    stroke: var(--accent-on-dark);
    stroke-width: 2.2;
    stroke-linecap: round;
  }
  .pc-ring-n {
    position: absolute;
    left: 0;
    top: 0;
    width: 116px;
    height: 94px;
    display: grid;
    place-items: center;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 46px;
    line-height: 1;
    letter-spacing: -0.04em;
    font-variant-numeric: tabular-nums;
    color: var(--accent-on-dark);
  }
  .pc-ring-t {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 24px;
    max-width: 15em;
  }
  .pc-ring .pc-unit {
    color: var(--accent-on-dark);
  }

  /* The families, tallied: figure, marks, word, aside, in columns. */
  .pc-rows {
    display: grid;
    grid-template-columns: 2ch var(--tw) max-content minmax(0, 1fr);
    column-gap: 14px;
    row-gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .pc-row {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: subgrid;
    align-items: baseline;
    min-height: 32px;
  }
  .pc-n {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 26px;
    line-height: 1;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
    text-align: right;
    color: var(--bg);
  }
  .pc-marks {
    align-self: center;
    overflow: visible;
  }
  .pc-marks path {
    fill: none;
    stroke: var(--on-ink-80);
    stroke-width: 1.5;
    stroke-linecap: round;
  }
  .pc-what {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--on-ink-80);
    white-space: nowrap;
  }
  .pc-row .pc-aside {
    font-size: 15px;
  }

  /* The hand-built count: a cream card pinned to the cover, ink inside. */
  .pc-card-at {
    display: flex;
    align-items: flex-start;
    justify-content: flex-start;
    padding-top: 8px;
  }
  .pc-card {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    width: min(100%, 236px);
    padding: 18px 20px 14px;
    background: var(--bg);
    color: var(--text-primary);
    transform: rotate(1.6deg);
  }
  .pc-pin {
    position: absolute;
    top: -6px;
    left: 50%;
    width: 13px;
    height: 13px;
    margin-left: -6px;
    border-radius: 100px;
    background: radial-gradient(circle at 35% 35%, #f6b37a 0 2px, var(--accent-on-dark) 3px, #b2561a 100%);
  }
  .pc-card p {
    margin: 0;
  }
  .pc-card-l {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent-ink);
  }
  .pc-card-n {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 40px;
    line-height: 1;
    letter-spacing: -0.035em;
    font-variant-numeric: tabular-nums;
  }
  .pc-card-a {
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 16px;
    line-height: 1.25;
    color: var(--text-secondary);
  }
  .pc-card-go {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.5em;
    min-height: 32px;
    margin-top: 4px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    text-decoration: none;
    color: var(--accent-hover);
  }
  .pc-card-go::after {
    content: '';
    position: absolute;
    inset: -6px -8px;
  }
  .pc-card-go:hover {
    color: var(--accent-ink);
    text-decoration: underline;
    text-underline-offset: 4px;
  }
  .pc-card-go:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 3px;
    border-radius: 2px;
  }

  .pc-foot {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    color: var(--on-ink-55);
  }

  /* --------------------------------------------- wider: the whole cover */

  @media (min-width: 761px) {
    .pc-grid {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      grid-template-areas: 'mast mast' 'bench card' 'tally card' 'foot foot';
      column-gap: clamp(32px, 4vw, 56px);
      row-gap: 34px;
      margin-top: 8px;
    }
    /* The stamp in the corner beside the title's first line, which is
       always the shorter of the two at this measure. */
    .pc-h {
      position: relative;
      width: fit-content;
    }
    .pc-stamp {
      position: absolute;
      top: -14px;
      left: calc(100% + 18px);
      margin: 0;
    }
    .pc-card-at {
      justify-content: flex-end;
    }
  }
  @media (min-width: 1100px) {
    .pc-grid {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr) minmax(0, 0.7fr);
      grid-template-areas: 'mast mast mast' 'bench tally card' 'foot foot foot';
      row-gap: 40px;
    }
    .pc-stamp {
      left: calc(100% + 36px);
      top: -6px;
    }
    .pc-tally {
      padding-top: 2px;
    }
  }

  /* -------------------------------------------------------------- phones */

  @media (max-width: 760px) {
    .pc {
      padding-bottom: 48px;
    }
    .pc-lede {
      font-size: var(--fs-body);
    }
    .pc-aside {
      font-size: 15px;
    }
    .pc-rows {
      grid-template-columns: 2ch var(--tw) minmax(0, 1fr);
      row-gap: 10px;
    }
    /* The aside drops under the word, still in the same column. */
    .pc-row .pc-aside {
      grid-column: 3;
      margin-top: -6px;
    }
    .pc-row {
      row-gap: 0;
    }
    .pc-card-at {
      justify-content: center;
    }
  }

  /* Print: ink on paper, every count legible, the scribbles gone. */
  @media print {
    .pc {
      background: none;
      color: #1a1008;
      padding-bottom: 12px;
    }
    h1,
    .pc-n,
    .pc-ring-n,
    .pc-lede,
    .pc-what,
    .pc-aside,
    .pc-stamp,
    .pc-ring .pc-unit {
      color: #1a1008;
    }
    .pc-out {
      color: #1a1008;
      -webkit-text-stroke: 0;
    }
    /* Kept in the grid (the columns line up by it), just not inked. */
    .pc-marks {
      visibility: hidden;
    }
    .pc-some svg,
    .pc-stamp svg,
    .pc-ring svg,
    .pc-pin,
    .pc-card-go,
    .pc-foot {
      display: none;
    }
    .pc-stamp,
    .pc-card {
      transform: none;
    }
  }
</style>
