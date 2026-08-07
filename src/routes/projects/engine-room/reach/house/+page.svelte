<script lang="ts">
  // The house — Part III, leaf 6.
  //
  // Nothing on this page changes what the house can do. What it describes is an interface
  // decision — arranging several hundred identifiers the way a person already thinks about a
  // building — and a safety property that falls out of one flag. Both only land as an
  // instrument: the tree has to be browsed and the dry run has to be watched not to fire.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Stat from '../../components/viz/Stat.svelte';
  import HouseTree from './components/HouseTree.svelte';
  import { ENTITIES, OPERATIONS, TREE_NOTE, DRY_RUN, MULTI, HOUSE_FACTS } from '../../lib/house';

  const TONE = 'var(--success)';
  const areas = new Set(ENTITIES.map((e) => e.area)).size;
  const domains = new Set(ENTITIES.map((e) => e.domain)).size;
  const reads = OPERATIONS.filter((o) => !o.writes).length;

  let fact = $state(0);
  const chosen = $derived(HOUSE_FACTS[fact]);
</script>

<svelte:head>
  <title>The house · The Engine Room</title>
  <meta name="description" content="Home automation reached as area, kind and thing rather than as several hundred identifiers — with a dry run that reports the call it would make instead of making it." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="reach"
    title="The house"
    line="A home automation system hands you a flat list of identifiers. Arranging them by room, and letting an automation be watched before it is armed, is what makes them worth wiring anything to."
    lineEli5="It can read and control things around the house. You pick a room rather than hunting through a list, and you can watch what it would do before letting it do it." />

  <Instrument
    kicker="The instrument"
    title="Room, then kind, then thing"
    tone={TONE}
    reading="Pick a room and something in it, choose an operation, and leave the dry run on."
    takeaway={DRY_RUN.body}>
    <HouseTree />
  </Instrument>

  <div class="pair">
    <aside class="note">
      <span class="n-kick">{TREE_NOTE.title}</span>
      <p>{TREE_NOTE.body}</p>
    </aside>
    <aside class="note">
      <span class="n-kick">{MULTI.title}</span>
      <p>{MULTI.body}</p>
    </aside>
  </div>

  <Instrument
    kicker="What it is made of"
    title="Five properties worth knowing"
    tone={TONE}
    reading="Pick one.">
    <div class="strip">
      <div class="chips" role="group" aria-label="Properties of the home integration">
        {#each HOUSE_FACTS as f, i (f.k)}
          <button type="button" class="chip" class:on={fact === i} aria-pressed={fact === i}
                  onclick={() => (fact = i)}>{f.k}<em>{f.v}</em></button>
        {/each}
      </div>
      <p class="why" aria-live="polite">{chosen.why}</p>
    </div>
    <div class="stats">
      <Stat value={OPERATIONS.length} label="operations"
            how="{reads} that only read, {OPERATIONS.length - reads} that change something" tone={TONE} />
      <Stat value={areas} label="areas in the worked house"
            how="illustrative — no real house is described here" tone={TONE} />
      <Stat value={domains} label="kinds of thing"
            how="lights, sensors, contacts, heating, media, blinds, locks" tone={TONE} />
      <Stat value="1" label="flag between a preview and a call"
            how="the same code path either way, so the preview is the truth" tone={TONE} />
    </div>
  </Instrument>

  <PageFoot />
</section>

<style>
  .note { display: flex; flex-direction: column; gap: 4px; margin: 0 0 16px;
    padding: 10px 14px; border-left: 3px solid var(--success);
    border-radius: 0 var(--radius-round) var(--radius-round) 0;
    background: color-mix(in srgb, var(--success) 8%, transparent); }
  .n-kick { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--success); }
  .note p { margin: 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.74); max-width: 82ch; }
  .pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 10px; margin-top: -6px; }

  .strip { display: flex; flex-direction: column; gap: 9px; min-width: 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip { display: inline-flex; align-items: baseline; gap: 7px; font-family: 'DM Sans', sans-serif;
    font-size: 11.5px; color: var(--text-primary); background: rgba(255,255,255,0.6);
    border: 1px solid rgba(28,22,17,0.18); border-radius: var(--radius-round);
    padding: 5px 11px; cursor: pointer; }
  .chip em { font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 9px;
    color: rgba(28,22,17,0.45); }
  .chip:hover { background: rgba(28,22,17,0.07); }
  .chip.on { background: var(--success); border-color: var(--success); color: #fff; }
  .chip.on em { color: rgba(255,255,255,0.7); }
  .why { margin: 0; min-height: 3em; font-size: 12.5px; line-height: 1.55;
    color: rgba(28,22,17,0.72); max-width: 84ch; }

  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 9px; margin-top: 12px; }


  @media (max-width: 560px) { .why { min-height: 0; } }
</style>
