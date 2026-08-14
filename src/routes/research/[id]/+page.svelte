<script lang="ts">
  import { onMount } from 'svelte';
  import type { PageData } from './$types';
  import FrontierGraph, { type FrontierLead } from '$lib/components/research/FrontierGraph.svelte';
  import ReportPanels, { type ReportView } from '$lib/components/research/ReportPanels.svelte';
  import ActionsRow from '$lib/components/research/ActionsRow.svelte';
  import { goto } from '$app/navigation';

  let { data }: { data: PageData } = $props();

  type Src = (typeof data.sources)[number];

  let status = $state(data.session.status);
  let summary = $state(data.session.summary);
  let durationMs = $state<number | null>(data.session.durationMs);
  let errorMessage = $state<string | null>(data.session.errorMessage);
  let sources = $state<Src[]>(data.sources);
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

  function fmtMs(ms: number | null): string {
    if (ms == null) return '—';
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  onMount(() => {
    const startedAt = Date.now();
    if (!finished) {
      elapsedTimer = setInterval(() => {
        elapsedMs = Date.now() - startedAt;
      }, 500);
    }

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
          if (Array.isArray(msg.data?.sources)) sources = msg.data.sources as Src[];
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

    return () => {
      es?.close();
      es = null;
      stopClock();
    };
  });

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
      <div class="kicker">JKAI · Research · {data.tier.label}</div>
      <h1>{data.session.topic}</h1>
      <p class="scope-line">{data.session.scopeLabel}</p>
    </div>
    <a class="back-link" href="/research">← All research</a>
  </header>

  <section class="statusbar">
    <span class="pill" class:done={status === 'complete'} class:failed={status === 'failed'}>{status}</span>
    <span class="metric"><b>{stats.sourcesFound || sources.length}</b> sources</span>
    {#if data.tier.extractsFacts}
      <span class="metric"><b>{stats.factsExtracted}</b> facts</span>
      <span class="metric"><b>{stats.entitiesIdentified}</b> entities</span>
    {/if}
    <span class="metric spacer">
      {#if finished}{fmtMs(durationMs)}{:else}{fmtMs(elapsedMs)} elapsed{/if}
      {#if data.tier.budgetMs && !finished}<span class="budget"> / {fmtMs(data.tier.budgetMs)} budget</span>{/if}
    </span>
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

  {#if leads.length}
    <section class="frontier-panel">
      <FrontierGraph {leads} />
    </section>
  {/if}

  <section class="answer">
    {#if summary}
      <div class="prose">{summary}</div>
    {:else if status === 'failed'}
      <p class="note">No answer was produced.</p>
    {:else}
      <p class="note">Working…</p>
    {/if}
  </section>

  {#if finished && summary}
    <ReportPanels
      report={data.report as ReportView}
      goals={data.session.goals}
      topEntities={data.topEntities}
      onInvestigate={investigate}
    />
    <ActionsRow
      sessionId={data.session.id}
      depth={data.session.depth}
      hasReport={!!summary}
      shareToken={data.session.shareToken}
    />
  {/if}

  {#if sources.length}
    <section class="sources">
      <div class="sr-label-tight">Sources</div>
      <ol>
        {#each sources as s, i (s.id ?? s.url)}
          <li>
            <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title || s.url}</a>
            <span class="src-meta">{s.domain}{#if s.credibilityType} · {s.credibilityType}{/if}</span>
          </li>
        {/each}
      </ol>
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
</div>

<style>
  .wrap { max-width: 860px; margin: 2rem auto 4rem; padding: 0 1.5rem; color: var(--text-primary); font-family: var(--font-body); }
  .page-hdr { display: flex; justify-content: space-between; align-items: flex-end; gap: 1.5rem; margin-bottom: 1.25rem; padding-bottom: 1rem; border-bottom: 2px solid var(--text-primary); }
  .kicker { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.18em; color: var(--accent); margin-bottom: 0.35rem; }
  .page-hdr h1 { margin: 0; font-family: var(--font-display); font-size: 1.8rem; font-weight: 900; line-height: 1.1; }
  .scope-line { margin: 0.5rem 0 0; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }
  .back-link { font-family: var(--font-mono); font-size: var(--fs-label); text-transform: uppercase; letter-spacing: 0.12em; color: var(--accent); text-decoration: none; flex-shrink: 0; }

  .statusbar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; margin-bottom: 1.25rem; font-family: var(--font-mono); font-size: var(--fs-label); }
  .pill { text-transform: uppercase; letter-spacing: 0.12em; padding: 2px 8px; border: 1px solid var(--accent); color: var(--accent); font-size: var(--fs-label-xs); }
  .pill.done { border-color: var(--success); color: var(--success); }
  .pill.failed { border-color: var(--error); color: var(--error); }
  .metric { color: var(--text-secondary); }
  .metric b { color: var(--text-primary); }
  .spacer { margin-left: auto; }
  .budget { color: var(--text-ghost); }
  .reason-toggle { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; background: none; border: 1px solid rgba(26, 16, 8, 0.18); color: var(--text-muted); cursor: pointer; padding: 3px 8px; }
  .reason-toggle.on { border-color: var(--accent); color: var(--accent); }

  .err-line { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--error); padding: 8px 10px; background: var(--error-bg); border-left: 2px solid var(--error); margin-bottom: 1rem; }

  .reasoning { border: 1px dashed rgba(26, 16, 8, 0.25); padding: 0.75rem 0.9rem; margin-bottom: 1.25rem; background: var(--surface-elevated, #faf6ee); }
  .reasoning pre { margin: 0.4rem 0 0; white-space: pre-wrap; word-break: break-word; font-family: var(--font-mono); font-size: 0.78rem; line-height: 1.5; color: var(--text-secondary); max-height: 300px; overflow-y: auto; }

  .sr-label-tight { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.16em; color: var(--text-muted); }
  .frontier-panel { margin-bottom: 1.5rem; }
  .answer { margin-bottom: 1.75rem; }
  .prose { white-space: pre-wrap; line-height: 1.65; font-size: 1rem; }
  .note { color: var(--text-muted); font-style: italic; }

  .sources { margin-bottom: 1.5rem; }
  .sources ol { margin: 0.5rem 0 0; padding-left: 1.4rem; display: grid; gap: 0.4rem; }
  .sources a { color: var(--text-primary); }
  .src-meta { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  .activity summary { font-family: var(--font-mono); font-size: var(--fs-label); text-transform: uppercase; letter-spacing: 0.1em; color: var(--accent); cursor: pointer; }
  .activity ul { margin: 0.5rem 0 0; padding-left: 1.2rem; font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-secondary); display: grid; gap: 0.2rem; }
</style>
