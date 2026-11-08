<svelte:options css="injected" />

<script lang="ts">
  // /projects read as notes: the landing page's notebook, turned to the
  // workbench. The default view, so the one most visitors see.
  //
  // The ink cover (PnCover) carries the title, today's stamp, the bench ringed
  // and tallied by kind, and the hand-built count on a pinned card. Its edge
  // is torn over the first page; turn it and the pages are cream exercise
  // book, ruled in faint petrol with the double red-orange margin, kickers in
  // the margin as the landing's showcase has them.
  //
  //   page 1  BUILT BY HAND: the field studies and tools, a contents page of
  //           every project (PnContents), then the hand-built projects as
  //           index cards pinned to the sheet (PnCard)
  //   page 2  BY AN AGENT (only when there is one, or the owner is looking):
  //           the agent's builds, taped in; empty, it says so plainly
  //
  // Everything written on the pages sits on a rule: 32px line boxes, gaps and
  // paddings in whole rules, and the two blocks whose height the browser
  // decides (the card grids) padded to a whole rule by `snap`. Every mark is
  // seeded from the project's key, so the server and the browser draw the
  // same sheet and nothing moves on its own.
  import type { ProjectsViewProps } from '$lib/projects/views';
  import { inkRing, rng } from '$lib/landing/notes-ink';
  import { snap } from '$lib/components/landing/showcase/notes/snap';
  import PnCover from './PnCover.svelte';
  import PnContents from './PnContents.svelte';
  import PnCard from './PnCard.svelte';

  let { hand, agent, showAgent, counts, owner, dateline, controls, switcher }: ProjectsViewProps = $props();

  const END = inkRing(rng(71), 14, 14, 9, 8.5, 1.18, 0.06);
</script>

