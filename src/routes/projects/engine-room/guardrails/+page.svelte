<script lang="ts">
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import { RAILS, PRINCIPLE, FAILURE_MODES, type Kind } from '../lib/guardrails';

  let filter = $state<'all' | Kind | 'scar'>('all');

  const shown = $derived(
    filter === 'all' ? RAILS
    : filter === 'scar' ? RAILS.filter((r) => r.scar)
    : RAILS.filter((r) => r.kind === filter),
  );
  const boundaries = RAILS.filter((r) => r.kind === 'boundary').length;
  const scars = RAILS.filter((r) => r.scar).length;
</script>

<svelte:head>
  <title>Guardrails — the security model · The Engine Room</title>
  <meta name="description" content="Every guardrail in a personal AI system, sorted by whether it is a boundary that holds or a request that is merely usually honoured — and which ones exist because something went wrong." />
</svelte:head>

<section class="pe-route wide">
  <StoryMasthead
    kicker="Section 10 · Guardrails"
    title="What stops it"
    thesis="A system that can read your mail, spend your money, control your house and rewrite its own code needs its limits to be real. The organising distinction on this page is between a guardrail that is a request — a sentence asking a model not to do something — and one that is a boundary, which holds regardless of what anything intends. Almost everything here is the second kind, and the one exception says so."
    thesisEli5="This system can read email, spend money, control a house and change its own code. So the limits on it have to be real limits, not polite requests. This page lists every one of them, and marks which are genuine walls and which are only good manners."
    asks={[
      'What is the difference between a rule and a wall?',
      'What can this system do to itself, and what can it never do?',
      'Which of these exist because something already went wrong?',
    ]}
  />

  <div class="principle">
    <span class="p-lab">The rule this page is organised around</span>
    <h3>{PRINCIPLE.title}</h3>
    <p>{PRINCIPLE.body}</p>
    <p class="p-tally">{PRINCIPLE.tally}</p>
  </div>

  <div class="filters" role="group" aria-label="Filter guardrails">
    <button class:on={filter === 'all'} onclick={() => (filter = 'all')}>All {RAILS.length}</button>
    <button class:on={filter === 'boundary'} onclick={() => (filter = 'boundary')}>Boundaries {boundaries}</button>
    <button class:on={filter === 'request'} onclick={() => (filter = 'request')}>Requests {RAILS.length - boundaries}</button>
    <button class:on={filter === 'scar'} onclick={() => (filter = 'scar')}>⚠ Written by an incident {scars}</button>
  </div>

  <div class="rails">
    {#each shown as r (r.id)}
      <div class="rail" class:req={r.kind === 'request'}>
        <div class="r-head">
          <span class="r-risk">{r.risk}</span>
          <span class="r-kind" data-k={r.kind}>{r.kind}</span>
        </div>
        <b class="r-rail">{r.rail}</b>
        <p class="r-detail">{r.detail}</p>
        {#if r.scar}
          <div class="r-scar">
            <span class="rs-lab">⚠ How it was got wrong</span>
            <p>{r.scar}</p>
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <h2 class="pe-h2">Three ways a guardrail fails without changing</h2>
  <p class="pe-prose" style="max-width:82ch">
    The controls that failed here mostly did not have bugs. They were correct, and something around them moved.
  </p>
  <div class="ds-grid">
    {#each FAILURE_MODES as f}
      <div class="ds-card"><h3>{f.title}</h3><p class="ds-body">{f.body}</p></div>
    {/each}
  </div>

  <div class="er-lesson">
    <span class="el-lab">The thing this page cannot show you</span>
    <p>There are no credentials, addresses, hostnames, personal details or configuration values anywhere in this
      study. That is not because they were redacted — they were never written. Every guardrail above is described by
      <b>shape</b>: what it prevents, where it sits, and how it was got wrong once.</p>
    <p>That constraint made the writing better rather than worse, which is the useful finding. The confidential part
      of a system like this is small and boring. The interesting part — the reasoning, the trade-offs, and the
      mistakes that produced them — is almost entirely publishable, and mostly is not published, which is a shame.</p>
  </div>

  <a class="pe-next" href="/projects/engine-room/trace">Back to the instrument — trace a turn →</a>
</section>

<style>
  .principle { border-left: 3px solid #8a2d3a; background: rgba(138,45,58,0.06); border-radius: 0 var(--radius-round) var(--radius-round) 0;
    padding: 13px 16px; margin: 14px 0; }
  .p-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: #8a2d3a; }
  .principle h3 { font-family: 'Fraunces', serif; font-weight: 600; font-size: 19px; margin: 5px 0 7px; color: var(--text-primary); }
  .principle p { margin: 0 0 7px; font-size: 14px; line-height: 1.6; color: rgba(28,22,17,0.78); max-width: 88ch; }
  .p-tally { font-family: 'JetBrains Mono', monospace; font-size: 11px !important; color: #8a2d3a !important; margin: 0 !important; }

  .filters { display: flex; gap: 6px; flex-wrap: wrap; margin: 16px 0 12px; }
  .filters button { font-family: 'DM Sans', sans-serif; font-size: 12.5px; color: var(--text-primary);
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-round);
    padding: 6px 13px; cursor: pointer; transition: background 0.12s, border-color 0.12s; }
  .filters button:hover { background: rgba(28,22,17,0.07); border-color: rgba(28,22,17,0.36); }
  .filters button.on { background: var(--text-primary); border-color: var(--text-primary); color: var(--bg); }

  .rails { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; }
  .rail { border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round); background: rgba(255,255,255,0.5); padding: 13px 15px; }
  .rail.req { border-color: rgba(196,87,10,0.35); background: rgba(196,87,10,0.045); }
  .r-head { display: flex; align-items: baseline; justify-content: space-between; gap: 9px; margin-bottom: 6px; }
  .r-risk { font-size: 12px; line-height: 1.45; color: rgba(28,22,17,0.6); font-style: italic; }
  .r-kind { font-family: 'JetBrains Mono', monospace; font-size: 8px; letter-spacing: 0.1em; text-transform: uppercase;
    padding: 2px 7px; border-radius: var(--radius-pill); white-space: nowrap; }
  .r-kind[data-k='boundary'] { color: #2d7a3a; background: rgba(45,122,58,0.13); }
  .r-kind[data-k='request'] { color: var(--accent); background: rgba(196,87,10,0.14); }
  .r-rail { display: block; font-family: 'Fraunces', serif; font-size: 16px; font-weight: 600; color: var(--text-primary); line-height: 1.28; margin-bottom: 6px; }
  .r-detail { margin: 0; font-size: 12.5px; line-height: 1.56; color: rgba(28,22,17,0.74); }
  .r-scar { margin-top: 9px; border-left: 2px solid #8a2d3a; background: rgba(138,45,58,0.05);
    border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0; padding: 8px 11px; }
  .rs-lab { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.1em; text-transform: uppercase; color: #8a2d3a; }
  .r-scar p { margin: 3px 0 0; font-size: 12px; line-height: 1.52; color: rgba(28,22,17,0.72); }
</style>
