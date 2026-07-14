<script lang="ts">
  // FEDERATION — presentation-style deck: full-bleed hero, viewport-height sim,
  // slide-scale headlines. The shared StoryMasthead/StorySection shell is
  // deliberately not used here — this section presents; the others document.
  import { app } from '../lib/appState.svelte';
  import { SCENARIOS, SCENARIO_GROUPS } from '$lib/sim/federation/scenarios';
  import { SUPPLIERS, DEFAULT_SCHOOL_COUNT } from '$lib/sim/federation/topology';
  import { JOIN_QUERIES } from '$lib/sim/federation/joins';
  import { STANDARDS } from '../lib/standards';

  const totalDots = DEFAULT_SCHOOL_COUNT.toLocaleString('en-GB');
  import type { Scenario } from '$lib/sim/federation/engine';
  import FederationSim from '$lib/sim/federation/FederationSim.svelte';
  import AskFederation from './components/AskFederation.svelte';

  const eli = $derived(app.narrative === 'eli5');
  let sim = $state<{ run: (id: string) => void; runScenario: (s: Scenario) => void }>();

  // when a catalogue scenario with a linked query runs, mirror its anatomy in
  // the ask-the-federation explorer below — a fresh object per run so replays
  // of the same scenario still re-fire the mirror effect
  let activeQuery = $state<{ id: string } | null>(null);
  function onActiveScenario(s: Scenario | null) {
    if (s?.queryId) activeQuery = { id: s.queryId };
  }

  const GRAMMAR = [
    { term: 'The field of dots', means: `${totalDots} providers — one dot per real English school, clustered around the MIS supplier that holds its records. Cluster size is each vendor's real school count (WhichMIS Oct-2025 census), so Arbor's field dwarfs the long tail because it genuinely does.` },
    { term: 'The far island', means: 'The second context space: 153 local authorities and their case systems — social care, SEND, admissions, alternative provision, the CME register. A cross-context question (schools × LAs) must cross to this island, and meet the identity resolver on the way.' },
    { term: 'The pylons', means: 'Supplier gateways: the X-Road “security server” idea. Each estate answers queries through exactly one guarded door. The names are the real market — Arbor, ESS SIMS, Bromcom, ScholarPack, down to the self-hosted long tail.' },
    { term: 'The ring', means: 'The exchange layer. Deliberately drawn as a ring, not a hub: it is protocol, not storage. The relays verify, enforce and stamp — they hold no record content.' },
    { term: 'The obelisk', means: 'The audit ledger at the heart of the ring — every query stamped, citizen-readable. Estonia’s best export, whatever the architecture.' },
    { term: 'The upper shapes', means: 'Consumers: DfE, 153 local authorities, children’s social care, accredited research, Ofsted — and the learner-held Education Record, wired through the DfE gateway that operates it, not straight to the ring.' },
    { term: 'The satellites', means: 'The department’s existing stores orbiting the DfE — NPD, LEO, ILR, LDS. Drawn honestly: this is the central estate a federation would progressively relieve, not pretend never existed.' },
    { term: 'The ring · Apps', means: 'Flip the ring to Apps: CPOMS, Satchel One, Sparx, TT Rock Stars, Tapestry and friends as certified spurs on the exchange — imagined contributors of aggregate intelligence, never account data. Toggle “reach” to overlay each platform’s approximate school count.' },
    { term: 'The ring · Brokers', means: 'Flip the ring to Brokers to see how school data actually moves today: the MIS access brokers — Wonde, Groupcall Xporter, Assembly, Salamander — that hold bulk-access deals with every MIS and resell the feed. A federation would invert them from middlemen into certified gateways answering under contract.' },
    { term: 'The red cylinder', means: 'The counterfactual. Flip to “Central store” and the same traffic becomes bulk copies into one national database — the design England built once and switched off.' },
  ];

  // the two array-count stats derive from the arrays they claim to count
  const STATS = [
    { n: totalDots, l: 'real schools' },
    { n: String(SUPPLIERS.length), l: 'MIS suppliers' },
    { n: `${SCENARIOS.length}+${JOIN_QUERIES.length}`, l: 'scenarios & joins' },
    { n: '0', l: 'records in the middle' },
  ];

  // STANDARDS moved to lib/standards.ts (also rendered on /next) — single source.
