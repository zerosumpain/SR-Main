<script lang="ts">
  // Codegraph — Part IV, leaf 4. The study's one full-length page, by explicit request
  // (2026-08-17): a deep dive on the implementation of the build-history graph, not a
  // summary of it. The house word-ceiling is deliberately waived here — John asked for
  // "a full long page, focussing on the implementation" — but every figure still traces
  // to lib/lessons.ts, itself verified against src/lib/codegraph/* the same day, and the
  // worked examples use stand-in paths only. The interactive arithmetic (WilsonBench)
  // mirrors the shipped relevance formula exactly, constants and all.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Bars from '../../components/viz/Bars.svelte';
  import Stat from '../../components/viz/Stat.svelte';
  import RecallBench from './components/RecallBench.svelte';
  import QueryComposer from './components/QueryComposer.svelte';
  import WilsonBench from './components/WilsonBench.svelte';
  import { app } from '../../lib/appState.svelte';
  import {
    KEYS_NOTE, EVIDENCE, CHANNELS, CORPUS, LATENCY, HYGIENE, FEEDBACK, BASELINE,
    RELEVANCE, RESOLUTION, ANATOMY, EDGE_KINDS, DEDUPE, CGQL, FINGERPRINT, PROOF,
    GRAPH_SURFACES,
  } from '../../lib/lessons';

  const TONE = '#8a2d3a';
  const eli = $derived(app.narrative === 'eli5');

  const COVERAGE = [
    { label: 'Files in the codebase', value: 3_359 },
    { label: 'Described by the static digest', value: 60, tone: 'var(--accent)' },
  ];

  let anat = $state(0);
  const chosenAnat = $derived(ANATOMY[anat]);
  let fp = $state(0);
  const chosenFp = $derived(FINGERPRINT[fp]);
  let gram = $state(0);
  const chosenGram = $derived(CGQL.grammar[gram]);
  let ch = $state(0);
  const chosenCh = $derived(CHANNELS[ch]);
  let ev = $state(0);
  const chosenEv = $derived(EVIDENCE[ev]);
  let res = $state(0);
  const chosenRes = $derived(RESOLUTION[res]);
  let hy = $state(0);
  const chosenHy = $derived(HYGIENE[hy]);
  let lat = $state(0);
  const chosenLat = $derived(LATENCY[lat]);
  let surf = $state(0);
  const chosenSurf = $derived(GRAPH_SURFACES[surf]);
</script>

