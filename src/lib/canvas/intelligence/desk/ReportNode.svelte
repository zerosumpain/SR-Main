<!-- src/lib/canvas/intelligence/desk/ReportNode.svelte -->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { buildReportView, type DeskCardLite, type ReportView } from './report-view';
  import { type DeskStatus } from './deskControls';
  import type { ResearchReport } from '$lib/deepdive/types';
  import { parseSseFrames, applyFrame, type ChatMessage, type ChatSource } from './chatStream';
  import ChatMarkdown from '$lib/canvas/ChatMarkdown.svelte';

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

  // A stored report whose executive summary is the failure sentinel (left behind
  // when the LLM gateway timed out before the fix). We treat it as "no usable
  // report" and self-heal by regenerating once.
  const reportFailed = $derived(
    !!report && /generation failed/i.test((report.executive_summary ?? '')),
  );
  // Guard so self-heal fires at most once per node mount.
  let healAttempted = false;
  function maybeSelfHeal() {
    if (healAttempted || !canRegenerate || regenerating) return;
    const r = report;
    const needsHeal = !r || !r.executive_summary?.trim() || /generation failed/i.test(r.executive_summary);
    if (needsHeal) {
      healAttempted = true;
      regenerate();
    }
  }

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
      // Auto-regenerate once if the stored report is missing or previously failed.
      maybeSelfHeal();
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      console.error('[report-node] load error', err);
      loadState = 'error';
    }
  }

  async function regenerate() {
    if (!canRegenerate || regenerating) return;

    const before = JSON.stringify(report);
    regenerating = true;

    try {
      await fetch(`/api/deepdive/${sessionId}/report/regenerate`, { method: 'POST' });
    } catch (err) {
      console.error('[report-node] regenerate error', err);
      regenerating = false;
      return;
    }

    // ~150s ceiling: runPostProcessing runs ~6 sequential LLM calls + a per-fact
    // novelty loop and, on a slow gateway (90s per-call timeout), can run well
    // past 90s. The cap must comfortably exceed that so it doesn't give up mid-run.
    const MAX_POLLS = 38;
    let polls = 0;

    stopPoll();

    async function poll() {
      polls += 1;
      const isCap = polls >= MAX_POLLS;

      try {
        const res = await fetch(`/api/deepdive/${sessionId}/report`);
        if (res.ok) {
          const body = (await res.json()) as { report: ResearchReport | null };
          const fetched = body.report ?? null;
          // Resolve only on a CHANGED **and healthy** report — a re-failed
          // regeneration also "changes" (non-deterministic clusters/sections) but
          // still carries the sentinel summary, so keep polling until the cap.
          const healthy = !!fetched && !/generation failed/i.test(fetched.executive_summary ?? '');
          if (fetched !== null && JSON.stringify(fetched) !== before && healthy) {
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
        console.warn('[report-node] poll cap reached — clearing spinner');
        regenerating = false;
        stopPoll();
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
    abortCustom();
  });

  // ——— expand / collapse the auto-report preview body ———
  let expanded = $state(false);

  function pct(n: number): string {
    return `${Math.round(n * 100)}%`;
  }

  // ——— Brief-driven custom report generation ———
  type GenState = 'idle' | 'streaming' | 'done' | 'error';
  let brief = $state('');
  let genState = $state<GenState>('idle');
  let customMarkdown = $state('');
  let customSources = $state<ChatSource[]>([]);
  let genError = $state('');

  // Plain let — never read inside a $effect.
  let customReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let customAbort: AbortController | null = null;

  function abortCustom() {
    customAbort?.abort();
    customAbort = null;
    try { customReader?.cancel(); } catch { /* ignore */ }
    customReader = null;
  }

  async function generateCustomReport() {
    const briefTrimmed = brief.trim();
    if (!briefTrimmed || genState === 'streaming') return;

    abortCustom();
    customMarkdown = '';
    customSources = [];
    genError = '';
    genState = 'streaming';

    customAbort = new AbortController();
    const signal = customAbort.signal;

    let res: Response;
    try {
      res = await fetch(`/api/deepdive/${sessionId}/report/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: briefTrimmed }),
        signal,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') { genState = 'idle'; return; }
      genState = 'error';
      genError = 'Network error — could not reach the server.';
      return;
    }

    if (!res.ok) {
      genState = 'error';
      genError = res.status === 404
        ? 'Session not found.'
        : res.status === 400
        ? 'Brief is required.'
        : `Server error (${res.status}).`;
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) { genState = 'error'; genError = 'No response body.'; return; }
    customReader = reader;

    const decoder = new TextDecoder();
    let buf = '';

    // Build a mutable ChatMessage stub that applyFrame mutates in place.
    // We reflect changes back into $state vars so Svelte updates.
    const stub: ChatMessage = { role: 'assistant', content: '' };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const { frames, rest } = parseSseFrames(buf);
        buf = rest;

        for (const frame of frames) {
          if (frame.type === 'done') {
            genState = 'done';
            break;
          }
          applyFrame(stub, frame);
          // Reflect into $state so the template re-renders.
          customMarkdown = stub.content;
          if (frame.type === 'sources') {
            customSources = stub.sources ?? [];
          }
        }
        if (genState === 'done') break;
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') { genState = 'idle'; return; }
      console.error('[report-node] stream read error', err);
      genState = 'error';
      genError = 'Stream interrupted.';
      return;
    } finally {
      customReader = null;
    }

    if (genState === 'streaming') genState = 'done';
  }

  function downloadCustomMd() {
    if (!customMarkdown) return;
    const blob = new Blob([customMarkdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${sessionId.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function resetCustom() {
    abortCustom();
    customMarkdown = '';
    customSources = [];
    genError = '';
    genState = 'idle';
  }
</script>

<div class="report-node" data-state={loadState} role="region" aria-label="Research report">
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

  <!-- ═══════════════════════════════════════════════════
       BRIEF-DRIVEN CUSTOM REPORT
  ═══════════════════════════════════════════════════ -->
  <section class="rn-brief-section">
    <h4 class="rn-sec-h">Custom report</h4>
    <div class="rn-brief-row">
      <textarea
        class="rn-brief-input"
        rows={3}
        placeholder="Describe what you want the report to cover…"
        bind:value={brief}
        disabled={genState === 'streaming'}
        onkeydown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            generateCustomReport();
          }
        }}
      ></textarea>
      <div class="rn-brief-btns">
        <button
          type="button"
          class="rn-btn rn-accent"
          disabled={genState === 'streaming' || !brief.trim()}
          onclick={generateCustomReport}
        >
          {genState === 'streaming' ? 'Generating…' : 'Generate report'}
        </button>
        {#if genState === 'done' || genState === 'error'}
          <button type="button" class="rn-btn" onclick={resetCustom}>Reset</button>
        {/if}
      </div>
    </div>
    <p class="rn-hint">Tip: Ctrl+Enter / ⌘+Enter to generate</p>

    {#if genState === 'error'}
      <p class="rn-muted rn-error">{genError}</p>
    {/if}

    {#if customMarkdown}
      <!-- Streaming / completed markdown output -->
      <div class="rn-custom-output">
        {#if customSources.length}
          <div class="rn-source-chips">
            {#each customSources as src (src.n)}
              {#if src.url}
                <a
                  class="rn-src-chip"
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={src.url}
                >[{src.n}] {src.title || src.domain || src.url}</a>
              {:else}
                <span class="rn-src-chip">[{src.n}] {src.title || src.domain || 'source'}</span>
              {/if}
            {/each}
          </div>
        {/if}

        <div class="rn-md-wrap">
          <ChatMarkdown content={customMarkdown} role="assistant" />
          {#if genState === 'streaming'}
            <span class="rn-cursor" aria-hidden="true">▋</span>
          {/if}
        </div>

        {#if genState === 'done'}
          <div class="rn-dl-row">
            <button type="button" class="rn-btn rn-accent" onclick={downloadCustomMd}>
              Download .md
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </section>

  <!-- ═══════════════════════════════════════════════════
       AUTO REPORT PREVIEW (existing)
  ═══════════════════════════════════════════════════ -->
  {#if loadState === 'loading'}
    <p class="rn-muted">Loading report&hellip;</p>
  {:else if loadState === 'error'}
    <p class="rn-muted rn-error">Could not load report.</p>
    <button type="button" class="rn-btn" onclick={load}>Retry</button>
  {:else if !view.hasReport}
    {#if regenerating}
      <p class="rn-muted">Generating report&hellip; this can take up to a minute.</p>
    {:else}
      <p class="rn-muted">Auto-report not yet generated.</p>
      {#if canRegenerate}
        <button type="button" class="rn-btn rn-accent" onclick={regenerate}>Generate report</button>
      {/if}
    {/if}
  {:else}
    <section class="rn-sec">
      <h4 class="rn-sec-h">Auto report</h4>
      <!-- executive summary (or an inline banner if only the summary failed —
           the rest of the report below is still shown) -->
      <section class="rn-exec">
        {#if reportFailed}
          {#if regenerating}
            <p class="rn-muted">Regenerating the executive summary&hellip;</p>
          {:else}
            <p class="rn-muted rn-error">The executive summary didn’t complete.</p>
            {#if canRegenerate}
              <button type="button" class="rn-btn rn-accent" onclick={regenerate}>Regenerate</button>
            {/if}
          {/if}
        {:else}
          <p class:rn-clamp={!expanded}>{view.executiveSummary}</p>
        {/if}
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
    </section>

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
    /* Fill the desk-node-host (position:absolute, display:flex, align-items:stretch).
       Host drives width/height via inline style; we fill it, scroll internally. */
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 10px 12px;
    background: var(--surface-elevated);
    font-family: var(--font-mono);
    color: var(--text-primary);
    scrollbar-width: thin;
  }
  .rn-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .rn-title {
    font-size: var(--fs-label);
    letter-spacing: 0.08em;
    color: var(--accent);
  }
  .rn-expand,
  .rn-btn {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
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
    font-size: var(--fs-label);
    color: var(--divider);
    margin: 0;
  }
  .rn-error {
    color: #8b3a1a;
  }
  .rn-exec p {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
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
    font-size: var(--fs-label-xs);
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
    font-size: var(--fs-label);
  }
  .rn-cl-count {
    color: var(--accent);
  }
  .rn-cl-summary {
    font-size: var(--fs-label);
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
    font-size: var(--fs-label);
    line-height: 1.45;
    margin-bottom: 3px;
  }
  .rn-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .rn-chip {
    font-size: var(--fs-label);
    padding: 2px 6px;
    border-radius: 3px;
    border: 1px solid var(--chip);
    color: var(--chip);
    background: transparent;
  }
  .rn-ent {
    font-size: var(--fs-label);
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
    font-size: var(--fs-label);
    margin: 0;
  }
  .rn-hyp-meta {
    font-size: var(--fs-label-xs);
    color: var(--divider);
  }
  .rn-hyp-line {
    font-size: var(--fs-label);
    margin: 2px 0 0;
  }
  .rn-tension {
    color: #8b3a1a;
  }
  .rn-fu-q {
    display: block;
    font-size: var(--fs-label);
  }
  .rn-fu-c {
    display: block;
    font-size: var(--fs-label);
    color: var(--divider);
  }
  .rn-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    border-top: 1px solid var(--divider);
    padding-top: 6px;
  }

  /* ——— Brief-driven report section ——— */
  .rn-brief-section {
    border-top: 1px solid var(--divider);
    padding-top: 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .rn-brief-row {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .rn-brief-input {
    font-family: var(--font-mono);
    font-size: var(--fs-body);
    line-height: 1.45;
    background: var(--bg-section, #111);
    border: 1px solid var(--card-border);
    color: var(--text-primary);
    border-radius: 3px;
    padding: 6px 8px;
    resize: vertical;
    width: 100%;
    box-sizing: border-box;
    outline: none;
  }
  .rn-brief-input:focus {
    border-color: var(--accent);
  }
  .rn-brief-input:disabled {
    opacity: 0.6;
  }
  .rn-brief-btns {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .rn-hint {
    font-size: var(--fs-label-xs);
    color: var(--divider);
    margin: 0;
  }
  .rn-custom-output {
    border: 1px solid var(--card-border);
    border-radius: 3px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .rn-source-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .rn-src-chip {
    font-size: var(--fs-label-xs);
    padding: 2px 6px;
    border: 1px solid var(--card-border);
    border-radius: 3px;
    color: var(--text-primary);
    text-decoration: none;
  }
  a.rn-src-chip:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .rn-md-wrap {
    /* The ChatMarkdown component scrolls on its own content. */
    overflow-x: hidden;
    word-break: break-word;
  }
  .rn-cursor {
    display: inline-block;
    width: 0.55em;
    animation: rn-blink 0.85s step-start infinite;
    color: var(--accent);
    line-height: 1;
  }
  @keyframes rn-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
  .rn-dl-row {
    display: flex;
    gap: 5px;
    padding-top: 4px;
    border-top: 1px solid var(--divider);
  }
</style>
