<script lang="ts">
  // The build's memory — Part IV, leaf 4. The standalone deep dive on the build-history
  // graph: what it is for, how it is keyed, what it holds, and what it is worth against
  // a static briefing. Runs longer than a typical leaf on purpose — it is the study's
  // one deep dive — but every figure still traces to lib/lessons.ts, counted 17 August
  // 2026, and the worked example uses stand-in paths only.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Bars from '../../components/viz/Bars.svelte';
  import Stat from '../../components/viz/Stat.svelte';
  import RecallBench from './components/RecallBench.svelte';
  import { app } from '../../lib/appState.svelte';
  import {
    KEYS_NOTE, EVIDENCE, CHANNELS, CORPUS, LATENCY, HYGIENE, FEEDBACK, BASELINE,
  } from '../../lib/lessons';

  const TONE = '#8a2d3a';
  const eli = $derived(app.narrative === 'eli5');

  // Coverage, drawn from the constants: what a static briefing described against what
  // the graph can key on. Same scale, so the gap is the argument.
  const COVERAGE = [
    { label: 'Files in the codebase', value: 3_359 },
    { label: 'Described by the static digest', value: 60, tone: 'var(--accent)' },
  ];

  let ev = $state(0);
  const chosenEv = $derived(EVIDENCE[ev]);
  let hy = $state(0);
  const chosenHy = $derived(HYGIENE[hy]);
  let ch = $state(0);
  const chosenCh = $derived(CHANNELS[ch]);
  let lat = $state(0);
  const chosenLat = $derived(LATENCY[lat]);
</script>

