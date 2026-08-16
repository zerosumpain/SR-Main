<script lang="ts">
  // TRACE A REQUEST — the 2-D companion to the 3-D federation simulator.
  //
  // The simulator answers "what shape is this network?". This page answers "what
  // actually happens, in what order, at every layer of the stack — and how long does
  // each part really take?". It is built to be read top-to-bottom by someone who has
  // never seen the project, at whichever depth they choose.
  import { LAYERS, DEPTHS, SCENARIOS, STAGES, type Depth } from './lib/trace';
  import RequestTrace from './components/RequestTrace.svelte';
  import TimeLedger from './components/TimeLedger.svelte';
  import MethodsMatrix from './components/MethodsMatrix.svelte';
  import SupplyFlywheel from './components/SupplyFlywheel.svelte';

  // Page-local depth control — a real gradient, not the site-wide Research/ELI5 binary.
  // Deliberately not seeded from localStorage: the layout restores its own narrative
  // setting after this component mounts, and a client-only seed would desync hydration.
  let depth = $state<Depth>('official');
</script>

<svelte:head>
  <title>Trace a request — The Data Spine</title>
  <meta name="description" content="A 2-D, animated walkthrough of a single request through a federated education data spine: commission, ledger, consent, MIS calculation, aggregation and answer — traced across the practical, analytical, compute, storage, network and physical layers, with the real elapsed time at each step." />
</svelte:head>

