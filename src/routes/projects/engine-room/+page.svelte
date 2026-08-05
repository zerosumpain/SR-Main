<script lang="ts">
  // The index — the whole system in one frame, the four claims the study has to earn,
  // and the numbers, with how each was counted.
  import StoryMasthead from './components/StoryMasthead.svelte';
  import SystemMap from './components/SystemMap.svelte';
  import StatWall from './components/StatWall.svelte';
  import { CLAIMS } from './lib/system';
  import { app } from './lib/appState.svelte';

  const eli = $derived(app.narrative === 'eli5');

  const START = [
    { href: '/projects/engine-room/trace', label: 'Trace a turn', kicker: 'The instrument',
      body: 'One message, followed through six stages and six layers, with a running clock and a running bill. If you read one thing here, read this.' },
    { href: '/projects/engine-room/models', label: 'Where the money goes', kicker: 'Models + caching',
      body: 'Automatic model selection, why the cheapest seller of a model is usually the wrong one, and the caching change that made an identical conversation dramatically cheaper.' },
    { href: '/projects/engine-room/building', label: 'The night shift', kicker: 'Self-improvement',
      body: 'Every night it reads its own failures and writes improvements. What it is allowed to install by itself, what it must ask about, and the gate in between.' },
  ];
</script>

<svelte:head>
  <title>The Engine Room — how this site works</title>
  <meta name="description" content="A walkthrough of the architecture behind strangeramblings.com: a personal knowledge engine with an assistant, a workflow engine, retrieval, a knowledge graph, and a system that improves itself overnight." />
</svelte:head>

<section class="pe-route wide">
  <StoryMasthead
    kicker="Field study · This site, explained"
    title="The Engine Room"
    thesis="This site looks like a blog. Underneath it is a personal knowledge engine: an assistant that can act on my mail, files, home and calendar; a visual automation engine; a document store you can ask questions of; a knowledge graph that resolves entities overnight; and a system that reads its own failures each night and writes its own improvements. This study opens the lid on all of it."
    thesisEli5="This site looks like an ordinary blog. Behind it is something much stranger: an assistant that can read my email and control my house, a machine that builds its own tools while I sleep, and a memory that joins everything together. This is a tour of how it works."
    asks={[
      'What does it take for one person to run a system with this much surface area?',
      'Where does the time and the money in an AI system actually go?',
      'What can a machine safely be allowed to change about itself — and what must it ask about?',
    ]}
  />

  <SystemMap />

  <h2 class="pe-h2">Four claims</h2>
  <p class="pe-prose" style="max-width:82ch">
    {#if eli}
      Four things that make this different from a pile of separate gadgets. The rest of the study is the evidence for them.
    {:else}
      Everything that follows is in service of four arguments. Each links to the section that has to earn it.
    {/if}
  </p>

  <div class="claims">
    {#each CLAIMS as c}
      <a class="claim" href="/projects/engine-room/{c.section}">
        <span class="c-n">{c.n}</span>
        <h3>{c.title}</h3>
        <p>{eli ? c.eli5 : c.body}</p>
        <span class="c-go">the evidence →</span>
      </a>
    {/each}
  </div>

  <h2 class="pe-h2">The size of it</h2>
  <p class="pe-prose" style="max-width:82ch">
    Counted from the source on 5 August 2026. Every tile says how it was measured — hover one to see the command.
    None of these are estimates, and none of them are the point: they are here to establish the scale that the rest
    of the study has to account for.
  </p>
  <StatWall />

  <h2 class="pe-h2">Where to start</h2>
  <div class="ds-grid">
    {#each START as s}
      <a class="ds-card start" href={s.href}>
        <span class="ds-kicker">{s.kicker}</span>
        <h3>{s.label}</h3>
        <p class="ds-body">{s.body}</p>
      </a>
    {/each}
  </div>

  <div class="er-lesson">
    <span class="el-lab">What is deliberately not here</span>
    <p>This page describes mechanisms, not secrets. There are no credentials, no keys, no addresses, no personal data
      and no configuration values on any page of this study — not obscured, simply absent. Where something would be
      unsafe to publish, the study explains the <b>shape</b> of it and stops there.</p>
    <p>That constraint turned out to improve the writing. Nearly everything genuinely interesting about a system like
      this is in the reasoning and the mistakes, and none of that is confidential.</p>
  </div>
</section>

<style>
  .claims { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; margin: 14px 0 4px; }
  .claim { display: block; text-decoration: none; border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round);
    background: rgba(255,255,255,0.5); padding: 14px 16px; transition: background 0.13s, border-color 0.13s; }
  .claim:hover { background: rgba(255,255,255,0.78); border-color: rgba(28,22,17,0.34); }
  .c-n { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.12em; color: var(--accent); }
  .claim h3 { font-family: 'Fraunces', serif; font-weight: 600; font-size: 16.5px; margin: 5px 0 7px; color: var(--text-primary); line-height: 1.22; }
  .claim p { margin: 0; font-size: 13px; line-height: 1.56; color: rgba(28,22,17,0.74); }
  .c-go { display: inline-block; margin-top: 9px; font-family: 'JetBrains Mono', monospace; font-size: 9.5px;
    letter-spacing: 0.06em; color: var(--accent-ink); }

  .ds-card.start { display: block; text-decoration: none; transition: background 0.13s, border-color 0.13s; }
  .ds-card.start:hover { background: rgba(255,255,255,0.78); border-color: rgba(28,22,17,0.34); }
</style>
