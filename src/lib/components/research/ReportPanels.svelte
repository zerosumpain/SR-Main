<script lang="ts" module>
  export interface KnowledgeGap {
    gap: string;
    type?: string;
    severity?: 'high' | 'medium' | 'low';
    goal_index?: number;
  }
  export interface Hypothesis {
    hypothesis: string;
    testability?: 'high' | 'medium' | 'low';
    suggested_queries?: string[];
  }
  export interface Contradiction {
    fact_a_id: string;
    fact_b_id: string;
    tension: string;
  }
  export interface SourceDiversity {
    total_domains: number;
    by_type: Record<string, number>;
    concentration_index: number;
  }
  export interface ReportView {
    knowledge_gaps?: KnowledgeGap[];
    hypotheses?: Hypothesis[];
    contradictions_map?: Contradiction[];
    source_diversity?: SourceDiversity;
    entity_centrality?: Record<string, number>;
    clusters?: { title: string; summary: string; fact_ids?: string[] }[];
  }
</script>

<script lang="ts">
  /**
   * The report, rendered.
   *
   * All of this has been computed and stored on every completed investigation
   * for months — executive summary, clusters, gaps, hypotheses, contradictions,
   * diversity, centrality — and none of it had a surface. The tabbed dashboard
   * that once showed some of it was retired to a 308 redirect, leaving the
   * canvas and a docx export as the only ways to read a finished run.
   *
   * Each panel is skipped when its data is absent, so a `scan` (which produces
   * only a summary) renders nothing extra rather than a wall of empty boxes.
   */
  let {
    report,
    goals = [],
    topEntities = [],
    onInvestigate,
  }: {
    report: ReportView;
    goals?: string[];
    /** Resolved id → name already done by the loader; centrality is keyed by ID. */
    topEntities?: { name: string; score: number }[];
    /** Spawn a child investigation seeded from a gap or hypothesis. */
    onInvestigate?: (topic: string, seed: { kind: 'gap' | 'hypothesis'; text: string }) => void;
  } = $props();

  const gaps = $derived(report.knowledge_gaps ?? []);
  const hypotheses = $derived(report.hypotheses ?? []);
  const contradictions = $derived(report.contradictions_map ?? []);
  const diversity = $derived(report.source_diversity ?? null);
  const clusters = $derived(report.clusters ?? []);

  /**
   * Per-goal coverage.
   *
   * `knowledge_gaps` already carries a `goal_index` pointing at the goal it
   * leaves unanswered — the link existed in the data and was never drawn, so a
   * reader had no way to tell which of their questions the run actually
   * answered.
   */
  const coverage = $derived(
    goals.map((goal, i) => {
      const hits = gaps.filter((g) => g.goal_index === i);
      const worst = hits.some((g) => g.severity === 'high')
        ? 'unanswered'
        : hits.length
          ? 'partial'
          : 'answered';
      return { goal, state: worst as 'answered' | 'partial' | 'unanswered', gaps: hits };
    }),
  );

  /** Herfindahl index: higher means the sources all came from one kind of place. */
  function concentrationWord(hhi: number): string {
    if (hhi >= 0.5) return 'narrow — most sources are one kind';
    if (hhi >= 0.3) return 'moderate';
    return 'broad';
  }
</script>

