<script lang="ts">
  // Wiring it together — Part III, leaf 3.
  //
  // One demonstration (two branches, one node, three wirings) and two readouts: what the six
  // kinds of node are for, and six lines about the runner.
  //
  // Every figure on this page traces to ../../lib/automation.ts. Nothing is counted here.
  // An earlier draft drew the catalogue as a treemap with a per-category node count — those
  // counts existed nowhere in the lib, did not match the registry, and summed to one less
  // than NODE_COUNT. Area needs a measured value; there isn't one, so the catalogue is a
  // selector, not a chart. Do not reintroduce magnitudes that no constant supports.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import FanInTrap from './components/FanInTrap.svelte';
  import { CATEGORIES, ENGINE_FACTS, DOCTOR, NODE_COUNT } from '../../lib/automation';

  const TONE = 'var(--success)';

  /** CATEGORIES' own `what`, compressed to one readout line. The full text is the hover title. */
  const WHAT: Record<string, string> = {
    trigger: 'A schedule, an arriving message, a webhook, or a person pressing go.',
    core: 'Call a model, call an API, send mail, read and write records.',
    control: 'Branch, loop, wait, dedupe, catch an error, hand off to another workflow.',
    integration: 'Mail, calendar, the house, health data, search, scraping, messaging — the outside world.',
    agentic: 'Delegated judgement: run an agent, route with a model, research a question, ask a person.',
    custom: 'Tools the system wrote for itself, registered live once they clear the gate.',
  };

  // Defaults to the kind that reaches outside the machine — the one the study is about.
  let cat = $state('integration');

  /** ENGINE_FACTS' own `why`, compressed to one readout line. No fact changed. */
  const WHY: Record<string, string> = {
    'Node types': 'Counted from the registrations in the registry, not from the palette.',
    'Registry parity': 'A registered type missing from the palette is invisible; the reverse is a dead entry. A test asserts they agree.',
    'Scheduling': 'A schedule naming no timezone now defaults to the owner’s, not the server’s. It did not always, and that cost an hour for half of every year.',
    'Palette': 'Not every registered type belongs on a menu: a handful are legacy and deliberately hidden.',
    'Resumability': 'A workflow paused on a human approval has to still be there tomorrow.',
    'New node types': 'The runner is a separately built bundle. Add a type without rebuilding it and the canvas offers something it cannot execute.',
  };

  // Defaults to the line most often got wrong: the palette is a view, not the registry.
  let fact = $state('Palette');

  /** DOCTOR's own `why`, compressed. The full text is the hover title. */
  const LEASH: Record<string, string> = {
    'Runs nightly': 'It sorts the day’s failed runs into config faults and wiring faults.',
    'A circuit breaker is on': 'An unlimited repairer breaks everything at once, quietly.',
    'Config edits are off': 'It may diagnose and report, never rewrite a workflow unattended.',
  };
</script>

