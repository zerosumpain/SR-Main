<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { bucketLabel, bucketOf, outcomeNote } from './build-status';
  import { publishedLink } from './published-link';
  import PromoteModal from './PromoteModal.svelte';
  import { invalidateAll } from '$app/navigation';
  import Activity from './Activity.svelte';
  import FilesTimeline from './FilesTimeline.svelte';
  import PlanEditor from './PlanEditor.svelte';
  import IterApproval from './IterApproval.svelte';
  import FailureRecovery from './FailureRecovery.svelte';
  import PreviewPanel from './PreviewPanel.svelte';
  import BuildSidebar from './BuildSidebar.svelte';
  import ModeSwitcher from './ModeSwitcher.svelte';
  import BuildSessionPanel from './BuildSessionPanel.svelte';
  import WatchPane from './WatchPane.svelte';
  import { reduceFeed, type FeedEvent } from './feed';
  import { buildFileTimeline } from './parse-actions';
  import BuildCockpit from './BuildCockpit.svelte';
  import IterationInspector from './IterationInspector.svelte';
  import { buildCockpitMetrics } from './cockpit-metrics';

  let { data }: { data: any } = $props();

  let build = $state(data.build);
  let iterations = $state<any[]>(data.iterations as any[]);
  // The instrument panel reads from the same live state as the rest of the
  // view, so it tracks the SSE refresh without any effect of its own.
  const cockpitMetrics = $derived(
    build ? buildCockpitMetrics(build, iterations ?? [], (data.logs ?? []) as any[]) : null,
  );

  let events = $state<FeedEvent[]>(
    (data.logs as Array<{ id: number; type: string; content: string; iterationId: string | null }>).map(
      (l) => ({ kind: 'log', id: l.id, type: l.type, content: l.content, iterationId: l.iterationId }),
    ),
  );

  // When the SvelteKit page-data store updates (after invalidateAll() refresh),
  // sync the local $state copies so derived values pick up the new plan/iters.
  //
  // Track ONLY data.build / data.iterations — the props that signal a
  // page-data refresh. All reads + writes of local `build`/`iterations`
  // happen inside untrack so this effect doesn't subscribe to its own
  // outputs. Earlier version still read build.id in the if-condition,
  // which trapped Svelte 5 in a proxy-churn loop and tripped
  // effect_update_depth_exceeded when downstream consumers (BuildSessionPanel)
  // also read `build`.
  $effect(() => {
    const sourceBuild = data.build;
    const sourceIters = data.iterations;
    untrack(() => {
      if (sourceBuild && sourceBuild.id === build.id) {
        build = { ...build, ...sourceBuild };
        if (Array.isArray(sourceIters)) iterations = sourceIters;
      }
    });
  });
  let mode = $state<'watch' | 'tinker' | 'drive'>('watch');
  let publishing = $state(false);
  let unpublishing = $state(false);
  let acting = $state<string | null>(null);
  let showPreview = $state(false);

  // Elapsed-time ticker — visible in the page kicker so the user knows
  // how long the build has been running. Anchors on createdAt; stops
  // ticking on terminal statuses but keeps showing the final duration.
  let nowMs = $state(Date.now());
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;
  const isTerminalStatus = $derived(
    build.status === 'completed' || build.status === 'failed' || build.status === 'paused',
  );
  const detailBucket = $derived(
    bucketOf({
      status: build.status,
      planStatus: (build as { planStatus?: string | null }).planStatus ?? null,
      outcome: (build as { outcome?: string | null }).outcome ?? null,
    }),
  );
  const startMs = $derived(
    build.startedAt ? new Date(build.startedAt).getTime() : new Date(build.createdAt).getTime(),
  );
  const endMs = $derived(
    build.completedAt ? new Date(build.completedAt).getTime() : null,
  );
  const elapsedMs = $derived(
    isTerminalStatus
      ? Math.max(0, (endMs ?? nowMs) - startMs)
      : Math.max(0, nowMs - startMs),
  );
  function formatElapsed(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    if (m < 60) return `${m}m ${r}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  // Live preview URL observed from the SSE stage stream — arrives as soon as
  // the orchestrator emits it, ~10s before the next page-data poll catches up.
  // Used to populate the App URL banner the moment a preview goes live.
  let livePreviewUrl = $state<string | null>(null);
  // Always-prominent banner is shown when we have any signal the app is up:
  // the persisted serveConfig (page load / 10s poll) OR a live stage event.
  const published = $derived(publishedLink(build.publishedSlug));
  // A change request's page lives in the repo, so its address never reaches
  // `publishedSlug` — that column holds the PR. Offer the card control when
  // the build published off-site (a PR) or already has a card to edit.
  const canCard = $derived(!!build.projectSlug || published?.external === true);
  const cardLink = $derived(build.projectSlug ? `/projects/${build.projectSlug}/` : null);
  let carding = $state(false);

  function afterCard(result: { slug: string; url: string }) {
    build = { ...build, projectSlug: result.slug };
    carding = false;
  }
  const previewLink = $derived(
    published
      ? published.href
      : (build.serveConfig || livePreviewUrl)
        ? `/api/jkai/proxy/${build.id}/`
        : null,
  );
  const previewBuilding = $derived(
    !previewLink && (build.status === 'running' || build.status === 'awaiting_plan_approval' || build.status === 'awaiting_iter_approval'),
  );

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
        // Stage events carry the preview URL the moment the orchestrator's
        // checkServeConfig emits it. Surface immediately rather than waiting
        // for the 10s page-data poll to catch up.
        if (payload.type === 'stage' && typeof payload.content === 'string') {
          try {
            const stage = JSON.parse(payload.content) as { previewUrl?: string | null };
            if (typeof stage.previewUrl === 'string' && stage.previewUrl.length > 0) {
              livePreviewUrl = stage.previewUrl;
            } else if (stage.previewUrl === null) {
              livePreviewUrl = null;
            }
          } catch { /* malformed stage payload — ignore */ }
        }
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
    // Tick the elapsed clock once a second while the build is non-terminal.
    elapsedTimer = setInterval(() => { nowMs = Date.now(); }, 1000);
    pollTimer = setInterval(async () => {
      try {
        const r = await fetch(`/api/jkai/builds/${build.id}`);
        if (!r.ok) return;
        const fresh = await r.json();
        const prevStatus = build.status;
        // The endpoint returns { ...build, iterations } — split them so the
        // build $state and iterations $state both stay current. Without this,
        // iter 0's saved plan never reaches the PlanEditor on the second
        // poll after planning completes.
        const { iterations: freshIters, ...freshBuild } = fresh ?? {};
        build = { ...build, ...freshBuild };
        if (Array.isArray(freshIters)) iterations = freshIters;

        // When status changes (e.g. running → awaiting_plan_approval), pull
        // a full server-side reload so logs and any parked-state UI lights
        // up immediately.
        if (prevStatus !== build.status) {
          await invalidateAll();
        }
      } catch {
        // ignore — next tick will retry
      }
    }, 10000);
  });

  onDestroy(() => {
    closed = true;
    es?.close();
    if (pollTimer) clearInterval(pollTimer);
    if (elapsedTimer) clearInterval(elapsedTimer);
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
  <!-- Top preview banner: appears the moment the orchestrator emits a
       previewUrl (via SSE stage event) or has persisted a serveConfig.
       Sticky so it stays visible while the user scrolls iteration logs. -->
  {#if previewLink || previewBuilding}
    <section class="preview-banner" class:building={previewBuilding} class:ready={!!previewLink}>
      <span class="preview-dot" aria-hidden="true"></span>
      {#if previewLink}
        <span class="preview-label">Preview is live</span>
        <a class="preview-cta" href={previewLink} target="_blank" rel="noreferrer">↗ Open app</a>
        <code class="preview-url">{`https://strangeramblings.com${previewLink}`}</code>
        <button
          type="button"
          class="row-link"
          onclick={() => navigator.clipboard?.writeText(`https://strangeramblings.com${previewLink}`)}
          title="Copy app URL"
        >copy</button>
      {:else}
        <span class="preview-label">Preview: preparing… the link will appear here as soon as the build's preview server is reachable.</span>
      {/if}
    </section>
  {/if}

  <header class="page-hdr">
    <div class="hdr-left">
      <a class="row-link" href="/jkai/builds">← all builds</a>
      <div class="kicker">
        JKAI build ·
        <!-- The bucket, not the raw status: `completed` is claimed by a
             delivery, a budget cap-out, a hand-kill and a chat
             registration, and this pill painted all four the same green. -->
        <span class="status-pill" data-status={detailBucket} title={outcomeNote(detailBucket) ?? ''}
          >{bucketLabel(detailBucket)}</span
        >
        ·
        <span class="elapsed" class:running={!isTerminalStatus} title="Elapsed since the build started">
          {formatElapsed(elapsedMs)}{!isTerminalStatus ? '' : ' (final)'}
        </span>
      </div>
      <h1>{build.title ?? build.prompt.slice(0, 60)}</h1>
    </div>
    <div class="hdr-right">
      <ModeSwitcher bind:mode />
    </div>
  </header>

  <!-- Instrument panel. Derived, not stored: `build`/`iterations`/`logs` are
       swapped wholesale by the page's cache+network refresh, and a $derived
       recomputes with them. -->
  {#if cockpitMetrics}
    <BuildCockpit metrics={cockpitMetrics} />
  {/if}

  <IterationInspector iterations={iterations ?? []} buildPrompt={build?.prompt ?? null} />

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
      <a
        class="nm-btn-ghost"
        href={`/api/jkai/proxy/${build.id}/`}
        target="_blank"
        rel="noreferrer"
      >↗ Open app</a>
    {/if}
    {#if build.serveConfig && !build.publishedSlug}
      <button class="nm-btn-ghost" disabled={publishing} onclick={publishBuild} type="button">
        {publishing ? 'Publishing…' : 'Publish'}
      </button>
    {/if}
    {#if published}
      <a class="row-link" href={published.href} target="_blank" rel="noreferrer">↗ {published.label}</a>
      <!-- A PR lives on GitHub; there is nothing on this site to take down. -->
      {#if !published.external}
        <button class="row-link danger" disabled={unpublishing} onclick={unpublishBuild} type="button">
          {unpublishing ? 'Unpublishing…' : 'Unpublish'}
        </button>
      {/if}
    {:else if build.publishedSlug}
      <span class="dim">{build.publishedSlug}</span>
    {/if}
    {#if canCard}
      {#if cardLink}
        <a class="row-link" href={cardLink} target="_blank" rel="noreferrer">↗ Project page</a>
      {/if}
      <button class="nm-btn-ghost" onclick={() => (carding = true)} type="button">
        {build.projectSlug ? 'Edit card' : 'Add to /projects'}
      </button>
    {/if}
  </div>

  <!-- Duplicate App URL section removed — the sticky preview banner above
       (preview-banner) already shows the URL with copy + open buttons. -->

  {#if build.status === 'failed'}
    <FailureRecovery
      buildId={build.id}
      failureKind={build.failure?.kind ?? null}
      origin={build.origin}
      onAfter={refresh}
    />
  {/if}

  <!-- Session panel — bidirectional WebSocket UI: type to inject a message
       into the agent's next turn, prefix with `# ` to pin a directive,
       prefix with `$ ` to run a shell command in the workdir, Ctrl+C to
       interrupt the in-flight pi process. -->
  <BuildSessionPanel buildId={build.id} />
  {#if build.status === 'running' && build.planStatus === 'pending'}
    <section class="nm-sec planning-banner">
      <header class="nm-sec-hd"><span class="sr-label-tight">Planning…</span></header>
      <p class="dim">The proposer/critic debate is running. The first draft normally lands in 30-60s and revisions in another 30-60s. The plan editor will open as soon as the planner finishes — you'll be asked to approve, re-plan, or skip before any code is written.</p>
    </section>
  {/if}
  {#if build.planStatus === 'pending' && build.status !== 'running' && build.status !== 'failed'}
    <PlanEditor plan={feed.proposedPlan ?? iter0?.plan ?? ''} buildId={build.id} onAfter={refresh} />
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

{#if carding}
  <PromoteModal build={build} kind="repo" onClose={() => (carding = false)} ondone={afterCard} />
{/if}

<style>
  .wrap {
    max-width: 1280px;
    margin: 2rem auto 4rem;
    padding: 0 1.5rem;
    color: var(--text-primary);
    font-family: var(--font-body);
  }
  .preview-banner {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
    padding: 0.6rem 0.9rem;
    margin-bottom: 1rem;
    border: 2px solid var(--text-primary);
    background: var(--bg);
    font-family: var(--font-body);
  }
  .preview-banner.ready {
    background: var(--accent-soft, var(--bg));
  }
  .preview-banner.building {
    border-style: dashed;
    color: var(--text-muted);
  }
  .preview-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-muted);
    flex: 0 0 auto;
  }
  .preview-banner.ready .preview-dot {
    background: var(--success);
  }
  .preview-banner.building .preview-dot {
    background: var(--accent);
    animation: preview-pulse 1.4s ease-in-out infinite;
  }
  @keyframes preview-pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }
  .preview-label {
    font-weight: 600;
    font-size: 0.9rem;
  }
  .preview-cta {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--text-primary);
    background: var(--text-primary);
    color: var(--bg);
    text-decoration: none;
  }
  .preview-cta:hover {
    background: var(--bg);
    color: var(--text-primary);
  }
  .preview-url {
    font-family: var(--font-code);
    font-size: 0.78rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
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
    font-size: var(--fs-label-xs);
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
  .status-pill[data-status='delivered'] {
    color: var(--status-success);
  }
  .status-pill[data-status='capped'],
  .status-pill[data-status='stopped'],
  .status-pill[data-status='registered'] {
    color: var(--text-muted);
  }
  .status-pill[data-status='unknown'] {
    color: var(--status-error);
  }
  .status-pill[data-status='failed'] {
    color: var(--status-error);
  }
  .status-pill[data-status='awaiting'] {
    color: var(--accent);
  }
  .elapsed {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .elapsed.running {
    color: var(--text-primary);
  }
  .elapsed.running::before {
    content: '⏱ ';
    color: var(--accent);
    animation: elapsed-pulse 1.4s ease-in-out infinite;
  }
  @keyframes elapsed-pulse {
    0%, 100% { opacity: 0.55; }
    50% { opacity: 1; }
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
  .planning-banner {
    border-left: 3px solid var(--accent);
  }
  .app-url {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    flex-wrap: wrap;
    margin: 0 0 1rem;
    padding: 0.55rem 0.75rem;
    background: var(--bg-secondary, var(--bg));
    border: 1px solid var(--card-border);
    border-left: 3px solid var(--accent);
  }
  .app-url-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--accent);
  }
  .app-url-value {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
    word-break: break-all;
    flex: 1 1 auto;
    min-width: 0;
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
    font-size: var(--fs-label);
    margin: 0;
  }
  @media (max-width: 900px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
</style>
