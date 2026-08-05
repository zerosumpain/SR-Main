<script lang="ts">
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import ProvenanceDemo from './components/ProvenanceDemo.svelte';
  import { RESEARCH_FACTS, CONNECTOR_LESSON, SEARCH_LESSON, DESK } from '../lib/research';
  import { app } from '../lib/appState.svelte';

  const eli = $derived(app.narrative === 'eli5');
</script>

<svelte:head>
  <title>Research — sources, provenance and not making things up · The Engine Room</title>
  <meta name="description" content="A research capability that gathers sources, extracts facts individually, and states what no source says — because a summariser asked to bridge a gap will bridge it." />
</svelte:head>

<section class="pe-route wide">
  <StoryMasthead
    kicker="Section 6 · Research"
    title="Finding things out, without making them up"
    thesis="Ask a system to research something and it will search, read, and write you a summary. The summary is the problem. Merging several sources into one narrative destroys the record of which source said what — and once that record is gone, a claim that appeared in none of them is indistinguishable from one that appeared in all three. The fix is structural rather than a matter of better instructions."
    thesisEli5="If you ask an AI to research something and summarise it, the summary quietly loses track of where each fact came from. Once that is lost, an invented sentence looks exactly like a true one. The fix is to make it list facts with their sources first, and to make it say plainly what none of the sources actually covered."
    asks={[
      'Why does summarising several sources make things up, even when every source is true?',
      'What does it take for a claim to remain checkable?',
      'How do you know a connected service is working right now, rather than that it worked once?',
    ]}
  />

  <h2 class="pe-h2">Where fabrication comes from</h2>
  <p class="pe-prose" style="max-width:82ch">
    {#if eli}
      Here are three real-looking sources. Compose an answer from them two different ways and watch what happens to
      a sentence that nobody wrote.
    {:else}
      This is not a hallucination in the usual sense — no fact is invented from nothing. Two adjacent true facts are
      fused into a causal claim that neither supports, which is both more plausible and harder to catch.
    {/if}
  </p>

  <ProvenanceDemo />

  <div class="er-lesson">
    <span class="el-lab">Why instructions do not fix this</span>
    <p>“Do not state anything the sources do not support” is a request, and it is fighting the shape of the task. A
      model asked to write a flowing summary is being asked to make things join up; bridging a gap <b>is</b> the job
      it was given. It will do it well, and the join will read better than the sources did.</p>
    <p>Giving it somewhere else to put the gap changes what the task is. Facts go in one list with their sources;
      what nothing covers goes in another list, explicitly. <b>The structure removes the pressure that produced the
      invention</b> — which is a more reliable intervention than asking more firmly.</p>
  </div>

  <h2 class="pe-h2">How a research run is put together</h2>
  <div class="grid">
    {#each RESEARCH_FACTS as r}
      <div class="cell"><b>{r.k}</b><span>{r.why}</span></div>
    {/each}
  </div>

  <h2 class="pe-h2">The desk you work at afterwards</h2>
  <p class="pe-prose" style="max-width:82ch">
    {#if eli}
      When a research run finishes you do not get an essay. You get a table of individual facts, each with its source
      and how confident it is, that you can sort and filter and disagree with.
    {:else}
      The output of a run is deliberately a corpus, not a document. Composing prose is something you do <i>from</i>
      the table, at the moment you need it — and because the table survives, the prose can always be regenerated with
      its provenance intact.
    {/if}
  </p>
  <div class="grid">
    {#each DESK as d}
      <div class="cell"><b>{d.k}</b><span>{d.why}</span></div>
    {/each}
  </div>

  <h2 class="pe-h2">Two lessons about believing your own dashboards</h2>
  <div class="ds-grid two">
    <div class="ds-card">
      <span class="ds-kicker">Connector health</span>
      <h3>{CONNECTOR_LESSON.title}</h3>
      <p class="ds-body">{CONNECTOR_LESSON.body}</p>
      <p class="fix">▸ {CONNECTOR_LESSON.fix}</p>
    </div>
    <div class="ds-card">
      <span class="ds-kicker">A tool that "returned nothing"</span>
      <h3>{SEARCH_LESSON.title}</h3>
      <p class="ds-body">{SEARCH_LESSON.body}</p>
      <p class="fix">▸ {SEARCH_LESSON.fix}</p>
    </div>
  </div>

  <a class="pe-next" href="/projects/engine-room/automation">Next — things that happen without being asked →</a>
</section>

<style>
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 10px; margin: 14px 0; }
  .cell { border: 1px solid rgba(28,22,17,0.15); border-radius: var(--radius-round); background: rgba(255,255,255,0.5); padding: 11px 13px; }
  .cell b { display: block; font-family: 'Fraunces', serif; font-size: 15px; font-weight: 600; color: var(--text-primary); line-height: 1.28; }
  .cell span { display: block; font-size: 12.5px; line-height: 1.52; color: rgba(28,22,17,0.7); margin-top: 5px; }
  .fix { margin: 9px 0 0; font-size: 12px; line-height: 1.52; color: var(--accent-ink);
    padding-top: 8px; border-top: 1px solid rgba(28,22,17,0.09); }
</style>
