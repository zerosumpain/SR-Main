<script lang="ts">
  // THE DFE MODEL — visual-first deck. One real question travels through the model,
  // beat by beat; every section is an interactive visual. Spine: "centralise the
  // trust, not the data". Source: "Federated Working: National Implementations and
  // Their Underlying Models" (analysis paper, Parts I–III).
  import { app } from '../lib/appState.svelte';
  import JourneyRail from './components/JourneyRail.svelte';
  import QuestionTravel from './components/QuestionTravel.svelte';
  import FabricDiagram from './components/FabricDiagram.svelte';
  import BrokerageGates from './components/BrokerageGates.svelte';
  import EdgeNodeDiagram from './components/EdgeNodeDiagram.svelte';
  import FlowsDiagram from './components/FlowsDiagram.svelte';
  import CrossDomainMap from './components/CrossDomainMap.svelte';
  import WorldTour from './components/WorldTour.svelte';
  import StackLayers from './components/StackLayers.svelte';
  import RiskStress from './components/RiskStress.svelte';
  import CommitmentsLedger from './components/CommitmentsLedger.svelte';

  const eli = $derived(app.narrative === 'eli5');
</script>

<svelte:head>
  <title>The Data Spine — how a DfE-run model could work</title>
  <meta name="description" content="A visual, interactive walkthrough of how a DfE-run education data model could work: one question travels into a thin national trust layer, fans out to the connectors, and only aggregates return — the edge node, the two flows, cross-domain federation, and the national precedents it is cherry-picked from." />
</svelte:head>

<JourneyRail />