<svelte:head>
  <title>Workflows · The Engine Room</title>
  <meta name="description" content="The join where two branches meet one node, and one of them silently disappears before the run starts." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="reach"
    title="Workflows"
    line="{NODE_COUNT} node types wire the system to itself. Where two branches meet at one node, one of them quietly ceases to exist, and everything downstream carries on as though nothing has happened."
    lineEli5="Automations are built from blocks joined with lines. Where two lines meet at one block, one of them can vanish without a word of warning — here you can make it happen where it costs nothing." />

  <Instrument
    kicker="The instrument"
    title="Two branches, one node"
    tone={TONE}
    reading="Two API calls into one node. Pick a wiring; watch what arrives."
    readingEli5="Two data sources feed one block. Pick a wiring and watch what actually arrives."
    takeaway="A daily spending summary managed this twice: one branch wiped the other, then three more collapsed into one. The build passed, the save passed, the editor looked delighted. The engine now names overlapping keys before a run, which it might have mentioned earlier."
    takeawayEli5="A real daily-spending summary lost data this way twice: one branch wiped out another, then three more collapsed into one — and everything looked fine throughout. The engine now names the clash before a run starts, so the mistake is caught while it is still free.">
    <FanInTrap tone={TONE} />
  </Instrument>

  <Instrument
    kicker="The catalogue"
    title="Six kinds of node"
    tone={TONE}
    reading="Pick a kind.">
    <div class="chips" role="group" aria-label="Node categories">
      {#each CATEGORIES as c (c.id)}
        <button class="chip" class:on={cat === c.id} aria-pressed={cat === c.id}
                title={c.what} onclick={() => (cat = c.id)}>{c.name}</button>
      {/each}
    </div>
    <p class="readout" aria-live="polite">{WHAT[cat]}</p>
  </Instrument>

  <Instrument
    kicker="The engine"
    title="Six lines about the runner"
    tone={TONE}
    reading="Pick one for why."
    readingEli5="Pick a line for the reason behind it.">
    <div class="kvs" role="group" aria-label="Facts about the workflow runner">
      {#each ENGINE_FACTS as f (f.k)}
        <button class="kv" class:on={fact === f.k} aria-pressed={fact === f.k}
                title={f.why} onclick={() => (fact = f.k)}>
          <span class="kv-k">{f.k}</span>
          <span class="kv-v">{f.v}</span>
        </button>
      {/each}
    </div>
    <p class="readout" aria-live="polite">{WHY[fact] ?? ENGINE_FACTS.find((f) => f.k === fact)?.why ?? ''}</p>

    <div class="band">
      <span class="band-lab">The nightly repairer</span>
      <ul class="leash">
        {#each DOCTOR as d (d.k)}
          <li title={d.why}><b>{d.k}</b><span>{LEASH[d.k]}</span></li>
        {/each}
      </ul>
    </div>
  </Instrument>

  <PageFoot />
</section>

<style>
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { font-family: inherit; font-size: var(--fs-label); font-weight: 600; line-height: 1.2;
    color: var(--text-primary); cursor: pointer; padding: 7px 13px;
    border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-pill);
    background: rgba(255,255,255,0.6); transition: background 0.13s, border-color 0.13s; }
  .chip:hover { background: rgba(28,22,17,0.07); border-color: rgba(28,22,17,0.36); }
  .chip.on { background: var(--success); border-color: var(--success); color: #fff; }

  .kvs { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 6px; }
  .kv { display: flex; flex-direction: column; gap: 3px; align-items: flex-start; text-align: left;
    padding: 8px 11px; min-width: 0; cursor: pointer; font-family: inherit;
    border: 1px solid rgba(28,22,17,0.16); border-left: 3px solid rgba(28,22,17,0.16);
    border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0; background: rgba(255,255,255,0.55);
    transition: background 0.13s, border-color 0.13s; }
  .kv:hover { background: rgba(255,255,255,0.9); border-color: rgba(28,22,17,0.34); }
  .kv.on { border-left-color: var(--success); background: color-mix(in srgb, var(--success) 9%, transparent); }
  .kv-k { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em;
    text-transform: uppercase; color: rgba(28,22,17,0.55); }
  .kv-v { font-size: var(--fs-label); font-weight: 600; line-height: 1.3; color: var(--text-primary);
    overflow-wrap: anywhere; }

  .readout { margin: 10px 0 0; font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.7);
    min-height: 2.6em; max-width: 82ch; }
  .readout::before { content: '▸ '; color: var(--success); }

  .band { margin-top: 13px; padding-top: 11px; border-top: 1px dashed rgba(28,22,17,0.18); }
  .band-lab { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--success); margin-bottom: 7px; }
  .leash { margin: 0; padding: 0; list-style: none; display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 8px; }
  .leash li { display: flex; flex-direction: column; gap: 2px; min-width: 0;
    padding-left: 10px; border-left: 2px solid color-mix(in srgb, var(--success) 40%, transparent); }
  .leash b { font-size: var(--fs-label); font-weight: 600; line-height: 1.3; color: var(--text-primary); }
  .leash span { font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.62); }

  @media (max-width: 380px) {
    .kvs, .leash { grid-template-columns: 1fr; }
  }
</style>
