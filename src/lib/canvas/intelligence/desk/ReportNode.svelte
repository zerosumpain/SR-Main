<!-- src/lib/canvas/intelligence/desk/ReportNode.svelte -->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { buildReportView, type DeskCardLite, type ReportView } from './report-view';
  import { type DeskStatus } from './deskControls';
  import type { ResearchReport } from '$lib/deepdive/types';

  let {
    sessionId,
    cards,
    sessionStatus,
    canRegenerate,
    onexport,
  }: {
    sessionId: string;
    cards: ReadonlyArray<DeskCardLite>;
    sessionStatus: DeskStatus;
    canRegenerate: boolean;
    onexport: (kind: 'docx' | 'md') => void;
  } = $props();

  type LoadState = 'loading' | 'ready' | 'error';
  let loadState = $state<LoadState>('loading');
  let report = $state.raw<ResearchReport | null>(null);
  let regenerating = $state(false);

  // Pure view-model: recomputes when the report json or the joined cards change.
  const view = $derived<ReportView>(buildReportView(report, cards));

  // Plain (non-$state) handles — never read inside a $effect.
  let loadController: AbortController | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  function stopPoll() {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  async function load() {
    // Abort any previous in-flight load.
    loadController?.abort();
    loadController = new AbortController();
    const signal = loadController.signal;

    loadState = 'loading';
    try {
      const res = await fetch(`/api/deepdive/${sessionId}/report`, { signal });
      if (!res.ok) {
        loadState = 'error';
        return;
      }
      const body = (await res.json()) as { report: ResearchReport | null };
      report = body.report ?? null;
      loadState = 'ready';
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      console.error('[report-node] load error', err);
      loadState = 'error';
    }
  }

  async function regenerate() {
    if (!canRegenerate || regenerating) return;

    // Snapshot the current report for change detection.
    const before = JSON.stringify(report);

    regenerating = true;

    try {
      await fetch(`/api/deepdive/${sessionId}/report/regenerate`, { method: 'POST' });
    } catch (err) {
      console.error('[report-node] regenerate error', err);
      regenerating = false;
      return;
    }

    // Poll GET /report every 4s until the content changes (or ~90s cap).
    const MAX_POLLS = 22;
    let polls = 0;

    stopPoll(); // Guard against overlapping polls.

    async function poll() {
      polls += 1;
      const isCap = polls >= MAX_POLLS;

      try {
        const res = await fetch(`/api/deepdive/${sessionId}/report`);
        if (res.ok) {
          const body = (await res.json()) as { report: ResearchReport | null };
          const fetched = body.report ?? null;
          if (fetched !== null && JSON.stringify(fetched) !== before) {
            // Report changed — update and stop.
            report = fetched;
            regenerating = false;
            stopPoll();
            return;
          }
        }
      } catch (err) {
        console.warn('[report-node] poll error', err);
      }

      if (isCap) {
        // Best-effort: accept whatever is there and stop.
        console.warn('[report-node] poll cap reached — clearing spinner');
        regenerating = false;
        stopPoll();
        // One final load to make sure the UI reflects the latest state.
        load();
        return;
      }

      pollTimer = setTimeout(poll, 4_000);
    }

    pollTimer = setTimeout(poll, 4_000);
  }

  $effect(() => {
    load();
  });

  onDestroy(() => {
    loadController?.abort();
    stopPoll();
  });

  // ——— expand / collapse the whole preview body ———
  let expanded = $state(false);

  function pct(n: number): string {
    return `${Math.round(n * 100)}%`;
  }
</script>

<div class="report-node" data-state={loadState}>
  <header class="rn-head">
    <span class="rn-title">REPORT</span>
    {#if loadState === 'ready' && view.hasReport}
      <button
        type="button"
        class="rn-expand"
        aria-expanded={expanded}
        onclick={() => (expanded = !expanded)}
      >{expanded ? '− collapse' : '+ expand'}</button>
    {/if}
  </header>

  {#if loadState === 'loading'}
    <p class="rn-muted">Loading report&hellip;</p>
  {:else if loadState === 'error'}
    <p class="rn-muted rn-error">Could not load report.</p>
    <button type="button" class="rn-btn" onclick={load}>Retry</button>
  {:else if !view.hasReport}
    <p class="rn-muted">Report not generated.</p>
    {#if canRegenerate}
      <button type="button" class="rn-btn rn-accent" disabled={regenerating} onclick={regenerate}>
        {regenerating ? 'regenerating…' : 'Regenerate'}
      </button>
    {/if}
  {:else}
    <!-- executive summary -->
    <section class="rn-exec">
      <p class:rn-clamp={!expanded}>{view.executiveSummary}</p>
    </section>

    {#if expanded}
      <!-- clusters -->
      {#if view.clusters.length}
        <section class="rn-sec">
          <h4 class="rn-sec-h">Clusters</h4>
          {#each view.clusters as cl (cl.title)}
            <details class="rn-cluster">
              <summary>
                <span class="rn-cl-title">{cl.title}</span>
                <span class="rn-cl-count">{cl.factCount}</span>
              </summary>
              {#if cl.summary}<p class="rn-cl-summary">{cl.summary}</p>{/if}
              <ul class="rn-fact-list">
                {#each cl.facts as f (f.id)}
                  <li>{f.content}</li>
                {/each}
              </ul>
            </details>
          {/each}
        </section>
      {/if}

      <!-- knowledge gaps -->
      {#if view.knowledgeGaps.length}
        <section class="rn-sec">
          <h4 class="rn-sec-h">Knowledge gaps</h4>
          <div class="rn-chips">
            {#each view.knowledgeGaps as g (g.gap)}
              <span class="rn-chip" style:--chip={g.color} title={`${g.type} · ${g.severity}`}>{g.gap}</span>
            {/each}
          </div>
        </section>
      {/if}

      <!-- hypotheses -->
      {#if view.hypotheses.length}
        <section class="rn-sec">
          <h4 class="rn-sec-h">Hypotheses</h4>
          {#each view.hypotheses as h (h.hypothesis)}
            <div class="rn-hyp">
              <p class="rn-hyp-text">{h.hypothesis}</p>
              <span class="rn-hyp-meta">testability: {h.testability}</span>
              {#if h.supporting.length}
                <p class="rn-hyp-line"><b>+</b> {h.supporting.map((f) => f.content).join(' · ')}</p>
              {/if}
              {#if h.tension.length}
                <p class="rn-hyp-line rn-tension"><b>&ndash;</b> {h.tension.map((f) => f.content).join(' · ')}</p>
              {/if}
            </div>
          {/each}
        </section>
      {/if}

      <!-- suggested follow-ups -->
      {#if view.followups.length}
        <section class="rn-sec">
          <h4 class="rn-sec-h">Suggested follow-ups</h4>
          <ul class="rn-fu-list">
            {#each view.followups as fu (fu.question)}
              <li><span class="rn-fu-q">{fu.question}</span><span class="rn-fu-c">{fu.context}</span></li>
            {/each}
          </ul>
        </section>
      {/if}

      <!-- top entities -->
      {#if view.topEntities.length}
        <section class="rn-sec">
          <h4 class="rn-sec-h">Key players</h4>
          <div class="rn-chips">
            {#each view.topEntities as e (e.id)}
              <span class="rn-ent">{e.name} <i>{pct(e.centrality)}</i></span>
            {/each}
          </div>
        </section>
      {/if}

      <!-- source diversity -->
      {#if view.sourceDiversity}
        <section class="rn-sec">
          <h4 class="rn-sec-h">Source diversity</h4>
          <p class="rn-muted">
            {view.sourceDiversity.total_domains} domains &middot;
            concentration {pct(view.sourceDiversity.concentration_index)}
          </p>
        </section>
      {/if}
    {/if}

    <!-- actions -->
    <footer class="rn-actions">
      {#if canRegenerate}
        <button type="button" class="rn-btn" disabled={regenerating} onclick={regenerate}>
          {regenerating ? 'regenerating…' : 'Regenerate report'}
        </button>
        <button type="button" class="rn-btn" onclick={() => onexport('docx')}>Download .docx</button>
        <button type="button" class="rn-btn" onclick={() => onexport('md')}>Download .md</button>
      {/if}
    </footer>
  {/if}
</div>

<style>
  .report-node {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 320px;
    max-height: 460px;
    overflow-y: auto;
    padding: 10px 12px;
    background: var(--surface-elevated);
    border: 1.5px solid var(--card-border);
    border-radius: 4px;
    font-family: var(--font-mono);
    color: var(--text-primary);
  }
  .rn-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .rn-title {
    font-size: 11px;
    letter-spacing: 0.08em;
    color: var(--accent);
  }
  .rn-expand,
  .rn-btn {
    font-family: var(--font-mono);
    font-size: 11px;
    background: transparent;
    border: 1px solid var(--card-border);
    color: var(--text-primary);
    border-radius: 3px;
    padding: 4px 8px;
    cursor: pointer;
  }
  .rn-expand:hover,
  .rn-btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .rn-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .rn-accent {
    border-color: var(--accent);
    color: var(--accent);
  }
  .rn-muted {
    font-size: 12px;
    color: var(--divider);
    margin: 0;
  }
  .rn-error {
    color: #8b3a1a;
  }
  .rn-exec p {
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    margin: 0;
  }
  .rn-clamp {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .rn-sec {
    border-top: 1px solid var(--divider);
    padding-top: 6px;
  }
  .rn-sec-h {
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--divider);
    margin: 0 0 4px;
  }
  .rn-cluster {
    border: 1px solid var(--card-border);
    border-radius: 3px;
    padding: 4px 6px;
    margin-bottom: 4px;
  }
  .rn-cluster summary {
    display: flex;
    justify-content: space-between;
    cursor: pointer;
    font-size: 12px;
  }
  .rn-cl-count {
    color: var(--accent);
  }
  .rn-cl-summary {
    font-size: 11px;
    color: var(--divider);
    margin: 4px 0;
  }
  .rn-fact-list,
  .rn-fu-list {
    margin: 4px 0 0;
    padding-left: 16px;
  }
  .rn-fact-list li,
  .rn-fu-list li {
    font-size: 11px;
    line-height: 1.45;
    margin-bottom: 3px;
  }
  .rn-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .rn-chip {
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 3px;
    border: 1px solid var(--chip);
    color: var(--chip);
    background: transparent;
  }
  .rn-ent {
    font-size: 11px;
    padding: 2px 6px;
    border: 1px solid var(--card-border);
    border-radius: 3px;
  }
  .rn-ent i {
    color: var(--accent);
    font-style: normal;
  }
  .rn-hyp {
    margin-bottom: 6px;
  }
  .rn-hyp-text {
    font-size: 12px;
    margin: 0;
  }
  .rn-hyp-meta {
    font-size: 10px;
    color: var(--divider);
  }
  .rn-hyp-line {
    font-size: 11px;
    margin: 2px 0 0;
  }
  .rn-tension {
    color: #8b3a1a;
  }
  .rn-fu-q {
    display: block;
    font-size: 12px;
  }
  .rn-fu-c {
    display: block;
    font-size: 11px;
    color: var(--divider);
  }
  .rn-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    border-top: 1px solid var(--divider);
    padding-top: 6px;
  }
</style>
