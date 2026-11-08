<svelte:options css="injected" />

<script lang="ts">
  // The app page: a patent-drawing sketch of the phone and the watch, its
  // parts numbered with leader arrows and the numbers explained underneath
  // (the list is the drawing's text, so nothing is said by the picture
  // alone); the doorways into the site ringed as the headline; a stapled
  // receipt of everything counted from the app itself; and a margin note
  // tying it back to Daydream, whose verdict buttons live in the app.
  import type { AppShowcase } from '$lib/landing/showcase';
  import { scenery } from '$lib/landing/ramblers/scenery';
  import { rng } from '$lib/landing/notes-ink';
  import { PAGES, SKETCH_H, SKETCH_W, callouts, deviceSketch, fig, inkArrow, receipt, type FairRow } from '$lib/landing/showcase-notes';
  import SnPage from './SnPage.svelte';
  import SnFigure from './SnFigure.svelte';
  import { reveal } from './reveal';
  import { snap } from './snap';

  let { app, fair }: { app: AppShowcase; fair: FairRow[] } = $props();

  const S = deviceSketch();
  let notes = $derived(callouts(app));
  let lines = $derived(receipt(app));
  // Back to Daydream: pointing left beside the drawing, up when the page is one column.
  const TIE = inkArrow(rng(271), 62, 8, 6, 34, 0.3);
  const TIE_UP = inkArrow(rng(272), 40, 44, 22, 4, 0.3);
</script>

