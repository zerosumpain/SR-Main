<script lang="ts">
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import SellerRoulette from './components/SellerRoulette.svelte';
  import ReasoningFloor from './components/ReasoningFloor.svelte';
  import TtftScatter from './components/TtftScatter.svelte';
  import { RESOLUTION, POLICY, CATALOGUE, CACHE_STORY } from '../lib/models';
  import { app } from '../lib/appState.svelte';

  const eli = $derived(app.narrative === 'eli5');
  let openLayer = $state<string | null>('2');
</script>

<svelte:head>
  <title>Models — automatic selection, sellers and caching · The Engine Room</title>
  <meta name="description" content="How a model is chosen automatically, why naming a model does not determine what you receive, and the caching change that made an identical conversation dramatically cheaper." />
</svelte:head>

<section class="pe-route wide">
  <StoryMasthead
    kicker="Section 3 · Reasoning"
    title="Which brain, and what it costs"
    thesis="There is one gateway to every model provider, and a single default that sixty-one files reach for. Everything interesting happens in the two things that sit either side of that default: a nightly auction that decides which model should be the default, and a set of central guards that repair a request on its way out — because the same model, named the same way, is sold by thirty-two different people at wildly different prices, precisions and speeds."
    thesisEli5="Every AI request goes through one doorway. Behind that doorway, a nightly contest picks which AI is best value for each kind of job. And there is a trap: buying 'the same AI' from the cheapest shop often gets you a worse, slower copy — so the system checks what it is actually being sold."
    asks={[
      'How does a system pick a model without a human choosing every time?',
      'Why is the cheapest seller of a model usually the wrong one?',
      'Where does the money in an AI system actually go — and what is the biggest single lever on it?',
    ]}
  />

  <h2 class="pe-h2">Four layers, first match wins</h2>
  <p class="pe-prose" style="max-width:82ch">
    {#if eli}
      When something needs an AI, it asks four questions in order and stops at the first answer.
    {:else}
      A shared default is a global variable. It is only safe if every deviation from it is explicit and nameable,
      so model resolution is a short chain with exactly four links — and the exceptions can be enumerated by
      grepping for three constants rather than auditing sixty-one files.
    {/if}
  </p>

  <div class="chain">
    {#each RESOLUTION as l}
      <button class="link" class:open={openLayer === l.n} onclick={() => (openLayer = openLayer === l.n ? null : l.n)}
              aria-expanded={openLayer === l.n}>
        <span class="l-n">{l.n}</span>
        <span class="l-name">{l.name}</span>
        <span class="l-chev">{openLayer === l.n ? '−' : '+'}</span>
        {#if openLayer === l.n}
          <span class="l-what">{eli ? l.eli5 : l.what}</span>
          <span class="l-when">{l.when}</span>
        {/if}
      </button>
    {/each}
  </div>

  <h2 class="pe-h2">What you are actually buying</h2>
  <SellerRoulette />

  <div class="er-lesson">
    <span class="el-lab">The bug underneath the bug</span>
    <p>Choosing sellers by price is not merely slow — it is <b>unsound</b>. The nightly auction scores models on
      quality indices measured at full precision. With no seller preference set, three consecutive calls to the site
      default were all served by the same quarter-precision endpoint. The auction was therefore optimising against a
      thing that was not being delivered, and no metric anywhere in the system would ever have shown it.</p>
    <p>The fix is a filter on advertised precision, not a faster machine. It is worth noticing that this class of
      failure — <b>the measurement describes something other than the artefact</b> — is invisible to monitoring by
      construction, because every number involved is correct.</p>
  </div>

  <h2 class="pe-h2">The latency theory that was wrong</h2>
  <TtftScatter />

  <h2 class="pe-h2">The empty answer</h2>
  <p class="pe-prose" style="max-width:82ch">
    {#if eli}
      Some AIs think privately before answering, and you pay for that thinking. If you do not leave them enough room,
      they use it all up thinking and hand back nothing at all — with no error to tell you why.
    {:else}
      Reasoning models emit hidden thinking tokens before any visible character, and those tokens consume the same
      output budget as the answer. Drag the budget and watch the answer vanish.
    {/if}
  </p>
  <ReasoningFloor />

  <h2 class="pe-h2">The largest single lever</h2>
  <div class="cache">
    <div class="c-side before">
      <span class="c-lab">Before</span>
      <p>{CACHE_STORY.before}</p>
    </div>
    <div class="c-side after">
      <span class="c-lab">After</span>
      <p>{CACHE_STORY.after}</p>
    </div>
  </div>
  <div class="er-lesson">
    <span class="el-lab">Why this one is worth telling</span>
    <p>{CACHE_STORY.lesson}</p>
    <p>Caching only works while the prefix is <b>byte-identical</b>. A timestamp in a system prompt, a set rendered in
      a different order, a tool list that sorts non-deterministically — any of those silently restores full price while
      everything continues to work perfectly. The cache is invisible when it works and invisible when it stops.</p>
  </div>

  <h2 class="pe-h2">The auction, and what it is allowed to weigh</h2>
  <p class="pe-prose" style="max-width:82ch">
    At 04:00 the catalogue is re-scored and a winner is chosen for each of four profiles — general conversation, tool
    use, retrieval and agentic work. Of <b>{CATALOGUE.total}</b> models in the catalogue snapshot, <b>{CATALOGUE.toolCapable}</b>
    can call tools and <b>{CATALOGUE.rated}</b> carry any quality index at all; <b>{CATALOGUE.eligible}</b> survive the
    eligibility filter, and the capability band for each profile narrows that to
    <b>{CATALOGUE.pools.general}</b>–<b>{CATALOGUE.pools.rag}</b> real candidates.
  </p>

  <div class="policy">
    {#each POLICY as p}
      <div class="p-row">
        <span class="p-k">{p.k}</span>
        <b class="p-v">{p.v}</b>
        <span class="p-why">{p.why}</span>
      </div>
    {/each}
  </div>

  <div class="ds-grid">
    <div class="ds-card">
      <span class="ds-kicker">A guard on the feedback loop</span>
      <h3>One lucky answer must not win</h3>
      <p class="ds-body">A thumbs-up marks that turn's routing decision as correct. Feeding the raw success rate back
        would let a model with a single success — one out of one, a perfect 100% — leapfrog one with forty out of
        fifty. The stored figure is the <b>lower bound of a 95% confidence interval</b> instead, so confidence has to
        be earned by volume. In a system with one user, small samples are not an edge case; they are the normal case.</p>
    </div>
    <div class="ds-card">
      <span class="ds-kicker">A guard on the auction itself</span>
      <h3>When every profile picked the same model</h3>
      <p class="ds-body">Rebalancing the scoring toward cost was simulated against the live catalogue before it
        shipped — and every profile collapsed onto the single cheapest survivor. General, tool-use and retrieval all
        returned the same answer. <b>Adaptive routing that always picks the same thing still runs, still logs, still
        renders a dashboard.</b> It fails silently unless someone inspects the picks, which is why the simulation is
        part of the change and not an afterthought.</p>
    </div>
    <div class="ds-card">
      <span class="ds-kicker">A guard on the ledger</span>
      <h3>Null, never zero</h3>
      <p class="ds-body">When a model's price is unknown, the cost ledger records <b>null</b> — not zero. A fabricated
        zero silently understates spend in every chart that sums the column, and charts are believed. A null is a
        visible admission of ignorance. Calls with no usage information write no row at all rather than diluting the
        table with entries that cannot mean anything.</p>
    </div>
    <div class="ds-card">
      <span class="ds-kicker">A guard on the exceptions</span>
      <h3>Overnight jobs pin their own</h3>
      <p class="ds-body">Three unattended pipelines — self-improvement, the workflow doctor and the builder — name
        their model explicitly rather than resolving the default. The thing that edits the system at 03:30 must not
        change behaviour because someone adjusted a preference in the afternoon. Each pin carries its reasoning as a
        comment at the constant.</p>
    </div>
  </div>

  <a class="pe-next" href="/projects/engine-room/tools">Next — the toolkit, and the economics of context →</a>
</section>

<style>
  .chain { display: flex; flex-direction: column; gap: 6px; margin: 14px 0; }
  .link { display: grid; grid-template-columns: 34px 1fr 24px; gap: 4px 10px; align-items: baseline; text-align: left;
    border: 1px solid rgba(28,22,17,0.18); border-radius: var(--radius-round); background: rgba(255,255,255,0.5);
    padding: 10px 14px; cursor: pointer; transition: background 0.13s, border-color 0.13s; }
  .link:hover { background: rgba(255,255,255,0.8); border-color: rgba(28,22,17,0.34); }
  .link.open { background: var(--accent-ink-tint-12); border-color: rgba(14,91,102,0.35); }
  .l-n { font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 600; color: var(--accent-ink); }
  .l-name { font-family: 'Fraunces', serif; font-size: 16px; font-weight: 600; color: var(--text-primary); }
  .l-chev { font-family: 'JetBrains Mono', monospace; font-size: 14px; color: rgba(28,22,17,0.4); text-align: right; }
  .l-what { grid-column: 2 / 4; font-size: 13.5px; line-height: 1.58; color: rgba(28,22,17,0.76); margin-top: 4px; max-width: 88ch; }
  .l-when { grid-column: 2 / 4; font-family: 'JetBrains Mono', monospace; font-size: 10px; line-height: 1.5; color: var(--accent); margin-top: 5px; }

  .cache { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; margin: 14px 0; }
  .c-side { border-radius: var(--radius-round); padding: 12px 15px; border: 1px solid rgba(28,22,17,0.16); }
  .c-side.before { background: rgba(196,68,68,0.06); border-color: rgba(196,68,68,0.28); }
  .c-side.after { background: rgba(45,122,58,0.07); border-color: rgba(45,122,58,0.3); }
  .c-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.13em; text-transform: uppercase; }
  .c-side.before .c-lab { color: #c44; }
  .c-side.after .c-lab { color: #2d7a3a; }
  .c-side p { margin: 6px 0 0; font-size: 13.5px; line-height: 1.58; color: rgba(28,22,17,0.78); }

  .policy { display: flex; flex-direction: column; gap: 0; margin: 14px 0; border: 1px solid rgba(28,22,17,0.14);
    border-radius: var(--radius-round); overflow: hidden; }
  .p-row { display: grid; grid-template-columns: minmax(150px, 1fr) 90px 2.2fr; gap: 12px; align-items: baseline;
    padding: 9px 14px; border-bottom: 1px solid rgba(28,22,17,0.07); background: rgba(255,255,255,0.45); }
  .p-row:last-child { border-bottom: none; }
  .p-k { font-size: 13px; color: var(--text-primary); }
  .p-v { font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 600; color: var(--accent); }
  .p-why { font-size: 12.5px; line-height: 1.5; color: rgba(28,22,17,0.68); }
  @media (max-width: 620px) {
    .p-row { grid-template-columns: 1fr 80px; }
    .p-why { grid-column: 1 / 3; }
  }
</style>