</script>

<svelte:head>
  <title>The Data Spine — the federated model, running</title>
  <meta name="description" content="An interactive Three.js simulation of a federated (X-Road-style) education data exchange for England: ~22,600 schools clustered by their real MIS vendor, a local-authority context space, fourteen scenarios from census day to breach day, plus cross-context join queries that resolve a school UPN to an LA case ID with an honest match confidence." />
</svelte:head>

<div class="fed-deck" data-section="federation-sim">
  <!-- SLIDE 1 — hero -->
  <header class="slide hero">
    <span class="kicker">Field study · The Data Spine · Federation</span>
    <h1>Every English school.<br /><em>No central database.</em></h1>
    <p class="hero-lede">
      {#if eli}
        The no-big-database design from the architecture section — running. Every dot is a school. The sparks are
        questions and answers. Press play on a scenario: census day, a child moving school, a hacker, a family saying no.
      {:else}
        The architecture pages argue that pointers beat warehouses. This page stops arguing and runs it: Estonia's
        X-Road pattern laid over England's real school-data geography. Pick a scenario — watch what moves,
        what stays put, and what gets refused.
      {/if}
    </p>
    <div class="hero-stats">
      {#each STATS as s}
        <div class="hs"><b>{s.n}</b><span>{s.l}</span></div>
      {/each}
    </div>
    <div class="hero-cta">
      <a class="cta" href="/projects/data-spine/federation/sim">⛶ Open the full-screen simulation ↗</a>
      <a class="cta ghost" href="#ask">Ask the federation ↓</a>
      <a class="cta ghost" href="#catalogue">Browse the scenarios ↓</a>
    </div>
  </header>

  <!-- SLIDE 2 — the model, full bleed -->
  <section class="slide-sim">
    <FederationSim bind:this={sim} {onActiveScenario} />
  </section>

  <!-- SLIDE 2.5 — ask the federation -->
  <section class="slide" id="ask">
    <span class="kicker">Ask the federation · query anatomy</span>
    <h2>Central government asks. Watch the whole exchange.</h2>
    <p class="slide-lede">
      {#if eli}
        Pick a real question the government might ask. Some questions the law says schools' systems must answer;
        others they can politely refuse. Press the button, watch the sparks fly above — then read exactly what the
        question looked like as code, what each supplier sent back, and what the department actually received.
      {:else}
        The scenarios above are scripted; this is the same machinery with the hood off. Choose a question, choose who
        opts out, and put it to the federation: the network above plays the fan-out while the panels below show the
        <b>full anatomy</b> — the signed query as it travels, every estate's partial response at component level, and
        the assembled return that lands at the DfE. The guardrail is the point: a statutory basis compels an answer
        (objections are logged, not obeyed); a voluntary ask can be declined, and the answer comes back smaller and
        says so.
      {/if}
    </p>
    <AskFederation onRunScenario={(s) => sim?.runScenario(s)} externalQuery={activeQuery} />
  </section>

  <!-- SLIDE 3 — how to read it -->
  <section class="slide">
    <span class="kicker">The visual grammar</span>
    <h2>How to read it</h2>
    <p class="slide-lede">
      {#if eli}
        Six things to spot. Drag to orbit, click anything to inspect it — and watch the colours: petrol questions go
        out, green answers come back, orange means real record content is moving (rare, on purpose), red means no.
      {:else}
        The composition restates the briefing's five-layer anatomy as geometry: records live at the bottom and
        <b>stay there</b>; the exchange is a ring because federation has no centre; the DfE sits above the ring but
        not above the other members. The colours do the analytical work — watch how rarely orange crosses the exchange.
      {/if}
    </p>
    <div class="grammar">
      {#each GRAMMAR as g}
        <div class="gr-row">
          <b>{g.term}</b>
          <p>{g.means}</p>
        </div>
      {/each}
    </div>
    <p class="fine">
      Supplier and platform names are real; per-vendor school counts are the WhichMIS October 2025 census (the
      independent / early-years / bespoke long tail is indicative), and every behaviour simulated on them — outages,
      queues, breaches, opt-outs — is illustrative, not a depiction of any real event. The market shape (three majors
      carrying ~92% of state schools, a long tail down to self-hosted) mirrors what the
      <a href="/projects/data-spine/architecture">architecture section</a> documents with sources.
    </p>
  </section>

  <!-- SLIDE 4 — the argument, inverted band -->
  <section class="slide band">
    <p class="band-quote">Refusal. Auditability. Blast radius. Opt-out.<br /><em>Architectural facts before policy promises.</em></p>
  </section>

  <!-- SLIDE 5 — catalogue -->
  <section class="slide" id="catalogue">
    <span class="kicker">The scenario catalogue · synthetic</span>
    <h2>Fourteen mornings on the exchange</h2>
    <p class="slide-lede">
      {#if eli}
        Fourteen stories, four themes. Each card says what happens and what it proves. Press run, then step through it
        above — each stage replays until you move on.
      {:else}
        Four movements — collections, frontline operations, the vendor economy, trust under stress — making one argument
        from fourteen directions: what matters about a federated spine is not throughput but <b>behaviour</b>. What it
        refuses. What it logs. What it returns when broken. Who gets value back.
      {/if}
    </p>
    {#each SCENARIO_GROUPS as g}
      <h3 class="sc-heading">{g}</h3>
      <div class="sc-grid">
        {#each SCENARIOS.filter((s) => s.group === g) as s}
          <div class="sc-card">
            <h4>{s.title}</h4>
            <span class="sc-tagline">{s.tagline}</span>
            <p class="sc-desc">{s.description}</p>
            <p class="sc-lesson"><b>What it argues:</b> {s.lesson}</p>
            <button class="sc-run" onclick={() => sim?.run(s.id)}>▶ Run this scenario</button>
          </div>
        {/each}
      </div>
    {/each}
  </section>

  <!-- SLIDE 5.5 — the standards stack -->
  <section class="slide" id="standards">
    <span class="kicker">The standards stack</span>
    <h2>What it would take to make this real</h2>
    <p class="slide-lede">
      {#if eli}
        For all these systems to talk to each other, everyone has to agree the rules first: how to name a child once,
        how to describe a record, how to ask a question, how to prove who asked, how to say no, and why anyone would
        bother joining. Some of those rules exist already. The interesting column is what's missing.
      {:else}
        Nothing on this page is blocked by cryptography. All of it is blocked by <b>agreement</b> — six layers of
        standards, each with pieces that already exist and pieces nobody has written. This is the honest bill of
        materials: what England already has on the shelf, and what a federation would have to standardise before the
        first real query crosses a real exchange.
      {/if}
    </p>
    <div class="std-grid">
      {#each STANDARDS as s}
        <div class="std-card">
          <span class="std-k">{s.k}</span>
          <h3>{s.title}</h3>
          <div class="std-col have">
            <span class="std-h">Exists today</span>
            <ul>
              {#each s.have as item}<li>{item}</li>{/each}
            </ul>
          </div>
          <div class="std-col miss">
            <span class="std-h">Missing</span>
            <ul>
              {#each s.miss as item}<li>{item}</li>{/each}
            </ul>
          </div>
        </div>
      {/each}
    </div>
    <p class="fine">
      The pattern to steal is procedural, not technical: X-Road’s protocol and trust rules are open and versioned;
      Ed-Fi and 1EdTech publish conformance suites vendors certify against. England has schemas and circulars —
      what it lacks is the registry, the contract format, and the certification loop that make standards enforceable
      at a gateway instead of negotiable in a meeting.
    </p>
  </section>

  <!-- SLIDE 6 — honest limits -->
  <section class="slide">
    <span class="kicker">Honest limits</span>
    <h2>What it proves — and what it honestly can’t</h2>
    <p class="slide-lede">
      {#if eli}
        This is a toy — a careful one. It shows how the pieces would talk to each other, not that Britain could build
        it. The hard parts are people agreeing rules, and 24,000 organisations actually plugging in. Estonia is twenty
        times smaller than England's school system alone.
      {:else}
        A simulation of message-passing proves the <b>mechanics</b>, and the mechanics are the easy part. X-Road's hard
        problem was never cryptography but institutional agreement — and Estonia federates 1.3m people with one civil
        register, where England's education system alone has 24,000 providers and no shared identifier yet in
        operation. The long tail in this model is drawn deliberately: a real spine lives or dies on whether the
        smallest participant can afford the on-ramp. The supplier names are real but every number and behaviour is
        synthetic — real volumes, real integration commitments and real legal decisions belong to the consultation,
        not to this page.
      {/if}
    </p>
    <div class="limit-cards">
      <div class="limit">
        <h3>Proven by the model</h3>
        <p>Aggregate collections with zero record movement · point-to-point transfer under a basis · refusal enforced at the edge · bounded breach exposure · opt-outs honoured at source · partial answers labelled partial.</p>
      </div>
      <div class="limit hard">
        <h3>Not provable here</h3>
        <p>Whether institutions agree the rules · whether the long tail can afford gateways · identity resolution quality · funding and custodianship · whether “privacy-respecting” survives contact with procurement.</p>
      </div>
    </div>
    <div class="next-row">
      <a class="pe-next" href="/projects/data-spine/governance">Next: the part nobody has designed — governance →</a>
    </div>
  </section>
</div>

<style>
  .fed-deck { width: 100%; }
  .slide { max-width: 1240px; margin: 0 auto; padding: clamp(48px, 8vh, 110px) clamp(16px, 3vw, 40px); scroll-margin-top: calc(var(--topH, 56px) + 46px); }

  .kicker { display: block; font-family: 'JetBrains Mono', monospace; font-size: clamp(10px, 1.1vw, 12px); letter-spacing: 0.26em; text-transform: uppercase; color: var(--accent-ink); margin-bottom: 18px; }

  /* SLIDE 1 — hero */
  .hero { min-height: calc(88svh - var(--topH, 56px)); display: flex; flex-direction: column; justify-content: center; }
  .hero h1 { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(38px, 7.2vw, 92px); line-height: 1.02; letter-spacing: -0.03em; margin: 0 0 26px; color: var(--ink); }
  .hero h1 em { font-style: italic; color: var(--accent-ink); }
  .hero-lede { font-size: clamp(16px, 1.7vw, 21px); line-height: 1.55; color: rgba(28,22,17,0.74); max-width: 62ch; margin: 0 0 34px; }
  .hero-stats { display: flex; gap: clamp(20px, 4vw, 56px); flex-wrap: wrap; margin-bottom: 38px; }
  .hs b { display: block; font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(30px, 3.6vw, 52px); line-height: 1; color: var(--ink); letter-spacing: -0.02em; }
  .hs span { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(28,22,17,0.5); }
  .hs:last-child b { color: var(--accent, #c4570a); }
  .hero-cta { display: flex; gap: 12px; flex-wrap: wrap; }
  .cta { display: inline-flex; align-items: center; gap: 8px; font-family: 'DM Sans', sans-serif; font-size: 15px; font-weight: 600; color: var(--paper, #f1ead6); background: var(--ink); border: 1.5px solid var(--ink); padding: 13px 24px; border-radius: var(--radius-round); cursor: pointer; text-decoration: none; }
  .cta:hover { background: #000; }
  .cta.ghost { background: transparent; color: var(--ink); }
  .cta.ghost:hover { background: rgba(28,22,17,0.07); }

  /* SLIDE 2 — full-bleed sim */
  .slide-sim { padding: 0; margin: 0; }

  /* shared slide headline scale */
  h2 { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(30px, 4.6vw, 60px); line-height: 1.04; letter-spacing: -0.025em; margin: 0 0 20px; color: var(--ink); }
  .slide-lede { font-size: clamp(15px, 1.5vw, 19px); line-height: 1.6; color: rgba(28,22,17,0.74); max-width: 72ch; margin: 0 0 34px; }
  .slide-lede b { color: var(--ink); }

  .grammar { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 14px; }
  .gr-row { border: 1px solid rgba(28,22,17,0.18); border-top: 3px solid var(--accent-ink-tint-35, rgba(14,91,102,0.35)); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 18px 20px; }
  .gr-row b { font-family: 'Fraunces', serif; font-size: clamp(17px, 1.6vw, 21px); }
  .gr-row p { font-size: 13.5px; line-height: 1.6; color: rgba(28,22,17,0.72); margin: 7px 0 0; }
  .fine { font-size: 12.5px; color: rgba(28,22,17,0.58); margin-top: 26px; max-width: 84ch; }
  .fine a { color: var(--accent-ink); }

  /* SLIDE 4 — inverted band */
  .band { max-width: none; background: var(--ink); padding: clamp(64px, 12vh, 140px) clamp(16px, 3vw, 40px); }
  .band-quote { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(26px, 4.4vw, 58px); line-height: 1.14; letter-spacing: -0.02em; color: var(--paper, #f1ead6); max-width: 1100px; margin: 0 auto; text-align: center; }
  .band-quote em { font-style: italic; color: #d9a05e; }

  /* SLIDE 5 — catalogue */
  .sc-heading { font-family: 'JetBrains Mono', monospace; font-size: clamp(11px, 1.2vw, 13px); letter-spacing: 0.2em; text-transform: uppercase; color: var(--accent-ink); margin: 40px 0 12px; border-bottom: 1px solid rgba(28,22,17,0.14); padding-bottom: 8px; }
  .sc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 16px; }
  .sc-card { display: flex; flex-direction: column; border: 1px solid rgba(28,22,17,0.18); border-top: 3px solid var(--accent-ink-tint-35, rgba(14,91,102,0.35)); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 20px 22px; min-width: 0; }
  .sc-card h4 { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(20px, 2vw, 26px); line-height: 1.1; letter-spacing: -0.015em; margin: 0 0 6px; color: var(--ink); }
  .sc-tagline { font-size: 13.5px; font-style: italic; color: rgba(28,22,17,0.58); margin-bottom: 10px; }
  .sc-desc { font-size: 13.5px; line-height: 1.55; color: rgba(28,22,17,0.74); margin: 0; }
  .sc-lesson { font-size: 13px; line-height: 1.55; color: rgba(28,22,17,0.74); margin: 10px 0 14px; }
  .sc-lesson b { color: var(--ink); }
  .sc-run { margin-top: auto; align-self: flex-start; background: var(--ink); color: var(--paper, #f1ead6); border: none; border-radius: var(--radius-round); font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600; padding: 9px 16px; cursor: pointer; }
  .sc-run:hover { background: #000; }

  /* SLIDE 5.5 — standards stack */
  .std-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; }
  .std-card { border: 1px solid rgba(28,22,17,0.18); border-top: 3px solid var(--accent-ink-tint-35, rgba(14,91,102,0.35)); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 20px 22px; min-width: 0; }
  .std-k { display: block; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.22em; color: var(--accent-ink); margin-bottom: 4px; }
  .std-card h3 { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(19px, 1.9vw, 24px); line-height: 1.12; letter-spacing: -0.015em; margin: 0 0 12px; color: var(--ink); }
  .std-col { margin-bottom: 10px; }
  .std-h { display: block; font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 4px; }
  .std-col.have .std-h { color: #2f7d4f; }
  .std-col.miss .std-h { color: #8a2d3a; }
  .std-col ul { list-style: none; margin: 0; padding: 0; }
  .std-col li { font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.74); padding: 2px 0 2px 14px; position: relative; }
  .std-col.have li::before { content: '·'; position: absolute; left: 2px; color: #2f7d4f; font-weight: 700; }
  .std-col.miss li::before { content: '·'; position: absolute; left: 2px; color: #8a2d3a; font-weight: 700; }
  .std-col.miss li { color: rgba(28,22,17,0.82); }

  /* SLIDE 6 — limits */
  .limit-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .limit { border: 1px solid rgba(28,22,17,0.18); border-left: 4px solid #2f7d4f; border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 20px 22px; }
  .limit.hard { border-left-color: #8a2d3a; }
  .limit h3 { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(19px, 1.9vw, 24px); margin: 0 0 8px; }
  .limit p { font-size: 13.5px; line-height: 1.6; color: rgba(28,22,17,0.74); margin: 0; }
  .next-row { margin-top: 44px; }

  @media (max-width: 760px) {
    .hero { min-height: calc(76svh - var(--topH, 56px)); }
    .limit-cards { grid-template-columns: 1fr; }
    .sc-grid { grid-template-columns: 1fr; }
  }
</style>
