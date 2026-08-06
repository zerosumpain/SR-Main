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
  <title>Finding things · The Engine Room</title>
  <meta name="description" content="How a document becomes searchable chunks, why there are two embedding indexes rather than one, and what comes back." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="memory"
    title="Finding things"
    line="Storing something and finding it again are different problems. A document is cut, embedded and permission-filtered before a prompt sees it."
    lineEli5="Saving a document is easy. Pulling out the right paragraph months later is the hard part." />

  <Instrument
    kicker="The instrument"
    title="Cutting a document into chunks"
    tone={TONE}
    reading="This section's own notes, cut at the live setting. Drag a dial, or turn the nudge off."
    takeaway="Two guards: 150 characters repeated across each cut, and the split moved back to a sentence end — so no fact is severed.">
    <Chunker />
  </Instrument>

  <Instrument
    kicker="Two indexes, on purpose"
    title="Different jobs, different budgets"
    tone={TONE}
    reading="Two separate indexes, not one shared space."
    takeaway="The costlier embedding goes only where a collection was chosen deliberately.">
    <Bars items={INDEXES} unit=" dims" tone={TONE} />
    <p class="foot">Both discard anything below a minimum similarity rather than padding the list out.</p>
  </Instrument>

  <Instrument
    kicker="The rest of the rig"
    title="The other decisions"
    tone={TONE}
    reading="Pick one.">
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
  .foot { margin: 10px 0 0; font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.55); max-width: 88ch; }

  .kvs { display: grid; grid-template-columns: repeat(auto-fit, minmax(178px, 1fr)); gap: 6px; }
  .kv { display: flex; flex-direction: column; gap: 3px; align-items: flex-start; text-align: left;
    padding: 8px 11px; min-width: 0; cursor: pointer; font-family: inherit;
    border: 1px solid rgba(28,22,17,0.16); border-left: 3px solid rgba(28,22,17,0.16);
    border-radius: 0 var(--radius-round) var(--radius-round) 0; background: rgba(255,255,255,0.55);
    transition: background 0.13s, border-color 0.13s; }
  .kv:hover { background: rgba(255,255,255,0.9); border-color: rgba(28,22,17,0.34); }
  .kv.on { border-left-color: var(--accent); background: color-mix(in srgb, var(--accent) 9%, transparent); }
  .kv-k { font-size: 11.5px; line-height: 1.3; color: rgba(28,22,17,0.7); overflow-wrap: anywhere; }
  .kv-v { font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 600;
    letter-spacing: -0.01em; color: var(--text-primary); }

  .readout { margin: 10px 0 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.7);
    min-height: 2.6em; max-width: 82ch; }
  .readout::before { content: '▸ '; color: var(--accent); }
</style>