{#if coverage.length}
  <section class="nm-sec">
    <div class="nm-sec-hd"><span class="sr-label-tight">Goal coverage</span></div>
    <ul class="coverage">
      {#each coverage as c (c.goal)}
        <li>
          <span class="state {c.state}">{c.state}</span>
          <span class="goal-text">{c.goal}</span>
          {#if c.gaps.length}
            <span class="goal-why">{c.gaps.map((g) => g.gap).join('; ')}</span>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if gaps.length}
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">What this did not establish</span>
      <span class="count">{gaps.length}</span>
    </div>
    <ul class="items">
      {#each gaps as g, i (i)}
        <li>
          <div class="item-main">
            {#if g.severity}<span class="sev {g.severity}">{g.severity}</span>{/if}
            <span>{g.gap}</span>
          </div>
          {#if onInvestigate}
            <button
              type="button"
              class="row-link"
              onclick={() => onInvestigate(g.gap, { kind: 'gap', text: g.gap })}
            >Research this →</button>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if hypotheses.length}
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Hypotheses worth testing</span>
      <span class="count">{hypotheses.length}</span>
    </div>
    <ul class="items">
      {#each hypotheses as h, i (i)}
        <li>
          <div class="item-main">
            {#if h.testability}<span class="sev {h.testability}">{h.testability} testability</span>{/if}
            <span>{h.hypothesis}</span>
          </div>
          {#if onInvestigate}
            <button
              type="button"
              class="row-link"
              onclick={() =>
                onInvestigate(h.suggested_queries?.[0] ?? h.hypothesis, {
                  kind: 'hypothesis',
                  text: h.hypothesis,
                })}
            >Test this →</button>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if contradictions.length}
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Sources that disagree</span>
      <span class="count">{contradictions.length}</span>
    </div>
    <ul class="items plain">
      {#each contradictions as c, i (i)}
        <li><div class="item-main"><span>{c.tension}</span></div></li>
      {/each}
    </ul>
  </section>
{/if}

{#if clusters.length}
  <section class="nm-sec">
    <div class="nm-sec-hd"><span class="sr-label-tight">Themes</span></div>
    <ul class="items plain">
      {#each clusters as c (c.title)}
        <li>
          <div class="item-main">
            <strong>{c.title}</strong>
            <span class="muted">{c.summary}</span>
          </div>
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if diversity || topEntities.length}
  <section class="nm-sec">
    <div class="nm-sec-hd"><span class="sr-label-tight">Evidence base</span></div>
    {#if diversity}
      <div class="diversity">
        <span><b>{diversity.total_domains}</b> distinct domains</span>
        <span class="muted">
          concentration {diversity.concentration_index} — {concentrationWord(diversity.concentration_index)}
        </span>
      </div>
      <div class="types">
        {#each Object.entries(diversity.by_type).sort((a, b) => b[1] - a[1]) as [type, n] (type)}
          <span class="type-chip">{type} <b>{n}</b></span>
        {/each}
      </div>
    {/if}
    {#if topEntities.length}
      <div class="entities">
        {#each topEntities as e (e.name)}
          <span class="entity-chip" style:--w={Math.max(0.15, e.score)}>{e.name}</span>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<style>
  .nm-sec { border: 1px solid var(--card-border); background: var(--surface-elevated); padding: 0.8rem 0.9rem; margin-bottom: 1rem; }
  .nm-sec-hd { display: flex; justify-content: space-between; align-items: baseline; gap: 0.6rem; margin-bottom: 0.6rem; padding-bottom: 0.4rem; border-bottom: 1px solid var(--divider); }
  .sr-label-tight { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.16em; color: var(--text-muted); }
  .count { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }

  .coverage { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
  .coverage li { display: grid; grid-template-columns: auto 1fr; gap: 0.5rem; align-items: baseline; }
  .goal-text { font-size: 0.92rem; }
  .goal-why { grid-column: 2; font-size: 0.8rem; color: var(--text-muted); }
  .state { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; padding: 1px 6px; border: 1px solid currentColor; white-space: nowrap; }
  .state.answered { color: var(--success); }
  .state.partial { color: var(--warn); }
  .state.unanswered { color: var(--error); }

  .items { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.6rem; }
  .items li { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.8rem; }
  .item-main { display: grid; gap: 0.2rem; font-size: 0.92rem; line-height: 1.45; }
  .muted { color: var(--text-muted); font-size: 0.85rem; }
  .sev { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); }
  .sev.high { color: var(--error); }
  .sev.medium { color: var(--warn); }
  .sev.low { color: var(--text-muted); }

  .row-link { font-family: var(--font-mono); font-size: var(--fs-label); background: none; border: none; color: var(--accent); cursor: pointer; white-space: nowrap; padding: 0; }
  .row-link:hover { text-decoration: underline; }

  .diversity { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: baseline; font-size: 0.9rem; margin-bottom: 0.5rem; }
  .types, .entities { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .types { margin-bottom: 0.6rem; }
  .type-chip, .entity-chip { font-family: var(--font-mono); font-size: var(--fs-label-xs); border: 1px solid var(--card-border); padding: 2px 7px; color: var(--text-secondary); }
  /* Centrality shows as weight, not another colour scale. */
  .entity-chip { border-color: color-mix(in srgb, var(--accent) calc(var(--w) * 100%), var(--card-border)); }
</style>
