<script lang="ts">
  // The filing cabinet — Part III, leaf 3.
  //
  // The finding: "searchable" is a per-modality claim wearing a uniform interface. One index,
  // one query and one permission model — but a photograph only reaches that index because a
  // model wrote a description of it first, and two of the six kinds never reach it at all.
  // The instrument's job is to make the reader meet the branch rather than read about it.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Stat from '../../components/viz/Stat.svelte';
  import FilePipeline from './components/FilePipeline.svelte';
  import FolderPolicy from './components/FolderPolicy.svelte';
  import { DRIVE_FACTS, HASH_GATE, INDEX } from '../../lib/drive';

  const TONE = 'var(--success)';
  let fact = $state(0);
  const chosen = $derived(DRIVE_FACTS[fact]);
</script>

<svelte:head>
  <title>The filing cabinet · The Engine Room</title>
  <meta name="description" content="A document store you can ask questions of: what a photograph, a voice memo and a spreadsheet each have to become before one index can find them all." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="reach"
    title="The filing cabinet"
    line="Keeping a document is easy. Being able to ask it a question means turning six kinds of file into the one thing a search index actually understands — and being honest about which two never make it."
    lineEli5="Anything dropped in can be searched by what is inside it — except a photo has to be described by a model first, and a video is not read at all. The search box is uniform; the work behind it is not." />

  <Instrument
    kicker="The instrument"
    title="Six kinds in, one index out"
    tone={TONE}
    reading="Pick a kind of file and follow it."
    readingEli5="Pick a kind of file and follow its journey to the search index."
    takeaway="A photograph has no text, so a model writes some for it — a plain description plus whatever words are visible in the picture — and that description is what search is really matching on. The uniform surface is genuine. The uniform capability behind it is a polite fiction."
    takeawayEli5="A photograph has no text, so a model writes some — a description plus any words visible in the picture — and that is what search actually matches on. The uniform search box is real; the sameness behind it is a polite fiction.">
    <FilePipeline />
  </Instrument>

  <aside class="note">
    <span class="n-kick">{HASH_GATE.title}</span>
    <p>{HASH_GATE.body}</p>
  </aside>

  <Instrument
    kicker="Underneath"
    title="Folders that do not exist, with two inheritance rules"
    tone={TONE}
    reading="Set a policy anywhere on the path. The verdict for a file in the deepest folder is computed below it."
    readingEli5="Set a rule anywhere along the path. The verdict for the deepest file is worked out underneath."
    takeaway="Exclude the whole tree, re-include one folder inside it, and the file feeds the graph — while a label from the excluded parent still applies to it. One setting takes the nearest answer; the other takes all of them."
    takeawayEli5="Exclude a whole tree, re-allow one folder inside it, and files there count again — while a label from the excluded parent still applies to them. One setting takes the nearest answer; the other takes all of them.">
    <FolderPolicy />
  </Instrument>

  <Instrument
    kicker="The rest of it"
    title="Six properties of the store"
    tone={TONE}
    reading="Pick one.">
    <div class="strip">
      <div class="chips" role="group" aria-label="Properties of the document store">
        {#each DRIVE_FACTS as f, i (f.k)}
          <button type="button" class="chip" class:on={fact === i} aria-pressed={fact === i}
                  onclick={() => (fact = i)}>{f.k}<em>{f.v}</em></button>
        {/each}
      </div>
      <p class="why" aria-live="polite">{chosen.why}</p>
    </div>
    <div class="stats">
      <Stat value={INDEX.globalDims.toLocaleString('en-GB')} label="dimensions, always-on index"
            how="the cheaper embedding, over every file" tone={TONE} />
      <Stat value={INDEX.collectionDims.toLocaleString('en-GB')} label="dimensions, on request"
            how="the better embedding, for a collection you have chosen to talk to" tone={TONE} />
      <Stat value={INDEX.topK} label="passages returned by default"
            how="anything below the similarity floor is dropped, not padded" tone={TONE} />
      <Stat value={INDEX.maxIndexableMb} unit="MB" label="most that is ever read into memory"
            how="the always-on machine is memory-bound; one large file would take it down" tone={TONE} />
    </div>
  </Instrument>

  <PageFoot />
</section>

<style>
  .note { display: flex; flex-direction: column; gap: 4px; margin: -6px 0 22px;
    padding: 10px 14px; border-left: 3px solid var(--success);
    border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0;
    background: color-mix(in srgb, var(--success) 8%, transparent); }
  .n-kick { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--success); }
  .note p { margin: 0; font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.74); max-width: 82ch; }

  .strip { display: flex; flex-direction: column; gap: 9px; min-width: 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip { display: inline-flex; align-items: baseline; gap: 7px; font-family: var(--font-body);
    font-size: var(--fs-label-xs); line-height: 1.25; color: var(--text-primary); background: rgba(255,255,255,0.6);
    border: 1px solid rgba(28,22,17,0.18); border-radius: var(--radius-sharp);
    padding: 5px 11px; cursor: pointer; transition: background 0.12s, border-color 0.12s; }
  .chip em { font-style: normal; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: rgba(28,22,17,0.45); }
  .chip:hover { background: rgba(28,22,17,0.07); border-color: rgba(28,22,17,0.34); }
  .chip.on { background: var(--success); border-color: var(--success); color: #fff; }
  .chip.on em { color: rgba(255,255,255,0.7); }
  .why { margin: 0; min-height: 3em; font-size: var(--fs-label); line-height: 1.55;
    color: rgba(28,22,17,0.72); max-width: 84ch; }

  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 9px; margin-top: 12px; }


  @media (max-width: 560px) { .why { min-height: 0; } }
</style>
