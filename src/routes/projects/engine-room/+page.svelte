<script lang="ts">
  // The index — read as one continuous piece, top to bottom.
  //
  // What this replaced: a hero, then five instruments stacked with small headings over
  // them. Every block was individually fine and the page had no argument running through
  // it — you arrived, met a diagram, met another diagram, and left. It read as a contents
  // page wearing an essay's clothes.
  //
  // Now it is seven chapters with one thesis: it looks like a blog · here is every room ·
  // here is the same thing cut away · watch one message actually go through · watch it
  // rebuild itself at 3am · here is where the detail lives · here is what I have to prove.
  // Each chapter is a number, a title you can stop on, one sentence, then the visual.
  //
  // The two isometric set pieces are the punch-outs. They are the only places in the study
  // that ANIMATE an argument rather than let you operate one, and they are deliberately
  // placed where the prose is at its least intuitive — the cost of carrying, and a machine
  // editing itself unattended.
  import Chapter from './components/Chapter.svelte';
  import SiteTour from './components/SiteTour.svelte';
  import SystemMap from './components/SystemMap.svelte';
  import CityRun from './components/CityRun.svelte';
  import StatWall from './components/StatWall.svelte';
  import { CLAIMS } from './lib/system';
  import { NIGHT_ROUTE, NIGHT_VERDICT } from './lib/city';
  import { PARTS, href } from './lib/nav';
  import { app } from './lib/appState.svelte';

  const eli = $derived(app.narrative === 'eli5');
  let openClaim = $state<string | null>(null);
</script>

<svelte:head>
  <title>The Engine Room — how this site works</title>
  <meta name="description" content="A walkthrough of the architecture behind strangeramblings.com: a personal knowledge engine with an assistant, a workflow engine, retrieval, a knowledge graph, and a system that improves itself overnight." />
</svelte:head>

