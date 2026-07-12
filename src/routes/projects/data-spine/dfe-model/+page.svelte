<script lang="ts">
  // THE DFE MODEL — presentation-style deck (pattern: ../federation/+page.svelte).
  // How a DfE-run national model could work, layered up: the reference blueprint,
  // the edge-node anatomy and the two core flows rebuilt as interactive diagrams,
  // then the survey of national implementations and the policy reality check.
  // Content source: "Federated Working: National Implementations and Their
  // Underlying Models" (analysis paper, Parts I–III).
  import { app } from '../lib/appState.svelte';
  import { REQUIREMENTS, SURVEY_ARCHETYPES, OBSERVATIONS, COMMITMENTS, TENSIONS, STACK, RISKS } from './lib/model';
  import FabricDiagram from './components/FabricDiagram.svelte';
  import EdgeNodeDiagram from './components/EdgeNodeDiagram.svelte';
  import FlowsDiagram from './components/FlowsDiagram.svelte';

  const eli = $derived(app.narrative === 'eli5');

  const STATS = [
    { n: '24,000', l: 'providers at the edge' },
    { n: '7', l: 'archetypes surveyed' },
    { n: '25+', l: 'countries running X-Road' },
    { n: '0', l: 'pupil records held centrally' },
  ];
</script>

<svelte:head>
  <title>The Data Spine — how a DfE-run model could work</title>
  <meta name="description" content="An interactive blueprint for a DfE-operated education data fabric: the reference architecture layered up stage by stage, the edge-node anatomy, the two core flows, the national implementations it cherry-picks from, and the mapping to live DfE commitments." />
</svelte:head>

