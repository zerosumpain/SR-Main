<script lang="ts">
  // Reading the web — Part II, leaf 4.
  //
  // The whole page is one claim: merging sources destroys provenance, and separating facts
  // from gaps restores it. ProvenanceDemo makes it operable — the same three sources, two
  // compositions, one of which contains a sentence nobody wrote. Everything else is counted
  // from those same constants, so no caption here can drift from the example above it.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Funnel from '../../components/viz/Funnel.svelte';
  import Steps from '../../components/viz/Steps.svelte';
  import ProvenanceDemo from './components/ProvenanceDemo.svelte';
  import {
    SOURCES, EXTRACTED, RESEARCH_FACTS, DESK, CONNECTOR_LESSON, SEARCH_LESSON,
  } from '../../lib/research';

  const TONE = 'var(--accent)';

  /* ── The pipeline, from RESEARCH_FACTS. Labels compressed to fit a rail; the constant's
        own wording stays on the title attribute, its point on the readout. ────────────── */
  const LABEL: Record<string, string> = {
    'Sources are gathered, then read': 'Gathered, then read',
    'Facts are extracted individually': 'Facts extracted one by one',
    'Entities are recognised as it goes': 'Entities recognised en route',
    'Citations survive to the answer': 'Citations survive',
  };
  const WHY: Record<string, string> = {
    'Sources are gathered, then read': 'Search returns links; a separate step reads each page.',
    'Facts are extracted individually': 'Each claim gets its own date, confidence and source first.',
    'Entities are recognised as it goes': 'People and organisations found here join the shared graph.',
    'Citations survive to the answer': 'Markers point back to passages, so any sentence can be checked.',
  };
  const PIPE = RESEARCH_FACTS.map((f) => ({ id: f.k, label: LABEL[f.k] ?? f.k }));
  let stage = $state(PIPE[0].id);

  /* ── The attrition, counted from the worked example rather than typed out. ─────────── */
  const claims = SOURCES.flatMap((s) => s.claims);
  const distinct = new Set(claims).size;
  const cited = EXTRACTED.length;
  const confirmed = EXTRACTED.filter((f) => f.from.length > 1).length;

  /* The 6→5 drop is the one claim two sources both make — it is the corroboration signal,
     not a repetition, so the label must not read as "the same source said it twice". The
     4→1 drop is the three facts only one source carries. Both are counted, not asserted. */
  const FUNNEL = [
    { label: 'Claims read', value: claims.length },
    { label: 'Distinct claims', value: distinct, lossLabel: 'said by two sources' },
    { label: 'Cited in the answer', value: cited, lossLabel: 'too vague to corroborate' },
    { label: 'Confirmed twice', value: confirmed, lossLabel: 'single-source: cited, not confirmed' },
  ];
  const funnelSay =
    `${claims.length} claims read from ${SOURCES.length} sources; ${distinct} distinct, because two sources make the same claim; ` +
    `${cited} carried into the answer with a source; ${confirmed} confirmed by a second source.`;

  /* ── The desk: six house rules, compressed. Full wording on the title attribute. ───── */
  const RULE: Record<string, string> = {
    'A table of facts, not a document': 'Table of facts, not a document',
    'Similar facts cluster together': 'Similar facts cluster',
    'Confidence is a blend, not a vote': 'Confidence is a blend, not a vote',
    'Corroboration only counts across sources': 'Corroboration counts across sources only',
    'A red-team pass argues back': 'A red-team pass argues back',
    'It stops when it stops learning': 'Stops when it stops learning',
  };
  const GIST: Record<string, string> = {
    'A table of facts, not a document': 'A few hundred scored claims — source, date, confidence — sortable.',
    'Similar facts cluster together': 'Grouped by meaning, so agreement reads as agreement, not repetition.',
    'Confidence is a blend, not a vote': 'Extractor certainty weighted against source credibility. Neither alone decides.',
    'Corroboration only counts across sources': 'The same claim three times in one document is one claim.',
    'A red-team pass argues back': 'A later pass hunts counter-evidence, and never moves to certainty.',
    'It stops when it stops learning': 'Phases end on novelty, not on an exhausted budget.',
  };
  let rule = $state(DESK[0].k);
  const ruleGist = $derived(GIST[rule] ?? '');

  /* ── Two incidents, both the same shape: a reading that was not its subject. Each row is
        display → truth → the fix, all three compressed straight from the constant. ─────── */
  const LESSONS = [
    { src: CONNECTOR_LESSON, showed: 'healthy', truth: 'dead for six weeks', fix: 'derive it from the last real success' },
    { src: SEARCH_LESSON, showed: 'no results', truth: 'results the preview cut off', fix: 'check the rendering, not the tool' },
  ];
</script>

