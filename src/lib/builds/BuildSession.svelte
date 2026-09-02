<script lang="ts">
  /**
   * The build screen — one screen, five panes, no page scroll.
   *
   * Layout contract, and the reason for it: `src/routes/jkai/+layout.svelte`
   * already owns the viewport (`.jkai-root { height: 100dvh; overflow: hidden }`
   * with `.jkai-body` as the single scroll region). This component is a flex
   * child of `.jkai-body`, so it takes `flex: 1; min-height: 0` and hides its
   * own overflow. It must NEVER set a viewport-relative height: the previous
   * version used `height: calc(100vh - 1rem)`, which is the whole viewport and
   * ignores the header above and the tab bar below, making the shell ~130px too
   * tall before any content existed. Stacking the cockpit and the iteration
   * inspector on top of the stream then pushed it several viewports long, which
   * is what made the page scroll and — as the scrollbar appeared and vanished
   * with each new iteration — what made the content width jump.
   *
   * So: exactly one scrolling element at a time, always the pane; everything
   * else `flex-shrink: 0`. The width is then a function of the container alone
   * and cannot move as the build progresses.
   *
   * The panes are the components that used to be stacked, unchanged in
   * behaviour, plus Controls (live settings) and Blueprint (the machinery).
   */
  import { onMount, onDestroy } from 'svelte';
  import { publishedLink } from './published-link';
  import { invalidateAll } from '$app/navigation';
  import BuildSessionPanel from './BuildSessionPanel.svelte';
  import StreamLine from './StreamLine.svelte';
  import IterationHeader from './IterationHeader.svelte';
  import BuildCockpit from './BuildCockpit.svelte';
  import IterationInspector from './IterationInspector.svelte';
  import BuildControls from './BuildControls.svelte';
  import BuildBlueprint from './BuildBlueprint.svelte';
  import RepoVerificationPanel from './RepoVerificationPanel.svelte';
  import IterApproval from './IterApproval.svelte';
  import { buildCockpitMetrics } from './cockpit-metrics';
  import type { ChapterPlanEntry } from './settings';
  import type { JkaiBuild, JkaiIteration } from '$lib/db/schema';
  import { bucketLabel, bucketOf, outcomeNote } from './build-status';
  import type { RepoVerificationPhase } from '$lib/verification/repo';

  interface PageData {
    build: JkaiBuild;
    iterations: JkaiIteration[];
    logs: Array<{ id: number; type: string; content: string; iterationId: string | null }>;
  }
  let { data }: { data: PageData } = $props();

  let build = $state<JkaiBuild>(data.build);
  /**
   * Iterations are local state, refreshed by the poll — NOT read straight from
   * `data`. The page component seeds its `view` object once in onMount and
   * never reassigns it from the `data` prop, so `invalidateAll()` cannot move
   * `data.iterations`. Reading it directly froze the iteration count and the
   * whole Iterations pane at their mount-time values for the life of the page.
   * V2 already split the poll response this way; V3 was discarding the half it
   * needed.
   */
  let iterations = $state<JkaiIteration[]>(data.iterations ?? []);
  let lines = $state<Array<{
    id: number;
    type: string;
    content: string;
    iterationId: string | null;
    streaming?: boolean;
  }>>(data.logs.map((l) => ({ ...l })));
  const liveBuffers = $state<Record<string, { type: string; content: string; iterationId: string | null }>>({});

  const cockpitMetrics = $derived(
    build ? buildCockpitMetrics(build as never, iterations, lines) : null,
  );

  let livePreviewUrl = $state<string | null>(null);
  const published = $derived(publishedLink(build.publishedSlug));
  const previewLink = $derived(
    published?.href
      ?? ((build.serveConfig || livePreviewUrl) ? `/api/jkai/proxy/${build.id}/` : null),
  );
  const previewIsPr = $derived(published?.external === true && !!build.gitTargetConfig);

  // Elapsed timer.
  let nowMs = $state(Date.now());
  const isTerminal = $derived(['completed', 'failed', 'paused'].includes(build.status));
  const startMs = $derived(new Date(build.createdAt).getTime());
  const endMs = $derived(isTerminal ? new Date(build.updatedAt).getTime() : null);
  const elapsedMs = $derived(isTerminal ? Math.max(0, (endMs ?? nowMs) - startMs) : Math.max(0, nowMs - startMs));
  function fmt(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }
  const iterationCount = $derived(iterations.filter((i) => i.number > 0).length);
  const buildBucket = $derived(bucketOf({
    status: build.status,
    planStatus: build.planStatus,
    outcome: build.outcome,
  }));

  // --- Panes -----------------------------------------------------------
  type Tab = 'stream' | 'verification' | 'iterations' | 'instruments' | 'controls' | 'blueprint';
  const TABS: Array<{ key: Tab; label: string }> = [
    { key: 'stream', label: 'Stream' },
    { key: 'verification', label: 'Verification' },
    { key: 'iterations', label: 'Iterations' },
    { key: 'instruments', label: 'Instruments' },
    { key: 'controls', label: 'Controls' },
    { key: 'blueprint', label: 'Blueprint' },
  ];
  let tab = $state<Tab>('stream');

  /** Attention marks on the tab strip, so a pane you are not looking at can still shout. */
  const controlsAlert = $derived(
    build.origin === 'studio' && (build.chapterPlan ?? []).length === 0,
  );
  const instrumentsAlert = $derived(
    (cockpitMetrics?.signals ?? []).some((s) => s.level === 'critical'),
  );

  // Build config (prompt, guardrails, gate, sidecar health, toolset catalogue).
  // Fetched lazily: it probes a Unix socket, so there is no reason to pay for it
  // until a pane that shows it is opened.
  interface BuildConfig {
    mode: 'app' | 'repo' | 'studio';
    port: number;
    systemPrompt: string;
    toolsets: Array<{ toolset: string; description: string; toolCount: number }>;
    lint: { enabled: boolean; svelteOnly: boolean; rules: Array<{ rule: string; summary: string; detail: string }>; exemptMounts: string[] };
    gate: { applies: boolean; chapterCount: number; hasPort: boolean; checks: Array<{ rule: string; scope: string; summary: string }> };
    verification: {
      applies: boolean;
      steps: Array<{
        phase: RepoVerificationPhase;
        label: string;
        command: string | null;
        owner: 'builder' | 'github' | 'production';
      }>;
    };
    sidecar: { name: string; socket: string; up: boolean; detail: string };
  }
  let config = $state<BuildConfig | null>(null);
  let configLoading = $state(false);
  let configError = $state<string | null>(null);
  // Plain let: an in-flight marker read and written by loadConfig itself. As
  // $state it would make any effect that calls loadConfig subscribe to its own
  // write.
  let configRequested = false;

  async function loadConfig(force = false): Promise<void> {
    if (configRequested && !force) return;
    configRequested = true;
    configLoading = true;
    configError = null;
    try {
      const r = await fetch(`/api/jkai/builds/${build.id}/config`);
      if (!r.ok) {
        configError = `Could not read the build's configuration (HTTP ${r.status}).`;
        // Let the next visit retry. The route probes a Unix socket with a 1.5s
        // timeout, so a slow sidecar is an ordinary transient failure — latching
        // it would strand the pane on a stale error until a full page reload.
        configRequested = false;
        return;
      }
      config = (await r.json()) as BuildConfig;
    } catch (e) {
      configError = e instanceof Error ? e.message : String(e);
      configRequested = false;
    } finally {
      configLoading = false;
    }
  }

  function selectTab(next: Tab): void {
    tab = next;
    if (next === 'verification' || next === 'controls' || next === 'blueprint') void loadConfig();
    if (next === 'stream') {
      // Re-arm the follow. Leaving the tab unmounts the scroller, so `onScroll`
      // cannot run and `stickToBottom` keeps whatever it held when the user last
      // scrolled up. Coming back re-renders at scrollTop 0, and a stale `false`
      // would leave them parked at the top of the log while a running build
      // appended invisibly below.
      stickToBottom = true;
      requestAnimationFrame(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
    }
    try {
      sessionStorage.setItem(`jkai:buildtab:${build.id}`, next);
    } catch {
      /* private mode — the tab just will not persist */
    }
  }

  // --- Stream ----------------------------------------------------------
  // EventSource, timers and lifecycle flags are plain `let`, never $state:
  // they are internal handles, and a $state handle that a function both reads
  // and writes will make any effect calling that function loop.
  let es: EventSource | null = null;
  let closed = false;
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let scroller: HTMLDivElement | undefined = $state();
  let stickToBottom = $state(true);

  function connect(): void {
    if (closed) return;
    es?.close();
    es = new EventSource(`/api/jkai/builds/${build.id}/stream`);
    es.onmessage = (e) => {
      try {
        const id = parseInt(e.lastEventId || '0', 10);
        const payload = JSON.parse(e.data);
        if (payload.type === 'stage' && typeof payload.content === 'string') {
          try {
            const stage = JSON.parse(payload.content);
            if (typeof stage.previewUrl === 'string' && stage.previewUrl.length > 0) livePreviewUrl = stage.previewUrl;
            else if (stage.previewUrl === null) livePreviewUrl = null;
          } catch { /* ignore */ }
          return;
        }
        if (id > 0) {
          lines = [...lines, {
            id,
            type: payload.type,
            content: payload.content,
            iterationId: payload.iterationId ?? null,
          }];
          if (payload.iterationId && (payload.type === 'text' || payload.type === 'thinking')) {
            for (const k of Object.keys(liveBuffers)) {
              if (k.startsWith(`${payload.iterationId}:`) && liveBuffers[k].type === payload.type) {
                delete liveBuffers[k];
              }
            }
          }
        } else {
          handleLive(payload);
        }
        if (stickToBottom && tab === 'stream') {
          requestAnimationFrame(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
        }
      } catch { /* swallow */ }
    };
    es.onerror = () => { /* auto-reconnect */ };
  }

  function handleLive(ev: { type?: string; iterationId?: string | null; streamId?: string; delta?: string; full?: string; toolName?: string }): void {
    if (!ev.streamId) return;
    const k = ev.streamId;
    if (ev.type === 'stream_thinking' && ev.delta) {
      liveBuffers[k] = liveBuffers[k] ?? { type: 'thinking', content: '', iterationId: ev.iterationId ?? null };
      liveBuffers[k].content += ev.delta;
    } else if (ev.type === 'stream_text' && ev.delta) {
      liveBuffers[k] = liveBuffers[k] ?? { type: 'text', content: '', iterationId: ev.iterationId ?? null };
      liveBuffers[k].content += ev.delta;
    } else if (ev.type === 'stream_tool_start') {
      liveBuffers[k] = { type: 'tool', content: `${ev.toolName ?? 'tool'} `, iterationId: ev.iterationId ?? null };
    } else if (ev.type === 'stream_tool_delta' && ev.delta) {
      liveBuffers[k] = liveBuffers[k] ?? { type: 'tool', content: '', iterationId: ev.iterationId ?? null };
      liveBuffers[k].content += ev.delta;
    } else if (ev.type === 'stream_turn_end' || ev.type === 'stream_tool_end') {
      if (typeof ev.full === 'string' && liveBuffers[k]) liveBuffers[k].content = ev.full;
    }
  }

  const rendered = $derived.by(() => {
    const out: Array<{
      key: string;
      id: number | null;
      type: string;
      content: string;
      iterationId: string | null;
      streaming: boolean;
    }> = [];
    for (const l of lines) {
      out.push({ key: `p:${l.id}`, id: l.id, type: l.type, content: l.content, iterationId: l.iterationId, streaming: false });
    }
    for (const [k, b] of Object.entries(liveBuffers)) {
      out.push({ key: `l:${k}`, id: null, type: b.type, content: b.content, iterationId: b.iterationId, streaming: true });
    }
    return out;
  });

  type Group = {
    iterationId: string | null;
    iter: JkaiIteration | null;
    firstId: number;
    events: typeof rendered;
  };
  const groups = $derived.by(() => {
    const map = new Map<string, Group>();
    for (let i = 0; i < rendered.length; i++) {
      const ev = rendered[i];
      const key = ev.iterationId ?? '__orphan__';
      let g = map.get(key);
      if (!g) {
        const iter = ev.iterationId
          ? iterations.find((x) => x.id === ev.iterationId) ?? null
          : null;
        g = {
          iterationId: ev.iterationId,
          iter,
          firstId: ev.id ?? Number.MAX_SAFE_INTEGER - i,
          events: [],
        };
        map.set(key, g);
      }
      g.events.push(ev);
    }
    return Array.from(map.values()).sort((a, b) => a.firstId - b.firstId);
  });

  const expandedByIter = $state<Record<string, boolean>>({});
  function isExpanded(g: Group): boolean {
    const k = g.iterationId ?? '__orphan__';
    if (k in expandedByIter) return expandedByIter[k];
    if (g.iterationId === null) return true;
    const lastIter = [...groups].reverse().find((x) => x.iterationId !== null);
    return lastIter?.iterationId === g.iterationId;
  }
  function toggleGroup(g: Group): void {
    const k = g.iterationId ?? '__orphan__';
    expandedByIter[k] = !isExpanded(g);
  }

  let focusedIter = $state<string | 'all'>('all');
  const visibleGroups = $derived(
    focusedIter === 'all'
      ? groups
      : groups.filter((g) => (g.iterationId ?? '__orphan__') === focusedIter),
  );
  const focusChips = $derived.by(() => {
    const chips: Array<{ key: string; label: string; status: string; iterationId: string | null }> = [
      { key: 'all', label: 'All', status: '', iterationId: null },
    ];
    for (const g of groups) {
      if (g.iterationId === null) {
        chips.push({ key: '__orphan__', label: 'Setup', status: '', iterationId: null });
      } else if (g.iter) {
        const label = g.iter.number === 0 ? 'Plan' : `Iter ${g.iter.number}`;
        chips.push({ key: g.iterationId, label, status: g.iter.status, iterationId: g.iterationId });
      }
    }
    return chips;
  });
  function focusOn(key: string): void {
    focusedIter = key as typeof focusedIter;
    if (key !== 'all' && expandedByIter[key] === false) expandedByIter[key] = true;
    requestAnimationFrame(() => scroller?.scrollTo({ top: 0 }));
  }

  function onScroll(): void {
    if (!scroller) return;
    const slack = 80;
    stickToBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < slack;
  }

  async function refresh(): Promise<void> {
    await invalidateAll();
  }

  /** Controls patch a column; re-read the row so the panel shows what landed. */
  async function afterPatch(): Promise<void> {
    try {
      const r = await fetch(`/api/jkai/builds/${build.id}`);
      if (!r.ok) return;
      const fresh = await r.json();
      const { iterations: freshIters, ...freshBuild } = fresh ?? {};
      build = { ...build, ...freshBuild };
      if (Array.isArray(freshIters)) iterations = freshIters;
    } catch {
      /* the 10s poll will catch up */
    }
    void loadConfig(true);
  }

  let acting = $state<string | null>(null);
  async function controlAction(action: 'pause' | 'resume' | 'stop' | 'restart'): Promise<void> {
    acting = action;
    try {
      await fetch(`/api/jkai/builds/${build.id}/${action}`, { method: 'POST' });
      await refresh();
    } finally { acting = null; }
  }

  // The composer costs ~130px. On a phone that is a fifth of the screen, so it
  // starts collapsed there and stays expanded on desktop. Read once, not
  // reactively: this is an initial preference, not a live binding.
  let composerOpen = $state(true);

  /** Parent-owned so a tab switch cannot discard half-typed chapters. */
  let spine = $state<{ draft: ChapterPlanEntry[]; key: string } | null>(null);

  onMount(() => {
    try {
      const saved = sessionStorage.getItem(`jkai:buildtab:${build.id}`) as Tab | null;
      if (saved && TABS.some((t) => t.key === saved)) {
        tab = saved;
        if (saved === 'verification' || saved === 'controls' || saved === 'blueprint') void loadConfig();
      }
    } catch {
      /* private mode */
    }
    composerOpen = !window.matchMedia('(max-width: 700px)').matches;

    // `awaiting_iter_approval` is in the list because the Controls pane can now
    // turn that gate on. Parking a build with no live stream and no way to see
    // why it stopped would make the toggle a trap.
    if (
      build.status === 'running' ||
      build.status === 'awaiting_plan_approval' ||
      build.status === 'awaiting_iter_approval'
    ) {
      connect();
    }
    elapsedTimer = setInterval(() => { nowMs = Date.now(); }, 1000);
    pollTimer = setInterval(async () => {
      try {
        const r = await fetch(`/api/jkai/builds/${build.id}`);
        if (!r.ok) return;
        const fresh = await r.json();
        const prevStatus = build.status;
        // The endpoint returns { ...build, iterations } — keep BOTH halves.
        // Discarding the iterations froze the Iterations pane and the header's
        // iteration count at their mount-time values.
        const { iterations: freshIters, ...freshBuild } = fresh ?? {};
        build = { ...build, ...freshBuild };
        if (Array.isArray(freshIters)) iterations = freshIters;
        if (prevStatus !== build.status) await invalidateAll();
      } catch { /* swallow */ }
    }, 10000);
    requestAnimationFrame(() => scroller?.scrollTo({ top: scroller.scrollHeight ?? 0 }));
  });

  onDestroy(() => {
    closed = true;
    es?.close();
    if (elapsedTimer) clearInterval(elapsedTimer);
    if (pollTimer) clearInterval(pollTimer);
  });

  // NOTE: there is deliberately no `data.build` sync effect here. The route
  // component (`routes/jkai/builds/[id]/+page.svelte`) seeds its own `view`
  // object once in onMount and never reassigns it from the `data` prop, so
  // `invalidateAll()` moves SvelteKit's `data` but not the object handed to this
  // component — such an effect could never fire, and one that carried a comment
  // saying it kept things in step would be actively misleading. The 10s poll
  // above is the refresh mechanism, and it now updates `build` AND `iterations`.
</script>

<svelte:head>
  <title>{build.title ?? build.prompt.slice(0, 50)} — JKAI build</title>
</svelte:head>

<div class="bs-shell">
  <!-- Status rail — always visible, never scrolls away. -->
  <header class="bs-rail">
    <a class="bs-back" href="/jkai/builds" title="All builds">←</a>
    <span class="bs-pill" data-status={buildBucket} title={outcomeNote(buildBucket) ?? ''}>{bucketLabel(buildBucket)}</span>
    <h1 class="bs-title">{build.title ?? build.prompt.slice(0, 60)}</h1>
    <span class="bs-meta bs-meta-iter">iter {iterationCount}</span>
    <span class="bs-meta bs-elapsed" class:running={!isTerminal}>{fmt(elapsedMs)}</span>
    {#if previewLink}
      <a
        class="bs-open"
        href={previewLink}
        target="_blank"
        rel="noreferrer"
        title={previewIsPr ? 'Open the pull request' : 'Open the running app'}
      >↗ {previewIsPr ? 'PR' : 'app'}</a>
    {/if}
    <span class="bs-actions">
      {#if build.status === 'running'}
        <button class="bs-act" disabled={acting !== null} onclick={() => controlAction('pause')} type="button">Pause</button>
        <button class="bs-act" disabled={acting !== null} onclick={() => controlAction('stop')} type="button">Stop</button>
      {:else if build.status === 'paused'}
        <button class="bs-act primary" disabled={acting !== null} onclick={() => controlAction('resume')} type="button">Resume</button>
        <button class="bs-act" disabled={acting !== null} onclick={() => controlAction('stop')} type="button">Stop</button>
      {:else if build.status === 'failed'}
        <button class="bs-act" disabled={acting !== null} onclick={() => controlAction('restart')} type="button">Restart</button>
      {/if}
    </span>
  </header>

  <!-- Tabs. Horizontally scrollable on a phone rather than wrapping, so the
       strip stays one row tall whatever the label lengths. -->
  <nav class="bs-tabs" aria-label="Build views">
    {#each TABS as t (t.key)}
      <button
        class="bs-tab"
        class:active={tab === t.key}
        onclick={() => selectTab(t.key)}
        type="button"
        aria-current={tab === t.key ? 'page' : undefined}
      >
        {t.label}
        {#if t.key === 'controls' && controlsAlert}<span class="bs-tab-alert" title="No chapter spine — the gate is checking nothing">!</span>{/if}
        {#if t.key === 'instruments' && instrumentsAlert}<span class="bs-tab-alert" title="A critical signal needs attention">!</span>{/if}
      </button>
    {/each}
  </nav>

  <!-- A parked build needs its approve/reject affordance on whatever pane the
       user is looking at: the Controls tab can turn this gate on, so the gate
       must be answerable from the same screen. Pinned above the pane rather
       than inside it, for the same reason the status rail is. -->
  {#if build.status === 'awaiting_iter_approval'}
    <div class="bs-gate">
      <IterApproval buildId={build.id} onAfter={refresh} />
    </div>
  {/if}

  <!-- The single scrolling region. -->
  {#if tab === 'stream'}
    <div class="bs-pane bs-pane-flush">
      {#if focusChips.length > 1}
        <nav class="bs-focus" aria-label="Focus stream on iteration">
          {#each focusChips as chip (chip.key)}
            {@const active = focusedIter === chip.key}
            <button
              class="bs-chip"
              class:active
              data-status={chip.status}
              onclick={() => focusOn(chip.key)}
              type="button"
              title={chip.label === 'All' ? 'Show every iteration' : `Show only ${chip.label}'s events`}
            >
              {chip.label}
              {#if chip.status === 'running'}<span class="bs-chip-dot" aria-hidden="true"></span>{/if}
            </button>
          {/each}
        </nav>
      {/if}
      <div class="bs-stream" bind:this={scroller} onscroll={onScroll} role="log" aria-live="polite">
        {#if rendered.length === 0}
          <div class="bs-empty">Waiting for activity…</div>
        {/if}
        {#each visibleGroups as g (g.iterationId ?? '__orphan__')}
          {@const open = isExpanded(g)}
          {@const lastIterGroup = [...groups].reverse().find((x) => x.iterationId !== null)}
          {@const isLatest = g.iterationId !== null && g === lastIterGroup}
          {#if g.iterationId !== null}
            <IterationHeader
              iter={g.iter}
              eventCount={g.events.length}
              expanded={open}
              {isLatest}
              onToggle={() => toggleGroup(g)}
            />
          {/if}
          {#if open}
            {#each g.events as line (line.key)}
              <StreamLine {line} buildId={build.id} />
            {/each}
          {/if}
        {/each}
      </div>
    </div>
  {:else}
    <div class="bs-pane">
      {#if tab === 'iterations'}
        <IterationInspector {iterations} buildPrompt={build?.prompt ?? null} />
      {:else if tab === 'verification'}
        {#if build.gitTargetConfig}
          <RepoVerificationPanel
            logs={lines}
            outcome={build.outcome}
            publishedSlug={build.publishedSlug}
            config={config?.verification ?? null}
            loading={configLoading}
            error={configError}
          />
        {:else}
          <p class="bs-empty">Verification chain is available for repository builds. App and Studio builds use their live preview and Studio gate.</p>
        {/if}
      {:else if tab === 'instruments'}
        {#if cockpitMetrics}
          <BuildCockpit metrics={cockpitMetrics} />
        {:else}
          <p class="bs-empty">No instrumentation yet.</p>
        {/if}
      {:else if tab === 'controls'}
        <BuildControls
          build={build as never}
          toolsets={config?.toolsets ?? []}
          catalogueLoading={configLoading}
          bind:spine
          onAfter={afterPatch}
        />
      {:else if tab === 'blueprint'}
        <BuildBlueprint
          build={build as never}
          {config}
          gateState={cockpitMetrics?.gate ?? null}
          loading={configLoading}
          error={configError}
        />
      {/if}
    </div>
  {/if}

  <!-- Composer — collapsible, because on a phone it is a fifth of the screen. -->
  <div class="bs-composer" class:open={composerOpen}>
    <button
      class="bs-composer-toggle"
      type="button"
      onclick={() => (composerOpen = !composerOpen)}
      aria-expanded={composerOpen}
    >
      <span class="bs-composer-caret" aria-hidden="true">{composerOpen ? '▾' : '▸'}</span>
      Session
      <span class="bs-composer-hint">inject · pin · shell</span>
    </button>
    {#if composerOpen}
      <BuildSessionPanel buildId={build.id} />
    {/if}
  </div>
</div>

<style>
  /* The shell fills its flex slot in `.jkai-body` and hides its own overflow.
     No viewport-relative height: the layout already owns the viewport. */
  .bs-shell {
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    width: 100%;
    max-width: 1400px;
    margin: 0 auto;
    padding: 0 0.75rem 0.5rem;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    overflow: hidden;
    color: var(--text-primary);
    font-family: var(--font-body);
  }

  /* --- Status rail --- */
  .bs-rail {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    flex-wrap: wrap;
    padding: 0.4rem 0.1rem;
    border-bottom: 2px solid var(--text-primary);
    flex-shrink: 0;
    min-width: 0;
  }
  .bs-back {
    font-family: var(--font-mono);
    font-size: var(--fs-body-sm, 15px);
    color: var(--text-muted);
    text-decoration: none;
    padding: 0.1rem 0.35rem;
    border: 1px solid var(--card-border);
    border-radius: 2px;
    flex-shrink: 0;
  }
  .bs-back:hover { color: var(--text-primary); border-color: var(--text-primary); }
  .bs-pill {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 2px 8px;
    border: 1px solid currentColor;
    color: var(--text-muted);
    flex-shrink: 0;
    white-space: nowrap;
  }
  .bs-pill[data-status='running'] { color: var(--accent); }
  .bs-pill[data-status='completed'] { color: var(--status-success, #10b981); }
  .bs-pill[data-status='delivered'] { color: var(--status-success, #10b981); }
  .bs-pill[data-status='proposed'] { color: var(--accent); }
  .bs-pill[data-status='failed'] { color: var(--status-error, #c0392b); }
  .bs-title {
    font-family: var(--font-display);
    font-size: 1.05rem;
    font-weight: 800;
    margin: 0;
    flex: 1 1 12rem;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bs-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .bs-elapsed.running { color: var(--text-primary); }
  .bs-elapsed.running::before {
    content: '⏱ ';
    color: var(--accent);
  }
  .bs-open {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 3px 8px;
    background: var(--accent);
    color: var(--bg);
    text-decoration: none;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .bs-open:hover { background: var(--accent-hover, var(--accent-ink)); }
  .bs-actions { display: flex; gap: 0.3rem; flex-shrink: 0; }
  .bs-act {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 5px 10px;
    border: 1px solid var(--text-primary, #1f1c18);
    background: var(--bg);
    color: var(--text-primary);
    cursor: pointer;
  }
  .bs-act.primary { background: var(--text-primary); color: var(--bg); }
  .bs-act:disabled { opacity: 0.4; cursor: not-allowed; }
  .bs-act:hover:not(:disabled) { background: var(--accent); color: var(--bg); border-color: var(--accent); }

  /* --- Tabs --- */
  .bs-tabs {
    display: flex;
    gap: 1px;
    flex-shrink: 0;
    background: var(--card-border);
    border: 1px solid var(--card-border);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .bs-tabs::-webkit-scrollbar { display: none; }
  .bs-tab {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 0.5rem 0.9rem;
    border: none;
    background: var(--bg);
    color: var(--text-muted);
    cursor: pointer;
    white-space: nowrap;
    flex: 1 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    justify-content: center;
    /* A 44px row: this is the primary navigation on a phone. */
    min-height: 44px;
  }
  .bs-tab:hover { color: var(--text-primary); }
  .bs-tab.active {
    background: var(--text-primary);
    color: var(--bg);
  }
  /* 12px is the floor the font-size gate enforces, so the badge is sized to fit
     the glyph rather than the glyph shrunk to fit the badge. */
  .bs-tab-alert {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 100px;
    background: var(--error);
    color: var(--bg);
    font-size: var(--fs-label-xs, 12px);
    line-height: 1;
    font-weight: 700;
    flex-shrink: 0;
  }

  .bs-gate {
    flex-shrink: 0;
    min-width: 0;
    max-height: 40%;
    overflow-y: auto;
    border: 2px solid var(--accent);
  }

  /* --- Panes: the one scrolling region --- */
  .bs-pane {
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    overflow-y: auto;
    /* Never horizontally: a long tool argument must scroll inside its own
       block, not widen the shell. */
    overflow-x: hidden;
  }
  /* The cockpit and the inspector carry a bottom margin for V2, where they are
     stacked siblings in a scrolling page. As panes they are the only child, so
     the margin is just dead space at the end of the scroll. Neutralised here
     rather than removed from the components, which V2 still renders. */
  .bs-pane :global(.cockpit),
  .bs-pane :global(.ii) {
    margin-bottom: 0;
  }
  /* The stream pane manages its own internal scroll, so the pane itself must
     not add a second one. */
  .bs-pane-flush {
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .bs-focus {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    overflow-x: auto;
    gap: 0.35rem;
    padding: 0.3rem 0.4rem;
    border: 1px solid var(--card-border);
    background: var(--bg);
    flex-shrink: 0;
    font-family: var(--font-mono), monospace;
    scrollbar-width: none;
  }
  .bs-focus::-webkit-scrollbar { display: none; }
  .bs-chip {
    font-family: var(--font-mono), monospace;
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 4px 10px;
    border: 1px solid var(--card-border);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .bs-chip:hover { color: var(--text-primary); border-color: var(--text-primary); }
  .bs-chip.active { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .bs-chip[data-status='completed'] { color: var(--status-success, #10b981); }
  .bs-chip[data-status='failed'] { color: var(--status-error, #c0392b); }
  .bs-chip.active[data-status='completed'] { background: var(--status-success, #10b981); color: var(--bg); border-color: var(--status-success, #10b981); }
  .bs-chip.active[data-status='failed'] { background: var(--status-error, #c0392b); color: var(--bg); border-color: var(--status-error, #c0392b); }
  .bs-chip-dot {
    width: 6px; height: 6px; border-radius: 100px;
    background: currentColor;
    animation: bs-pulse 1.4s ease-in-out infinite;
  }
  @keyframes bs-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }

  .bs-stream {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 0.5rem 0.7rem;
    background: var(--bg-section, color-mix(in srgb, var(--text-primary) 4%, transparent));
    border: 1px solid var(--card-border);
    font-family: var(--font-mono), 'Menlo', 'Monaco', monospace;
    font-size: var(--fs-label);
    line-height: 1.55;
  }
  .bs-empty {
    color: var(--text-muted);
    font-style: italic;
    padding: 1rem;
  }

  /* --- Composer --- */
  .bs-composer {
    flex-shrink: 0;
    min-width: 0;
    border: 2px solid var(--text-primary);
    background: var(--bg);
    display: flex;
    flex-direction: column;
    /* Bounded: the queue and notes lists scroll inside the panel rather than
       pushing the pane off the bottom of the screen. */
    max-height: 45%;
    overflow: hidden;
  }
  .bs-composer-toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.45rem 0.7rem;
    background: transparent;
    border: none;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-secondary);
    text-align: left;
    flex-shrink: 0;
    min-height: 38px;
  }
  .bs-composer-toggle:hover { background: var(--accent-tint-04); }
  .bs-composer-caret { color: var(--accent); }
  .bs-composer-hint {
    margin-left: auto;
    color: var(--text-ghost);
    letter-spacing: 0.06em;
    text-transform: none;
  }
  .bs-composer.open :global(.bsp) {
    margin-top: 0;
    border: none;
    border-top: 1px dashed var(--card-border);
    min-height: 0;
    overflow-y: auto;
  }
  /* The panel labels itself "Session" and so does the toggle above it. Keep the
     toggle's (it is the one visible when collapsed) and let the panel's header
     shrink to just its live/error indicator. */
  .bs-composer.open :global(.bsp-title) {
    display: none;
  }
  .bs-composer.open :global(.bsp-hdr) {
    border-bottom: none;
    padding-bottom: 0;
    margin-top: -0.15rem;
  }
  /* Backstop for the case where notes + queue + shell output still overflow the
     capped panel: the input must stay reachable rather than scrolling away. */
  .bs-composer.open :global(.bsp-input-row) {
    position: sticky;
    bottom: 0;
    background: var(--bg);
    padding-top: 0.35rem;
  }

  @media (max-width: 700px) {
    .bs-shell {
      padding: 0 0.5rem 0.35rem;
      gap: 0.3rem;
    }
    .bs-rail {
      gap: 0.35rem;
      padding: 0.3rem 0.1rem;
    }
    .bs-title {
      /* Second row on a phone: status and controls keep the first. */
      flex-basis: 100%;
      order: 10;
      font-size: 0.95rem;
    }
    /* Keep the whole control row on ONE line with the status. Three stacked
       rows of chrome on an 844px screen is most of the stream's space. */
    .bs-meta {
      font-size: var(--fs-label-xs);
    }
    .bs-act {
      padding: 4px 7px;
      letter-spacing: 0.04em;
    }
    .bs-open {
      padding: 3px 6px;
    }
    .bs-back {
      padding: 0.1rem 0.3rem;
    }
    .bs-tab {
      padding: 0.5rem 0.7rem;
      flex: 0 0 auto;
    }
    .bs-composer { max-height: 55%; }
  }

  /* Phone width proper. The iteration count moves out so the status and the
     transport controls share one row instead of two — three rows of chrome plus
     the hub header and the tab bar leaves the stream less than half the screen.
     The count is still on the Iterations pane, the focus chips and Instruments. */
  @media (max-width: 480px) {
    .bs-meta-iter {
      display: none;
    }
    .bs-title {
      font-size: 0.9rem;
    }
  }
</style>
