<script lang="ts">
  // FEDERATION — the running model: an interactive Three.js simulation of an
  // X-Road-style federated education data exchange, plus the scenario catalogue
  // and the honest limits of the argument.
  import { app } from '../lib/appState.svelte';
  import { SCENARIOS, SCENARIO_GROUPS } from './lib/scenarios';
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import StorySection from '../components/StorySection.svelte';
  import FederationSim from './components/FederationSim.svelte';

  const eli = $derived(app.narrative === 'eli5');
  let sim = $state<{ run: (id: string) => void }>();

  const GRAMMAR = [
    { term: 'The field of dots', means: '24,000 providers — every state school, college and AP setting, one dot each — clustered around the MIS supplier that holds their records. Blob size is market share.' },
    { term: 'The pylons', means: 'Supplier gateways: the X-Road “security server” idea. Each estate answers queries through exactly one guarded door.' },
    { term: 'The ring', means: 'The exchange layer. Deliberately drawn as a ring, not a hub: it is protocol, not storage. The relays verify, enforce and stamp — they hold no record content.' },
    { term: 'The obelisk', means: 'The audit ledger at the heart of the ring — every query stamped, citizen-readable. Estonia’s best export, whatever the architecture.' },
    { term: 'The upper shapes', means: 'Consumers: DfE, 153 local authorities, children’s social care, accredited research, Ofsted, the learner-held Education Record — and other departments arriving with MoUs.' },
    { term: 'The red cylinder', means: 'The counterfactual. Flip to “Central store” and the same traffic becomes bulk copies into one national database — the design England built once and switched off.' },
  ];
</script>

<svelte:head>
  <title>The Data Spine — the federated model, running</title>
  <meta name="description" content="An interactive Three.js simulation of a federated (X-Road-style) education data exchange for England: 24,000 schools, 15 MIS suppliers, and thirteen scenarios from census day to breach day." />
</svelte:head>

