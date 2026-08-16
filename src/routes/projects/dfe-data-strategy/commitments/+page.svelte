<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import NextStep from '../components/NextStep.svelte';
  import IntelInline from '../components/IntelInline.svelte';
  import CommitFilters from '../components/commitments/CommitFilters.svelte';
  import CommitShelf from '../components/commitments/CommitShelf.svelte';
  import CommitTimeline from '../components/commitments/CommitTimeline.svelte';
  import FlowMap from '../components/commitments/FlowMap.svelte';
  import CommitDemand from '../components/commitments/CommitDemand.svelte';
  import CommitDrawer from '../components/commitments/CommitDrawer.svelte';
  import { ledger, type Lens } from '../lib/commitmentsFilter.svelte';
  import { COMMITMENTS, DOCUMENTS, MUST_ANSWER } from '../lib/commitments';

  const LENSES: { id: Lens; label: string; hint: string }[] = [
    { id: 'shelf', label: '▤ The shelf', hint: 'Every document, and what each commits the department to' },
    { id: 'timeline', label: '⧗ The timeline', hint: 'When the commitments must land' },
    { id: 'flow', label: '⇄ The flow map', hint: 'The new data flows between organisations' },
    { id: 'demand', label: '◈ The demand', hint: 'What it all asks of the strategy' },
  ];

  const flowPairs = new Set(COMMITMENTS.flatMap((c) => c.flows.map((f) => `${f.from}→${f.to}`))).size;
  const statutory = COMMITMENTS.filter((c) => c.status === 'statutory-duty' || c.status === 'legislated-not-commenced').length;

  onMount(() => {
    const p = $page.url.searchParams;
    const lens = p.get('lens');
    if (lens === 'shelf' || lens === 'timeline' || lens === 'flow' || lens === 'demand') ledger.lens = lens;
    const c = p.get('c');
    if (c && COMMITMENTS.some((x) => x.id === c)) ledger.select(c);
  });
</script>

<svelte:head>
  <title>The commitments ledger — Keystone</title>
  <meta
    name="description"
    content="Every data-relevant commitment in the 2024–26 white-paper landscape that the department must deliver, support or comply with — explorable by document, timeline, data-flow map and strategic demand."
  />
</svelte:head>

<div class="pe-route wide">
  <StoryMasthead
    kicker="Understand · The commitments ledger"
    title="What the department is already committed to"
    thesis="Before anyone writes a line of strategy, government has already made the promises. Acts, white papers and cross-government mandates from 2024–26 commit the department to new services, new registers, new identifiers and new flows of data between partners. This ledger holds every data-relevant commitment — sourced, dated, and interpreted for what it demands of the strategy."
    thesisEli5="The government has already promised lots of things that need data — new IDs for children, new registers, new ways of sharing. This page lists every promise and what it means for the department's data plan."
    asks={['Every commitment, traced to its document and section', 'The new data flows and partnerships each one creates', 'What the strategy must say because of it']}
    askLabel="What the ledger holds"
  />

  <div class="stats" aria-label="Ledger totals">
    <div class="stat"><b>{COMMITMENTS.length}</b><span>commitments</span></div>
    <div class="stat"><b>{DOCUMENTS.length}</b><span>documents</span></div>
    <div class="stat"><b>{flowPairs}</b><span>new data flows</span></div>
    <div class="stat hard"><b>{statutory}</b><span>statutory or legislated</span></div>
    <div class="stat"><b>{MUST_ANSWER.length}</b><span>must-answer now</span></div>
  </div>

  <IntelInline section="commitments" note="the watched programmes — spine, registers, profiles" />

  <nav class="lenses" aria-label="Ways to read the ledger">
    {#each LENSES as l}
      <button class="lens" class:on={ledger.lens === l.id} title={l.hint} onclick={() => (ledger.lens = l.id)}>{l.label}</button>
    {/each}
  </nav>

  <CommitFilters />

  {#if ledger.lens === 'shelf'}
    <CommitShelf />
  {:else if ledger.lens === 'timeline'}
    <CommitTimeline />
  {:else if ledger.lens === 'flow'}
    <FlowMap />
  {:else}
    <CommitDemand />
  {/if}

  <NextStep
    links={[
      { label: 'Write the strategy these demand', href: '/projects/dfe-data-strategy/author', kind: 'primary' },
      { label: 'The pressures landscape', href: '/projects/dfe-data-strategy/landscape' },
      { label: 'The legal stack behind the flows', href: '/projects/dfe-data-strategy/legislation' },
    ]}
  />
</div>

<CommitDrawer />

<style>
  .stats {
    display: flex;
    gap: 12px 26px;
    flex-wrap: wrap;
    margin: 2px 0 16px;
    padding: 13px 20px;
    border: 1px solid rgba(28, 22, 17, 0.14);
    border-radius: var(--radius-sharp);
    background: rgba(255, 255, 255, 0.5);
  }
  .stat {
    display: flex;
    flex-direction: column;
  }
  .stat b {
    font-family: var(--fs-serif);
    font-size: 27px;
    font-weight: 600;
    line-height: 1.05;
    color: var(--ink);
  }
  .stat.hard b {
    color: #b04a2f;
  }
  .stat span {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.55);
  }
  .lenses {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .lens {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    font-weight: 500;
    padding: 8px 16px;
    border: 1px solid rgba(28, 22, 17, 0.25);
    border-radius: var(--radius-sharp);
    background: rgba(255, 255, 255, 0.55);
    color: var(--ink);
    cursor: pointer;
  }
  .lens:hover {
    background: rgba(28, 22, 17, 0.07);
  }
  .lens.on {
    background: var(--ink);
    color: var(--paper, #f1ead6);
    border-color: var(--ink);
  }
</style>