<div class="dm-deck" data-section="dfe-model">
  <!-- SLIDE 1 — hero -->
  <header class="slide hero">
    <span class="kicker">Field study · The Data Spine · The DfE model</span>
    <h1>Centralise the trust.<br /><em>Never the data.</em></h1>
    <p class="hero-lede">
      {#if eli}
        The government has promised a "data spine" run from the centre. Here is how a DfE-run model could
        actually work: the department keeps the rulebook, the phone book and the receipts — and every child's
        records stay in their school's own system. Built up layer by layer, from the systems other countries
        already run.
      {:else}
        The federation page runs the pattern; this page designs the programme. A survey of every major national
        federation deployment reduces to one question — <b>which primitive do you centralise?</b> — and the answer
        proposed here is the trust fabric: directory, consent, policy, ledger and identity under DfE stewardship,
        with pupil-level data held at source behind a default-deny connector. Layer the model up stage by stage,
        open up an edge node, and step through the only two flows the fabric permits.
      {/if}
    </p>
    <div class="hero-stats">
      {#each STATS as s}
        <div class="hs"><b>{s.n}</b><span>{s.l}</span></div>
      {/each}
    </div>
    <div class="hero-cta">
      <a class="cta" href="#blueprint">▾ Layer it up</a>
      <a class="cta ghost" href="#flows">The two flows ↓</a>
      <a class="cta ghost" href="#world">The world tour ↓</a>
    </div>
  </header>

  <!-- SLIDE 2 — the blueprint (Figure 1, interactive) -->
  <section class="slide" id="blueprint">
    <span class="kicker">The blueprint · HLD figure 1 · interactive</span>
    <h2>A thin national fabric, layered up</h2>
    <p class="slide-lede">
      {#if eli}
        Press <b>Next stage</b> to build the model one idea at a time. Each stage keeps replaying its animation
        until you move on — and once it's built, every box can be tapped to see what it does.
      {:else}
        The high-level design, assembled the way the argument runs: start from the estate England already has,
        add the trust boundary, then centralise only what is safe to centralise. Step through the six stages —
        each replays until you advance — then explore: every component carries its function, the national
        deployment it is cherry-picked from, and the standards that would implement it.
      {/if}
    </p>
    <FabricDiagram {eli} />
  </section>

  <!-- SLIDE 3 — edge node (Figure 2, interactive) -->
  <section class="slide" id="edge-node">
    <span class="kicker">Inside the boundary · HLD figure 2 · interactive</span>
    <h2>The connector <em>is</em> the trust boundary</h2>
    <p class="slide-lede">
      {#if eli}
        Zoom into one school. Its records stay in its own system; the connector is the guarded door everything
        must pass through — and the door starts locked.
      {:else}
        Every participant — MIS estate, school, trust or LA — runs the same open-source connector against its own
        systems. It maps the native schema to the common education data model, runs analytic queries in situ,
        enforces consent and policy before anything leaves, and signs every transaction into the national ledger.
        Certification against this one component replaces 24,000 bespoke integrations.
      {/if}
    </p>
    <EdgeNodeDiagram {eli} />
  </section>

  <!-- SLIDE 4 — the two flows (Figure 3, interactive) -->
  <section class="slide" id="flows">
    <span class="kicker">The two core flows · HLD figure 3 · interactive</span>
    <h2>Only two things ever happen</h2>
    <p class="slide-lede">
      {#if eli}
        Everything the fabric does is one of two stories. Step through each one — the current step keeps
        replaying until you press next.
      {:else}
        Every capability reduces to two flows, and both are fully logged. Flow A is the OpenSAFELY lesson applied
        to education: the analysis travels to the data and only aggregates return. Flow B is the deliberate
        exception — a rules-based, minimum-necessary PII release when a safeguarding or SEND threshold is met.
        They sit in different policy classes on purpose: opt-outs govern analytics; statutory duties can override
        consent under a rule, and the ledger is what makes any override accountable after the fact.
      {/if}
    </p>
    <FlowsDiagram {eli} />
  </section>

  <!-- SLIDE 5 — inverted band -->
  <section class="slide band">
    <p class="band-quote">Centralise the primitives that build trust.<br /><em>Federate everything that holds a child’s name.</em></p>
  </section>

  <!-- SLIDE 6 — cherry-picked requirements -->
  <section class="slide" id="requirements">
    <span class="kicker">The bill of materials</span>
    <h2>Every requirement, cherry-picked from a proven system</h2>
    <p class="slide-lede">
      {#if eli}
        Nothing here is invented. Each job the spine must do is borrowed from a country already doing it.
      {:else}
        The model is deliberately unoriginal: each requirement is met by lifting the best-fit element from a
        documented, operational national deployment and recomposing it for England's plural MIS estate.
      {/if}
    </p>
    <div class="req-grid">
      {#each REQUIREMENTS as r}
        <div class="req-card">
          <h4>{r.need}</h4>
          <p>{r.how}</p>
          <span class="req-from">↞ {r.from}</span>
        </div>
      {/each}
    </div>
  </section>

  <!-- SLIDE 7 — the world tour -->
  <section class="slide" id="world">
    <span class="kicker">Part I · the survey</span>
    <h2>Seven ways nations federate</h2>
    <p class="slide-lede">
      {#if eli}
        Other countries solved this years ago, in seven different flavours. The useful question is never
        "which product?" — it's "what did they put in the middle?"
      {:else}
        The principal national implementations of federated working, clustered by what actually crosses the
        organisational boundary and where trust is anchored. The useful question is rarely "which product"
        but <b>which primitive does each country centralise, and which does it push to the edge.</b>
      {/if}
    </p>
    {#each SURVEY_ARCHETYPES as a}
      <details class="arch">
        <summary>
          <span class="arch-no">{a.no}</span>
          <span class="arch-name">{a.name}</span>
          <span class="arch-short">{a.short}</span>
          <span class="arch-chev">▾</span>
        </summary>
        <p class="arch-what">{a.what}</p>
        <div class="impl-table" role="table">
          {#each a.impls as im}
            <div class="impl-row" role="row">
              <span class="impl-where">{im.where}</span>
              <div class="impl-body">
                <b>{im.system}</b>
                <p class="impl-tech">{im.tech}</p>
                <p class="impl-note">{im.note}</p>
              </div>
            </div>
          {/each}
        </div>
      </details>
    {/each}
    <div class="obs-grid">
      {#each OBSERVATIONS as o}
        <div class="obs-card">
          <h4>{o.title}</h4>
          <p>{o.body}</p>
        </div>
      {/each}
    </div>
  </section>

  <!-- SLIDE 8 — stack + risks -->
  <section class="slide" id="stack">
    <span class="kicker">Candidate stack · stated risks</span>
    <h2>Buildable — and honest about what could go wrong</h2>
    <div class="stack-risks">
      <div class="stack-col">
        <span class="col-lab">Candidate standards &amp; technology</span>
        {#each STACK as s}
          <div class="stack-row"><b>{s.layer}</b><p>{s.choice}</p></div>
        {/each}
      </div>
      <div class="risk-col">
        <span class="col-lab risk-lab">Open questions &amp; risks — designed for, not discovered later</span>
        {#each RISKS as r}
          <div class="risk-row"><b>{r.title}</b><p>{r.body}</p></div>
        {/each}
      </div>
    </div>
  </section>

  <!-- SLIDE 9 — policy reality check -->
  <section class="slide" id="policy">
    <span class="kicker">Part III · the reality check</span>
    <h2>The white papers don’t undercut this model — they commission it</h2>
    <p class="slide-lede">
      {#if eli}
        The government has already promised the spine, the child identifier and the information-sharing rules.
        What's still up for grabs is the architecture — and that's exactly where this model differs from
        building one big database.
      {:else}
        The Data Spine is committed policy; the Single Unique Identifier is in statute; MAIS is a live programme;
        Milburn has made the cross-sector case unavoidable. What remains genuinely contestable is architecture —
        the DfE's framing tilts toward centralised collection-and-linking, where the federated posture reaches
        the same ends with a materially stronger privacy and security story.
      {/if}
    </p>
    <div class="commit-list">
      {#each COMMITMENTS as c}
        <div class="commit-row">
          <div class="commit-what">
            <b>{c.what}</b>
            <span class="commit-src">{c.source}</span>
          </div>
          <p class="commit-align">{c.align}</p>
        </div>
      {/each}
    </div>
    <h3 class="tension-h">The tensions to design around</h3>
    <div class="tension-grid">
      {#each TENSIONS as t}
        <div class="tension-card">
          <h4>{t.title}</h4>
          <p>{t.body}</p>
        </div>
      {/each}
    </div>
    <p class="bottom-line">
      <b>Bottom line.</b> The safest way to deliver a national education data spine is to federate it — keep the
      data with its controllers, move questions rather than records, and make every disclosure provable.
    </p>
    <div class="next-row">
      <a class="pe-next" href="/projects/data-spine/governance">Next: who holds the rulebook — governance →</a>
    </div>
  </section>
</div>

<style>
  .dm-deck { width: 100%; }
  .slide { max-width: 1240px; margin: 0 auto; padding: clamp(48px, 8vh, 110px) clamp(16px, 3vw, 40px); scroll-margin-top: calc(var(--topH, 56px) + 46px); }

  .kicker { display: block; font-family: 'JetBrains Mono', monospace; font-size: clamp(10px, 1.1vw, 12px); letter-spacing: 0.26em; text-transform: uppercase; color: var(--accent-ink); margin-bottom: 18px; }

  /* hero */
  .hero { min-height: calc(82svh - var(--topH, 56px)); display: flex; flex-direction: column; justify-content: center; }
  .hero h1 { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(38px, 7vw, 90px); line-height: 1.02; letter-spacing: -0.03em; margin: 0 0 26px; color: var(--ink); }
  .hero h1 em { font-style: italic; color: var(--accent-ink); }
  .hero-lede { font-size: clamp(16px, 1.7vw, 21px); line-height: 1.55; color: rgba(28,22,17,0.74); max-width: 64ch; margin: 0 0 34px; }
  .hero-lede b { color: var(--ink); }
  .hero-stats { display: flex; gap: clamp(20px, 4vw, 56px); flex-wrap: wrap; margin-bottom: 38px; }
  .hs b { display: block; font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(30px, 3.6vw, 52px); line-height: 1; color: var(--ink); letter-spacing: -0.02em; }
  .hs span { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(28,22,17,0.5); }
  .hs:last-child b { color: var(--accent, #c4570a); }
  .hero-cta { display: flex; gap: 12px; flex-wrap: wrap; }
  .cta { display: inline-flex; align-items: center; gap: 8px; font-family: 'DM Sans', sans-serif; font-size: 15px; font-weight: 600; color: var(--paper, #f1ead6); background: var(--ink); border: 1.5px solid var(--ink); padding: 13px 24px; border-radius: var(--radius-round); cursor: pointer; text-decoration: none; }
  .cta:hover { background: #000; }
  .cta.ghost { background: transparent; color: var(--ink); }
  .cta.ghost:hover { background: rgba(28,22,17,0.07); }

  h2 { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(30px, 4.6vw, 60px); line-height: 1.04; letter-spacing: -0.025em; margin: 0 0 20px; color: var(--ink); }
  h2 em { font-style: italic; color: var(--accent-ink); }
  .slide-lede { font-size: clamp(15px, 1.5vw, 19px); line-height: 1.6; color: rgba(28,22,17,0.74); max-width: 74ch; margin: 0 0 34px; }
  .slide-lede b { color: var(--ink); }

  /* inverted band */
  .band { max-width: none; background: var(--ink); padding: clamp(64px, 12vh, 140px) clamp(16px, 3vw, 40px); }
  .band-quote { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(26px, 4.4vw, 58px); line-height: 1.14; letter-spacing: -0.02em; color: var(--paper, #f1ead6); max-width: 1100px; margin: 0 auto; text-align: center; }
  .band-quote em { font-style: italic; color: #d9a05e; }

  /* requirements */
  .req-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 14px; }
  .req-card { display: flex; flex-direction: column; border: 1px solid rgba(28,22,17,0.18); border-top: 3px solid var(--accent-ink-tint-35, rgba(14,91,102,0.35)); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 18px 20px; min-width: 0; }
  .req-card h4 { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(16px, 1.6vw, 20px); line-height: 1.15; margin: 0 0 8px; color: var(--ink); }
  .req-card p { font-size: 13px; line-height: 1.55; color: rgba(28,22,17,0.74); margin: 0 0 10px; }
  .req-from { margin-top: auto; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.04em; color: var(--accent-ink); }

  /* world tour */
  .arch { border: 1px solid rgba(28,22,17,0.18); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); margin-bottom: 10px; }
  .arch summary { display: flex; align-items: baseline; gap: 12px; cursor: pointer; list-style: none; padding: 14px 18px; }
  .arch summary::-webkit-details-marker { display: none; }
  .arch-no { flex: 0 0 auto; font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600; color: var(--paper, #f1ead6); background: var(--accent-ink); border-radius: var(--radius-sharp); padding: 2px 8px; }
  .arch-name { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(16px, 1.8vw, 21px); color: var(--ink); }
  .arch-short { font-size: 12.5px; font-style: italic; color: rgba(28,22,17,0.55); }
  .arch-chev { margin-left: auto; font-size: 11px; color: rgba(28,22,17,0.45); transition: transform 0.15s; }
  .arch[open] .arch-chev { transform: rotate(180deg); }
  .arch-what { font-size: 13.5px; line-height: 1.55; color: rgba(28,22,17,0.74); margin: 0; padding: 0 18px 12px; max-width: 90ch; }
  .impl-table { padding: 0 18px 16px; }
  .impl-row { display: flex; gap: 14px; padding: 10px 0; border-top: 1px dashed rgba(28,22,17,0.14); }
  .impl-where { flex: 0 0 170px; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; letter-spacing: 0.04em; color: var(--accent-ink); padding-top: 3px; }
  .impl-body { min-width: 0; }
  .impl-body b { font-family: 'Fraunces', serif; font-size: 15px; color: var(--ink); }
  .impl-tech { font-size: 12.5px; line-height: 1.5; color: rgba(28,22,17,0.7); margin: 3px 0 2px; }
  .impl-note { font-size: 12px; line-height: 1.5; font-style: italic; color: rgba(28,22,17,0.55); margin: 0; }
  .obs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; margin-top: 26px; }
  .obs-card { border: 1px solid rgba(28,22,17,0.18); border-left: 3px solid var(--accent-ink); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 14px 16px; }
  .obs-card h4 { font-family: 'Fraunces', serif; font-weight: 600; font-size: 15.5px; margin: 0 0 6px; color: var(--ink); }
  .obs-card p { font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.74); margin: 0; }

  /* stack + risks */
  .stack-risks { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  .col-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.14em; text-transform: uppercase; color: #2f7d4f; margin-bottom: 10px; }
  .col-lab.risk-lab { color: #8a2d3a; }
  .stack-col, .risk-col { border: 1px solid rgba(28,22,17,0.18); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 16px 18px; min-width: 0; }
  .stack-row, .risk-row { padding: 8px 0; border-top: 1px dashed rgba(28,22,17,0.14); }
  .stack-row b, .risk-row b { font-family: 'Fraunces', serif; font-size: 14.5px; color: var(--ink); }
  .stack-row p, .risk-row p { font-size: 12.5px; line-height: 1.5; color: rgba(28,22,17,0.72); margin: 3px 0 0; }

  /* policy */
  .commit-list { border: 1px solid rgba(28,22,17,0.18); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 4px 18px; }
  .commit-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: 6px 18px; padding: 12px 0; border-top: 1px dashed rgba(28,22,17,0.14); }
  .commit-row:first-child { border-top: none; }
  .commit-what b { font-family: 'Fraunces', serif; font-size: 15.5px; color: var(--ink); display: block; }
  .commit-src { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.03em; color: rgba(28,22,17,0.5); }
  .commit-align { font-size: 13px; line-height: 1.55; color: rgba(28,22,17,0.76); margin: 0; }
  .tension-h { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(19px, 2vw, 26px); margin: 34px 0 14px; color: var(--ink); }
  .tension-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
  .tension-card { border: 1px solid rgba(138,45,58,0.4); border-left: 3px solid #8a2d3a; border-radius: var(--radius-round); background: rgba(138,45,58,0.045); padding: 14px 16px; }
  .tension-card h4 { font-family: 'Fraunces', serif; font-weight: 600; font-size: 15.5px; margin: 0 0 6px; color: var(--ink); }
  .tension-card p { font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.76); margin: 0; }
  .bottom-line { margin: 30px 0 0; font-family: 'Fraunces', serif; font-size: clamp(17px, 1.9vw, 23px); line-height: 1.45; color: rgba(28,22,17,0.85); max-width: 80ch; }
  .bottom-line b { color: var(--accent-ink); }
  .next-row { margin-top: 44px; }

  @media (max-width: 860px) {
    .hero { min-height: calc(72svh - var(--topH, 56px)); }
    .stack-risks { grid-template-columns: 1fr; }
    .commit-row { grid-template-columns: 1fr; }
    .impl-where { flex-basis: 110px; }
  }
</style>