<svelte:head>
  <title>Codegraph · The Engine Room</title>
  <meta name="description" content="The build-history knowledge graph, implementation and all: nodes of files and gates, error fingerprinting, the CGQL query language, a relevance formula that shifts from recency to evidence, and a feedback loop with no model in it." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="change"
    title="Codegraph"
    line="The build-history knowledge graph, in full: the schema under it, the fingerprints into it, the five-verb query language over it, and the arithmetic that decides whether a lesson has earned its place in a prompt."
    lineEli5="The system that builds new features used to start every job with amnesia. Codegraph is the memory it was given — and this page takes it apart properly: what it stores, how a question is asked of it, and how it decides what is worth repeating." />

  <div class="pe-prose intro">
    {#if eli}
      <p>
        The builder works in attempts: write the code, run the checks, read the failures, go
        again. Historically a finished job took {BASELINE.iterationsPerBuild} attempts, and
        {BASELINE.failingPct}% of jobs failed outright. Watching where the attempts actually went
        was the uncomfortable part: about ten actions per attempt were spent re-discovering the
        codebase — the same files opened over and over, the same dead ends walked twice — and
        anything one attempt learned died with it, because chat transcripts get deleted while
        the code lives on.
      </p>
      <p>
        The obvious fix, a written briefing pasted into every job, was tried first. It described
        sixty files out of three thousand — a fixed summary cannot know which sixty the next job
        will need. Codegraph replaces the briefing with a memory: every failure, every verified
        fix and every hard-won note is filed against the exact files and errors it concerns, and
        each new job is handed precisely the slice of history that touches what it is about to
        do. No AI is involved in the filing or the finding; the whole thing runs on keys a
        machine already has in its hands.
      </p>
    {:else}
      <p>
        The builder iterates — generate, run the gate, read the diagnostics, go again — at
        {BASELINE.iterationsPerBuild} iterations per completed build historically, with
        {BASELINE.failingPct}% failing outright. Instrumenting the iterations showed 10.5
        discovery actions each, the average file read 6.53 times over, and the deeper rot:
        whatever an iteration learned evaporated with its transcript. Over a third of historical
        build sessions no longer have one.
      </p>
      <p>
        Codegraph is a second knowledge graph, deliberately separate from the entity graph — that
        one is about the world; this one is about this codebase and what building it has already
        taught the machine. It replaces a static codebase digest with keyed recall: nodes are
        files and gates because those persist, episodes and lessons hang off them, retrieval is
        driven by the file set in hand and the fingerprint of the last gate error, and the
        result is packed into the prompt before the attempt begins. Everything below is the
        implementation, part by part.
      </p>
    {/if}
  </div>

  <!-- ================================================================ -->
  <h2 class="pe-h2">What it is made of</h2>
  <p class="pe-prose">
    Four kinds of thing, five kinds of connection. The load-bearing decision is what the nodes
    are: files and gates, never conversations. Conversations are the natural unit — they are
    where the learning happened — and they are exactly what gets deleted. A memory keyed on
    something mortal inherits the mortality, so the graph hangs everything off the two things a
    build always has and the repository always keeps.
  </p>

  <Instrument
    kicker="The anatomy"
    title="Files, gates, and what hangs off them"
    tone={TONE}
    reading="Pick an element, then an edge kind. Counts are from 17 August 2026, the day it went live."
    readingEli5="Pick a part of the graph to read what it is for. The counts are from the day it went live."
    takeaway={DEDUPE.body}
    takeawayEli5={DEDUPE.body}>
    <div class="strip">
      <div class="chips" role="group" aria-label="Graph elements">
        {#each ANATOMY as a, i (a.k)}
          <button type="button" class="chip" class:on={anat === i} aria-pressed={anat === i}
                  onclick={() => (anat = i)}>{a.k}<em>{a.v}</em></button>
        {/each}
      </div>
      <p class="why" aria-live="polite">{chosenAnat.why}</p>
    </div>
    <ul class="edges">
      {#each EDGE_KINDS as e (e.k)}
        <li><code>{e.k}</code><span>{e.why}</span></li>
      {/each}
    </ul>
    <div class="stats">
      <Stat lead value={CORPUS.nodes.toLocaleString('en-GB')} label="nodes"
            how="{CORPUS.nodesAtHead.toLocaleString('en-GB')} still exist; deleted files are flagged, never dropped" tone={TONE} />
      <Stat lead value={CORPUS.edges.toLocaleString('en-GB')} label="edges" how="across the five kinds" tone={TONE} />
      <Stat lead value={CORPUS.episodes} label="episodes" how="every one verified fail → fix → pass" tone={TONE} />
      <Stat lead value={CORPUS.lessons} label="lessons" how="{CORPUS.staleLessons} flagged stale" tone={TONE} />
      <Stat lead value={CORPUS.dbGrowthMb} unit="MB" label="total database growth" how="on a 3,200 MB database" tone={TONE} />
    </div>
  </Instrument>

  <!-- ================================================================ -->
  <h2 class="pe-h2">The keys: a failure is already a query</h2>
  <p class="pe-prose">
    Retrieval systems usually start from what somebody typed. That fails here for a measurable
    reason: {eli
      ? 'twenty-nine per cent of instructions to the builder are twenty-five characters or fewer — "crack on" contains nothing a meaning-based search can use.'
      : '29% of build instructions run to 25 characters or fewer, and "crack on" embeds to nothing.'}
    So the keys are mechanical. When a check fails, its raw output is reduced to a stable
    fingerprint — colour codes stripped, counts normalised, keyed on the class of error rather
    than the command that produced it — and that fingerprint, plus the set of files the build is
    touching, is the entire query. Both cost a regular expression. Neither costs a model call,
    which is what makes them affordable on every iteration of every build.
  </p>

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
    kicker="Fingerprinting"
    title="Three findings from 8,647 real command results"
    tone={TONE}
    reading="The fingerprinting rules were measured against 25 real sessions, not designed at a whiteboard. Pick a finding."
    readingEli5="The rules for reducing an error to a key came from measuring 25 real sessions. Pick a finding."
    takeaway="The design lesson underneath all three: the raw material is uglier than any specification would admit, so the reducer is built from measured output and its edge cases are pinned by tests — including the green runs it must never call red."
    takeawayEli5="The lesson under all three: real output is messier than any plan admits, so the rules were built from measurements — and the tests pin the green runs that must never be called failures.">
    <div class="strip">
      <div class="chips" role="group" aria-label="Fingerprinting findings">
        {#each FINGERPRINT as f, i (f.k)}
          <button type="button" class="chip" class:on={fp === i} aria-pressed={fp === i}
                  onclick={() => (fp = i)}>{f.k}<em>{f.v}</em></button>
        {/each}
      </div>
      <p class="why" aria-live="polite">{chosenFp.why}</p>
    </div>
  </Instrument>

  <!-- ================================================================ -->
  <h2 class="pe-h2">The query language</h2>
  <p class="pe-prose">
    Between the keys and the database sits CGQL — a five-verb pipeline that is deliberately not
    a real language. Both of its callers are machines composing queries mechanically, and a
    grammar with more power than its callers use only widens what a hostile string smuggled
    into a prompt could ask for. {CGQL.security}
  </p>

  <Instrument
    kicker="The composer"
    title="Build a query, watch the string form"
    tone={TONE}
    reading="Choose a seed, a walk, what to collect and a budget. Nothing executes — this is the grammar, not the database."
    readingEli5="Choose where to start, how far to look outward, what to collect and how much answer you can afford. Nothing runs — this shows how the question is written."
    takeaway="Every stage has a hard cap — two hops, ten items a pick, eight thousand characters — because the answer is destined for a prompt, and a prompt is a budget. The parser checks every keyword against a fixed list and binds every value; nothing a query says is ever spliced into the database's own language."
    takeawayEli5="Every stage has a hard ceiling — how far it may look, how much it may collect, how long the answer may be — because the answer goes into a prompt, and a prompt is a budget. The parser is the security boundary: nothing a query says reaches the database as anything but data.">
    <QueryComposer tone={TONE} />
  </Instrument>

  <Instrument
    kicker="The grammar"
    title="Five verbs, and why so few"
    tone={TONE}
    reading="Pick a stage."
    readingEli5="Pick a stage of the pipeline."
    takeaway={CGQL.topic}
    takeawayEli5={CGQL.topic}>
    <div class="strip">
      <div class="chips" role="group" aria-label="CGQL stages">
        {#each CGQL.grammar as g, i (g.k)}
          <button type="button" class="chip" class:on={gram === i} aria-pressed={gram === i}
                  onclick={() => (gram = i)}>{g.k}<em>{g.v}</em></button>
        {/each}
      </div>
      <p class="why" aria-live="polite">{chosenGram.why}</p>
    </div>
  </Instrument>

  <!-- ================================================================ -->
  <h2 class="pe-h2">Two channels, and the one it refuses to be</h2>
  <p class="pe-prose">
    The build runner assembles one command line and hands over; there is no way to slip
    anything into the agent's context mid-run. So delivery is split. Push covers what the agent
    does not know to ask: computed before the attempt starts, appended to the prompt, logged as
    served, empty or failed — three distinct outcomes, because a delivery metric that cannot
    say "empty" will report a dead pipe as healthy — and switchable off with one flag. Pull
    covers what the agent thinks to ask mid-build, and it rides the one transport the evidence
    supports: running a command. The elegant alternative — a bespoke tool interface — was
    offered on every build and never called once. Nothing important is allowed to depend on it.
  </p>

  <Instrument
    kicker="Delivery"
    title="Push what it can't ask for, answer what it can"
    tone={TONE}
    reading="Pick a channel — and note what neither of them is."
    readingEli5="Two ways the memory reaches a build. Pick one — and note what neither of them is."
    takeaway="Designing for the channel that is provably used, rather than the one that is architecturally nicer, is most of why this works. The bespoke interface had a perfect record: offered 5,214 times, called never."
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
    kicker="Against the alternative"
    title="A briefing cannot know what you'll need"
    tone={TONE}
    reading="The static digest's coverage, to scale — and the measured behaviour that buried it."
    readingEli5="What the old fixed briefing actually covered, drawn to scale, next to the measured cost of rediscovery."
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

  <!-- ================================================================ -->
  <h2 class="pe-h2">What deserves the budget</h2>
  <p class="pe-prose">
    A serve is a few thousand characters and the graph holds hundreds of candidates, so
    something has to rank them — and "most recently written" is not it. The score is a product
    of computed terms: a Wilson lower bound over the lesson's record (one lucky success out of
    one must not outrank forty out of fifty), an age decay with a floor at
    {RELEVANCE.recencyFloor} because old is not wrong, a stale weight of
    {RELEVANCE.staleWeight} when every cited file has left the tree, and a floor of
    {RELEVANCE.outcomeFloor} under the outcome term so that a failed lesson is demoted rather
    than deleted — an item at zero can never be served again, which makes zero a deletion
    wearing a demotion's clothes. The balance shifts as evidence arrives: with nothing
    observed, recency does the sorting; at {RELEVANCE.evidenceHalfWeight} resolved outcomes the
    two carry equal weight; beyond that, the record rules. Nothing switches mode — the weights
    move.
  </p>

  <Instrument
    kicker="The arithmetic"
    title="What one win is actually worth"
    tone={TONE}
    reading="The live formula with the live constants. Drag the record, the age and the staleness; the score is the one the ranking computes."
    readingEli5="The real formula with the real numbers. Drag how often a lesson helped, how old it is, and whether its files still exist — the score is the one the system uses."
    takeaway={FEEDBACK.note}
    takeawayEli5={FEEDBACK.note}>
    <WilsonBench tone={TONE} />
  </Instrument>

  <Instrument
    kicker="Closing the loop"
    title="No model marks this homework"
    tone={TONE}
    reading="A serve's worth is resolved at the start of the next iteration, from what the gate said. Pick an outcome."
    readingEli5="Whether a serve helped is decided by the next round of checks, not by anyone's opinion. Pick an outcome."
    takeaway="Asking a model whether the context was useful would be unfalsifiable, and a wrong 'helpful' is indistinguishable from a real one the moment it is written. The gate is the judge: mechanical, checkable, and occasionally humbling."
    takeawayEli5="Asking an AI whether the help helped would be unfalsifiable — a wrong 'yes' would poison the rankings with no way to detect it. So the judge is the next round of checks: mechanical, checkable, and occasionally humbling.">
    <div class="strip">
      <div class="chips" role="group" aria-label="Serve outcomes">
        {#each RESOLUTION as r, i (r.k)}
          <button type="button" class="chip" class:on={res === i} aria-pressed={res === i}
                  onclick={() => (res = i)}>{r.k}<em>{r.v}</em></button>
        {/each}
      </div>
      <p class="why" aria-live="polite">{chosenRes.why}</p>
    </div>
  </Instrument>

  <!-- ================================================================ -->
  <h2 class="pe-h2">Forgetting, on purpose and on evidence</h2>
  <p class="pe-prose">
    A memory that only grows becomes a liability: the budget fills with the plausible-but-dead,
    and the one lesson that matters is the one that no longer fits. Codegraph forgets three
    ways, each with a different authority. A person retires a lesson — reversibly, with a
    written reason. The staleness sweep flags lessons whose cited files have all gone, checked
    against each lesson's own repository. And atrophy handles the rest: a lesson that keeps
    being served and never precedes an improvement slides down the ranking until the budget
    stops reaching it. Nothing is silently deleted; everything is one good outcome, or one
    reversal, from coming back.
  </p>

  <Instrument
    kicker="Hygiene"
    title="A memory you cannot prune is a liability"
    tone={TONE}
    reading="Four rules. Pick one."
    readingEli5="Four rules that keep the memory worth believing. Pick one."
    takeaway="The common thread: forgetting is filtered in exactly one place, at the single loader every read passes through. Scatter that predicate across five callers and 'forget' becomes a suggestion — the fourth caller always forgets to."
    takeawayEli5="The common thread: forgetting happens in exactly one place, on the single path every read takes. Spread the rule across five callers and 'forget' becomes a suggestion — someone always forgets to forget.">
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

  <!-- ================================================================ -->
  <h2 class="pe-h2">Proof, so far</h2>
  <p class="pe-prose">{PROOF.body}</p>

  <Instrument
    kicker="The bill"
    title="What remembering costs"
    tone={TONE}
    reading="Measured in production on 17 August 2026. Pick a lane."
    readingEli5="Measured on the live system. Pick a kind of question to see what it costs in milliseconds."
    takeaway="Ten megabytes and single-digit milliseconds on the hot lane. Institutional memory turned out to be nearly free to keep; the expensive thing was every day of not having it."
    takeawayEli5="Ten megabytes of storage and a few milliseconds a question. Keeping what you learned turns out to be nearly free; the expensive thing was every day of not having it.">
    <div class="strip">
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
    kicker="The surfaces"
    title="Where to see it, argue with it, and tell it to forget"
    tone={TONE}
    reading="Four owner-side screens. Pick one."
    readingEli5="Four screens for looking the memory in the eye. Pick one."
    takeaway="The Ask screen renders the exact block a build would be handed — same loader, same budget — because a retrieval system whose output cannot be inspected is a rumour with an API."
    takeawayEli5="One screen shows the exact text a build would be handed — same code path, same budget — because a memory you cannot inspect is just a rumour with good presentation.">
    <div class="strip">
      <div class="chips" role="group" aria-label="Owner surfaces">
        {#each GRAPH_SURFACES as s, i (s.k)}
          <button type="button" class="chip" class:on={surf === i} aria-pressed={surf === i}
                  onclick={() => (surf = i)}>{s.k}</button>
        {/each}
      </div>
      <p class="why" aria-live="polite">{chosenSurf.why}</p>
    </div>
  </Instrument>

  <aside class="note">
    <span class="n-kick">The number it exists to beat</span>
    <p>
      {BASELINE.iterationsPerBuild} iterations per completed build — {BASELINE.last30Days} over
      the last thirty days — with {BASELINE.failingPct}% of builds failing. Whether the memory
      moves those numbers is not yet knowable: the corpus-level readout refuses to claim
      outcome-based ranking below {RELEVANCE.evidenceMaturity} resolved serves, and it says so
      rather than guessing. Too early to tell is the honest reading, and this page will keep
      saying it until it is not.
    </p>
  </aside>

  <PageFoot />
</section>

<style>
  .intro { margin: 0 0 20px; }

  /* Section prose sits directly under its pe-h2, full width like everything else. */
  section :global(.pe-prose) { margin: 0 0 16px; }

  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 9px; margin-top: 14px; }

  .edges { list-style: none; margin: 14px 0 0; padding: 10px 0 0; border-top: 1px dashed rgba(28,22,17,0.18);
    display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 6px 16px; }
  .edges li { display: flex; align-items: baseline; gap: 8px; min-width: 0;
    font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.72); }
  .edges code { flex-shrink: 0; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: var(--text-primary); background: color-mix(in srgb, #8a2d3a 12%, transparent);
    padding: 2px 6px; border-radius: var(--radius-sharp); }

  .strip { display: flex; flex-direction: column; gap: 9px; min-width: 0; }
  .evrow { margin-top: 14px; padding-top: 12px; border-top: 1px dashed rgba(28,22,17,0.18); }
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