<div class="tr-deck">
  <!-- ============ HERO ============ -->
  <header class="slide hero">
    <span class="kicker">Field study · The Data Spine · The instrument</span>
    <h1>Trace a request.<br /><em>All six layers, all six stages.</em></h1>
    {#if depth === 'eli5'}
      <p class="hero-lede">
        Follow one question all the way through. Somebody asks it, it gets written down, the rules get
        checked, each school's own computer works out its own small answer, the answers get added up, and a
        number comes back. At every step you can switch between six different ways of looking at the same
        moment — from the people involved, down to the actual computers. And the clock keeps running, because
        <b>how long it really takes</b> is the most important thing on this page.
      </p>
    {:else}
      <p class="hero-lede">
        One question, followed the whole way: who commissions it, what gets written into the ledger before
        anything runs, how consent is checked, what each school's own system actually calculates, how the
        department adds it up, and what comes back. At every step you can change which <b>layer</b> you are
        looking at — from the people involved down to the machines in the racks — and the clock keeps running,
        because the honest answer to "how long does this take" is the most important number on the page.
      </p>
    {/if}

    <div class="depth-bar">
      <span class="db-lab">Explain everything at</span>
      <div class="db-seg">
        {#each DEPTHS as d}
          <button class:on={depth === d.id} onclick={() => (depth = d.id)} title={d.hint}>{d.label}</button>
        {/each}
      </div>
      <span class="db-hint">{DEPTHS.find((d) => d.id === depth)?.hint}</span>
    </div>

    <div class="pair">
      <div class="pc">
        <span class="pc-l">YOU ARE HERE · 2-D</span>
        <b>Trace a request</b>
        <p>What happens, in order, at every layer — and how long it really takes.</p>
      </div>
      <div class="pc alt">
        <span class="pc-l">THE OTHER INSTRUMENT · 3-D</span>
        <b>Live simulator</b>
        <p>The shape of the whole network: 24,000 schools, 14 suppliers, 153 authorities, moving.</p>
        <a href="/projects/data-spine/federation/sim">Open the simulator →</a>
      </div>
    </div>
  </header>

  <!-- ============ 1 · THE TRACE ============ -->
  <section class="slide" id="trace">
    <span class="kicker">The instrument · interactive</span>
    <h2>One request, followed all the way down</h2>
    {#if depth === 'eli5'}
      <p class="slide-lede">
        Start with the picture at the top: <b>who is actually involved</b> — and notice how completely that
        changes between "how many children were absent" and "this child might be in danger". Then press play
        and watch the dot move. Underneath, there is a table of the whole thing in six steps.
      </p>
    {:else}
      <p class="slide-lede">
        Start with the map at the top: <b>who is actually involved in this scenario</b> — and notice how
        completely it changes between a national statistic and a child at risk. Then press play. Below the map,
        the six columns are the stages and the six rows are the layers of the stack; only one layer is open at a
        time, but the marker appears on every row at once, because all six are happening simultaneously.
        <b>Click any layer to open it.</b>
      </p>
    {/if}
    <RequestTrace {depth} />
  </section>

  <!-- ============ 2 · THE LAYERS ============ -->
  <section class="slide" id="layers">
    <span class="kicker">The stack · what each layer is for</span>
    <h2>Six ways to be right about the same thing</h2>
    {#if depth === 'eli5'}
      <p class="slide-lede">
        People arguing about this talk past each other, because they are describing different bits and each
        thinks they are describing the whole thing. "Nothing moves" is true about <em>what gets kept</em> and
        misleading about <em>what travels</em>. Each row below is a different question — and the design only
        works if the answer is a good one on all six.
      </p>
    {:else}
      <p class="slide-lede">
        A data architecture argument goes wrong when two people are describing different layers and both think
        they are describing the system. "Nothing moves" is true at the storage layer and misleading at the
        network layer. "It is just an API" is true at the compute layer and useless at the practical one. Each
        layer below answers a different question, and a design is only sound when the answer holds at all six.
      </p>
    {/if}
    {#if depth === 'eli5'}
      <div class="tbl-wrap">
        <table class="l-tbl">
          <thead>
            <tr><th class="c-n">The layer</th><th>What it means</th><th>The one thing to remember</th></tr>
          </thead>
          <tbody>
            {#each LAYERS as L}
              <tr>
                <th class="c-n"><span class="ln">L{L.no}</span>{L.eli5Name}</th>
                <td>{L.eli5Question}</td>
                <td class="pt">{L.eli5Point}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="layer-cards">
        {#each LAYERS as L}
          <div class="lc">
            <span class="lc-no">L{L.no}</span>
            <span class="lc-tag">{L.tag}</span>
            <b>{L.name}</b>
            <p class="lc-q">{L.question}</p>
            <p class="lc-b">{L.blurb}</p>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- rhythm break -->
  <section class="slide band">
    <p class="band-quote">The technology takes seconds.<br /><em>The permission takes months.</em></p>
  </section>

  <!-- ============ 3 · THE CLOCK ============ -->
  <section class="slide" id="clock">
    <span class="kicker">The clock · interactive</span>
    <h2>How much time actually passes</h2>
    {#if depth === 'eli5'}
      <p class="slide-lede">
        This is the question that decides whether the whole thing is worth building. A question everyone has
        already agreed to is answered in about the time it takes to load a web page. A question
        <em>nobody has asked before</em> takes months — and almost none of those months are the computers.
        You cannot make permission instant. What you <b>can</b> do is only have to ask for it once: do the
        arguing once for a whole kind of question, and every question of that kind afterwards takes seconds.
      </p>
    {:else}
      <p class="slide-lede">
        This is the question that decides whether a spine is worth building. A pre-agreed, non-PII question is
        answered in about the time it takes to load a web page. A question <em>nobody has asked before</em> —
        new purpose, new variable, new linkage — takes months, and almost none of that is computing. The
        machinery cannot make permission instant. What it can do is make permission <b>reusable</b>: pay the
        cost once per class of question rather than once per question, and the second ask costs seconds forever.
      </p>
    {/if}
    <TimeLedger {depth} />
  </section>

  <!-- ============ 4 · THE METHODS ============ -->
  <section class="slide" id="methods">
    <span class="kicker">The methods · interactive</span>
    <h2>Eleven techniques, and what each one is <em>not</em> for</h2>
    {#if depth === 'eli5'}
      <p class="slide-lede">
        There is a set of clever tricks for answering questions about people without exposing the people. Every
        one of them is genuinely useful, and every one of them gets oversold — so the table below has a column
        for what each one <em>cannot</em> do. Then <b>OpenSAFELY</b>: the part that is not a proposal, because
        they have already tried this on real English school records and written down what went wrong.
      </p>
    {:else}
      <p class="slide-lede">
        Every privacy-preserving method on this list is oversold somewhere. Differential privacy is aimed at a
        larger scale than most education statistics; homomorphic encryption is not needed here at all;
        compute-to-data does nothing about definitions. The matrix maps each technique to the stages it
        governs — and the third column of every detail card is the one worth reading first. Below it,
        <b>OpenSAFELY</b>, and the part that is no longer hypothetical: they have already run this method on
        English schools data, and published what broke.
      </p>
    {/if}
    <MethodsMatrix {depth} />
  </section>

  <!-- ============ 5 · THE NETWORK EFFECT ============ -->
  <section class="slide" id="network">
    <span class="kicker">The network effect · interactive</span>
    <h2>Why the market joins — and what that costs</h2>
    {#if depth === 'eli5'}
      <p class="slide-lede">
        None of this works unless the companies that hold the records choose to plug in. They will not do it to
        be nice. They will do it because plugging in once is cheaper than answering data requests forever, and
        because schools will start asking "are you certified?" when they buy. Once the school systems are in,
        the other education apps want in too — and the price of joining is putting something useful back.
        That is the most valuable idea on this page, and also the most dangerous one.
      </p>
    {:else}
      <p class="slide-lede">
        None of this works unless the systems that hold the data choose to connect. Suppliers will not do that
        out of civic duty; they will do it because one certified integration is cheaper than an indefinite queue
        of bespoke data requests, and because an accreditation a school asks for in procurement is worth money.
        Once the MIS estate is on, the same argument recruits the wider edtech market — products get certified,
        school-authorised context instead of re-keyed spreadsheets, and contribute non-PII signals back under
        the same rules. That flywheel is the most valuable and the most dangerous idea on this page.
      </p>
    {/if}
    <SupplyFlywheel {depth} />
  </section>

  <!-- ============ 6 · WHERE NEXT ============ -->
  <section class="slide" id="onward">
    <span class="kicker">Onward</span>
    <h2>What this trace assumes, and where it is argued</h2>
    <p class="slide-lede">
      This page is an instrument, not the argument. It shows the mechanics of a model that is set out — with
      its evidence, its precedents and its open questions — across the rest of the study. The stages and
      layers here correspond exactly to the components in the recommendation, and the numbers come from the
      same supplier census the simulator uses.
    </p>
    <div class="onward">
      <a class="ow" href="/projects/data-spine/model">
        <span>The recommendation</span><b>Centralise the trust, never the data →</b>
        <p>The seven-beat argument this trace is the mechanics of.</p>
      </a>
      <a class="ow" href="/projects/data-spine/governance">
        <span>Governance</span><b>The trust ledger and the privacy playbook →</b>
        <p>Legal instruments, nine PETs mapped to layers, and the honest tensions.</p>
      </a>
      <a class="ow" href="/projects/data-spine/federation/sim">
        <span>The other instrument</span><b>The live 3-D simulator →</b>
        <p>The same model as a moving network, with scenarios and cross-context joins.</p>
      </a>
      <a class="ow" href="/projects/data-spine/next">
        <span>Next steps</span><b>What has to be decided, and by whom →</b>
        <p>The standards stack, and the five open decisions the consultation inherits.</p>
      </a>
    </div>
    <p class="foot-note">
      {SCENARIOS.length} scenarios · {STAGES.length} stages · {LAYERS.length} layers ·
      {STAGES.length * LAYERS.length} described cells. Every timing is illustrative and labelled; the model
      itself has no published architecture, so all analysis of its design is hypothesis.
    </p>
  </section>
</div>

<style>
  .tr-deck { width: 100%; }
  .slide { max-width: 1240px; margin: 0 auto; padding: clamp(36px, 5.5vh, 76px) clamp(16px, 3vw, 40px); scroll-margin-top: calc(var(--topH, 56px) + 92px); }

  .kicker { display: block; font-family: var(--font-mono); font-size: clamp(10px, 1.1vw, 12px); letter-spacing: 0.26em; text-transform: uppercase; color: var(--accent-ink); margin-bottom: 16px; }

  .hero h1 { font-family: var(--fs-serif); font-weight: 600; font-size: clamp(36px, 6.4vw, 78px); line-height: 1.02; letter-spacing: -0.03em; margin: 0 0 22px; color: var(--ink); }
  .hero h1 em { font-style: italic; color: var(--accent-ink); }
  .hero-lede { font-size: clamp(16px, 1.7vw, 20px); line-height: 1.55; color: rgba(26,16,8,0.82); max-width: 68ch; margin: 0 0 24px; }
  .hero-lede b { color: var(--ink); }

  h2 { font-family: var(--fs-serif); font-weight: 600; font-size: clamp(27px, 4vw, 50px); line-height: 1.05; letter-spacing: -0.025em; margin: 0 0 16px; color: var(--ink); }
  h2 em { font-style: italic; color: var(--accent-ink); }
  .slide-lede { font-size: clamp(15px, 1.5vw, 18px); line-height: 1.6; color: rgba(26,16,8,0.82); max-width: 76ch; margin: 0 0 26px; }
  .slide-lede b { color: var(--ink); }
  .slide-lede em { font-style: italic; color: var(--accent-ink); }

  /* depth control */
  .depth-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 0 0 24px; padding: 12px 16px;
    background: var(--surface-elevated, #e8dece); border: 1.5px solid rgba(26,16,8,0.4); border-radius: var(--radius-sharp); }
  .db-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.16em; text-transform: uppercase; color: rgba(26,16,8,0.6); }
  .db-seg { display: inline-flex; background: rgba(26,16,8,0.07); padding: 3px; border-radius: var(--radius-sharp); border: 1px solid rgba(26,16,8,0.14); }
  .db-seg button { background: transparent; border: none; color: var(--ink); padding: 6px 14px; border-radius: var(--radius-sharp);
    font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 500; cursor: pointer; }
  .db-seg button.on { background: var(--accent-ink); color: #fff; font-weight: 600; }
  .db-hint { font-size: var(--fs-label); color: rgba(26,16,8,0.66); flex: 1 1 240px; }

  /* the two instruments */
  .pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
  .pc { background: var(--accent-ink); border: 1.5px solid var(--accent-ink); border-radius: var(--radius-sharp); padding: 14px 16px; }
  .pc-l { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.16em; color: #8fc3bd; }
  .pc b { display: block; font-family: var(--fs-serif); font-weight: 600; font-size: 21px; color: #fff; margin: 4px 0 5px; }
  .pc p { font-size: var(--fs-label); line-height: 1.5; color: #cfe6e4; margin: 0; }
  .pc.alt { background: #ffffff; border-color: rgba(26,16,8,0.4); }
  .pc.alt .pc-l { color: var(--accent-ink); }
  .pc.alt b { color: var(--ink); }
  .pc.alt p { color: rgba(26,16,8,0.78); }
  .pc.alt a { display: inline-block; margin-top: 8px; font-family: var(--font-body); font-size: var(--fs-label); font-weight: 600; color: var(--accent-ink); text-decoration: none; border-bottom: 1.5px solid var(--accent-ink); }
  .pc.alt a:hover { color: #094850; }

  /* layer cards */
  .layer-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(272px, 1fr)); gap: 12px; }
  .lc { background: #ffffff; border: 1.5px solid rgba(26,16,8,0.35); border-left: 4px solid var(--accent-ink); border-radius: var(--radius-sharp); padding: 13px 15px; }
  .lc-no { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; color: var(--accent-ink); }
  .lc-tag { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.14em; color: rgba(26,16,8,0.5); margin-left: 7px; }
  .lc b { display: block; font-family: var(--fs-serif); font-weight: 600; font-size: 20px; color: var(--ink); margin: 3px 0 6px; }
  .lc-q { font-family: var(--font-body); font-size: var(--fs-label); font-weight: 600; line-height: 1.4; color: var(--accent-ink); margin: 0 0 7px; }
  .lc-b { font-size: var(--fs-label); line-height: 1.55; color: rgba(26,16,8,0.78); margin: 0; }

  /* ELI5 layer table */
  .tbl-wrap { overflow-x: auto; background: #ffffff; border: 1.5px solid rgba(26,16,8,0.35); border-radius: var(--radius-sharp); padding: 4px 16px 10px; }
  .l-tbl { width: 100%; min-width: 640px; border-collapse: collapse; }
  .l-tbl th, .l-tbl td { text-align: left; vertical-align: top; padding: 11px 12px; font-size: var(--fs-nav); line-height: 1.5; border-bottom: 1px solid rgba(26,16,8,0.12); }
  .l-tbl thead th { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(26,16,8,0.55); border-bottom: 1.5px solid rgba(26,16,8,0.3); }
  .l-tbl tbody th { font-family: var(--font-body); font-weight: 600; color: var(--ink); width: 210px; }
  .l-tbl tbody th .ln { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink); margin-right: 7px; }
  .l-tbl td { color: rgba(26,16,8,0.84); }
  .l-tbl td.pt { color: rgba(26,16,8,0.7); }
  .l-tbl tbody tr:last-child th, .l-tbl tbody tr:last-child td { border-bottom: none; }

  /* inverted band */
  .band { max-width: none; background: var(--ink); padding: clamp(48px, 8vh, 100px) clamp(16px, 3vw, 40px); }
  .band-quote { font-family: var(--fs-serif); font-weight: 600; font-size: clamp(26px, 4.4vw, 56px); line-height: 1.14; letter-spacing: -0.02em; color: var(--paper, #f1ead6); max-width: 1100px; margin: 0 auto; text-align: center; }
  .band-quote em { font-style: italic; color: #d9a05e; }

  /* onward */
  .onward { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; }
  .ow { display: block; background: #ffffff; border: 1.5px solid rgba(26,16,8,0.35); border-radius: var(--radius-sharp); padding: 13px 15px; text-decoration: none; transition: border-color 0.15s; }
  .ow:hover { border-color: var(--accent-ink); }
  .ow span { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.16em; text-transform: uppercase; color: var(--accent-ink); }
  .ow b { display: block; font-family: var(--font-body); font-size: var(--fs-nav); font-weight: 600; color: var(--ink); margin: 4px 0 5px; line-height: 1.3; }
  .ow p { font-size: var(--fs-label); line-height: 1.5; color: rgba(26,16,8,0.72); margin: 0; }

  .foot-note { font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1.7; letter-spacing: 0.04em; color: rgba(26,16,8,0.55); margin: 22px 0 0; }

  @media (max-width: 860px) {
    .slide { scroll-margin-top: calc(var(--topH, 56px) + 84px); }
  }
</style>