<div class="dm-deck" data-section="dfe-model">
  <!-- BEAT 0 — hero: ask one question -->
  <header class="slide hero" id="ask" data-beat="ask">
    <span class="kicker">Field study · The Data Spine · The DfE model</span>
    <h1>Centralise the trust.<br /><em>Never the data.</em></h1>
    <p class="hero-lede">
      {#if eli}
        The government has promised a "data spine" run from the centre. Here is how it could work without a big
        new database: the DfE keeps the rulebook and the receipts, every child's records stay in their own school,
        and questions travel to the data instead of the other way round. Ask a question below and watch.
      {:else}
        The whole model in one move. A DfE-run spine does not need a central pool: the department runs a thin trust
        layer — directory, consent, rules, identity, ledger — and pupil records stay at the edge behind a
        default-deny connector. Ask one real question and watch it travel; the rest of the page follows that same
        question, beat by beat.
      {/if}
    </p>
    <QuestionTravel {eli} />
  </header>

  <!-- BEAT 1 — the terrain -->
  <section class="slide" id="terrain" data-beat="terrain">
    <span class="kicker">Beat 1 · The terrain · interactive</span>
    <h2>The ground the question crosses</h2>
    <p class="slide-lede">
      {#if eli}
        Build the model up one idea at a time. Start with the schools England already has, add a guarded door to
        each, then a small shared centre — and see there is no big database anywhere.
      {:else}
        The high-level design, assembled the way the argument runs: the estate England already has at the edge, a
        deliberately thin DfE brokerage in the middle, cross-domain reach to the side — and no central pool. Step
        through the six stages, then explore: every component carries its function, the national deployment it is
        cherry-picked from, and the standard that would implement it.
      {/if}
    </p>
    <FabricDiagram {eli} />
  </section>

  <!-- BEAT 2 — the front door -->
  <section class="slide" id="gates" data-beat="gates">
    <span class="kicker">Beat 2 · The front door · interactive</span>
    <h2>Five gates — and not one record held</h2>
    <p class="slide-lede">
      {#if eli}
        The question goes in through the small centre. It passes five checks — a phone book, a no-thank-you list, a
        rulebook, an ID check and a receipts log — and none of them keeps a single child's record.
      {:else}
        What the DfE actually runs is brokerage, not storage. The question clears five gates — catalogue, consent
        and opt-out, policy and rules, identity, and the immutable ledger — each authorising, filtering or logging,
        and none holding a record. This is precisely what a "centralised" model should centralise.
      {/if}
    </p>
    <BrokerageGates {eli} />
  </section>

  <!-- BEAT 3 — inside one connector -->
  <section class="slide" id="connector" data-beat="connector">
    <span class="kicker">Beat 3 · Inside one connector · interactive</span>
    <h2>The connector <em>is</em> the trust boundary</h2>
    <p class="slide-lede">
      {#if eli}
        Now zoom into one school. The question lands, runs against the records where they live, gets its small
        totals checked, and only the totals leave. The door starts locked.
      {:else}
        The question lands at one estate. Every participant runs the same open-source connector against its own
        records: it maps the schema, runs the analysis in situ, applies disclosure control, and signs the result
        into the ledger — records never cross the boundary. Certification against this one component replaces
        24,000 bespoke integrations.
      {/if}
    </p>
    <EdgeNodeDiagram {eli} />
  </section>

  <!-- BEAT 4 — the two endings -->
  <section class="slide" id="endings" data-beat="endings">
    <span class="kicker">Beat 4 · The two endings · interactive</span>
    <h2>Same question, two duties</h2>
    <p class="slide-lede">
      {#if eli}
        Everything the fabric does ends one of two ways: a safe total comes back (almost always), or — when a child
        is at risk — the minimum needed goes to a named professional, and it is always written down.
      {:else}
        Every capability reduces to two flows, both fully logged. Flow A is the OpenSAFELY lesson: the analysis
        travels to the data and only aggregates return. Flow B is the deliberate exception — a rules-based,
        minimum-necessary PII release when a safeguarding or SEND threshold is met. Different policy classes on
        purpose: opt-outs govern the total; a statutory duty can override consent under a logged rule.
      {/if}
    </p>
    <FlowsDiagram {eli} />
  </section>

  <!-- rhythm break -->
  <section class="slide band">
    <p class="band-quote">Centralise the primitives that build trust.<br /><em>Federate everything that holds a child’s name.</em></p>
  </section>

  <!-- BEAT 5 — beyond education -->
  <section class="slide" id="beyond" data-beat="beyond">
    <span class="kicker">Beat 5 · Beyond education · interactive</span>
    <h2>Federate — never pool</h2>
    <p class="slide-lede">
      {#if eli}
        Other services connect the same careful way. To find young people who've slipped out of every system, the
        fabric asks education, benefits and health at once and adds up the totals — without ever building one giant
        folder.
      {:else}
        Cross-domain reach is trust-federation, not a shared pool. Milburn's finding — over a million NEETs, most
        of them invisible across DfE, DWP and DHSC — is answerable by a no-PII query spanning three domains with no
        combined database ever created. Toggle the members, run the query, watch the join stay virtual and logged.
      {/if}
    </p>
    <CrossDomainMap {eli} />
  </section>

  <!-- BEAT 6 — borrowed from the world -->
  <section class="slide" id="borrowed" data-beat="borrowed">
    <span class="kicker">Beat 6 · Borrowed from the world · interactive</span>
    <h2>Nothing here is invented</h2>
    <p class="slide-lede">
      {#if eli}
        Other countries solved this years ago, seven different ways. Each job the spine must do is borrowed from a
        country already doing it — and England's version moves less data than any exchange on the line.
      {:else}
        Seven national archetypes, placed by what they centralise and how much data they move. Every requirement is
        lifted from a proven deployment; click a requirement to see which country it comes from, and where England's
        proposed model — centralising only trust — sits on the spectrum.
      {/if}
    </p>
    <WorldTour {eli} />
  </section>

  <!-- SUPPORTING — buildable -->
  <section class="slide" id="stack">
    <span class="kicker">Buildable · the candidate stack</span>
    <h2>An assembled stack of open standards</h2>
    <p class="slide-lede">
      {#if eli}
        None of this needs new science. It's a stack of standards that already exist — hover a layer to see which
        parts of the journey it holds up.
      {:else}
        Nothing on this page is blocked by cryptography. It is a stack of existing open standards, each layer
        load-bearing for specific beats of the journey — hover a layer to see which.
      {/if}
    </p>
    <StackLayers {eli} />
  </section>

  <!-- SUPPORTING — stress-test -->
  <section class="slide" id="risks">
    <span class="kicker">Stress-test · designed for, not discovered later</span>
    <h2>Every failure mode has a place that absorbs it</h2>
    <p class="slide-lede">
      {#if eli}
        Here's what could go wrong — and where in the design each problem is caught. Press on a risk to see the
        answer.
      {:else}
        The honest risks and tensions, each with the beat of the journey that absorbs it. Apply pressure to any one
        to see the mitigation the design already carries — and the residual question still open.
      {/if}
    </p>
    <RiskStress {eli} />
  </section>

  <!-- SUPPORTING — commissioned, not invented -->
  <section class="slide" id="policy">
    <span class="kicker">Commissioned, not invented · the alignment ledger</span>
    <h2>The white papers don’t undercut this — they commission it</h2>
    <p class="slide-lede">
      {#if eli}
        The government has already promised the spine, the child ID and the sharing rules. What's still open is the
        design — and that's exactly where this model differs from one big database.
      {:else}
        The Data Spine is committed policy; the Single Unique Identifier is in statute; MAIS is live; Milburn made
        the cross-sector case unavoidable. What remains contestable is architecture — and the federated posture
        reaches the same ends with a materially stronger privacy story. Each row maps a commitment to the model's
        answer and the beat it validates.
      {/if}
    </p>
    <CommitmentsLedger {eli} />
    <div class="next-row">
      <a class="pe-next" href="/projects/data-spine/governance">Next: who holds the rulebook — governance →</a>
    </div>
  </section>
</div>

<style>
  .dm-deck { width: 100%; }
  .slide { max-width: 1240px; margin: 0 auto; padding: clamp(40px, 6.5vh, 88px) clamp(16px, 3vw, 40px); scroll-margin-top: calc(var(--topH, 56px) + 92px); }

  .kicker { display: block; font-family: 'JetBrains Mono', monospace; font-size: clamp(10px, 1.1vw, 12px); letter-spacing: 0.26em; text-transform: uppercase; color: var(--accent-ink); margin-bottom: 16px; }

  /* hero */
  .hero { min-height: auto; }
  .hero h1 { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(38px, 7vw, 84px); line-height: 1.02; letter-spacing: -0.03em; margin: 0 0 22px; color: var(--ink); }
  .hero h1 em { font-style: italic; color: var(--accent-ink); }
  .hero-lede { font-size: clamp(16px, 1.7vw, 20px); line-height: 1.55; color: rgba(26,16,8,0.82); max-width: 66ch; margin: 0 0 28px; }
  .hero-lede b { color: var(--ink); }

  h2 { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(28px, 4.2vw, 52px); line-height: 1.05; letter-spacing: -0.025em; margin: 0 0 16px; color: var(--ink); }
  h2 em { font-style: italic; color: var(--accent-ink); }
  .slide-lede { font-size: clamp(15px, 1.5vw, 18px); line-height: 1.6; color: rgba(26,16,8,0.82); max-width: 74ch; margin: 0 0 28px; }
  .slide-lede b { color: var(--ink); }

  /* inverted band */
  .band { max-width: none; background: var(--ink); padding: clamp(56px, 10vh, 120px) clamp(16px, 3vw, 40px); }
  .band-quote { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(26px, 4.4vw, 56px); line-height: 1.14; letter-spacing: -0.02em; color: var(--paper, #f1ead6); max-width: 1100px; margin: 0 auto; text-align: center; }
  .band-quote em { font-style: italic; color: #d9a05e; }

  .next-row { margin-top: 32px; }

  @media (max-width: 860px) {
    .slide { scroll-margin-top: calc(var(--topH, 56px) + 84px); }
  }
</style>
