<script lang="ts">
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import EntityResolver from './components/EntityResolver.svelte';
  import { RETRIEVAL, DATASTORE, GRAPH_FACTS } from '../lib/memory';
  import { app } from '../lib/appState.svelte';

  const eli = $derived(app.narrative === 'eli5');
</script>

<svelte:head>
  <title>Memory — retrieval, the graph and entity resolution · The Engine Room</title>
  <meta name="description" content="How a personal system remembers: documents you can question, a knowledge graph that resolves duplicate entities overnight, and a flexible store for everything not worth a migration." />
</svelte:head>

<section class="pe-route wide">
  <StoryMasthead
    kicker="Section 5 · Memory"
    title="What it knows, and how it finds it again"
    thesis="There is one database. Inside it: ordinary typed tables for things with a known shape, a schema-free store for the long tail that is not worth a migration, an embedding index so retrieval works on meaning rather than exact words, and a graph of entities and the relationships between them. The hardest problem here is not storing anything. It is deciding when two records are the same thing."
    thesisEli5="Everything it knows lives in one place: normal tables for tidy things, a flexible store for messy things, a search index that understands meaning rather than exact words, and a web of people and organisations and how they connect. The hard part is not remembering. It is working out when two notes are about the same person."
    asks={[
      'How do you search notes by what they mean rather than what they say?',
      'When are two records the same person — and what happens when you get that wrong?',
      'Why is caching an expensive calculation sometimes about accuracy rather than speed?',
    ]}
  />

  <h2 class="pe-h2">Retrieval</h2>
  <p class="pe-prose" style="max-width:82ch">
    {#if eli}
      Documents are broken into passages, and each passage is turned into a list of numbers that captures its
      meaning. A question becomes numbers the same way, and the closest passages come back — so asking about
      “time off” finds a note that only ever says “annual leave”.
    {:else}
      Documents, extracted facts and graph entities all embed into a single shared vector space, so one query can
      reach across all three. Retrieved passages arrive carrying their provenance, and are filtered to what the
      requester may see before anything is assembled into a prompt.
    {/if}
  </p>
  <div class="grid4">
    {#each RETRIEVAL as r}
      <div class="cell"><span class="ce-k">{r.k}</span><b>{r.v}</b><span class="ce-w">{r.why}</span></div>
    {/each}
  </div>

  <div class="er-lesson">
    <span class="el-lab">This page is the demonstration</span>
    <p>The <b>Ask the system</b> button in the corner is the thing this section describes. It retrieves over a corpus
      assembled from this study's own content, ranks passages, and streams an answer with its sources shown — and it
      refuses anything outside its scope. It is a lexical index rather than a vector one, because the corpus is small
      enough that the simpler tool is the better tool. That choice is also part of the point.</p>
  </div>

  <h2 class="pe-h2">When are two records the same thing?</h2>
  <p class="pe-prose" style="max-width:82ch">
    {#if eli}
      A name arrives a dozen different ways: reversed, abbreviated, with a company after it, as an acronym. Something
      has to decide when two of them are one person — and be right, because merging two different people destroys
      information you cannot get back. Toggle the evidence and watch it decide.
    {:else}
      Entity resolution runs overnight, algorithmically and explainably. The strongest name-or-address signal sets a
      base confidence; structural and semantic corroboration adjust it; and only a score above the bar merges without
      a human. Toggle the signals.
    {/if}
  </p>

  <EntityResolver />

  <div class="er-lesson">
    <span class="el-lab">What it looked like before this existed</span>
    <p>The ladder above is not decoration. Before it, a duplicate sweep found <b>561 candidate pairs and merged
      none of them</b> — not one cleared the bar — and <b>396 of those 561 were sitting at exactly 0.55</b>, the score
      for the weakest signal in the set. Every genuine duplicate in the graph was pinned to the same
      indistinguishable value, so no threshold could have separated them.</p>
    <p>That is what a scoring function with too few signals looks like from the outside: not obviously broken, just
      permanently undecided. The fix was more <i>kinds</i> of evidence — structural and semantic corroboration that
      names alone cannot reach — rather than a different number.</p>
  </div>

  <h2 class="pe-h2">Five things the graph taught</h2>
  <div class="ds-grid">
    {#each GRAPH_FACTS as g}
      <div class="ds-card">
        <h3>{g.title}</h3>
        <p class="ds-body">{g.body}</p>
        <p class="g-lesson">▸ {g.lesson}</p>
      </div>
    {/each}
  </div>

  <h2 class="pe-h2">The store for everything else</h2>
  <p class="pe-prose" style="max-width:82ch">
    {#if eli}
      Not everything deserves its own carefully designed table. There is a flexible store for the odds and ends — with
      proper permissions, a record of who changed what, and the option to make things expire.
    {:else}
      Typed tables are right when the shape is known and stable. They are the wrong tool for the long tail, where the
      cost of a migration exceeds the value of the structure. The datastore covers that tail without giving up the
      things that actually matter.
    {/if}
  </p>
  <div class="ds-grid">
    {#each DATASTORE as d}
      <div class="ds-card compact">
        <h3>{d.k}</h3>
        <p class="ds-body">{d.why}</p>
      </div>
    {/each}
  </div>

  <div class="er-lesson">
    <span class="el-lab">A trap worth naming</span>
    <p>Passing an array as a single query parameter looks like it works. It binds as a <b>row constructor</b>, not a
      list — so it is correct for one element and silently wrong for two or more. It passes every test written with a
      single item, which is most tests, and fails the first time real data arrives.</p>
    <p>The general shape: <b>a bug whose smallest reproduction is larger than the case you naturally test</b>. Those
      are worth writing down when you find them, because you will not find them twice.</p>
  </div>

  <a class="pe-next" href="/projects/engine-room/research">Next — research, sources, and not making things up →</a>
</section>

<style>
  .grid4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin: 14px 0; }
  .cell { border: 1px solid rgba(28,22,17,0.15); border-radius: var(--radius-round); background: rgba(255,255,255,0.5);
    padding: 11px 13px; display: flex; flex-direction: column; gap: 2px; }
  .ce-k { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.11em; text-transform: uppercase; color: rgba(28,22,17,0.5); }
  .cell b { font-family: 'Fraunces', serif; font-size: 16px; font-weight: 600; color: var(--text-primary); }
  .ce-w { font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.68); margin-top: 3px; }

  .g-lesson { margin: 9px 0 0; font-size: 12px; line-height: 1.5; color: var(--accent-ink);
    padding-top: 8px; border-top: 1px solid rgba(28,22,17,0.09); }
  :global(.ds-card.compact h3) { font-size: 14.5px; }
</style>
