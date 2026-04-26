<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import Activity from './Activity.svelte';
  import FilesTimeline from './FilesTimeline.svelte';
  import PlanEditor from './PlanEditor.svelte';
  import IterApproval from './IterApproval.svelte';
  import PreviewPanel from './PreviewPanel.svelte';
  import BuildSidebar from './BuildSidebar.svelte';
  import ModeSwitcher from './ModeSwitcher.svelte';
  import WatchPane from './WatchPane.svelte';
  import { reduceFeed, type FeedEvent } from './feed';
  import { buildFileTimeline } from './parse-actions';

  let { data }: { data: any } = $props();

  let build = $state(data.build);
  const iterations = $derived(data.iterations as any[]);
  let events = $state<FeedEvent[]>(
    (data.logs as Array<{ id: number; type: string; content: string; iterationId: string | null }>).map(
      (l) => ({ kind: 'log', id: l.id, type: l.type, content: l.content, iterationId: l.iterationId }),
    ),
  );
  let mode = $state<'watch' | 'tinker' | 'drive'>('watch');
  let publishing = $state(false);
  let unpublishing = $state(false);
  let acting = $state<string | null>(null);
  let showPreview = $state(false);

  const feed = $derived(reduceFeed(events));
  const fileTimeline = $derived(buildFileTimeline(iterations));
  const iter0 = $derived(iterations.find((i) => i.number === 0));

  let es: EventSource | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectDelay = 3000;
  let closed = false;

  function connect() {
    if (closed) return;
    es?.close();
    es = new EventSource(`/api/jkai/builds/${build.id}/stream`);
    es.onmessage = (e) => {
      try {
        const id = parseInt(e.lastEventId || '0', 10);
        const payload = JSON.parse(e.data);
        if (id > 0) {
          events = [
            ...events,
            { kind: 'log', id, type: payload.type, content: payload.content, iterationId: payload.iterationId },
          ];
        } else {
          events = [
            ...events,
            {
              kind: 'live',
              type: payload.type,
              iterationId: payload.iterationId ?? null,
              streamId: payload.streamId,
              delta: payload.delta,
              full: payload.full,
              toolName: payload.toolName,
            },
          ];
        }
        reconnectDelay = 3000;
      } catch {
        // swallow malformed events
      }
    };
    es.onerror = () => {
      es?.close();
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 60000);
    };
  }

  onMount(() => {
    if (build.status === 'running' || build.status === 'awaiting_plan_approval') {
      connect();
    }
    pollTimer = setInterval(async () => {
      try {
        const r = await fetch(`/api/jkai/builds/${build.id}`);
        if (r.ok) {
          const fresh = await r.json();
          build = { ...build, ...fresh };
        }
      } catch {
        // ignore
      }
    }, 10000);
  });

  onDestroy(() => {
    closed = true;
    es?.close();
    if (pollTimer) clearInterval(pollTimer);
  });

  async function refresh() {
    await invalidateAll();
    const r = await fetch(`/api/jkai/builds/${build.id}`).catch(() => null);
    if (r && r.ok) build = { ...build, ...(await r.json()) };
  }

  async function controlAction(action: 'pause' | 'resume' | 'stop') {
    acting = action;
    try {
      const r = await fetch(`/api/jkai/builds/${build.id}/${action}`, { method: 'POST' });
      if (r.ok) await refresh();
    } finally {
      acting = null;
    }
  }

  async function publishBuild() {
    publishing = true;
    try {
      const r = await fetch(`/api/jkai/builds/${build.id}/publish`, { method: 'POST' });
      if (r.ok) {
        const body = await r.json();
        if (body.slug) build = { ...build, publishedSlug: body.slug };
      } else {
        const err = await r.text().catch(() => r.statusText);
        alert(`Publish failed: ${err.slice(0, 200)}`);
      }
    } finally {
      publishing = false;
    }
  }

  async function unpublishBuild() {
    if (!confirm(`Unpublish "${build.publishedSlug}"? The public URL will go offline.`)) return;
    unpublishing = true;
    try {
      const r = await fetch(`/api/jkai/builds/${build.id}/unpublish`, { method: 'POST' });
      if (r.ok) build = { ...build, publishedSlug: null };
      else alert(`Unpublish failed: ${await r.text().catch(() => r.statusText)}`);
    } finally {
      unpublishing = false;
    }
  }
</script>

<svelte:head>
  <title>{build.title ?? build.prompt.slice(0, 50)} — JKAI build</title>