<section class="pe-route wide er-index">
  <!-- ---- the hero ---------------------------------------------------- -->
  <header class="hero">
    <span class="pe-eyebrow">Field study · This site, explained</span>
    <h1 class="hero-title">The Engine&nbsp;Room</h1>
    <p class="hero-line">
      {#if eli}
        This site looks like an ordinary blog. Behind it is an assistant that reads my email, runs my house,
        remembers what it learns, and quietly rewrites bits of its own code while I am asleep. This page takes
        the lid off: what each part does, why it was built, and what it turned out to be worth.
      {:else}
        This site looks like a blog. It is a blog. It is also an assistant with its hands in my mail, my files
        and my house, a workflow engine, a knowledge graph that grades its own confidence, and a night shift
        that rewrites the codebase while I sleep — all of which seemed like a sensible weekend project at the
        time. Here it is with the lid off.
      {/if}
    </p>
    <div class="hero-foot">
      <a class="hero-cta" href={href('turn', 'trace')}>
        <span class="c-txt"><b>Skip to the instrument</b><em>One message, six stages, six layers, with a live clock</em></span>
        <span class="c-go" aria-hidden="true">→</span>
      </a>
      <span class="hero-scroll" aria-hidden="true">or keep scrolling <i>↓</i></span>
    </div>
  </header>

  <Chapter
    no="Chapter one"
    title="It really does look like a blog"
    sub="Nineteen pages hold this place up. Five of them you can see without asking; the other fourteen need a password, and they are where the actual work happens. Hover any card to see what it connects to — click one for a proper look."
    lead
  >
    <SiteTour />
  </Chapter>

  <Chapter
    no="Chapter two"
    title="Underneath, six floors"
    sub="The same system with the front taken off. Every box is a real component and every curve is a real dependency — hover one and only its own connections light up, because all nineteen at once is a hairball, not a diagram."
    tone="var(--accent)"
  >
    <SystemMap />
  </Chapter>

  <Chapter
    no="Chapter three"
    title="Now watch one message go through"
    sub="A single turn, walked across town: six buildings, nine legs, and a meter in the corner running real money. The thing worth noticing is which legs cost anything."
    tone="#c2703d"
  >
    <CityRun />
  </Chapter>

  <Chapter
    no="Chapter four"
    title="And what it gets up to at half three"
    sub="Same town, nobody in it. Every night the machine reads back its own failures, writes tools to do better, and tests them in a sandbox — then reaches the one door it is not allowed through."
    tone="#8a2d3a"
  >
    <CityRun
      route={NIGHT_ROUTE}
      verdict={NIGHT_VERDICT}
      night
      showMeter={false}
      idle="Seven legs, one night, nobody watching. Press play."
      playLabel="Run the night shift"
    />
  </Chapter>

  <Chapter
    no="Chapter five"
    title="Five parts, twenty-nine pages"
    sub="Everything above is the tour. This is the study proper — each part is a short hub over a handful of single-idea pages, and every page carries one instrument you can actually drive."
    tone="var(--accent-ink)"
  >
    <nav class="parts" aria-label="Parts of the study">
      {#each PARTS as p}
        <a class="part" href={href(p.id)} style="--tone:{p.tone}">
          <span class="p-no">Part {p.no}</span>
          <b class="p-name">{p.name}</b>
          <span class="p-strap">{p.strap}</span>
          <ol class="p-leaves">
            {#each p.leaves as l}<li>{l.label}</li>{/each}
          </ol>
          <span class="p-count">{p.leaves.length} pages →</span>
        </a>
      {/each}
    </nav>
  </Chapter>

  <Chapter
    no="Chapter six"
    title="Five things I have to earn"
    sub="A field study that only describes itself is a brochure. These are the claims the rest of the pages exist to prove — press one for the argument, then go and check it."
    tone="var(--accent)"
  >
    <div class="claims">
      {#each CLAIMS as c}
        <div class="claim" class:open={openClaim === c.n}>
          <button class="c-head" onclick={() => (openClaim = openClaim === c.n ? null : c.n)}
                  aria-expanded={openClaim === c.n}>
            <span class="c-n">{c.n}</span>
            <span class="c-title">{c.title}</span>
            <span class="c-chev" aria-hidden="true">{openClaim === c.n ? '−' : '+'}</span>
          </button>
          {#if openClaim === c.n}
            <div class="c-body">
              <p>{eli ? c.eli5 : c.body}</p>
              <a class="c-ev" href="/projects/engine-room/{c.section}">the evidence →</a>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </Chapter>

  <Chapter
    no="Chapter seven"
    title="The size of the thing"
    sub="Counted from the source tree rather than estimated, and every tile carries the command that produced it. One person, evenings and weekends, over about a year."
    tone="#5a6b7a"
  >
    <StatWall />
  </Chapter>

  <p class="idx-note">
    <b>What is deliberately not here.</b> No credentials, keys, addresses or personal data appear anywhere in this
    study — not obscured, never written. The screenshots in chapter one are real pages with the real content
    replaced in the browser before the picture was taken. Where something would be unsafe to publish, it is
    described by shape.
  </p>
</section>

<style>
  .er-index { padding-bottom: 40px; }

  /* ---- hero — full width under the headline, like every headline here. */
  .hero { margin: 0 0 clamp(52px, 8vw, 104px); }
  .hero-title {
    margin: 6px 0 16px;
    font-family: var(--fs-serif); font-weight: 600;
    font-size: clamp(44px, 9vw, 104px);
    line-height: 0.94; letter-spacing: -0.03em;
    color: var(--text-primary);
  }
  .hero-line {
    margin: 0 0 24px;
    font-size: clamp(17px, 1.9vw, 22px);
    line-height: 1.5; color: rgba(28, 22, 17, 0.78);
    text-wrap: pretty;
  }
  .hero-foot { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .hero-cta { display: inline-flex; align-items: center; gap: 14px; text-decoration: none;
    background: var(--accent-ink); color: #fff; padding: 13px 20px; border-radius: var(--radius-sharp); }
  .hero-cta:hover { background: #0b4a53; }
  .c-txt { display: flex; flex-direction: column; gap: 2px; }
  .c-txt b { font-size: var(--fs-body-sm); font-weight: 600; }
  .c-txt em { font-style: normal; font-family: var(--font-mono); font-size: var(--fs-label-xs); opacity: 0.78; }
  .hero-cta .c-go { font-size: 17px; opacity: 0.8; }
  .hero-scroll { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.14em;
    text-transform: uppercase; color: rgba(28, 22, 17, 0.42); }
  .hero-scroll i { font-style: normal; display: inline-block; animation: nudge 2.4s ease-in-out infinite; }
  @keyframes nudge { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(3px); } }
  @media (prefers-reduced-motion: reduce) { .hero-scroll i { animation: none; } }

  /* ---- parts --------------------------------------------------------- */
  .parts { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
  .part { display: flex; flex-direction: column; gap: 3px; text-decoration: none;
    border: 1px solid rgba(28,22,17,0.16); border-top: 3px solid var(--tone);
    border-radius: var(--radius-sharp); background: rgba(255,255,255,0.5); padding: 14px 16px 12px;
    transition: background 0.13s, border-color 0.13s, transform 0.13s; }
  .part:hover { background: rgba(255,255,255,0.9); border-color: rgba(28,22,17,0.32);
    border-top-color: var(--tone); transform: translateY(-2px); }
  .p-no { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.16em;
    text-transform: uppercase; color: var(--tone); }
  .p-name { font-family: var(--fs-serif); font-weight: 600; font-size: 22px; line-height: 1.1; color: var(--text-primary); }
  .p-strap { font-size: var(--fs-label); line-height: 1.45; color: rgba(28,22,17,0.68); margin-bottom: 7px; }
  .p-leaves { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px;
    border-top: 1px dashed rgba(28,22,17,0.16); padding-top: 8px; }
  .p-leaves li { font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1.5;
    color: rgba(28,22,17,0.6); }
  .p-count { margin-top: 9px; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.06em; color: var(--tone); }

  /* ---- claims -------------------------------------------------------- */
  .claims { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 8px; }
  .claim { border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-sharp);
    background: rgba(255,255,255,0.55); overflow: hidden; align-self: start; }
  .claim.open { border-color: rgba(28,22,17,0.34); }
  .c-head { width: 100%; display: flex; align-items: baseline; gap: 9px; text-align: left;
    background: none; border: none; padding: 12px 14px; cursor: pointer; font-family: inherit; }
  .c-head:hover { background: rgba(28,22,17,0.04); }
  .c-n { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent); flex-shrink: 0; }
  .c-title { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-body); line-height: 1.24;
    color: var(--text-primary); min-width: 0; }
  .c-chev { margin-left: auto; font-family: var(--font-mono); font-size: var(--fs-nav);
    color: rgba(28,22,17,0.4); flex-shrink: 0; }
  .c-body { padding: 0 14px 13px; }
  .c-body p { margin: 0 0 8px; font-size: var(--fs-label); line-height: 1.58; color: rgba(28,22,17,0.76); }
  .c-ev { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink); text-decoration: none; }
  .c-ev:hover { text-decoration: underline; }

  /* ---- closing note -------------------------------------------------- */
  .idx-note { margin: 0; padding: 12px 16px; border-left: 3px solid rgba(28,22,17,0.28);
    background: rgba(28,22,17,0.035); border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0;
    font-size: var(--fs-label); line-height: 1.6; color: rgba(28,22,17,0.7); max-width: 92ch; }
  .idx-note b { color: var(--text-primary); }
</style>