<svelte:head>
  <title>The build's memory · The Engine Room</title>
  <meta name="description" content="A knowledge graph of what building this system has already taught it: keyed on files and failures rather than prose, pushed into every build, and honest about what one helpful serve is worth." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="change"
    title="The build's memory"
    line="A second knowledge graph, deliberately separate from the first: not about the world, but about this codebase and what building it has already taught the machine. Keyed on file sets and gate fingerprints, because that is what a build actually has in its hands."
    lineEli5="The system that builds new features used to start every job with amnesia — repeating searches it had done before and mistakes it had already paid for. This page is about the memory it was given, and what remembering is worth." />

  <div class="pe-prose intro">
    {#if eli}
      <p>
        When the builder is asked for something, it works in attempts: write the code, run the
        checks, read the failures, try again. On average a finished job took
        {BASELINE.iterationsPerBuild} attempts, and each attempt spent a striking amount of its
        time rediscovering the codebase — the same files read over and over, the same dead ends
        walked twice. Worse, what an attempt learned died with it.
      </p>
      <p>
        The usual fix is a written briefing pasted into every job. That was tried; it described
        sixty files out of three thousand, because a static summary cannot know which sixty the
        next job will need. So instead there is a memory: every failure, every fix and every
        hard-won note is filed against the exact files and errors it concerns, and each new job
        is handed precisely the slice of history that touches what it is about to do. The filing
        and the finding are free — no AI is involved in either.
      </p>
    {:else}
      <p>
        The builder iterates: generate, run the gate, read the diagnostics, go again — historically
        {BASELINE.iterationsPerBuild} iterations per completed build, with {BASELINE.failingPct}%
        of builds failing outright. The instrumented waste is rediscovery, and the deeper problem
        is that anything one iteration learned evaporated with its transcript — over a third of
        historical build sessions no longer have one.
      </p>
      <p>
        The graph replaces a static codebase digest with targeted recall. Nodes are files and
        gates, because those persist; episodes (a verified fail → fix → pass) and curated lessons
        hang off them. Retrieval is keyed on the file set in hand and the fingerprint of the last
        gate error — both mechanical, both already in the build record, both free of any model
        call — and the result is pushed into the prompt before the attempt begins.
      </p>
    {/if}
  </div>

  <Instrument
    kicker="The instrument"
    title="Ask it what it remembers"
    tone={TONE}
    reading="Three ways a query forms — from a failure, from the files in hand, or from words. Pick one."
    readingEli5="Three ways to ask the memory a question. Pick one and read what comes back, and how fast."
    takeaway={KEYS_NOTE.body}
    takeawayEli5={KEYS_NOTE.body}>
    <RecallBench tone={TONE} />
  </Instrument>

  <Instrument
    kicker="Against the alternative"
    title="A briefing cannot know what you'll need"
    tone={TONE}
    reading="The static digest's coverage, to scale — and the measured behaviour it produced."
    readingEli5="What the old fixed briefing actually covered, drawn to scale, next to what the rediscovery cost."
    takeaway="A static briefing is written once and hopes; the graph answers per build, keyed to the files actually in hand — a typical serve is about 5,000 characters aimed exactly where the build is working. Coverage stops being a gamble."
    takeawayEli5="A fixed briefing is written once and hopes it guessed right. The memory answers per job, about the exact files being worked on — a few thousand characters of directly relevant history instead of a summary of two per cent of everything.">
    <Bars items={COVERAGE} unit=" files" tone={TONE} grouped={false} height={26} />
    <div class="strip evrow">
      <div class="chips" role="group" aria-label="The measured evidence">
        {#each EVIDENCE as e, i (e.k)}
          <button type="button" class="chip" class:on={ev === i} aria-pressed={ev === i}
                  onclick={() => (ev = i)}>{e.k}<em>{e.v}</em></button>
        {/each}
      </div>
      <p class="why" aria-live="polite">{chosenEv.why}</p>
    </div>
  </Instrument>

  <Instrument
    kicker="Two channels"
    title="Delivered by the routes a build actually uses"
    tone={TONE}
    reading="Pick a channel. The one thing neither of them is: the bespoke tool interface, which went unused 5,214 times out of 5,214."
    readingEli5="Two ways the memory reaches a build. Pick one — and note what neither of them is."
    takeaway="Designing for the channel that is provably used, rather than the one that is architecturally nicer, is most of why this works. The elegant interface had a perfect record of never being called."
    takeawayEli5="The memory arrives by the routes the builder demonstrably uses. The more elegant interface it was offered has a perfect record: offered every time, used never — so nothing important rides on it.">
    <div class="strip">
      <div class="chips" role="group" aria-label="Delivery channels">
        {#each CHANNELS as c, i (c.k)}
          <button type="button" class="chip" class:on={ch === i} aria-pressed={ch === i}
                  onclick={() => (ch = i)}>{c.k}<em>{c.v}</em></button>
        {/each}
      </div>
      <p class="why" aria-live="polite">{chosenCh.why}</p>
    </div>
  </Instrument>

  <Instrument
    kicker="The corpus"
    title="What a codebase's memory weighs"
    tone={TONE}
    reading="Counted on 17 August 2026, the day the graph went live — and what each kind of question costs in milliseconds."
    readingEli5="The memory on the day it went live: what is in it, how little space it takes, and how fast it answers."
    takeaway="Ten megabytes, on a database of over three thousand. Institutional memory turns out to be nearly free to keep; the expensive thing was never having it."
    takeawayEli5="The whole memory added ten megabytes to the database. Keeping what you learned turns out to be nearly free; the expensive thing was never having it.">
    <div class="stats">
      <Stat lead value={CORPUS.nodes.toLocaleString('en-GB')} label="nodes — files and gates"
            how="{CORPUS.nodesAtHead.toLocaleString('en-GB')} still exist; deleted files are flagged, not dropped" tone={TONE} />
      <Stat lead value={CORPUS.edges.toLocaleString('en-GB')} label="edges between them"
            how="imports, co-changes, lesson citations" tone={TONE} />
      <Stat lead value={CORPUS.episodes} label="episodes"
            how="verified fail → fix → pass chains, every one checked" tone={TONE} />
      <Stat lead value={CORPUS.lessons} label="lessons"
            how="curated notes, imported verbatim — {CORPUS.staleLessons} flagged stale" tone={TONE} />
      <Stat lead value={CORPUS.dbGrowthMb} unit="MB" label="total database growth"
            how="the entire memory, on a 3,200 MB database" tone={TONE} />
    </div>
    <div class="strip latrow">
      <div class="chips" role="group" aria-label="Measured latency">
        {#each LATENCY as l, i (l.k)}
          <button type="button" class="chip" class:on={lat === i} aria-pressed={lat === i}
                  onclick={() => (lat = i)}>{l.k}<em>{l.v}</em></button>
        {/each}
      </div>
      <p class="why" aria-live="polite">{chosenLat.why}</p>
    </div>
  </Instrument>

  <Instrument
    kicker="Staying trustworthy"
    title="A memory you cannot prune is a liability"
    tone={TONE}
    reading="Four rules. Pick one."
    readingEli5="Four rules that keep the memory worth believing. Pick one."
    takeaway={FEEDBACK.note}
    takeawayEli5={FEEDBACK.note}>
    <div class="strip">
      <div class="chips" role="group" aria-label="Corpus hygiene rules">
        {#each HYGIENE as h, i (h.k)}
          <button type="button" class="chip" class:on={hy === i} aria-pressed={hy === i}
                  onclick={() => (hy = i)}>{h.k}<em>{h.v}</em></button>
        {/each}
      </div>
      <p class="why" aria-live="polite">{chosenHy.why}</p>
    </div>
  </Instrument>

  <aside class="note">
    <span class="n-kick">The number it exists to beat</span>
    <p>
      {BASELINE.iterationsPerBuild} iterations per completed build — {BASELINE.last30Days} over
      the last thirty days — with {BASELINE.failingPct}% of builds failing. Whether the memory
      moves those numbers is not yet knowable: the ranking needs dozens of resolved builds before
      outcome evidence outweighs recency, and it says so rather than guessing. Too early to tell
      is the honest reading, and the page will keep saying it until it is not.
    </p>
  </aside>

  <PageFoot />
</section>

<style>
  .intro { margin: 0 0 20px; }

  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 9px; }

  .strip { display: flex; flex-direction: column; gap: 9px; min-width: 0; }
  .evrow, .latrow { margin-top: 14px; padding-top: 12px; border-top: 1px dashed rgba(28,22,17,0.18); }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip { display: inline-flex; align-items: baseline; gap: 7px; font-family: var(--font-body);
    font-size: var(--fs-label-xs); line-height: 1.25; color: var(--text-primary); background: rgba(255,255,255,0.6);
    border: 1px solid rgba(28,22,17,0.18); border-radius: var(--radius-sharp);
    padding: 5px 11px; cursor: pointer; transition: background 0.12s, border-color 0.12s; }
  .chip em { font-style: normal; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: rgba(28,22,17,0.45); }
  .chip:hover { background: rgba(28,22,17,0.07); border-color: rgba(28,22,17,0.34); }
  .chip.on { background: #8a2d3a; border-color: #8a2d3a; color: #fff; }
  .chip.on em { color: rgba(255,255,255,0.7); }
  .why { margin: 0; min-height: 3em; font-size: var(--fs-label); line-height: 1.55;
    color: rgba(28,22,17,0.72); }

  .note { display: flex; flex-direction: column; gap: 4px; margin: 0 0 22px;
    padding: 10px 14px; border-left: 3px solid #8a2d3a;
    border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0;
    background: color-mix(in srgb, #8a2d3a 8%, transparent); }
  .n-kick { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.12em;
    text-transform: uppercase; color: #8a2d3a; }
  .note p { margin: 0; font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.74); }

  @media (max-width: 560px) { .why { min-height: 0; } }
</style>
