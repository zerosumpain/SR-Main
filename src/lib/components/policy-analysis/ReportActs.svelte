<script lang="ts">
  // H — THE WRITTEN ASSESSMENT, as five acts rather than fifteen chapters.
  //
  // The report contract has fifteen sections and the page listed every one of
  // them in contract order, one after another, with the redesign options bolted
  // on above. That is an index, not a narrative: the reader is a policy
  // professional, not the person who built the pipeline, and nothing on the page
  // told them that `scope_methodology` qualifies the verdict above it while
  // `distribution` is about who ends up paying.
  //
  // The grouping is navigation, not editing. Every section keeps its own heading
  // inside its act and nothing is renamed or dropped, so the assessment reads the
  // same — a reader can just take it one movement at a time and know where they
  // are. `reportActs` in `view.ts` decides the grouping, so it is testable
  // without mounting anything.
  //
  // A tab is a real tab: roving tabindex, arrow keys, Home and End, and every
  // panel stays in the DOM so that find-in-page and the print stylesheet still
  // reach the acts nobody clicked. This is not the nesting the 2026-09-10
  // flattening removed — that defect was a second WORKSPACE rail buried inside
  // the first. One document being read a movement at a time is the document's
  // own structure, and it is the only way the written assessment stops being a
  // single unbroken scroll.
  import type { Artefact } from '$lib/policy-analysis/contracts';
  import { explain } from '$lib/policy-analysis/glossary';
  import type { ReportAct } from '$lib/policy-analysis/view';

  interface Props {
    acts: ReportAct[];
    recommendations: Artefact[];
    inspect: (id: string) => void;
  }

  let { acts, recommendations, inspect }: Props = $props();

  // The redesign options are an answer, so they belong with the act that asks
  // what to do — not stacked above the verdict where they used to sit.
  const RESPONSE = 'response';
  const panelId = (key: string) => `report-panel-${key}`;
  const tabId = (key: string) => `report-act-${key}`;

  /**
   * ONE ACT ON SCREEN, all five in the DOM.
   *
   * The rail used to be five in-page anchors and all five acts rendered
   * continuously — 4,668px of report, and the rail itself was the last
   * clickthrough in the feature that scrolled the reader to somewhere else in
   * the same document, which is the one thing the brief ruled out. Selecting an
   * act hides the others by CLASS, never by the `hidden` attribute, so
   * find-in-page and `@media print` still reach every one of them.
   */
  let act = $state(0);

  function onkey(event: KeyboardEvent) {
    const moves: Record<string, number> = {
      ArrowRight: act + 1,
      ArrowLeft: act - 1,
      Home: 0,
      End: acts.length - 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    act = (next + acts.length) % acts.length;
    document.getElementById(tabId(acts[act].key))?.focus();
  }
</script>

{#if acts.length}
  <!--
    THE MOVEMENTS, SELECTED — not anchored.
    This rail was five in-page links and all five acts rendered continuously,
    which made the report a 4,668px scroll AND made the rail the last
    clickthrough in the feature that moved the reader to somewhere else in the
    same document. It selects now. Nothing is lost: every act is in the DOM, so
    find-in-page reaches the four that are not on screen and the print copy
    carries all five.
  -->
  <div class="contents" role="tablist" aria-label="The written assessment, in five movements">
    {#each acts as a, index (a.key)}
      <button
        type="button"
        role="tab"
        id={tabId(a.key)}
        class="jump"
        class:on={index === act}
        aria-selected={index === act}
        aria-controls={panelId(a.key)}
        tabindex={index === act ? 0 : -1}
        onclick={() => (act = index)}
        onkeydown={onkey}
      >
        <span class="ordinal">{index + 1}</span>
        <span class="tab-title">{a.title}</span>
        <span class="tab-count">{a.count}</span>
      </button>
    {/each}
  </div>

  {#each acts as a, index (a.key)}
    <!-- A DIV, not a section: a `section` is a non-interactive landmark and
         Svelte rightly refuses it the `tabpanel` role. The previous pass
         cleared eleven of these warnings off this feature; this would have put
         five back. -->
    <div
      id={panelId(a.key)}
      class="panel"
      class:off={index !== act}
      role="tabpanel"
      aria-labelledby={tabId(a.key)}
    >
      <h3 class="act-title"><span class="ordinal">{index + 1}</span> {a.title}</h3>
      <p class="act-strap">{a.strap}</p>

      {#each a.chapters as chapter (chapter.section)}
        <div class="chapter">
          <h3>{chapter.label}</h3>
          {#each chapter.items as f (f.id)}
            <div class="finding">
              <p>{f.statement}</p>
              <p class="finding-foot">
                <!-- One compact line, not a two-line kicker plus a sentence.
                     Fifteen findings each carrying "structural inference" on
                     its own line above the text buried the findings. -->
                <span class="origin">{explain(f.origin)?.short ?? f.origin.replaceAll('_', ' ')}</span>
                <button class="link" onclick={() => inspect(f.id)}>What it rests on ({f.refs.length}) →</button>
              </p>
            </div>
          {/each}
        </div>
      {/each}

      {#if a.key === RESPONSE && recommendations.length}
        <div class="recommendations">
          <p class="sr-label">Redesign options — normative judgements, not findings</p>
          {#each recommendations as r (r.id)}
            <article class="rec">
              <h4>{r.label}</h4>
              <p>{r.statement}</p>
              {#if r.data.change}<p><strong>Change.</strong> {String(r.data.change)}</p>{/if}
              {#if r.data.tradeoffs}<p><strong>Trade-off.</strong> {String(r.data.tradeoffs)}</p>{/if}
              {#if r.data.burdenBearers}<p class="muted"><strong>Who carries it.</strong> {(r.data.burdenBearers as string[]).join(', ')}</p>{/if}
              <button class="link" onclick={() => inspect(r.id)}>Findings behind it →</button>
            </article>
          {/each}
        </div>
      {/if}
    </div>
  {/each}

  <p class="muted whereami">
    Movement {act + 1} of {acts.length} · {acts[act]?.count ?? 0} of
    {acts.reduce((n, a) => n + a.count, 0)} findings. Every movement is in the exported document and in the
    printed copy, whichever one is on screen.
  </p>
{/if}

<style>
  .contents { display: flex; flex-wrap: wrap; gap: .35rem; margin: 1.25rem 0 0; border-bottom: 2px solid var(--line-strong); }
  .jump { font: inherit; display: flex; align-items: baseline; gap: .5rem; padding: .5rem .75rem; background: none; border: 0; border-radius: 0; cursor: pointer; text-decoration: none; color: var(--text-secondary); font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; }
  .jump:hover { background: var(--surface-sunken); color: var(--text-primary); }
  .jump:focus-visible { outline: 2px solid var(--accent-ink); outline-offset: -2px; }
  .jump.on { background: var(--text-primary); color: var(--bg); }
  .jump.on .ordinal, .jump.on .tab-count { color: var(--accent-on-dark); }
  /* A CLASS, never `hidden`: `[hidden] { display: none !important }` is a
     user-agent declaration and outranks any author rule, which is how four of
     five acts went missing from the printed pack on 2026-09-10. */
  .panel.off { display: none; }
  .finding-foot { display: flex; flex-wrap: wrap; align-items: baseline; gap: .6rem; margin: 0; }
  .origin { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--text-muted); }
  .act-title { display: flex; align-items: baseline; gap: .6rem; margin: 2rem 0 .25rem; scroll-margin-top: 4rem; }
  .ordinal { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent); }
  .tab-count { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }
  .panel { padding-top: 1.25rem; }
  /*
   * A class, not the `hidden` attribute. `[hidden] { display: none !important }`
   * is a USER-AGENT declaration and outranks any author !important, so the
   * `.panel[hidden] { display: block !important }` this block used to carry
   * could never fire — four of the five acts were quietly missing from every
   * printed copy.
   */
  .panel:focus-visible { outline: 2px solid var(--accent-ink); outline-offset: 4px; }
  .act-strap { color: var(--text-secondary); max-width: 68ch; margin: 0 0 1.25rem; }
  .chapter { border-top: 1px solid var(--line); padding: 1.1rem 0 .4rem; }
  .chapter h3 { margin: 0 0 .6rem; text-transform: capitalize; }
  .finding { padding: .35rem 0 .9rem; max-width: 74ch; }
  .finding p { margin: 0 0 .4rem; }
  .recommendations { border-top: 2px solid var(--accent); margin-top: 1.5rem; padding-top: 1rem; }
  .rec { padding: .9rem 0; border-bottom: 1px solid var(--line); max-width: 74ch; }
  .rec h4 { margin: 0 0 .4rem; font-size: var(--fs-body-lg); }
  .rec p { margin: 0 0 .4rem; }
  .whereami { margin-top: 1.25rem; }

  /* Printing is the one case where the reader wants all five acts at once, and
     every panel is already in the DOM for exactly that reason. */
  @media print {
    .contents, .whereami { display: none !important; }
    /* Every movement, whichever one was on screen. */
    .panel.off { display: block; }
    .panel { break-inside: auto; }
    .act-strap::before { content: ""; display: block; border-top: 2px solid #000; margin-bottom: .5rem; }
  }
</style>