</svelte:head>

<div class="wrap">
  <header class="page-hdr">
    <div class="hdr-left">
      <a class="row-link" href="/jkai/builds">← all builds</a>
      <div class="kicker">JKAI build · <span class="status-pill" data-status={build.status}>{build.status}</span></div>
      <h1>{build.title ?? build.prompt.slice(0, 60)}</h1>
    </div>
    <div class="hdr-right">
      <ModeSwitcher bind:mode />
    </div>
  </header>

  <div class="actions-row">
    {#if build.status === 'running'}
      <button class="nm-btn-ghost" disabled={acting !== null} onclick={() => controlAction('pause')}>Pause</button>
      <button class="nm-btn-ghost" disabled={acting !== null} onclick={() => controlAction('stop')}>Stop</button>
    {:else if build.status === 'paused'}
      <button class="nm-save-btn" disabled={acting !== null} onclick={() => controlAction('resume')}>Resume</button>
      <button class="nm-btn-ghost" disabled={acting !== null} onclick={() => controlAction('stop')}>Stop</button>
    {/if}
    {#if build.serveConfig}
      <button
        class="nm-btn-ghost"
        class:active={showPreview}
        onclick={() => (showPreview = !showPreview)}
        type="button"
      >
        {showPreview ? 'Hide preview' : 'Preview'}
      </button>
    {/if}
    {#if build.serveConfig && !build.publishedSlug}
      <button class="nm-btn-ghost" disabled={publishing} onclick={publishBuild} type="button">
        {publishing ? 'Publishing…' : 'Publish'}
      </button>
    {/if}
    {#if build.publishedSlug}
      <a class="row-link" href={`/projects/jkai/${build.publishedSlug}/`} target="_blank" rel="noreferrer">↗ Live</a>
      <button class="row-link danger" disabled={unpublishing} onclick={unpublishBuild} type="button">
        {unpublishing ? 'Unpublishing…' : 'Unpublish'}
      </button>
    {/if}
  </div>

  {#if build.status === 'awaiting_plan_approval'}
    <PlanEditor plan={iter0?.plan ?? feed.proposedPlan ?? ''} buildId={build.id} onAfter={refresh} />
  {:else if build.status === 'awaiting_iter_approval'}
    <IterApproval buildId={build.id} onAfter={refresh} />
  {/if}

  {#if showPreview && build.serveConfig}
    <PreviewPanel
      buildId={build.id}
      serveConfig={build.serveConfig}
      publishedSlug={build.publishedSlug}
    />
  {/if}

  <div class="layout">
    <main class="main">
      {#if mode === 'watch' || mode === 'tinker'}
        <Activity feed={feed} />
        <FilesTimeline changes={fileTimeline} />
        <WatchPane buildId={build.id} mode={mode} status={build.status} />
      {:else}
        <section class="nm-sec">
          <p class="dim">{mode} mode coming in Phase 3 — pi RPC drive-mode take-over will land here.</p>
        </section>
      {/if}
    </main>
    <BuildSidebar build={build} onAfter={refresh} />
  </div>
</div>

<style>
  .wrap {
    max-width: 1280px;
    margin: 2rem auto 4rem;
    padding: 0 1.5rem;
    color: var(--text-primary);
    font-family: var(--font-body);
  }
  .page-hdr {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 1.5rem;
    margin-bottom: 1rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid var(--text-primary);
  }
  .hdr-left {
    min-width: 0;
  }
  .kicker {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--accent);
    margin: 0.45rem 0;
  }
  h1 {
    font-family: var(--font-display);
    font-size: 1.7rem;
    font-weight: 900;
    line-height: 1.1;
    margin: 0;
    color: var(--text-primary);
  }
  .status-pill {
    color: var(--text-muted);
  }
  .status-pill[data-status='running'] {
    color: var(--accent);
  }
  .status-pill[data-status='completed'] {
    color: var(--status-success);
  }
  .status-pill[data-status='failed'] {
    color: var(--status-error);
  }
  .status-pill[data-status='awaiting_plan_approval'] {
    color: var(--accent);
  }
  .actions-row {
    display: flex;
    gap: 0.6rem;
    margin: 0 0 1rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .actions-row :global(.nm-btn-ghost.active) {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }
  .layout {
    display: grid;
    grid-template-columns: 1fr 280px;
    gap: 1.25rem;
    align-items: start;
  }
  .main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .dim {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    margin: 0;
  }
  @media (max-width: 900px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
</style>