<svelte:head>
  <title>Research · The Engine Room</title>
  <meta name="description" content="How merging sources invents facts, and how separating facts from gaps stops it." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="memory"
    title="Research"
    line="Three sources, composed two different ways. One of the answers contains a sentence that nobody anywhere ever wrote, and it reads exactly as convincingly as the rest."
    lineEli5="Squash your sources together into one blob and the answer can end up saying things nobody actually said. Keeping every fact pinned to its source is what stops that — and you can watch it go wrong below." />

  <Instrument
    kicker="The instrument"
    title="Same sources, two compositions"
    tone={TONE}
    takeaway="Merge first and you throw away provenance; having thrown it away, the model cheerfully fills the gap. The invented bit is indistinguishable from the true bits, which is the entire problem."
    takeawayEli5="Merge the sources first and you lose track of who said what — and the model then happily fills any gap. The invented sentence reads exactly as confidently as the real ones, which is the whole problem.">
    <ProvenanceDemo />
  </Instrument>

  <Instrument
    kicker="The pipeline"
    title="What survives to the answer"
    tone={TONE}
    reading="Pick a stage."
    readingEli5="Pick a stage of the pipeline."
    takeaway="Corroboration turns out to be thin on the ground. Most of what survives is cited rather than confirmed, and the page says which is which rather than rounding up."
    takeawayEli5="Genuine confirmation turns out to be rare: most of what survives has one source behind it, not two. The answer says which is which, rather than rounding everything up to 'confirmed'.">
    <Steps items={PIPE} selected={stage} onselect={(id) => (stage = id)} tone={TONE} />
    <p class="readout" aria-live="polite" title={RESEARCH_FACTS.find((f) => f.k === stage)?.why}>{WHY[stage] ?? ''}</p>

    <span class="band">Attrition</span>
    <div class="chart" role="img" aria-label={funnelSay}>
      <Funnel stages={FUNNEL} tone={TONE} height={34} />
    </div>
  </Instrument>

  <Instrument
    kicker="The desk"
    title="Where a run lands"
    tone={TONE}
    reading="Pick one."
    readingEli5="Six house rules for a finished research run. Pick one.">
    <div class="rules">
      {#each DESK as d, i (d.k)}
        <button class="rule" class:on={rule === d.k} aria-pressed={rule === d.k}
                title={d.why} onclick={() => (rule = d.k)}>
          <span class="r-no">{String(i + 1).padStart(2, '0')}</span>
          <span class="r-k">{RULE[d.k] ?? d.k}</span>
        </button>
      {/each}
    </div>
    <p class="readout" aria-live="polite">{ruleGist}</p>
  </Instrument>

  <Instrument
    kicker="Lessons"
    title="Two false readings"
    tone={TONE}>
    <div class="lsn">
      <p class="l-key" aria-hidden="true">
        <span class="l-showed">displayed</span><span class="l-arrow">→</span><span class="l-truth">actually</span>
      </p>
      {#each LESSONS as l (l.src.title)}
        <div class="l-row">
          <p class="l-t" title={l.src.body}>{l.src.title}</p>
          <p class="l-read">
            <span class="l-sr">Displayed:</span>
            <span class="l-showed">{l.showed}</span>
            <span class="l-arrow" aria-hidden="true">→</span>
            <span class="l-sr">actually:</span>
            <span class="l-truth">{l.truth}</span>
          </p>
          <p class="l-fix" title={l.src.fix}>
            <span aria-hidden="true">▸</span><span class="l-sr">Fix:</span>{l.fix}
          </p>
        </div>
      {/each}
    </div>
  </Instrument>

  <PageFoot />
</section>

<style>
  .readout { margin: 9px 0 0; font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.7);
    min-height: 2.4em; max-width: 80ch; }
  .readout::before { content: '▸ '; color: var(--accent); }

  .band { display: block; margin: 13px 0 7px; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.12em; text-transform: uppercase; color: rgba(28,22,17,0.45); }
  .chart { min-width: 0; overflow-x: auto; }

  .rules { display: grid; grid-template-columns: repeat(auto-fit, minmax(178px, 1fr)); gap: 6px; }
  .rule { display: flex; align-items: center; gap: 8px; text-align: left; min-width: 0; cursor: pointer;
    font-family: inherit; padding: 7px 11px; background: rgba(255,255,255,0.55);
    border: 1px solid rgba(28,22,17,0.16); border-left: 3px solid rgba(28,22,17,0.16);
    border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0; transition: background 0.13s, border-color 0.13s; }
  .rule:hover { background: rgba(255,255,255,0.92); border-color: rgba(28,22,17,0.34); }
  .rule.on { border-left-color: var(--accent); background: color-mix(in srgb, var(--accent) 9%, transparent); }
  .r-no { flex-shrink: 0; font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600;
    color: rgba(28,22,17,0.4); }
  .rule.on .r-no { color: var(--accent); }
  .r-k { font-size: var(--fs-label-xs); line-height: 1.3; color: var(--text-primary); overflow-wrap: anywhere; }

  .lsn { display: flex; flex-direction: column; gap: 7px; }
  .l-key { display: flex; align-items: center; gap: 6px; margin: 0 0 1px;
    font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.08em; opacity: 0.75; }
  .l-key .l-showed { min-width: 0; }
  .l-row { padding: 8px 12px; border: 1px solid rgba(28,22,17,0.16);
    border-radius: var(--radius-sharp); background: rgba(255,255,255,0.55); }
  .l-t { margin: 0 0 5px; font-size: var(--fs-label); font-weight: 600; color: var(--text-primary); line-height: 1.3; }
  .l-read { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0;
    font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .l-showed { min-width: 12ch; padding: 2px 7px; border-radius: var(--radius-sharp);
    color: var(--error); background: color-mix(in srgb, var(--error) 10%, transparent);
    text-decoration: line-through; }
  .l-arrow { color: rgba(28,22,17,0.35); }
  .l-truth { padding: 2px 7px; border-radius: var(--radius-sharp); color: var(--success);
    background: color-mix(in srgb, var(--success) 12%, transparent); }
  .l-fix { display: flex; gap: 6px; margin: 6px 0 0; font-size: var(--fs-label-xs); line-height: 1.45;
    color: rgba(28,22,17,0.6); }
  .l-fix span[aria-hidden] { color: var(--accent); }

  /* Announced, never drawn: the displayed→actually key above is decorative to a reader
     using a screen reader, so each row restates its own frame. */
  .l-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
    overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }

  @media (max-width: 560px) {
    .l-showed { min-width: 0; }
  }
</style>