<div class="pe-route wide" data-section="federation-sim">
  <StoryMasthead
    kicker="Field study · The Data Spine · Federation"
    title="The federated spine, running"
    thesis="The architecture pages argue that pointers beat warehouses. This page stops arguing and runs it: a live model of an Estonian-style federated exchange laid over England's actual school-data geography — 24,000 providers, three dominant MIS suppliers and a long tail of twelve more. Thirteen scenarios play out what the DfE, a council, a social worker, a researcher — and an attacker — would actually experience. Everything is synthetic; the shape is real."
    thesisEli5="Instead of describing the no-big-database design, this page lets you watch it work. Every dot is a school; the coloured sparks are questions and answers. Run the scenarios: census day, a child moving school, a hacker, a family saying no."
    asks={[
      'What does a federated analytic request physically look like — and what never leaves the school’s MIS?',
      'Where do MIS suppliers, councils and children’s social care sit in the network, and what does each get back?',
      'What changes when the same morning is replayed against a central store instead?',
    ]}
    askLabel="What this simulation shows" />

  <FederationSim bind:this={sim} />

  <!-- How to read the model -->
  <StorySection title="How to read the model">
    {#snippet prose()}
      <p class="pe-prose">
        {#if eli}
          Six things to spot. Drag to orbit, click anything to inspect it, and watch the colours: petrol questions travel out,
          green answers come back, orange means actual record content is moving — which should be rare — and red means someone was told no.
        {:else}
          The composition is vertical on purpose: it restates the briefing's five-layer anatomy as geometry. Records live at the
          bottom and <b>stay there</b>; the exchange layer is a ring because federation has no centre; consumers sit above the ring
          but crucially not above each other — the DfE is a member of the network, not its owner. The colour language does the
          analytical work: watch how rarely orange (record content) needs to cross the exchange, and what happens to the
          pupil-level counter while whole national collections complete in green.
        {/if}
      </p>
      <p class="pe-prose">
        The supplier names are fictional; their market shape — three majors carrying ~80% of schools, a mid pack of
        specialists, a long tail down to self-hosted — mirrors the real market the
        <a href="/projects/data-spine/architecture">architecture section</a> documents with sources.
      </p>
    {/snippet}
    {#snippet data()}
      <div class="grammar">
        {#each GRAMMAR as g}
          <div class="gr-row">
            <b>{g.term}</b>
            <p>{g.means}</p>
          </div>
        {/each}
      </div>
    {/snippet}
  </StorySection>

  <!-- Scenario catalogue -->
  <h2 class="pe-h2">The scenario catalogue</h2>
  <p class="pe-prose catalogue-intro">
    {#if eli}
      Thirteen stories, four themes. Each card says what happens and what it proves. Press run and watch it play out above.
    {:else}
      Thirteen scenarios in four movements — collections, frontline operations, the vendor economy, and trust under stress.
      Together they make one argument from thirteen directions: the interesting properties of a federated spine are not
      throughput but <b>behaviour</b> — what it refuses, what it logs, what it returns when broken, and who gets value back.
    {/if}
  </p>
  {#each SCENARIO_GROUPS as g}
    <h3 class="sc-heading">{g}</h3>
    <div class="ds-grid">
      {#each SCENARIOS.filter((s) => s.group === g) as s}
        <div class="ds-card sc-card">
          <h3>{s.title}</h3>
          <span class="sc-tagline">{s.tagline}</span>
          <p class="ds-body">{s.description}</p>
          <p class="ds-body sc-lesson"><b>What it argues:</b> {s.lesson}</p>
          <button class="sc-run" onclick={() => sim?.run(s.id)}>▶ Run this scenario</button>
        </div>
      {/each}
    </div>
  {/each}

  <!-- Honest limits -->
  <StorySection title="What the model argues — and what it honestly can’t">
    {#snippet prose()}
      <p class="pe-prose">
        {#if eli}
          This is a toy — a careful one. It shows how the pieces would talk to each other, not that Britain could build it.
          The genuinely hard parts are people agreeing on rules, and 24,000 organisations actually plugging in. Estonia is
          twenty times smaller than England’s school system alone.
        {:else}
          A simulation of message-passing proves the <b>mechanics</b>, and the mechanics are the easy part. The precedent
          record is blunt about where federations actually strain: X-Road's hard problem was never cryptography but
          institutional agreement — and Estonia federates 1.3m people with one civil register, where England's education
          system alone has 24,000 providers and no shared identifier yet in operation. The long tail in this model
          (Bracken's rural federations, Whitloe's nurseries, the self-hosted cluster) is drawn deliberately: any real spine
          lives or dies on whether the smallest participant can afford the on-ramp.
        {/if}
      </p>
      <p class="pe-prose">
        {#if eli}
          Also: every number here is made up. Real supplier names, real query volumes and real legal decisions belong to the
          consultation, not to this page.
        {:else}
          And the disclaimers that keep this honest: all data is synthetic and every supplier fictional; the scenarios encode
          <b>this project's</b> reading of the governance argument, not any government design; and the white paper has
          committed to none of it — the consultation is where these behaviours would be won or lost. What the model does
          establish is that the properties people actually argue about — refusal, auditability, blast radius, opt-out — are
          <b>architectural</b> facts before they are policy promises.
        {/if}
      </p>
    {/snippet}
    {#snippet data()}
      <div class="limit-cards">
        <div class="ds-card limit">
          <h3>Proven by the model</h3>
          <p class="ds-body">Aggregate collections with zero record movement · point-to-point transfer under a basis · refusal enforced at the edge · bounded breach exposure · opt-outs honoured at source · partial answers labelled partial.</p>
        </div>
        <div class="ds-card limit hard">
          <h3>Not provable here</h3>
          <p class="ds-body">Whether institutions agree the rules · whether the long tail can afford gateways · identity resolution quality (the consistent-identifier question) · funding and custodianship · whether "privacy-respecting" survives contact with procurement.</p>
        </div>
      </div>
    {/snippet}
  </StorySection>

  <div class="next-row">
    <a class="pe-next" href="/projects/data-spine/governance">Next: the part nobody has designed — governance →</a>
  </div>
</div>

<style>
  .grammar { display: flex; flex-direction: column; gap: 8px; }
  .gr-row { border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 10px 14px; }
  .gr-row b { font-family: 'Fraunces', serif; font-size: 14.5px; }
  .gr-row p { font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.72); margin: 3px 0 0; }

  .catalogue-intro { max-width: 90ch; }
  .sc-heading { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--accent-ink); margin: 22px 0 4px; }
  .sc-card { display: flex; flex-direction: column; border-top: 3px solid var(--accent-ink-tint-35, rgba(14,91,102,0.35)); }
  .sc-tagline { font-size: 12px; font-style: italic; color: rgba(28,22,17,0.58); margin-bottom: 4px; }
  .sc-lesson { margin-top: 8px; margin-bottom: 12px; }
  .sc-run { margin-top: auto; align-self: flex-start; background: var(--ink); color: var(--paper, #f1ead6); border: none; border-radius: var(--radius-round); font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600; padding: 7px 13px; cursor: pointer; }
  .sc-run:hover { background: #000; }

  .limit-cards { display: flex; flex-direction: column; gap: 12px; }
  .ds-card.limit { border-left: 3px solid #2f7d4f; }
  .ds-card.limit.hard { border-left-color: #8a2d3a; }

  .next-row { margin: 26px 0 16px; }
</style>
