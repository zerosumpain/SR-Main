<script lang="ts">
  // FEDERATION — presentation-style deck: full-bleed hero, viewport-height sim,
  // slide-scale headlines. The shared StoryMasthead/StorySection shell is
  // deliberately not used here — this section presents; the others document.
  import { app } from '../lib/appState.svelte';
  import { SCENARIOS, SCENARIO_GROUPS } from './lib/scenarios';
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

  const STATS = [
    { n: '24,000', l: 'providers' },
    { n: '15', l: 'MIS suppliers' },
    { n: '13', l: 'scenarios' },
    { n: '0', l: 'records in the middle' },
  ];
</script>

<svelte:head>
  <title>The Data Spine — the federated model, running</title>
  <meta name="description" content="An interactive Three.js simulation of a federated (X-Road-style) education data exchange for England: 24,000 schools, 15 MIS suppliers, and thirteen runnable scenarios from census day to breach day." />
</svelte:head>

<div class="fed-deck" data-section="federation-sim">
  <!-- SLIDE 1 — hero -->
  <header class="slide hero">
    <span class="kicker">Field study · The Data Spine · Federation</span>
    <h1>Twenty-four thousand schools.<br /><em>No central database.</em></h1>
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
      <button class="cta" onclick={() => sim?.run('census')}>▶ Run census day</button>
      <a class="cta ghost" href="#catalogue">Browse all thirteen ↓</a>
    </div>
  </header>

  <!-- SLIDE 2 — the model, full bleed -->
  <section class="slide-sim">
    <FederationSim bind:this={sim} />
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
      Supplier names are fictional; their market shape — three majors carrying ~80% of schools, a long tail down to
      self-hosted — mirrors the real market the <a href="/projects/data-spine/architecture">architecture section</a> documents with sources.
    </p>
  </section>

  <!-- SLIDE 4 — the argument, inverted band -->
  <section class="slide band">
    <p class="band-quote">Refusal. Auditability. Blast radius. Opt-out.<br /><em>Architectural facts before policy promises.</em></p>
  </section>

  <!-- SLIDE 5 — catalogue -->
  <section class="slide" id="catalogue">
    <span class="kicker">The scenario catalogue · synthetic</span>
    <h2>Thirteen mornings on the exchange</h2>
    <p class="slide-lede">
      {#if eli}
        Thirteen stories, four themes. Each card says what happens and what it proves. Press run and watch it play out above.
      {:else}
        Four movements — collections, frontline operations, the vendor economy, trust under stress — making one argument
        from thirteen directions: what matters about a federated spine is not throughput but <b>behaviour</b>. What it
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
        smallest participant can afford the on-ramp. And every number here is synthetic — real supplier names, real
        volumes and real legal decisions belong to the consultation, not to this page.
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
