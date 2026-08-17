<script lang="ts">
  // Out of signal — Part III, leaf 8.
  //
  // The outdoor field kit: a route planner whose maps are built to keep working after the
  // phone loses signal. Two instruments carry it — the offline tile budget (the real
  // download planner's arithmetic: zooms 12–16, two tiles of padding, 25 KB a tile) and
  // the difficulty grader (the live bands, run in front of the reader). Everything else is
  // chips and two notes. No real route, trace or location appears anywhere on this page.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Bars from '../../components/viz/Bars.svelte';
  import Stat from '../../components/viz/Stat.svelte';
  import DifficultyDial from './components/DifficultyDial.svelte';
  import { TILE, PAD_STORY, PLANNER, GUARDS, WHY_PRIVATE, PWA } from '../../lib/trails';

  const TONE = 'var(--success)';

  // The download planner's own arithmetic, at an illustrative UK latitude (53°N).
  // Ground width of a tile at zoom z ≈ 40,075 km × cos(lat) / 2^z; the route's square
  // box is covered at every zoom from minZoom to maxZoom, padded by TILE.pad whole
  // tiles on each side — exactly what planDownload does.
  const WORLD_KM = 40_075 * Math.cos((53 * Math.PI) / 180);
  let boxKm = $state(10);
  const ZOOMS = Array.from({ length: TILE.maxZoom - TILE.minZoom + 1 }, (_, i) => TILE.minZoom + i);
  const perZoom = $derived(ZOOMS.map((z) => {
    const tileKm = WORLD_KM / 2 ** z;
    const side = Math.ceil(boxKm / tileKm) + 2 * TILE.pad;
    return { z, count: side * side };
  }));
  const totalTiles = $derived(perZoom.reduce((a, r) => a + r.count, 0));
  const totalMb = $derived((totalTiles * TILE.bytesPerTile) / 1_000_000);
  const zoomBars = $derived(perZoom.map((r) => ({
    label: `Zoom ${r.z}`,
    value: r.count,
    note: r.z === TILE.maxZoom ? 'navigating zoom — most of the bill' : undefined,
  })));

  let plan = $state(0);
  const chosenPlan = $derived(PLANNER[plan]);
  let guard = $state(0);
  const chosenGuard = $derived(GUARDS[guard]);
</script>

