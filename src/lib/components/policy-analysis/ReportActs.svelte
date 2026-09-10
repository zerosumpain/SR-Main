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
  // reach the acts nobody clicked.
  import type { Artefact } from '$lib/policy-analysis/contracts';
  import type { ReportAct } from '$lib/policy-analysis/view';

  interface Props {
    acts: ReportAct[];
    recommendations: Artefact[];
    inspect: (id: string) => void;
  }

  let { acts, recommendations, inspect }: Props = $props();

  let active = $state(0);
  // The redesign options are an answer, so they belong with the act that asks
  // what to do — not stacked above the verdict where they used to sit.
  const RESPONSE = 'response';
  const current = $derived(acts[Math.min(active, Math.max(acts.length - 1, 0))]);
  const tabId = (key: string) => `report-tab-${key}`;
  const panelId = (key: string) => `report-panel-${key}`;

  function onkeydown(event: KeyboardEvent, index: number) {
    const moves: Record<string, number> = {
      ArrowRight: index + 1, ArrowLeft: index - 1,
      Home: 0, End: acts.length - 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    active = (next + acts.length) % acts.length;
    // Roving tabindex: the newly selected tab takes the focus with it.
    document.getElementById(tabId(acts[active].key))?.focus();
  }
</script>

{#if acts.length}
  <div class="tablist" role="tablist" aria-label="The written assessment, in five acts">
    {#each acts as act, index (act.key)}
      <button
        role="tab"
        id={tabId(act.key)}
        class="tab"
        class:on={index === active}
        aria-selected={index === active}
        aria-controls={panelId(act.key)}
        tabindex={index === active ? 0 : -1}
        onclick={() => (active = index)}
        onkeydown={(e) => onkeydown(e, index)}
      >
        <span class="ordinal">{index + 1}</span>
        <span class="tab-title">{act.title}</span>
        <span class="tab-count">{act.count}</span>
      </button>
    {/each}
  </div>

  {#each acts as act, index (act.key)}
    <div
      role="tabpanel"
      id={panelId(act.key)}
      class="panel"
      aria-labelledby={tabId(act.key)}
      class:off={index !== active}
      tabindex="0"
    >
      <p class="act-strap">{act.strap}</p>

      {#each act.chapters as chapter (chapter.section)}
        <div class="chapter">
          <h3>{chapter.label}</h3>
          {#each chapter.items as f (f.id)}
            <div class="finding">
              <p class="kicker-sm">{f.origin.replaceAll('_', ' ')}</p>
              <p>{f.statement}</p>
              <button class="link" onclick={() => inspect(f.id)}>Trace to test, hypothesis and passage ({f.refs.length}) →</button>
            </div>
          {/each}
        </div>
      {/each}

      {#if act.key === RESPONSE && recommendations.length}
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
    Act {Math.min(active, acts.length - 1) + 1} of {acts.length} · {current?.count ?? 0}
    {(current?.count ?? 0) === 1 ? 'finding' : 'findings'} in this act
  </p>
{/if}

<style>
  .tablist { display: flex; flex-wrap: wrap; gap: .35rem; margin: 1.25rem 0 0; border-bottom: 2px solid var(--line-strong); }
  .tab {
    display: flex; align-items: baseline; gap: .5rem;
    background: none; border: 1px solid transparent; border-bottom: none;
    padding: .6rem .9rem; cursor: pointer; font: inherit; color: var(--text-secondary);
    margin-bottom: -2px;
  }
  .tab:hover { color: var(--text-primary); background: var(--accent-tint-04); }
  .tab.on { color: var(--text-primary); border-color: var(--line-strong); border-bottom: 2px solid var(--bg); background: var(--bg); font-weight: 600; }
  .tab:focus-visible { outline: 2px solid var(--accent-ink); outline-offset: -2px; }
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
  .panel.off { display: none; }
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
    .tablist, .whereami { display: none !important; }
    .panel.off { display: block; }
    .panel { break-inside: auto; }
    .act-strap::before { content: ""; display: block; border-top: 2px solid #000; margin-bottom: .5rem; }
  }
</style>