<SnPage id="ap" page={PAGES.app} {fair}>
  <div class="ap">
    <div class="ap-l">
      <div class="ap-hl" use:scenery use:snap>
        <SnFigure f={fig(app.nativeEndpoints)} unit="doorways from the app into the site" mark="ring" tone="ink" size="xl" seed={31} />
        <p class="sn-a">across {app.nativeAreas.toLocaleString('en-GB')} areas of the site, all of them for one phone and one watch.</p>
      </div>

      <figure class="ap-fig" use:scenery>
        <div class="ap-sketch" use:reveal>
          <svg viewBox="0 0 {SKETCH_W} {SKETCH_H}" aria-hidden="true" focusable="false">
            <g class="dev">
              <path d={S.phone} />
              <path class="thin" d={S.screen} />
              <path class="thin" d={S.island} />
              <path class="thick" d={S.lockTime} />
              <path d={S.live} />
              <path class="thin" d={S.liveTrack} />
              <circle class="dotc" cx={S.liveDot.cx} cy={S.liveDot.cy} r="4" />
              <path d={S.widgets} />
              <path class="pen" d={S.widgetBars} />
              <path class="thin" d={S.widgetTicks} />
              <path class="pet" d={S.orb} />
              <path class="pet" d={S.wave} />
              <path class="thin" d={S.home} />
              <path d={S.watch} />
              <path class="thin" d={S.watchScreen} />
              <path d={S.strapTop} />
              <path d={S.strapBottom} />
              <path d={S.crown} />
              <path class="track" d={S.readinessTrack} />
              <path class="pencil" d={S.readiness} />
              {#each S.games as g, i (i)}<path class="thin" d={g} />{/each}
            </g>
            {#each notes as c, i (c.n)}
              <g class="lead" style:--i={i}><path d={c.leader.shaft} pathLength="1" /><path d={c.leader.head} /></g>
            {/each}
          </svg>
          {#each notes as c, i (c.n)}
            <span class="ap-num" style:left="{c.at[0] * 100}%" style:top="{c.at[1] * 100}%" style:--i={i} aria-hidden="true">{c.n}</span>
          {/each}
        </div>
        <figcaption use:scenery use:snap>
          <p class="sn-l">The app, as drawn for the patent office</p>
          <ol class="ap-list">
            {#each notes as c (c.n)}
              <li>
                <span class="ap-li-n" aria-hidden="true">{c.n}</span>
                <span>{c.text}{#if c.more}<span class="ap-more">{c.more}</span>{/if}</span>
              </li>
            {/each}
          </ol>
        </figcaption>
      </figure>
    </div>

    <div class="ap-r">
      <!-- The receipt: pinned and a degree off true beside the drawing, so never a
           floor there. In one column it lies straight, and this marker (no size
           until then) lets the rambler stand on its top edge. -->
      <div class="ap-rc-floor" use:scenery></div>
      <div class="ap-rc-wrap" use:snap>
        <div class="ap-rc">
          <span class="ap-staple" aria-hidden="true"></span>
          <p class="ap-rc-h">counted from the app itself</p>
          <dl>
            {#each lines as l (l.k)}
              <div class="ap-row">
                <dt>{l.k}</dt>
                <dd>{l.v}</dd>
                {#if l.sub}<dd class="ap-sub">{l.sub}</dd>{/if}
              </div>
            {/each}
          </dl>
        </div>
      </div>

      <div class="ap-tie" use:scenery use:snap>
        <svg class="tie-l" viewBox="0 0 72 48" aria-hidden="true" focusable="false"><path d={TIE.shaft} /><path d={TIE.head} /></svg>
        <svg class="tie-u" viewBox="0 0 64 48" aria-hidden="true" focusable="false"><path d={TIE_UP.shaft} /><path d={TIE_UP.head} /></svg>
        <p class="sn-a">Daydream’s notes land in the app’s More page, each with two buttons, useful or not. Those taps are the percentage two pages back.</p>
      </div>
    </div>
  </div>
</SnPage>

<style>
  /* Two columns that run independently: the figure and the drawing on the
     left, the receipt and the note back to Daydream on the right. */
  .ap {
    display: grid;
    grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
    column-gap: clamp(32px, 5vw, 80px);
    align-items: start;
    margin-top: 64px;
  }
  .ap-l,
  .ap-r {
    display: flex;
    flex-direction: column;
    gap: 64px;
    min-width: 0;
  }
  .ap-hl .sn-a {
    max-width: 40ch;
  }
  .ap-fig {
    margin: 0;
    container-type: inline-size;
  }
  .ap-rc-wrap {
    display: flex;
    justify-content: center;
    padding-top: 8px;
  }
  .ap-tie {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    column-gap: 10px;
    align-items: start;
    max-width: 420px;
    align-self: center;
  }
  .ap-tie svg {
    width: 64px;
    height: 44px;
    overflow: visible;
  }
  .ap-tie .tie-u {
    display: none;
  }
  .ap-tie path {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.8;
    stroke-linecap: round;
  }

  /* The drawing: as wide as its column allows, its height a whole number of rules. */
  .ap-sketch {
    --h: round(down, min(100cqw, 640px) * 0.75, 32px);
    position: relative;
    width: calc(var(--h) / 0.75);
    height: var(--h);
    max-width: 100%;
  }
  .ap-sketch svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .ap-sketch path {
    fill: none;
    stroke: var(--text-primary);
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .ap-sketch .thin {
    stroke-width: 1.1;
    stroke: var(--text-secondary);
  }
  .ap-sketch .thick {
    stroke-width: 4;
  }
  .ap-sketch .pen {
    stroke: var(--accent);
    stroke-width: 2.4;
  }
  .ap-sketch .pet {
    stroke: var(--accent-ink);
    stroke-width: 1.8;
  }
  /* Readiness: an empty ring with a pencilled dash. The drawing has no number to show; the health page has. */
  .ap-sketch .track {
    stroke: var(--text-secondary);
    stroke-width: 1.2;
  }
  .ap-sketch .pencil {
    stroke: var(--text-muted);
    stroke-width: 2.4;
  }
  .dotc {
    fill: var(--accent);
  }
  .lead path {
    stroke: var(--accent-ink);
    stroke-width: 1.3;
  }
  .lead path:first-child {
    stroke-dasharray: 1 1.05;
  }
  .ap-num {
    position: absolute;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    margin: -14px 0 0 -14px;
    border: 1.5px solid var(--accent-ink);
    border-radius: 100px;
    background: var(--bg);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    line-height: 1;
    color: var(--accent-ink);
  }
  /* Live, the leaders draw out from their numbers once the sketch is seen. */
  .ap-sketch:global([data-armed]) .lead path:first-child {
    stroke-dashoffset: 1.03;
  }
  .ap-sketch:global([data-armed]) .lead path:last-child,
  .ap-sketch:global([data-armed]) .ap-num {
    opacity: 0;
  }
  .ap-sketch:global([data-seen]) .lead path:first-child {
    stroke-dashoffset: 0;
    transition: stroke-dashoffset 420ms ease-out calc(300ms + var(--i) * 220ms);
  }
  .ap-sketch:global([data-seen]) .lead path:last-child,
  .ap-sketch:global([data-seen]) .ap-num {
    opacity: 1;
    transition: opacity 200ms ease-out calc(300ms + var(--i) * 220ms);
  }

  .ap-fig figcaption {
    margin-top: 64px;
  }
  .ap-rc-floor {
    display: none;
  }
  .ap-list {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .ap-list li {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr);
    column-gap: 14px;
    align-items: baseline;
    font-family: var(--font-body);
    font-size: var(--fs-body);
    line-height: 32px;
    color: var(--text-primary);
  }
  .ap-li-n {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 1.5px solid var(--accent-ink);
    border-radius: 100px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1;
    color: var(--accent-ink);
    transform: translateY(6px);
  }
  .ap-more {
    display: block;
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 16px;
    line-height: 32px;
    color: var(--text-secondary);
  }

  /* The receipt: till-roll paper, a mono column, a zigzag tear and a staple. */
  .ap-rc {
    position: relative;
    width: min(100%, 340px);
    padding: 26px 24px 34px;
    box-sizing: border-box;
    background: var(--surface-card);
    border: 1px solid var(--line);
    border-bottom: 0;
    transform: rotate(-1.4deg);
    clip-path: polygon(
      0 0,
      100% 0,
      100% calc(100% - 8px),
      95% 100%,
      90% calc(100% - 8px),
      85% 100%,
      80% calc(100% - 8px),
      75% 100%,
      70% calc(100% - 8px),
      65% 100%,
      60% calc(100% - 8px),
      55% 100%,
      50% calc(100% - 8px),
      45% 100%,
      40% calc(100% - 8px),
      35% 100%,
      30% calc(100% - 8px),
      25% 100%,
      20% calc(100% - 8px),
      15% 100%,
      10% calc(100% - 8px),
      5% 100%,
      0 calc(100% - 8px)
    );
  }
  .ap-staple {
    position: absolute;
    top: 9px;
    left: 50%;
    width: 34px;
    height: 4px;
    margin-left: -17px;
    border: 1.5px solid #6d6a66;
    border-top: 0;
    background: linear-gradient(#bdb8b0, #8f8a83);
  }
  .ap-rc-h {
    margin: 0 0 14px;
    padding-bottom: 12px;
    border-bottom: 1px dashed var(--text-ghost);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    text-align: center;
    color: var(--accent-ink);
  }
  .ap-rc dl {
    margin: 0;
  }
  .ap-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: 10px;
    padding: 4px 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    line-height: 1.45;
    color: var(--text-primary);
  }
  .ap-row dt {
    overflow: hidden;
    white-space: nowrap;
  }
  /* Dot leaders from the name to its count. */
  .ap-row dt::after {
    content: ' . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .';
    color: var(--text-ghost);
  }
  .ap-row dd {
    margin: 0;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .ap-row .ap-sub {
    grid-column: 1 / -1;
    margin-top: 2px;
    font-weight: 400;
    font-size: var(--fs-label-xs);
    text-align: left;
    color: var(--text-muted);
  }

  @media (max-width: 1000px) {
    .ap {
      grid-template-columns: minmax(0, 1fr);
      row-gap: 64px;
    }
    .ap-rc-wrap {
      justify-content: flex-start;
      padding-top: 0;
    }
    .ap-rc-floor {
      display: block;
      width: min(100%, 340px);
      height: 0;
      margin-bottom: -64px;
    }
    .ap-rc {
      transform: none;
    }
    .ap-tie {
      align-self: start;
    }
    .ap-tie .tie-l {
      display: none;
    }
    .ap-tie .tie-u {
      display: block;
    }
  }
</style>
