<script lang="ts">
  // How things connect — Part II, leaf 3.
  //
  // One finding carries this page: the fast option is the wrong one. So the flagship
  // instrument refuses to separate speed from fidelity — picking an approach moves both
  // readings at once, and choosing the quarter-second run lights eight of fifty cells red.
  // The old version told this as three paragraphs, which let a reader take the speed-up away
  // and never notice what the fastest of the three paid for it in.
  //
  // Below it: the nightly merge cap drawn as a blast radius rather than stated as a number,
  // and the flexible store compressed from six explanatory cards into one selectable strip.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Stat from '../../components/viz/Stat.svelte';
  import RankingBench from './components/RankingBench.svelte';
  import { NIGHTLY_CAP } from './data';
  import { DATASTORE } from '../../lib/memory';

  const TONE = 'var(--accent)';

  const pairs = Array.from({ length: NIGHTLY_CAP }, (_, i) => i);

  let ds = $state(0);
  const dsSel = $derived(DATASTORE[ds]);
</script>

<svelte:head>
  <title>How things connect · The Engine Room</title>
  <meta name="description" content="Why an exact ranking of the most connected entities was cached rather than approximated, and what the approximation got wrong." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="memory"
    title="How things connect"
    line="Ranking the most connected entities exactly took forty seconds. Changing how the data was laid out — not the algorithm — brought it to 1.7, bit for bit identical."
    lineEli5="Working out which things are most connected took forty seconds. Storing the data differently made it much quicker, with exactly the same answer." />

  <Instrument
    kicker="The instrument"
    title="Three ways to rank the most connected"
    tone={TONE}
    reading="Pick an approach. Time along the top, then what its answer actually looks like."
    takeaway="The twenty-four-fold win came from the data layout, before anyone considered giving up precision. The approximation was rejected; the exact result is cached for a minute instead.">
    <RankingBench />
  </Instrument>

  <aside class="note">
    <span class="n-kick">The cache has its own failure</span>
    <p>
      The analysis runs in the background, shared between callers. A merge landing mid-computation
      would let a snapshot that predates it install itself. A generation counter is taken at the
      start and checked before storing.
    </p>
  </aside>

  <Instrument
    kicker="The cap"
    title="A blast radius, not a rate limit"
    tone={TONE}
    reading="Each square is one merge the nightly pass is allowed to make."
    takeaway="At 4am the useful question is not how fast it can go, but how much it can get wrong before someone looks.">
    <div class="blast">
      <div class="dots" role="img"
           aria-label="{NIGHTLY_CAP} squares — the most pairs the nightly pass may merge before it stops.">
        {#each pairs as p (p)}<span class="dot"></span>{/each}
      </div>
      <Stat
        value={NIGHTLY_CAP}
        unit="pairs"
        label="the most one night may merge"
        how="Every merge is reversible, as a routine operation."
        tone={TONE}
        lead />
    </div>
  </Instrument>

  <Instrument
    kicker="Underneath"
    title="One store, six properties"
    tone={TONE}
    reading="What the schema-free store provides. Pick one.">
    <div class="strip">
      <div class="chips" role="group" aria-label="Six properties of the flexible store">
        {#each DATASTORE as d, i (d.k)}
          <button type="button" class="chip" class:on={ds === i} aria-pressed={ds === i}
                  onclick={() => (ds = i)} title={d.why}>{d.k}</button>
        {/each}
      </div>
      <p class="why" aria-live="polite">{dsSel.why}</p>
    </div>
  </Instrument>

  <PageFoot />
</section>

<style>
  .note { display: flex; flex-direction: column; gap: 4px; margin: -6px 0 22px;
    padding: 10px 14px; border-left: 3px solid var(--accent);
    border-radius: 0 var(--radius-round) var(--radius-round) 0;
    background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .n-kick { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--accent); }
  .note p { margin: 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.74); max-width: 82ch; }

  .blast { display: flex; align-items: center; gap: 14px 22px; flex-wrap: wrap; }
  .dots { display: flex; flex-wrap: wrap; gap: 5px; max-width: 260px; min-width: 0; }
  .dot { width: 14px; height: 14px; border-radius: 2px;
    background: color-mix(in srgb, var(--accent) 42%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 60%, transparent); }

  .strip { display: flex; flex-direction: column; gap: 9px; min-width: 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip { font-family: 'DM Sans', sans-serif; font-size: 11.5px; line-height: 1.25;
    color: var(--text-primary); background: rgba(255,255,255,0.6);
    border: 1px solid rgba(28,22,17,0.18); border-radius: var(--radius-round);
    padding: 5px 11px; cursor: pointer; transition: background 0.12s, border-color 0.12s; }
  .chip:hover { background: rgba(28,22,17,0.07); border-color: rgba(28,22,17,0.34); }
  .chip.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  .why { margin: 0; min-height: 3em; font-size: 12.5px; line-height: 1.55;
    color: rgba(28,22,17,0.72); max-width: 80ch; }

  @media (max-width: 560px) {
    .why { min-height: 0; }
  }
</style>
