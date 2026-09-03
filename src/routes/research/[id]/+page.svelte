<script lang="ts">
  import { onMount } from 'svelte';
  import type { PageData } from './$types';
  import FrontierGraph, { type FrontierLead } from '$lib/components/research/FrontierGraph.svelte';
  import ReportPanels, { type ReportView } from '$lib/components/research/ReportPanels.svelte';
  import ActionsRow from '$lib/components/research/ActionsRow.svelte';
  import Markdown from '$lib/components/research/Markdown.svelte';
  import StatTiles, { type Stat } from '$lib/components/research/StatTiles.svelte';
  import SessionNetwork from '$lib/components/research/SessionNetwork.svelte';
  import ResearchTimeline from '$lib/components/research/ResearchTimeline.svelte';
  import SourceMix from '$lib/components/research/SourceMix.svelte';
  import SourceTable from '$lib/components/research/SourceTable.svelte';
  import AskJkaiPanel from '$lib/components/research/AskJkaiPanel.svelte';
  import RunControls from '$lib/components/research/RunControls.svelte';
  import RunSpend from '$lib/components/research/RunSpend.svelte';
  import HealthShell from '$lib/components/health/hub/HealthShell.svelte';
  import { goto, invalidateAll } from '$app/navigation';

  let { data }: { data: PageData } = $props();

  let status = $state(data.session.status);
  let summary = $state(data.session.summary);
  let durationMs = $state<number | null>(data.session.durationMs);
  let errorMessage = $state<string | null>(data.session.errorMessage);
  /**
   * Live source count while the run is in flight. The RANKED list comes from
   * the loader — media flags and per-source fact counts are a database join,
   * not something the SSE frame carries — so this drives the tile only, and the
   * table below reads `data.sources` after the completion refresh.
   */
  let liveSourceCount = $state(data.sources.length);
  let stats = $state({
    sourcesFound: 0,
    factsExtracted: 0,
    entitiesIdentified: 0,
    counterfactualsRaised: 0,
    relationshipsFound: 0,
  });
  let logLines = $state<string[]>([]);
  let leads = $state<FrontierLead[]>(data.leads as FrontierLead[]);

  let showReasoning = $state(false);
  let reasoning = $state('');

  // EventSource and timer handles are internal machinery, never read by the
  // template or a $derived — as $state they would re-trigger the effect that
  // opens and closes them (documented route to effect_update_depth_exceeded).
  let es: EventSource | null = null;
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;

  let elapsedMs = $state(0);
  const running = $derived(!['complete', 'failed', 'draft'].includes(status) || status === 'draft');
  const finished = $derived(status === 'complete' || status === 'failed');
  const paused = $derived(status === 'paused');
  /**
   * Not going anywhere on its own. A paused run has real sources, real facts
   * and a real bill, so the evidence panels below belong to it as much as they
   * belong to a finished one — only the report-shaped panels need a report.
   */
  const settled = $derived(finished || paused);
  const researchNav = $derived([
    { href: '/research', label: 'New research' },
    { href: `/research/${data.session.id}/desk`, label: 'Open desk' },
    { href: '/jkai/intel', label: 'Intel', muted: true },
    { href: '/jkai', label: 'Chat', muted: true },
  ]);

  /**
   * Headline numbers. Single magnitudes, so tiles rather than a chart — a bar
   * chart of "sources / facts / entities" would encode nothing the digits do
   * not. `tone` is reserved for genuine states and always ships with its label.
   */
  const tiles = $derived.by((): Stat[] => {
    const c = data.counts;
    const div = (data.report as { source_diversity?: { total_domains?: number; concentration_index?: number } })
      ?.source_diversity;
    const out: Stat[] = [
      {
        label: 'Sources',
        value: c.sources,
        note: c.domains ? `${c.domains} domains` : null,
        href: '#sources',
      },
      // The count that answers "how much of this actually mattered". It is the
      // one the old list made impossible to see.
      {
        label: 'Key material',
        value: c.keySources,
        note: 'fed the report, or substantial',
        href: '#sources',
      },
    ];
    if (data.tier.extractsFacts) {
      out.push({ label: 'Facts', value: c.facts, href: data.timeline.length ? '#timeline' : undefined });
      out.push({
        label: 'Entities',
        value: c.entities,
        note: c.relationships ? `${c.relationships} links` : 'no links extracted',
        href: '#network',
      });
    }
    if (c.counterfactuals > 0) {
      out.push({ label: 'Challenged', value: c.counterfactuals, note: 'claims with counter-evidence', tone: 'warn' });
    }
    out.push({ label: 'Took', value: fmtMs(durationMs) });
    if (div?.concentration_index != null) {
      const narrow = div.concentration_index >= 0.5;
      out.push({
        label: 'Source spread',
        value: narrow ? 'Narrow' : div.concentration_index >= 0.3 ? 'Moderate' : 'Broad',
        note: narrow ? 'most sources are one kind' : null,
        tone: narrow ? 'warn' : undefined,
        href: '#source-mix',
      });
    }
    return out;
  });

  /** What the Ask panel opens with, pushed from the network or a report panel. */
  let pendingQuestion = $state<string | null>(null);
  /** Media kind the source list is narrowed to, driven by the mix chart. */
  let sourceFilter = $state<string | null>(null);

  const askContext = $derived({
    sessionId: data.session.id,
    topic: data.session.topic,
    topEntities: data.topEntities.map((e) => e.name),
    report: data.report as Record<string, never>,
  });

  function fmtMs(ms: number | null): string {
    if (ms == null) return '—';
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  /**
   * (Re)connect to the run's event stream.
   *
   * Reconnecting is not decoration. The server binds a stream to the session's
   * emitter at the moment the request arrives, and a finished run's emitter is
   * torn down thirty seconds later — so a browser that was watching a run when
   * it stopped is holding a listener on an object nothing will ever emit on
   * again. Resuming from this page has to open a new one, or the page would sit
   * there showing a paused run that had in fact been working for five minutes.
   */
  function openStream() {
    es?.close();
    es = new EventSource(`/api/research/${data.session.id}/stream`);
    es.onmessage = (ev) => {
      let msg: { type: string; message?: string; data?: Record<string, any> };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'status':
          if (typeof msg.data?.status === 'string') status = msg.data.status;
          break;
        case 'stats':
          if (msg.data) stats = { ...stats, ...(msg.data as typeof stats) };
          break;
        case 'log':
          if (msg.message) logLines = [...logLines.slice(-60), msg.message];
          break;
        case 'sources':
          if (Array.isArray(msg.data?.sources)) liveSourceCount = msg.data.sources.length;
          break;
        case 'token':
          // The synthesis streams in; the summary IS the accumulating text.
          if (typeof msg.data?.token === 'string') summary += msg.data.token;
          break;
        case 'reasoning':
          if (typeof msg.data?.token === 'string') reasoning += msg.data.token;
          break;
        case 'lead': {
          // Merge by id — a lead is emitted repeatedly as it moves through
          // queued → running → its verdict.
          const l = msg.data as unknown as FrontierLead;
          if (l?.id) {
            const i = leads.findIndex((x) => x.id === l.id);
            if (i === -1) leads = [...leads, l];
            else leads = [...leads.slice(0, i), l, ...leads.slice(i + 1)];
          }
          break;
        }
        case 'synthesis':
          if (typeof msg.data?.executive_summary === 'string') summary = msg.data.executive_summary;
          break;
        case 'complete':
          status = 'complete';
          durationMs = (msg.data?.durationMs as number) ?? null;
          stopClock();
          // Everything the finished view needs — the report, the ranked
          // sources with their media flags, the resolved timeline, the counts —
          // is assembled by the loader from tables the stream does not carry.
          // Watching a run to completion used to leave all of it empty until a
          // manual refresh.
          void invalidateAll();
          break;
        case 'error':
          status = 'failed';
          errorMessage = msg.message ?? 'Research failed';
          stopClock();
          break;
      }
    };
    es.onerror = () => {
      // The browser reconnects on its own; the stream replays state on connect,
      // so a dropped socket costs nothing but a gap in the log.
    };
  }

  function startClock() {
    stopClock();
    const startedAt = Date.now();
    elapsedTimer = setInterval(() => {
      elapsedMs = Date.now() - startedAt;
    }, 500);
  }

  onMount(() => {
    if (!finished && !paused) startClock();
    openStream();

    return () => {
      es?.close();
      es = null;
      stopClock();
    };
  });

  /**
   * A control changed the run's state. The stream is reopened rather than
   * trusted: see `openStream`.
   */
  function onControlChanged(next: string) {
    status = next;
    if (next === 'paused' || next === 'pausing') {
      stopClock();
    } else if (next !== 'stopping') {
      // Resumed. The old failure no longer applies and the clock restarts from
      // this leg — the total the run reports at the end still includes what it
      // spent before, because that sum is kept on the row, not here.
      errorMessage = null;
      logLines = [];
      startClock();
      openStream();
    }
    void invalidateAll();
  }

  /**
   * Spawn a child investigation from a gap or hypothesis. `seedContext` and
   * `parentSessionId` have existed on the session row all along — this is the
   * first thing that actually sets them from the UI.
   */
  async function investigate(topic: string, seed: { kind: 'gap' | 'hypothesis'; text: string }) {
    const res = await fetch('/api/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        depth: 'brief',
        parentSessionId: data.session.id,
        seedContext: {
          type: seed.kind,
          parentTopic: data.session.topic,
          parentGoals: data.session.goals,
          ...(seed.kind === 'gap' ? { gapDescription: seed.text } : { hypothesisText: seed.text }),
        },
      }),
    });
    if (res.ok) {
      const child = await res.json();
      await goto(`/research/${child.id}`);
    }
  }

  function stopClock() {
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
  }