<div class="pn">
  <PnCover {counts} handCount={hand.length} {showAgent} {owner} {dateline} {switcher} />

  <div class="pn-desk">
    <span class="pn-tear" aria-hidden="true"></span>
    <div class="pn-paper">
      <section class="pn-page" aria-labelledby="pn-hand-h" use:snap>
        <div class="pn-in">
          <p class="pn-k">Built by hand</p>
          <header class="pn-body">
            <h2 id="pn-hand-h">The field studies &amp; tools</h2>
            <p class="pn-lede">Long-form arguments you can operate rather than read, and a few tools that had a job to do.</p>
          </header>

          {#if hand.length || agent.length}
            <div class="pn-ct" id="pn-contents">
              <PnContents {hand} {agent} />
            </div>
          {/if}

          <div class="pn-body pn-cards-at">
            {#if hand.length}
              <ul class="pn-cards" role="list" use:snap>
                {#each hand as e (e.key)}<PnCard {e} {controls} />{/each}
              </ul>
            {:else}
              <p class="pn-a">Nothing published yet.</p>
            {/if}
          </div>
        </div>
      </section>

      {#if showAgent}
        <section class="pn-page" aria-labelledby="pn-agent-h" use:snap>
          <div class="pn-in">
            <p class="pn-k">By an agent</p>
            <header class="pn-body">
              <h2 id="pn-agent-h">Written by an agent</h2>
              <p class="pn-lede">One prompt in, a working page out. The iteration count is how many passes it took.</p>
            </header>
            <div class="pn-body pn-cards-at">
              {#if agent.length}
                <ul class="pn-cards" role="list" use:snap>
                  {#each agent as e (e.key)}<PnCard {e} {controls} />{/each}
                </ul>
              {:else}
                <p class="pn-empty">Nothing here yet: no agent-built project is on the index.</p>
                <p class="pn-a">only I can see this page while it’s empty.</p>
              {/if}
            </div>
          </div>
        </section>
      {/if}

      <div class="pn-end">
        <div class="pn-in">
          <div class="pn-body">
            <svg class="pn-endmark" viewBox="0 0 28 28" aria-hidden="true" focusable="false"><circle cx="14" cy="14" r="3" /><path
                d={END}
              /></svg>
            <p class="pn-a">that’s the lot, for now.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .pn {
    --gut: clamp(16px, 4vw, 64px);
    --mg: clamp(84px, 9vw, 148px);
    --pad: clamp(14px, 2vw, 32px);
    /* Where the rule falls in each 32px line: just under the writing's baseline. */
    --rule-y: 23px;
    --rule: rgba(14, 91, 102, 0.16);
    --pc-ctl-line: rgba(26, 16, 8, 0.28);
  }

  /* --------------------------------------------------------- the paper */

  /* The desk the notebook lies on, seen only past the paper's edges. */
  .pn-desk {
    position: relative;
    background: var(--surface-rail-deep);
    color: var(--text-primary);
    overflow-x: clip;
  }
  .pn-paper {
    position: relative;
    max-width: calc(1312px + 2 * var(--gut));
    margin: 0 auto;
    padding: 32px 0 0;
    background-color: var(--bg);
    border-inline: 1px solid rgba(26, 16, 8, 0.08);
    box-sizing: border-box;
  }
  /* The margin: a double red-orange rule down the whole sheet, starting below the tear. */
  .pn-paper::before {
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
  /* The cover's torn edge laid over the first page, and the shade where it lifts. */
  .pn-tear {
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

  /* A page: its own ruling, anchored at its top, kept a whole number of rules tall. */
  .pn-page,
  .pn-end {
    background-image: repeating-linear-gradient(
      to bottom,
      transparent 0 var(--rule-y),
      var(--rule) var(--rule-y) calc(var(--rule-y) + 1px),
      transparent calc(var(--rule-y) + 1px) 32px
    );
  }
  .pn-page {
    padding-bottom: calc(64px + var(--snap, 0px));
  }
  .pn-in {
    display: grid;
    grid-template-columns: var(--mg) minmax(0, 1fr);
    max-width: 1312px;
    margin: 0 auto;
    padding: 96px var(--gut) 0;
    box-sizing: border-box;
  }
  /* The kicker sits in the margin, on the heading's line, right up against the red rule. */
  .pn-k {
    grid-column: 1;
    margin: 0;
    padding-right: 22px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 32px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    text-align: right;
    color: var(--accent-hover);
  }
  .pn-body {
    grid-column: 2;
    min-width: 0;
    padding-left: var(--pad);
  }
  h2 {
    position: relative;
    top: -5px;
    max-width: 820px;
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 34px;
    line-height: 32px;
    letter-spacing: -0.035em;
    color: var(--text-primary);
    text-wrap: balance;
  }
  .pn-lede {
    max-width: 62ch;
    margin: 32px 0 0;
    font-family: var(--font-body);
    font-size: var(--fs-body);
    line-height: 32px;
    color: var(--text-secondary);
  }
  /* Marginalia: lower case, Fraunces italic, in a softer ink, on the lines. */
  .pn-a {
    margin: 0;
    font-family: var(--fs-serif);
    font-optical-sizing: auto;
    font-style: italic;
    font-size: 17px;
    line-height: 32px;
    color: var(--text-secondary);
  }
  .pn-empty {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--fs-body-lg);
    line-height: 32px;
    color: var(--text-primary);
  }

  /* The contents, one blank rule under the lede. */
  .pn-ct {
    grid-column: 1 / -1;
    margin-top: 32px;
    scroll-margin-top: 80px;
  }

  /* The cards, pinned to the sheet: two blank rules above them. */
  .pn-cards-at {
    margin-top: 64px;
  }
  .pn-cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
    align-items: start;
    gap: 64px 40px;
    margin: 0;
    padding: 12px 0 var(--snap, 0px);
    list-style: none;
  }
  /* An empty page has no contents between its lede and its note. */
  .pn-page:not(:has(.pn-ct)) .pn-cards-at:has(.pn-empty) {
    margin-top: 32px;
  }

  /* The end of the notebook: a small ringed full stop and a line. */
  .pn-end .pn-in {
    padding-top: 0;
    padding-bottom: 64px;
  }
  .pn-end .pn-body {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .pn-endmark {
    width: 28px;
    height: 28px;
    flex: none;
    color: var(--accent);
  }
  .pn-endmark circle {
    fill: currentColor;
  }
  .pn-endmark path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
  }

  @media (min-width: 1000px) {
    .pn-k {
      padding-top: 16px;
    }
    h2 {
      top: -2px;
      font-size: clamp(54px, 4.4vw, 60px);
      line-height: 64px;
    }
    .pn-lede {
      margin-top: 0;
      font-size: var(--fs-body-lg);
    }
  }
  /* Wide enough that a long kicker can run left into the gutter on one line. */
  @media (min-width: 1200px) {
    .pn-k {
      white-space: nowrap;
    }
  }
  @media (max-width: 760px) {
    .pn {
      --mg: 30px;
    }
    .pn-in {
      padding-top: 64px;
    }
    /* The kicker turns to run down the margin, as a phone's margin is narrow. */
    .pn-k {
      padding: 4px 0 0;
      line-height: 1.4;
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      justify-self: center;
      align-self: start;
      grid-row: 1 / span 2;
    }
    .pn-a {
      font-size: 16px;
    }
    .pn-cards {
      gap: 48px;
    }
  }

  @media print {
    .pn-desk,
    .pn-paper,
    .pn-page,
    .pn-end {
      background: none;
      border: 0;
      padding-bottom: 0;
    }
    .pn-paper::before,
    .pn-tear,
    .pn-endmark {
      display: none;
    }
    .pn-in {
      display: block;
      padding-top: 24px;
    }
    .pn-body {
      padding: 0;
    }
    .pn-k {
      padding: 0;
      text-align: left;
      color: #1a1008;
    }
    h2 {
      top: 0;
      font-size: 26px;
      line-height: 1.1;
      color: #1a1008;
    }
    .pn-lede,
    .pn-a {
      color: #1a1008;
      line-height: 1.45;
    }
    .pn-cards {
      display: block;
    }
    .pn-cards > :global(li) {
      margin-bottom: 12px;
    }
  }
</style>
