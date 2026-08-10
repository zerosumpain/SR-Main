<script lang="ts">
  // Reading from the outside — Part III, leaf 5.
  //
  // Two kinds of external feed, hard-wired and soft-wired, and one shared failure: both will
  // tell you they are fine. The flagship instrument is therefore not a diagram of a connector,
  // it is a switch between two dashboards, one of which is a lie.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Stat from '../../components/viz/Stat.svelte';
  import ProbeBoard from './components/ProbeBoard.svelte';
  import UnitTrap from './components/UnitTrap.svelte';
  import {
    FEEDS, ANALYTICS_COUNT, FIXED_POINT, HONESTY, CHEAP_BANNER,
    CATALOGUE, CATALOGUE_RULES,
  } from '../../lib/feeds';

  const TONE = 'var(--success)';
  let feed = $state(FEEDS[0].id);
  const chosen = $derived(FEEDS.find((f) => f.id === feed) ?? FEEDS[0]);
</script>

<svelte:head>
  <title>Reading from the outside · The Engine Room</title>
  <meta name="description" content="Hard-wired connectors and a catalogue of callable APIs, and the failure they share: a stored status column is a memory of the last run, not evidence that anything works now." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="reach"
    title="Reading from the outside"
    line="Some feeds turn up on their own and some have to be fetched. Both will cheerfully tell you they are working. The column saying so is a memory of the last time something ran, which is not at all the same claim."
    lineEli5="It reads data from other services. The hard part is not connecting to them — it is noticing when one has quietly given up." />

  <Instrument
    kicker="The instrument"
    title="What the column says, and what a probe just saw"
    tone={TONE}
    reading="The same five connectors, filled two different ways."
    takeaway={HONESTY.body}>
    <ProbeBoard />
  </Instrument>

  <aside class="note">
    <span class="n-kick">{CHEAP_BANNER.title}</span>
    <p>{CHEAP_BANNER.body}</p>
  </aside>

  <Instrument
    kicker="The hard-wired half"
    title="Three feeds, two ways in, two ways to fail"
    tone={TONE}
    reading="Pick a feed."
    takeaway="A pushed feed fails silently, because no data looks identical to a quiet day. So it is called stale after two days rather than the three everything else gets. A pulled feed has the decency to fail where you can see it, since using it is the test.">
    <div class="strip">
      <div class="chips" role="group" aria-label="Feeds">
        {#each FEEDS as f (f.id)}
          <button type="button" class="chip" class:on={feed === f.id} aria-pressed={feed === f.id}
                  onclick={() => (feed = f.id)}>{f.label}<em>{f.arrival}</em></button>
        {/each}
      </div>
      <dl class="facts" aria-live="polite">
        <div><dt>Authorisation</dt><dd>{chosen.auth}</dd></div>
        <div><dt>Cadence</dt><dd>{chosen.cadence}</dd></div>
        <div><dt>What it carries</dt><dd>{chosen.carries}</dd></div>
        <div><dt>How it fails</dt><dd>{chosen.fails}</dd></div>
      </dl>
    </div>
  </Instrument>

  <Instrument
    kicker="The unit that is not in the type"
    title="Every measurement is an integer of hundredths"
    tone={TONE}
    reading="Pick a measurement and read the column three ways."
    takeaway={FIXED_POINT.body}>
    <UnitTrap />
  </Instrument>

  <Instrument
    kicker="The soft-wired half"
    title="Calling an API nobody wrote code for"
    tone={TONE}
    reading="What the model may do with a catalogued data source, and what it may not."
    takeaway="The model can write to this register itself, so nothing in it gets the benefit of the doubt. Every rule below is enforced at call time against my settings, not against whatever the record says about itself.">
    <ul class="rules">
      {#each CATALOGUE_RULES as r (r.k)}
        <li><b>{r.k}</b><span>{r.why}</span></li>
      {/each}
    </ul>
    <div class="stats">
      <Stat value={CATALOGUE.seeded} label="public data sources catalogued at boot"
            how="seeded entries, never overwriting one the system registered itself" tone={TONE} />
      <Stat value={CATALOGUE.timeoutSec} unit="s" label="timeout on any outbound call"
            how="a slow third party must not hold a turn open" tone={TONE} />
      <Stat value={CATALOGUE.maxResponseKb} unit="KB" label="most of a response that is read"
            how="a large body would arrive as prompt tokens" tone={TONE} />
      <Stat value={ANALYTICS_COUNT} label="published analytics over the feeds"
            how="each with its formula, inputs, caveats and citation" tone={TONE} />
    </div>
  </Instrument>

  <PageFoot />
</section>

<style>
  .note { display: flex; flex-direction: column; gap: 4px; margin: -6px 0 22px;
    padding: 10px 14px; border-left: 3px solid var(--success);
    border-radius: 0 var(--radius-round) var(--radius-round) 0;
    background: color-mix(in srgb, var(--success) 8%, transparent); }
  .n-kick { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--success); }
  .note p { margin: 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.74); max-width: 82ch; }

  .strip { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
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

  .facts { margin: 0; display: grid; gap: 4px; }
  .facts div { display: grid; grid-template-columns: 130px 1fr; gap: 10px; align-items: baseline; }
  .facts dt { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.08em;
    text-transform: uppercase; color: rgba(28,22,17,0.45); }
  .facts dd { margin: 0; font-size: 12.5px; line-height: 1.5; color: rgba(28,22,17,0.78); max-width: 84ch; }

  .rules { margin: 0; padding: 0; list-style: none; display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 8px; }
  .rules li { display: flex; flex-direction: column; gap: 2px; padding: 9px 12px;
    border: 1px solid rgba(28,22,17,0.14); border-left: 3px solid var(--success);
    border-radius: 0 var(--radius-round) var(--radius-round) 0; background: rgba(255,255,255,0.5); }
  .rules b { font-size: 12.5px; color: var(--text-primary); }
  .rules span { font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.65); }

  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 9px; margin-top: 12px; }


  @media (max-width: 620px) { .facts div { grid-template-columns: 1fr; gap: 1px; } }
</style>
