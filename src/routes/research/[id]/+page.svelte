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
  let stats = $state({ sourcesFound: 0, factsExtracted: 0, entitiesIdentified: 0, counterfactualsRaised: 0 });
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

<div class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">
        JKAI · Research · {data.tier.label}{#if data.tier.grounded}{' · '}{data.tier.groundingLabel}{/if}
      </div>
      <h1>{data.session.topic}</h1>
      <p class="scope-line">{data.session.scopeLabel}</p>
    </div>
    <a class="back-link" href="/research">← All research</a>
  </header>

  <section class="statusbar">
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
  </section>

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

  {#if settled}
    <StatTiles stats={tiles} />
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
          <p class="note">Working…</p>
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

  {#if logLines.length}
    <details class="activity">
      <summary>Activity ({logLines.length})</summary>
      <ul>
        {#each logLines as line, i (i)}<li>{line}</li>{/each}
      </ul>
    </details>
  {/if}
</div>

<style>
  /* Wider than the 860px reading column it used to be: this is a dashboard now,
     and the answer keeps its own measure inside the grid below rather than the
     whole page being sized to it. */
  .wrap { max-width: 1180px; margin: 2rem auto 4rem; padding: 0 1.5rem; color: var(--text-primary); font-family: var(--font-body); }

  /* Answer left, actions right. The rail collapses under the answer before the
     answer gets too narrow to read. */
  .main-grid { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 1.25rem; align-items: start; margin-bottom: 1.25rem; }
  .col-answer { min-width: 0; }
  .col-rail { min-width: 0; position: sticky; top: 1rem; }
  @media (max-width: 900px) {
    .main-grid { grid-template-columns: minmax(0, 1fr); }
    .col-rail { position: static; }
  }
  .page-hdr { display: flex; justify-content: space-between; align-items: flex-end; gap: 1.5rem; margin-bottom: 1.25rem; padding-bottom: 1rem; border-bottom: 2px solid var(--text-primary); }
  .kicker { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.18em; color: var(--accent); margin-bottom: 0.35rem; }
  .page-hdr h1 { margin: 0; font-family: var(--font-display); font-size: 1.8rem; font-weight: 900; line-height: 1.1; }
  .scope-line { margin: 0.5rem 0 0; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }
  .back-link { font-family: var(--font-mono); font-size: var(--fs-label); text-transform: uppercase; letter-spacing: 0.12em; color: var(--accent); text-decoration: none; flex-shrink: 0; }

  .statusbar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; margin-bottom: 1.25rem; font-family: var(--font-mono); font-size: var(--fs-label); }
  .pill { text-transform: uppercase; letter-spacing: 0.12em; padding: 2px 8px; border: 1px solid var(--accent); color: var(--accent); font-size: var(--fs-label-xs); }
  .pill.done { border-color: var(--success); color: var(--success); }
  .pill.failed { border-color: var(--error); color: var(--error); }
  .pill.held { border-color: var(--accent-ink); color: var(--accent-ink); }

  .gnd-line { margin: 0 0 1rem; font-size: 0.86rem; line-height: 1.5; color: var(--text-muted); border-left: 2px solid var(--accent); padding: 0.4rem 0 0.4rem 0.7rem; }
  .gnd-line.unsourced { border-left-color: var(--warn); color: var(--text-secondary); }

  .paused-line { margin: 0 0 1rem; font-size: 0.86rem; line-height: 1.5; color: var(--text-muted); border-left: 2px solid var(--accent-ink); padding: 0.4rem 0 0.4rem 0.7rem; }
  .metric { color: var(--text-secondary); }
  .metric b { color: var(--text-primary); }
  .spacer { margin-left: auto; }
  .budget { color: var(--text-ghost); }
  .reason-toggle { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; background: none; border: 1px solid rgba(26, 16, 8, 0.18); color: var(--text-muted); cursor: pointer; padding: 3px 8px; }
  .reason-toggle.on { border-color: var(--accent); color: var(--accent); }

  .err-line { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--error); padding: 8px 10px; background: var(--error-bg); border-left: 2px solid var(--error); margin-bottom: 1rem; }

  .reasoning { border: 1px dashed rgba(26, 16, 8, 0.25); padding: 0.75rem 0.9rem; margin-bottom: 1.25rem; background: var(--surface-elevated, #faf6ee); }
  .reasoning pre { margin: 0.4rem 0 0; white-space: pre-wrap; word-break: break-word; font-family: var(--font-mono); font-size: 0.78rem; line-height: 1.5; color: var(--text-secondary); max-height: 300px; overflow-y: auto; }

  /* .sr-label-tight comes from $lib/styles/nm-tokens.css. */
  .frontier-panel { margin-bottom: 1.5rem; }
  .answer { margin-bottom: 0; }
  .note { color: var(--text-muted); font-style: italic; }

  .activity summary { font-family: var(--font-mono); font-size: var(--fs-label); text-transform: uppercase; letter-spacing: 0.1em; color: var(--accent); cursor: pointer; }
  .activity ul { margin: 0.5rem 0 0; padding-left: 1.2rem; font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-secondary); display: grid; gap: 0.2rem; }
</style>