</script>

<svelte:head><title>{data.session.topic} — Research</title></svelte:head>

<HealthShell
  path="/research/report"
  kicker={`${data.tier.label} · evidence report`}
  back={{ href: '/research', label: '← All research' }}
  nav={researchNav}
  live={!settled && status !== 'draft' ? status : null}
  meta={[formatDate(data.session.createdAt)]}
  footer={[
    `research/${data.session.id.slice(0, 8)} · ${data.session.depth}`,
    `${data.counts.sources} sources · ${data.counts.facts} facts`,
    `${status} · ${fmtMs(durationMs)}`,
  ]}
>
  <div class="report-page">
    <section class="report-lede">
      <div class="lede-inner">
        <p class="eyebrow">
          JKAI · Research · {data.tier.label}{#if data.tier.grounded}{' · '}{data.tier.groundingLabel}{/if}
        </p>
        <h1>{data.session.topic}</h1>
        <p class="standfirst">{data.session.scopeLabel}</p>

        <dl class="report-ledger" aria-label="Research report summary">
          <div>
            <dt>State</dt>
            <dd class:state-done={status === 'complete'} class:state-failed={status === 'failed'}>{status}</dd>
            <small>{paused && data.session.resumeFrom ? `Resume at ${data.session.resumeFrom}` : 'Current run status'}</small>
          </div>
          <div>
            <dt>Sources</dt>
            <dd>{settled ? data.counts.sources : stats.sourcesFound || liveSourceCount}</dd>
            <small>{data.counts.domains} domains represented</small>
          </div>
          <div>
            <dt>Key material</dt>
            <dd>{data.counts.keySources}</dd>
            <small>Sources feeding the report</small>
          </div>
          <div>
            <dt>Elapsed</dt>
            <dd>{finished || paused ? fmtMs(durationMs) : fmtMs(elapsedMs)}</dd>
            <small>{data.tier.budgetMs && !settled ? `${fmtMs(data.tier.budgetMs)} budget` : formatDate(data.session.createdAt)}</small>
          </div>
        </dl>
      </div>
    </section>

    <main class="wrap">
      <section class="run-section" aria-labelledby="run-title">
        <header class="section-head">
          <div>
            <p class="section-no">01 / Run ledger</p>
            <h2 id="run-title">STATE &amp; SPEND</h2>
          </div>
          <p>The live counters, controls and cost trail for this investigation.</p>
        </header>

        <div class="statusbar">
          <span
            class="pill"
            class:done={status === 'complete'}
            class:failed={status === 'failed'}
            class:held={paused}
          >{status}</span>
          {#if paused && data.session.resumeFrom}
            <span class="metric">will pick up at <b>{data.session.resumeFrom}</b></span>
          {/if}
          <!-- The SSE counters only ever tick DURING a run, so on a finished one they
               are all zero. Reading "0 facts 0 entities" directly above tiles saying
               51 and 53 made the header look broken; once the run is over the loader's
               counts are the true ones. -->
          <span class="metric"><b>{settled ? data.counts.sources : stats.sourcesFound || liveSourceCount}</b> sources</span>
          {#if data.tier.extractsFacts}
            <span class="metric"><b>{settled ? data.counts.facts : stats.factsExtracted}</b> facts</span>
            <span class="metric"><b>{settled ? data.counts.entities : stats.entitiesIdentified}</b> entities</span>
            <!-- Shown beside the entity count, not tucked away in the network panel:
                 entities with no links between them is the shape an extraction
                 failure takes, and it was invisible here for months. -->
            <span class="metric"><b>{settled ? data.counts.relationships : stats.relationshipsFound}</b> links</span>
          {/if}
          <span class="metric spacer">
            {#if finished}{fmtMs(durationMs)}{:else if paused}{fmtMs(durationMs)} so far{:else}{fmtMs(elapsedMs)} elapsed{/if}
            {#if data.tier.budgetMs && !settled}<span class="budget"> / {fmtMs(data.tier.budgetMs)} budget</span>{/if}
          </span>
          <RunControls
            sessionId={data.session.id}
            {status}
            pausable={data.session.depth === 'investigation'}
            onChanged={onControlChanged}
          />
          <button type="button" class="reason-toggle" class:on={showReasoning} onclick={() => (showReasoning = !showReasoning)}>
            {showReasoning ? 'Hide' : 'Show'} reasoning
          </button>
        </div>

        {#if errorMessage}
          <div class="err-line">{errorMessage}</div>
        {/if}

        {#if showReasoning}
          <section class="reasoning">
            <div class="sr-label-tight">Model reasoning</div>
            {#if reasoning}
              <pre>{reasoning}</pre>
            {:else}
              <p class="note">
                Nothing yet. Reasoning only appears while a model that emits it is thinking —
                Codex models never stream reasoning, so this stays empty on those.
              </p>
            {/if}
          </section>
        {/if}

        <!-- An instant answer that searched and one that did not are different things
             to trust, and only one of them has sources below to check it against. -->
        {#if data.session.depth === 'instant' && finished}
          <p class="gnd-line" class:unsourced={!data.tier.grounded}>
            {#if !data.tier.grounded}
              Answered from training data with no search, so nothing here is sourced — treat any date, figure
              or URL in it as unverified.
            {:else if data.counts.sources}
              Searched the web while answering. The {data.counts.sources}
              {data.counts.sources === 1 ? 'page' : 'pages'} it actually read are listed below.
            {:else}
              Search was allowed, but it cited nothing it read — treat this answer as unsourced.
            {/if}
          </p>
        {/if}

        {#if paused}
          <p class="paused-line">
            Held here on purpose. Nothing has been thrown away — the leads that were in flight are back on
            the queue, and a deploy will not restart this run behind your back.
          </p>
        {/if}

        <!-- The bill, wherever the run is up to. Two budgets are being spent and
             neither was visible: model tokens through OpenRouter, and Tavily credits
             against a fixed monthly allowance. -->
        <RunSpend sessionId={data.session.id} live={!settled} final={finished} />
      </section>

      <section class="answer-group" aria-labelledby="answer-title">
        <header class="section-head">
          <div>
            <p class="section-no">02 / Readout</p>
            <h2 id="answer-title">WHAT THE EVIDENCE SAYS</h2>
          </div>
          <p>The synthesis first; actions and follow-up stay beside the answer.</p>
        </header>

        <!-- The answer and the two things you do with it, side by side. Asking jkai
             and exporting are the actions a reader reaches for while still looking at
             the summary, so they sit next to it rather than at the foot of the page. -->
        <div class="main-grid">
          <div class="col-answer">
            <section class="answer">
              {#if summary}
                <Markdown text={summary} />
              {:else if status === 'failed'}
                <p class="note">No answer was produced.</p>
              {:else if finished}
                <!-- A run can finish with everything else intact and no summary: a
                     tight budget used to skip the synthesis step and keep the
                     enrichment. Saying "Working…" under a COMPLETE pill was the page
                     contradicting itself. -->
                <p class="note">
                  This run finished without writing a summary — the evidence below is still here.
                </p>
              {:else if paused}
                <p class="note">
                  Paused before the summary was written. Resume it and it will carry on from where it
                  stopped.
                </p>
              {:else}
                <p class="note working-note">Working on the readout…</p>
              {/if}
            </section>
          </div>

          <!-- Gated on `finished`, not on there being a summary: asking jkai about a
               run and exporting it are exactly what you want when the summary is the
               thing that came out empty. -->
          {#if finished}
            <aside class="col-rail">
              <AskJkaiPanel context={askContext} pending={pendingQuestion} />
              <ActionsRow
                sessionId={data.session.id}
                depth={data.session.depth}
                hasReport={!!summary}
                shareToken={data.session.shareToken}
              />
            </aside>
          {/if}
        </div>
      </section>

      {#if settled || leads.length || data.sources.length}
        <section class="evidence-group" aria-labelledby="evidence-title">
          <header class="section-head">
            <div>
              <p class="section-no">03 / Evidence base</p>
              <h2 id="evidence-title">TRACE THE CLAIMS</h2>
            </div>
            <p>Material, relationships, challenges and sources behind the readout.</p>
          </header>

          <div class="evidence-stack">
            {#if settled}
              <StatTiles stats={tiles} />
            {/if}

            {#if leads.length}
              <section class="frontier-panel">
                <FrontierGraph {leads} />
              </section>
            {/if}

            {#if settled}
              <ResearchTimeline periods={data.timeline} />

              {#if data.counts.entities > 0}
                <SessionNetwork
                  sessionId={data.session.id}
                  onAsk={(q) => {
                    pendingQuestion = q;
                    document.getElementById('ask')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                />
              {/if}
            {/if}

            {#if finished}
              <ReportPanels
                report={data.report as ReportView}
                goals={data.session.goals}
                topEntities={data.topEntities}
                onInvestigate={investigate}
                onAsk={(q) => {
                  pendingQuestion = q;
                  document.getElementById('ask')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}
              />
            {/if}

            {#if settled && data.mix.length > 1}
              <SourceMix
                mix={data.mix}
                contributors={data.contributors}
                selected={sourceFilter}
                onSelect={(kind) => {
                  sourceFilter = kind;
                  document.getElementById('sources')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              />
            {/if}

            {#if data.sources.length}
              <SourceTable
                sources={data.sources}
                filterKind={sourceFilter}
                onClearFilter={() => (sourceFilter = null)}
                sessionId={data.session.id}
                savedSourceIds={data.savedSourceIds}
                driveFolder={data.driveFolder}
              />
            {/if}
          </div>
        </section>
      {/if}

      {#if logLines.length}
        <details class="activity">
          <summary>Activity ({logLines.length})</summary>
          <ul>
            {#each logLines as line, i (i)}<li>{line}</li>{/each}
          </ul>
        </details>
      {/if}
    </main>
  </div>
</HealthShell>

<style>
  .report-page { min-height: 100vh; background: var(--bg); color: var(--text-primary); font-family: var(--font-body); }
  .report-lede { padding: clamp(38px, 5vw, 72px) clamp(20px, 3vw, 44px); background: var(--text-primary); color: var(--bg); border-bottom: 1px solid rgba(237, 228, 212, 0.16); }
  .lede-inner { width: min(1400px, 100%); margin: 0 auto; }
  .eyebrow, .section-no { margin: 0 0 18px; font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 500; letter-spacing: var(--tracking-label-wide); text-transform: uppercase; color: var(--accent); }
  .report-lede .eyebrow { color: var(--accent-on-dark); }
  h1 { max-width: 15ch; margin: 0; overflow-wrap: anywhere; font-family: var(--font-display); font-size: clamp(2.9rem, 6.5vw, 6.8rem); font-weight: 900; line-height: 0.9; letter-spacing: -0.04em; color: var(--bg); text-wrap: balance; }
  .standfirst { margin: 26px 0 0; font-family: var(--font-mono); font-size: var(--fs-label); line-height: 1.55; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(237, 228, 212, 0.62); }
  .report-ledger { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; margin: clamp(42px, 6vw, 78px) 0 0; border-top: 1px solid rgba(237, 228, 212, 0.16); border-left: 1px solid rgba(237, 228, 212, 0.16); }
  .report-ledger > div { min-width: 0; padding: 18px; border-right: 1px solid rgba(237, 228, 212, 0.16); border-bottom: 1px solid rgba(237, 228, 212, 0.16); background: rgba(237, 228, 212, 0.04); }
  .report-ledger dt { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label-wide); text-transform: uppercase; color: rgba(237, 228, 212, 0.52); }
  .report-ledger dd { margin: 10px 0 8px; overflow: hidden; font-family: var(--font-display); font-size: clamp(1.65rem, 3.2vw, 2.75rem); line-height: 0.95; letter-spacing: -0.025em; text-transform: uppercase; color: var(--bg); text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .report-ledger dd.state-done { color: var(--good-on-dark); }
  .report-ledger dd.state-failed { color: var(--error); }
  .report-ledger small { display: block; overflow: hidden; font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1.4; letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent-on-dark); text-overflow: ellipsis; white-space: nowrap; }

  /* Wider than a reading page because the evidence views are dashboards. The
     synthesis keeps a bounded column through the answer/action grid. */
  .wrap { width: min(1180px, 100%); margin: 0 auto; padding: 64px clamp(20px, 5vw, 64px) 96px; }
  .run-section, .answer-group { margin-bottom: 86px; }
  .section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 32px; padding-bottom: 18px; border-bottom: 2px solid var(--text-primary); }
  .section-head .section-no { margin-bottom: 8px; }
  .section-head h2 { margin: 0; font-family: var(--font-display); font-size: clamp(2.15rem, 4.6vw, 4.25rem); line-height: 0.9; letter-spacing: -0.03em; }
  .section-head > p { max-width: 38ch; margin: 0 0 3px; font-size: var(--fs-body-sm); line-height: 1.5; color: var(--text-muted); text-align: right; }

  .statusbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; min-height: 58px; margin-bottom: 20px; padding: 12px 0; border-bottom: 1px solid var(--line-strong); font-family: var(--font-mono); font-size: var(--fs-label); }
  .pill { padding: 4px 9px; border: 1px solid var(--accent); color: var(--accent); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; }
  .pill.done { border-color: var(--success); color: var(--success); }
  .pill.failed { border-color: var(--error); color: var(--error); }
  .pill.held { border-color: var(--accent-ink); color: var(--accent-ink); }
  .metric { color: var(--text-secondary); }
  .metric b { color: var(--text-primary); }
  .spacer { margin-left: auto; }
  .budget { color: var(--text-ghost); }
  .reason-toggle { padding: 5px 9px; border: 1px solid var(--line-strong); background: transparent; color: var(--text-muted); font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em; text-transform: uppercase; cursor: pointer; }
  .reason-toggle:hover, .reason-toggle.on { border-color: var(--accent); color: var(--accent); }
  .err-line { margin-bottom: 20px; padding: 10px 12px; border-left: 3px solid var(--error); background: var(--error-bg); color: var(--error); font-family: var(--font-mono); font-size: var(--fs-label); }
  .reasoning { margin-bottom: 20px; padding: 18px; border: 1px dashed var(--line-strong); background: var(--surface-sunken); }
  .reasoning pre { max-height: 300px; margin: 8px 0 0; overflow-y: auto; white-space: pre-wrap; word-break: break-word; color: var(--text-secondary); font-family: var(--font-code); font-size: var(--fs-label); line-height: 1.55; }
  .gnd-line, .paused-line { margin: 0 0 20px; padding: 9px 12px; border-left: 3px solid var(--accent); background: var(--accent-tint-04); color: var(--text-muted); font-size: var(--fs-nav); line-height: 1.5; }
  .gnd-line.unsourced { border-left-color: var(--warn); color: var(--text-secondary); }
  .paused-line { border-left-color: var(--accent-ink); background: var(--accent-ink-tint-06); }

  /* Answer left, actions right. The rail collapses under the answer before the
     answer gets too narrow to read. */
  .main-grid { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 32px; align-items: start; margin-top: 30px; }
  .col-answer { min-width: 0; }
  .col-rail { position: sticky; top: 72px; min-width: 0; }
  .answer { padding: 0 24px 0 0; border-right: 1px solid var(--line-hair); }
  .note { color: var(--text-muted); font-size: var(--fs-body); line-height: 1.6; font-style: italic; }
  .working-note { padding: 28px; border: 1px dashed var(--line-strong); text-align: center; }

  .evidence-group { margin-bottom: 54px; }
  .evidence-stack { display: grid; gap: 26px; padding-top: 30px; }
  .frontier-panel { margin: 0; }
  .activity { margin-top: 34px; padding-top: 18px; border-top: 1px solid var(--line-strong); }
  .activity summary { color: var(--accent); font-family: var(--font-mono); font-size: var(--fs-label); letter-spacing: 0.1em; text-transform: uppercase; cursor: pointer; }
  .activity ul { display: grid; gap: 4px; margin: 10px 0 0; padding-left: 20px; color: var(--text-secondary); font-family: var(--font-code); font-size: var(--fs-label); }

  @media (max-width: 900px) {
    .report-ledger { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .main-grid { grid-template-columns: minmax(0, 1fr); }
    .col-rail { position: static; }
    .answer { padding-right: 0; border-right: 0; }
  }
  @media (max-width: 720px) {
    .report-lede { padding-inline: 20px; }
    h1 { max-width: none; font-size: clamp(2.6rem, 13vw, 4.3rem); }
    .wrap { padding-top: 44px; }
    .run-section, .answer-group { margin-bottom: 64px; }
    .section-head { align-items: flex-start; flex-direction: column; gap: 14px; }
    .section-head > p { max-width: none; text-align: left; }
    .spacer { margin-left: 0; }
  }
  @media (max-width: 480px) {
    .report-ledger { grid-template-columns: 1fr; }
    .report-ledger > div { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; gap: 6px 18px; }
    .report-ledger dd { grid-column: 2; grid-row: 1 / span 2; margin: 0; }
    .report-ledger small { grid-column: 1; }
  }
</style>
