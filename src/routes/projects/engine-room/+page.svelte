<script lang="ts">
  // The index — the whole machine in one frame, then four ways in.
  //
  // Deliberately short. The job of this page is orientation, not explanation: a map, a
  // scale, and four doors. Everything that wants a paragraph lives on a leaf page next to
  // the diagram that earns it.
  import SystemMap from './components/SystemMap.svelte';
  import StatWall from './components/StatWall.svelte';
  import Instrument from './components/viz/Instrument.svelte';
  import { CLAIMS } from './lib/system';
  import { PARTS, href } from './lib/nav';
  import { app } from './lib/appState.svelte';

  const eli = $derived(app.narrative === 'eli5');
  let openClaim = $state<string | null>(null);
</script>

<svelte:head>
  <title>The Engine Room — how this site works</title>
  <meta name="description" content="A walkthrough of the architecture behind strangeramblings.com: a personal knowledge engine with an assistant, a workflow engine, retrieval, a knowledge graph, and a system that improves itself overnight." />
</svelte:head>

<section class="pe-route wide">
  <header class="idx-head">
    <span class="pe-eyebrow">Field study · This site, explained</span>
    <h1 class="pe-h1">The Engine Room</h1>
    <p class="idx-line">
      {#if eli}
        This site looks like an ordinary blog. Behind it is an assistant that can read my email and control my
        house, a machine that builds its own tools while I sleep, and a memory that joins everything together.
      {:else}
        This site looks like a blog. Underneath it is a personal knowledge engine — an assistant with reach into
        mail, files and home, a workflow engine, a knowledge graph, and a system that rewrites itself overnight.
      {/if}
    </p>
    <a class="idx-cta" href={href('turn', 'trace')}>
      <span class="c-mark" aria-hidden="true">◧</span>
      <span class="c-txt"><b>Start with the instrument</b><em>One message, six stages, six layers — with a live clock and a running bill</em></span>
      <span class="c-go" aria-hidden="true">→</span>
    </a>
  </header>

  <Instrument
    title="The whole system, one frame"
    kicker="Six bands"
    reading="Every part of the machine, grouped by what it is for. Hover a box to see what it does; the lit lines are what it talks to. Click to open the page that explains it."
    flush
  >
    <SystemMap />
  </Instrument>

  <h2 class="pe-h2">Four parts</h2>
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

  <Instrument
    title="Four claims this study has to earn"
    kicker="The argument"
    reading="Press one to see the claim in full, then follow it to the page that has to back it up."
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
  </Instrument>

  <Instrument
    title="The size of it"
    kicker="Counted, not estimated"
    reading="Every tile carries the command that produced it. None of these are the point — they establish the scale the rest of the study has to account for."
    tone="var(--accent)"
  >
    <StatWall />
  </Instrument>

  <p class="idx-note">
    <b>What is deliberately not here.</b> No credentials, keys, addresses, personal data or configuration values
    appear anywhere in this study — not obscured, simply never written. Where something would be unsafe to publish,
    the study describes its shape and stops.
  </p>
</section>

<style>
  .idx-head { margin: 0 0 20px; }
  .idx-line { margin: 0 0 16px; font-size: 17.5px; line-height: 1.55; color: rgba(28,22,17,0.76); max-width: 62ch; }

  .idx-cta { display: inline-flex; align-items: center; gap: 12px; text-decoration: none;
    background: var(--accent-ink); color: #fff; padding: 12px 18px; border-radius: var(--radius-round); }
  .idx-cta:hover { background: #0b4a53; }
  .c-mark { font-size: 18px; opacity: 0.8; }
  .c-txt { display: flex; flex-direction: column; gap: 2px; }
  .c-txt b { font-size: 15px; font-weight: 600; }
  .c-txt em { font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 10px; opacity: 0.78; }
  .idx-cta .c-go { font-size: 17px; opacity: 0.8; }

  .parts { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin: 14px 0 22px; }
  .part { display: flex; flex-direction: column; gap: 3px; text-decoration: none;
    border: 1px solid rgba(28,22,17,0.16); border-top: 3px solid var(--tone);
    border-radius: var(--radius-round); background: rgba(255,255,255,0.5); padding: 14px 16px 12px;
    transition: background 0.13s, border-color 0.13s; }
  .part:hover { background: rgba(255,255,255,0.85); border-color: rgba(28,22,17,0.32); border-top-color: var(--tone); }
  .p-no { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.16em;
    text-transform: uppercase; color: var(--tone); }
  .p-name { font-family: 'Fraunces', serif; font-weight: 600; font-size: 22px; line-height: 1.1; color: var(--text-primary); }
  .p-strap { font-size: 13px; line-height: 1.45; color: rgba(28,22,17,0.68); margin-bottom: 7px; }
  .p-leaves { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px;
    border-top: 1px dashed rgba(28,22,17,0.16); padding-top: 8px; }
  .p-leaves li { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; line-height: 1.5;
    color: rgba(28,22,17,0.6); }
  .p-count { margin-top: 9px; font-family: 'JetBrains Mono', monospace; font-size: 9.5px;
    letter-spacing: 0.06em; color: var(--tone); }

  .claims { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 8px; }
  .claim { border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round);
    background: rgba(255,255,255,0.55); overflow: hidden; align-self: start; }
  .claim.open { border-color: rgba(28,22,17,0.34); }
  .c-head { width: 100%; display: flex; align-items: baseline; gap: 9px; text-align: left;
    background: none; border: none; padding: 11px 13px; cursor: pointer; font-family: inherit; }
  .c-head:hover { background: rgba(28,22,17,0.04); }
  .c-n { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--accent); flex-shrink: 0; }
  .c-title { font-family: 'Fraunces', serif; font-weight: 600; font-size: 15.5px; line-height: 1.24;
    color: var(--text-primary); min-width: 0; }
  .c-chev { margin-left: auto; font-family: 'JetBrains Mono', monospace; font-size: 14px;
    color: rgba(28,22,17,0.4); flex-shrink: 0; }
  .c-body { padding: 0 13px 12px; }
  .c-body p { margin: 0 0 8px; font-size: 13px; line-height: 1.56; color: rgba(28,22,17,0.76); }
  .c-ev { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--accent-ink); text-decoration: none; }
  .c-ev:hover { text-decoration: underline; }

  .idx-note { margin: 4px 0 0; padding: 10px 14px; border-left: 3px solid rgba(28,22,17,0.28);
    background: rgba(28,22,17,0.035); border-radius: 0 var(--radius-round) var(--radius-round) 0;
    font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.7); max-width: 92ch; }
  .idx-note b { color: var(--text-primary); }
</style>
