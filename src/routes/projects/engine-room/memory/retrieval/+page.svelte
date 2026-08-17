<script lang="ts">
  // Finding things — Part II, leaf 1.
  //
  // The instrument is the argument: a real passage cut into overlapping chunks, with the
  // split nudged back to a sentence boundary in front of the reader. Everything else is a
  // dial reading. The two indexes are drawn as two bars precisely because they are two —
  // merging them into one "embedding space" would be the wrong picture.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Bars from '../../components/viz/Bars.svelte';
  import Chunker from './components/Chunker.svelte';
  import { RETRIEVAL } from '../../lib/memory';

  const TONE = 'var(--accent)';

  // The two indexes, from RETRIEVAL[1] and RETRIEVAL[2]. Deliberately separate: a lane is a
  // job, and each job gets its own embedding and its own passage count.
  const INDEXES = [
    { label: 'Per-collection index', value: 3072, note: 'Chat with a chosen collection · 10 passages', muted: false },
    { label: 'Always-on index', value: 1536, note: 'File mentions in chat · 8 passages', muted: true },
  ];

  // The remaining constants, one line each. SHORT only compresses the wording of the
  // constant's own `why`; anything unlisted falls back to the constant verbatim, so a
  // renamed key can never blank the readout.
  const SHORT: Record<string, string> = {
    'Where the index lives': 'No second store to keep in sync, no separate service to be down on its own.',
    'What is retrieved': 'Each passage arrives carrying where it came from, so a claim can be traced back.',
    'Who may see it': 'Scoped to what the requester may read, before anything reaches a prompt.',
  };
  const REST = RETRIEVAL.slice(3).map((r) => ({ k: r.k, v: r.v, why: SHORT[r.k] ?? r.why }));

  let pick = $state(0);
  const picked = $derived(REST[Math.min(pick, REST.length - 1)] ?? null);
</script>

<svelte:head>
  <title>Retrieval · The Engine Room</title>
  <meta name="description" content="How a document becomes searchable chunks, why there are two embedding indexes rather than one, and what comes back." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="memory"
    title="Retrieval"
    line="Keeping a document and finding it again are two entirely different problems, and only one of them is easy. A document gets cut, embedded and permission-filtered long before a prompt lays eyes on it."
    lineEli5="Saving a document is the easy half. The hard half is pulling out the one right paragraph months later — so every document is cut up, indexed and permission-checked long before any question is asked of it." />

  <Instrument
    kicker="The instrument"
    title="Cutting a document into chunks"
    tone={TONE}
    reading="This section's own notes, cut at the live setting. Drag a dial, or turn the nudge off."
    readingEli5="This page's own notes, cut up exactly as the live system would cut them. Drag a dial and watch where the cuts fall."
    takeaway="Two guards against chopping a fact in half: 150 characters repeated across every cut, and the split shuffled back to the end of a sentence. Cut mid-clause and you get a chunk confidently asserting the opposite of what was written."
    takeawayEli5="Two guards stop a fact being chopped in half: each cut overlaps the last by 150 characters, and cuts are nudged back to the end of a sentence. Without them, half a sentence can end up confidently saying the opposite of what was written.">
    <Chunker />
  </Instrument>

  <Instrument
    kicker="Two indexes, on purpose"
    title="Different jobs, different budgets"
    tone={TONE}
    reading="Two separate indexes, kept apart on purpose rather than one big shared space."
    readingEli5="Two separate search indexes, kept apart on purpose rather than merged into one."
    takeaway="The dearer embedding only gets used where somebody deliberately picked a collection. Everywhere else makes do, and nobody has ever noticed."
    takeawayEli5="The dearer, more detailed index is saved for when someone deliberately picks a set of documents to ask about. Everything else uses the cheaper one — a saving nobody has ever noticed in use, which is the best kind.">
    <Bars items={INDEXES} unit=" dims" tone={TONE} />
    <p class="foot">Both discard anything below a minimum similarity rather than padding the list out.</p>
  </Instrument>

  <Instrument
    kicker="The rest of the rig"
    title="The other decisions"
    tone={TONE}
    reading="Pick one."
    readingEli5="Pick one for the reasoning behind it.">
    <div class="kvs">
      {#each REST as r, i (r.k)}
        <button class="kv" class:on={pick === i} aria-pressed={pick === i} onclick={() => (pick = i)}>
          <span class="kv-k">{r.k}</span>
          <span class="kv-v">{r.v}</span>
        </button>
      {/each}
    </div>
    <p class="readout" aria-live="polite">{picked?.why ?? ''}</p>
  </Instrument>

  <PageFoot />
</section>

<style>
  .foot { margin: 10px 0 0; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.55); max-width: 88ch; }

  .kvs { display: grid; grid-template-columns: repeat(auto-fit, minmax(178px, 1fr)); gap: 6px; }
  .kv { display: flex; flex-direction: column; gap: 3px; align-items: flex-start; text-align: left;
    padding: 8px 11px; min-width: 0; cursor: pointer; font-family: inherit;
    border: 1px solid rgba(28,22,17,0.16); border-left: 3px solid rgba(28,22,17,0.16);
    border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0; background: rgba(255,255,255,0.55);
    transition: background 0.13s, border-color 0.13s; }
  .kv:hover { background: rgba(255,255,255,0.9); border-color: rgba(28,22,17,0.34); }
  .kv.on { border-left-color: var(--accent); background: color-mix(in srgb, var(--accent) 9%, transparent); }
  .kv-k { font-size: var(--fs-label-xs); line-height: 1.3; color: rgba(28,22,17,0.7); overflow-wrap: anywhere; }
  .kv-v { font-family: var(--font-mono); font-size: var(--fs-nav); font-weight: 600;
    letter-spacing: -0.01em; color: var(--text-primary); }

  .readout { margin: 10px 0 0; font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.7);
    min-height: 2.6em; max-width: 82ch; }
  .readout::before { content: '▸ '; color: var(--accent); }
</style>