<svelte:head>
  <title>Out of signal · The Engine Room</title>
  <meta name="description" content="A route planner and offline map kit: what a downloaded map really costs, how a route is graded by climb, and the rules that keep an unattended planner honest." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="reach"
    title="Out of signal"
    line="Workouts arrive with their GPS tracks, a router draws candidate loops, our scorer ranks them — and the field kit caches every map tile a route needs, because the whole point of a good route is that it leaves signal behind."
    lineEli5="A route planner and an outdoor map that keep working when the phone has no signal. Plan a loop, download its map, go — the interesting engineering all happens before you leave the house." />

  <aside class="note">
    <span class="n-kick">{PWA.title}</span>
    <p>{PWA.body}</p>
  </aside>

  <Instrument
    kicker="The instrument"
    title="What a map that cannot fail costs"
    tone={TONE}
    reading="Drag the size of a route's box. Tiles are counted at every zoom from {TILE.minZoom} to {TILE.maxZoom}, padded by {TILE.pad} tiles a side — the download planner's own arithmetic, at an illustrative latitude."
    readingEli5="Drag the size of the area a route covers. The map is saved at five levels of detail, each padded at the edges — this is the real planner's own sum."
    takeaway="{PAD_STORY.body}"
    takeawayEli5="{PAD_STORY.body}">
    <label class="box-sl">
      <span class="sl-k">Route bounding box <b>{boxKm} × {boxKm} km</b></span>
      <input type="range" min="2" max="30" step="1" bind:value={boxKm} />
    </label>
    <Bars items={zoomBars} unit=" tiles" tone={TONE} grouped={false} height={20} />
    <div class="stats">
      <Stat lead value={totalTiles.toLocaleString('en-GB')} unit="tiles" label="fetched for this route"
            how="already-held tiles are skipped, so a re-run tops up cheaply" tone={TONE} />
      <Stat lead value={totalMb.toFixed(1)} unit="MB" label="at {Math.round(TILE.bytesPerTile / 1000)} KB a tile"
            how="a sample of real tiles averaged ~{TILE.measuredKb} KB; an earlier estimate assumed {TILE.assumedKb}" tone={TONE} />
    </div>
  </Instrument>

  <Instrument
    kicker="The grader"
    title="Distance is half the story"
    tone={TONE}
    reading="Equivalent kilometres: distance plus a kilometre for every hundred metres of climb, banded with the live grader's own thresholds."
    readingEli5="One number for how hard a route is: the distance, plus extra for every bit of climb. Change the sport and watch the goalposts move."
    takeaway="Hardness is deliberately a second axis. The quality score says whether a route is a good loop; this says whether you will feel it tomorrow — and a route that scores well on one can score terribly on the other."
    takeawayEli5="Hardness is kept separate from whether a route is any good, on purpose: a flat five-kilometre loop and a two-summit slog can both be excellent routes. One number cannot say both things.">
    <DifficultyDial tone={TONE} />
  </Instrument>

  <Instrument
    kicker="The planner"
    title="Who draws, who ranks"
    tone={TONE}
    reading="Three decisions, and the reason each one sits where it does."
    readingEli5="Three decisions. Pick one for the reason behind it."
    takeaway="The router is trusted to draw and never to judge; the judging is plain arithmetic that runs identically every time. The one place a language model appears, it may fill in a form and nothing else."
    takeawayEli5="The route-drawing service is trusted to draw, never to judge — the judging is plain arithmetic. The one place an AI appears, it may fill in a form and nothing else; anything you did not say is left blank, not guessed.">
    <div class="strip">
      <div class="chips" role="group" aria-label="Planner decisions">
        {#each PLANNER as p, i (p.k)}
          <button type="button" class="chip" class:on={plan === i} aria-pressed={plan === i}
                  onclick={() => (plan = i)}>{p.k}<em>{p.v}</em></button>
        {/each}
      </div>
      <p class="why" aria-live="polite">{chosenPlan.why}</p>
    </div>
  </Instrument>

  <Instrument
    kicker="The manners"
    title="Five rules that keep it honest"
    tone={TONE}
    reading="Pick one."
    readingEli5="Pick a rule."
    takeaway="Most of these exist because an unattended system's mistakes compound: one bad suggestion seeds the next, one greedy burst of requests loses the whole service. The cheap time to be careful is before anything goes wrong."
    takeawayEli5="Most of these exist because an unattended system's mistakes compound: one bad suggestion seeds the next, one greedy burst of requests can lose access to a whole service. The cheap time to be careful is before anything goes wrong.">
    <div class="strip">
      <div class="chips" role="group" aria-label="Planner guardrails">
        {#each GUARDS as g, i (g.k)}
          <button type="button" class="chip" class:on={guard === i} aria-pressed={guard === i}
                  onclick={() => (guard = i)}>{g.k}<em>{g.v}</em></button>
        {/each}
      </div>
      <p class="why" aria-live="polite">{chosenGuard.why}</p>
    </div>
  </Instrument>

  <aside class="note">
    <span class="n-kick">{WHY_PRIVATE.title}</span>
    <p>{WHY_PRIVATE.body}</p>
  </aside>

  <PageFoot />
</section>

<style>
  .note { display: flex; flex-direction: column; gap: 4px; margin: 0 0 22px;
    padding: 10px 14px; border-left: 3px solid var(--success);
    border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0;
    background: color-mix(in srgb, var(--success) 8%, transparent); }
  .n-kick { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--success); }
  .note p { margin: 0; font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.74); }

  .box-sl { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; max-width: 420px; }
  .sl-k { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.08em;
    text-transform: uppercase; color: rgba(28,22,17,0.55); }
  .sl-k b { color: var(--text-primary); letter-spacing: 0; }
  .box-sl input { width: 100%; accent-color: var(--success); }

  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 9px; margin-top: 12px; }

  .strip { display: flex; flex-direction: column; gap: 9px; min-width: 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip { display: inline-flex; align-items: baseline; gap: 7px; font-family: var(--font-body);
    font-size: var(--fs-label-xs); line-height: 1.25; color: var(--text-primary); background: rgba(255,255,255,0.6);
    border: 1px solid rgba(28,22,17,0.18); border-radius: var(--radius-sharp);
    padding: 5px 11px; cursor: pointer; transition: background 0.12s, border-color 0.12s; }
  .chip em { font-style: normal; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: rgba(28,22,17,0.45); }
  .chip:hover { background: rgba(28,22,17,0.07); border-color: rgba(28,22,17,0.34); }
  .chip.on { background: var(--success); border-color: var(--success); color: #fff; }
  .chip.on em { color: rgba(255,255,255,0.7); }
  .why { margin: 0; min-height: 3em; font-size: var(--fs-label); line-height: 1.55;
    color: rgba(28,22,17,0.72); }

  @media (max-width: 560px) { .why { min-height: 0; } }
</style>
