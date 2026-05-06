<script lang="ts">
  /**
   * Phase 7 cosmetic rewrite — single-pane terminal-style stream view.
   * Replaces the lanes-based BuildDetailV2 chrome when PUBLIC_BUILDS_V3=true.
   * V2 stays as the default until this beds in.
   *
   * Renders all build activity as a chronological tagged-line feed:
   *   [agent]   model output text
   *   [thinks]  model thinking (toggle to show inline; expanded modal on click)
   *   [tool]    tool invocation; arg block streams in, click to expand result
   *   [bash]    shell stdout
   *   [lint]    design-lint findings
   *   [user]    injected message / pinned note
   *   [sys]     orchestrator events (iteration start/end, promote, preview)
   *
   * The active iteration is sticky-pinned at top via the same banner +
   * status strip pattern from V2; past iterations collapse to one-liners
   * with [view] expand to full content. Bottom is the BuildSessionPanel
   * (inject / pin / shell / interrupt) reused unchanged.
   */
  import { onMount, onDestroy } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import BuildSessionPanel from './BuildSessionPanel.svelte';
  import StreamLine from './StreamLine.svelte';
  import IterationHeader from './IterationHeader.svelte';
  import type { JkaiBuild, JkaiIteration } from '$lib/db/schema';

  interface PageData {
    build: JkaiBuild;
    iterations: JkaiIteration[];
    logs: Array<{ id: number; type: string; content: string; iterationId: string | null }>;
  }
  let { data }: { data: PageData } = $props();

  let build = $state<JkaiBuild>(data.build);
  // Persisted log entries (positive event IDs from SSE).
  let lines = $state<Array<{
    id: number;
    type: string;
    content: string;
    iterationId: string | null;
    streaming?: boolean;
  }>>(data.logs.map((l) => ({ ...l })));
  // Live streaming buffers — keyed by streamId, flushed into a synthetic
  // line until the segment ends (turn_end / tool_input_end).
  const liveBuffers = $state<Record<string, { type: string; content: string; iterationId: string | null }>>({});

  let livePreviewUrl = $state<string | null>(null);
  const previewLink = $derived(
    build.publishedSlug
      ? `/projects/${build.publishedSlug}/`
      : (build.serveConfig || livePreviewUrl) ? `/api/jkai/proxy/${build.id}/` : null,
  );

  // Elapsed timer.
  let nowMs = $state(Date.now());
  const isTerminal = $derived(['completed', 'failed', 'paused'].includes(build.status));
  const startMs = $derived(
    build.startedAt ? new Date(build.startedAt).getTime() : new Date(build.createdAt).getTime(),
  );
  const endMs = $derived(build.completedAt ? new Date(build.completedAt).getTime() : null);
  const elapsedMs = $derived(isTerminal ? Math.max(0, (endMs ?? nowMs) - startMs) : Math.max(0, nowMs - startMs));
  function fmt(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }
  const iterationCount = $derived(data.iterations.filter((i) => i.number > 0).length);

  let es: EventSource | null = null;
  let closed = $state(false);
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
          // If a streaming buffer matches this iteration's text/thinking
          // segment, drop it — the persisted log replaces the in-progress
          // view.
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
        if (stickToBottom) requestAnimationFrame(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
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
      // Final snapshot replaces the partial. Keep until the persisted log
      // arrives a moment later (which deletes via the matching code above).
      if (typeof ev.full === 'string' && liveBuffers[k]) liveBuffers[k].content = ev.full;
    }
  }

  // Build the rendered list: persisted lines + live buffers, in the
  // correct chronological order (persisted come first by id; live buffers
  // append at the end since they're "happening now").
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

  // Group rendered events by iteration so we can drop an IterationHeader
  // between groups. iterationId === null events (orphan / pre-iteration
  // system logs) form their own anonymous group at the top. Group order is
  // determined by the FIRST event id in each group, so iterations appear in
  // the chronological order they actually started.
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
          ? data.iterations.find((x) => x.id === ev.iterationId) ?? null
          : null;
        g = {
          iterationId: ev.iterationId,
          iter,
          firstId: ev.id ?? Number.MAX_SAFE_INTEGER - i, // live buffers go last
          events: [],
        };
        map.set(key, g);
      }
      g.events.push(ev);
    }
    return Array.from(map.values()).sort((a, b) => a.firstId - b.firstId);
  });

  // Per-iteration expand/collapse state. Default: latest iteration is
  // expanded, past iterations collapse to their summary line. The "orphan"
  // group (build-level system logs) is always expanded since it's where
  // 'Build started' / 'Plan approved' etc. live.
  const expandedByIter = $state<Record<string, boolean>>({});
  function isExpanded(g: Group): boolean {
    const k = g.iterationId ?? '__orphan__';
    if (k in expandedByIter) return expandedByIter[k];
    if (g.iterationId === null) return true;
    // Latest iteration = the LAST group with a non-null iterationId.
    const lastIter = [...groups].reverse().find((x) => x.iterationId !== null);
    return lastIter?.iterationId === g.iterationId;
  }
  function toggleGroup(g: Group): void {
    const k = g.iterationId ?? '__orphan__';
    expandedByIter[k] = !isExpanded(g);
  }

  // Focus filter — when set to an iterationId (or '__orphan__'), only that
  // group renders in the stream below. 'all' keeps the full view.
  let focusedIter = $state<string | 'all'>('all');
  const visibleGroups = $derived(
    focusedIter === 'all'
      ? groups
      : groups.filter((g) => (g.iterationId ?? '__orphan__') === focusedIter),
  );
  // Selection of focusable iterations to render as chips. Includes Plan
  // (iter 0) and orphan-system events when present, in chronological order.
  const focusChips = $derived.by(() => {
    const chips: Array<{ key: string; label: string; status: string; iterationId: string | null }> = [
      { key: 'all', label: 'All', status: '', iterationId: null },
    ];
    for (const g of groups) {
      if (g.iterationId === null) {
        chips.push({ key: '__orphan__', label: 'Setup', status: '', iterationId: null });
      } else if (g.iter) {
        const label = g.iter.number === 0 ? 'Plan' : `Iter ${g.iter.number}`;
        chips.push({
          key: g.iterationId,
          label,
          status: g.iter.status,
          iterationId: g.iterationId,
        });
      }
    }
    return chips;
  });
  function focusOn(key: string): void {
    focusedIter = key as typeof focusedIter;
    // When focusing on a specific iteration, force-expand it so the user
    // sees its events right away (it might have been collapsed).
    if (key !== 'all' && expandedByIter[key] === false) {
      expandedByIter[key] = true;
    }
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

  let acting = $state<string | null>(null);
  async function controlAction(action: 'pause' | 'resume' | 'stop' | 'restart'): Promise<void> {
    acting = action;
    try {
      await fetch(`/api/jkai/builds/${build.id}/${action}`, { method: 'POST' });
      await refresh();
    } finally { acting = null; }
  }

  onMount(() => {
    if (build.status === 'running' || build.status === 'awaiting_plan_approval') connect();
    elapsedTimer = setInterval(() => { nowMs = Date.now(); }, 1000);
    pollTimer = setInterval(async () => {
      try {
        const r = await fetch(`/api/jkai/builds/${build.id}`);
        if (!r.ok) return;
        const fresh = await r.json();
        const prevStatus = build.status;
        const { iterations: _i, ...freshBuild } = fresh ?? {};
        build = { ...build, ...freshBuild };
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
</script>

<svelte:head>
  <title>{build.title ?? build.prompt.slice(0, 50)} — JKAI build</title>
</svelte:head>

<div class="bs-shell">
  <!-- Sticky preview banner (same as V2 — kept unchanged). -->
  {#if previewLink}
    <section class="bs-preview ready">
      <span class="bs-dot" aria-hidden="true"></span>
      <span class="bs-preview-label">Preview</span>
      <a class="bs-preview-cta" href={previewLink} target="_blank" rel="noreferrer">↗ Open app</a>
      <code class="bs-preview-url">https://strangeramblings.com{previewLink}</code>
      <button class="bs-preview-copy" onclick={() => navigator.clipboard?.writeText(`https://strangeramblings.com${previewLink}`)} type="button" title="Copy">copy</button>
    </section>
  {:else if !isTerminal}
    <section class="bs-preview building">
      <span class="bs-dot" aria-hidden="true"></span>
      <span class="bs-preview-label">Preview · preparing… link will appear when the agent's app is reachable</span>
    </section>
  {/if}

  <!-- Status strip: status pill + iteration count + elapsed timer. -->
  <header class="bs-status">
    <a class="bs-back" href="/jkai/builds">← all builds</a>
    <span class="bs-pill" data-status={build.status}>{build.status}</span>
    <span class="bs-meta">iter {iterationCount}</span>
    <span class="bs-meta bs-elapsed" class:running={!isTerminal}>⏱ {fmt(elapsedMs)}{isTerminal ? ' (final)' : ''}</span>
    <h1 class="bs-title">{build.title ?? build.prompt.slice(0, 60)}</h1>
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

  <!-- Focus chips: filter the stream to a single iteration (or 'All').
       Lives outside the terminal stream so it's always reachable even
       when the stream is filled. -->
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
      {#if focusedIter !== 'all'}
        <span class="bs-focus-hint">Filtered — only this iteration's events are shown.</span>
      {/if}
    </nav>
  {/if}

  <!-- The stream itself: terminal aesthetic, monospace, fixed-height
       scrolling region. New events append at the bottom; we auto-scroll
       only when the user is within 80px of the tail (stickToBottom). -->
  <div
    class="bs-stream"
    bind:this={scroller}
    onscroll={onScroll}
    role="log"
    aria-live="polite"
  >
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

  <!-- Bottom prompt: inject / pin / shell / interrupt. Re-uses the same
       BuildSessionPanel that V2 ships. -->
  <BuildSessionPanel buildId={build.id} />
</div>

<style>
  .bs-shell {
    max-width: 1400px;
    margin: 0 auto;
    padding: 0 1rem 1rem;
    color: var(--text-primary);
    font-family: var(--font-body);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    height: calc(100vh - 1rem);
    box-sizing: border-box;
  }
  .bs-preview {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.45rem 0.7rem;
    border: 2px solid var(--text-primary, #1f1c18);
    background: var(--bg, #ede4d4);
    flex-wrap: wrap;
    flex-shrink: 0;
  }
  .bs-preview.building { border-style: dashed; color: var(--text-muted); }
  .bs-preview.ready { background: var(--accent-soft, var(--bg)); }
  .bs-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--text-muted, #6b675f);
    flex: 0 0 auto;
  }
  .bs-preview.ready .bs-dot {
    background: var(--color-emerald, #10b981);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-emerald, #10b981) 25%, transparent);
  }
  .bs-preview.building .bs-dot {
    background: var(--accent);
    animation: bs-pulse 1.4s ease-in-out infinite;
  }
  @keyframes bs-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
  .bs-preview-label {
    font-family: var(--font-mono); font-weight: 600; font-size: 0.85rem;
  }
  .bs-preview-cta {
    font-family: var(--font-mono); font-size: 0.8rem;
    padding: 0.25rem 0.55rem;
    background: var(--text-primary); color: var(--bg);
    text-decoration: none;
  }
  .bs-preview-cta:hover { background: var(--accent); }
  .bs-preview-url {
    font-family: var(--font-mono); font-size: 0.74rem;
    color: var(--text-muted); flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .bs-preview-copy {
    font-family: var(--font-mono); font-size: 0.74rem;
    background: transparent;
    border: 1px solid var(--card-border);
    padding: 0.18rem 0.5rem;
    cursor: pointer;
    color: var(--text-muted);
  }

  .bs-status {
    display: flex;
    align-items: baseline;
    gap: 0.7rem;
    flex-wrap: wrap;
    padding: 0.35rem 0.5rem;
    border-bottom: 1px solid var(--card-border);
    flex-shrink: 0;
  }
  .bs-back {
    font-family: var(--font-mono); font-size: 11px;
    color: var(--text-muted); text-decoration: none;
  }
  .bs-back:hover { color: var(--text-primary); }
  .bs-pill {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.14em;
    padding: 2px 8px; border: 1px solid currentColor;
    color: var(--text-muted);
  }
  .bs-pill[data-status='running'] { color: var(--accent); }
  .bs-pill[data-status='completed'] { color: var(--status-success, #10b981); }
  .bs-pill[data-status='failed'] { color: var(--status-error, #c0392b); }
  .bs-meta {
    font-family: var(--font-mono); font-size: 11px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .bs-elapsed.running { color: var(--text-primary); }
  .bs-title {
    font-family: var(--font-display); font-size: 1.1rem; font-weight: 800;
    margin: 0; flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .bs-actions { display: flex; gap: 0.3rem; flex-shrink: 0; }
  .bs-act {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.1em;
    padding: 4px 10px;
    border: 1px solid var(--text-primary, #1f1c18);
    background: var(--bg);
    color: var(--text-primary);
    cursor: pointer;
  }
  .bs-act.primary { background: var(--text-primary); color: var(--bg); }
  .bs-act:disabled { opacity: 0.4; cursor: not-allowed; }
  .bs-act:hover:not(:disabled) { background: var(--accent); color: var(--bg); border-color: var(--accent); }

  .bs-focus {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.35rem;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--card-border);
    background: var(--bg);
    flex-shrink: 0;
    font-family: var(--font-mono), monospace;
  }
  .bs-chip {
    font-family: var(--font-mono), monospace;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 3px 9px;
    border: 1px solid var(--card-border);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .bs-chip:hover {
    color: var(--text-primary);
    border-color: var(--text-primary);
  }
  .bs-chip.active {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }
  .bs-chip[data-status='completed'] { color: var(--status-success, #10b981); }
  .bs-chip[data-status='failed'] { color: var(--status-error, #c0392b); }
  .bs-chip.active[data-status='completed'] { background: var(--status-success, #10b981); color: var(--bg); border-color: var(--status-success, #10b981); }
  .bs-chip.active[data-status='failed'] { background: var(--status-error, #c0392b); color: var(--bg); border-color: var(--status-error, #c0392b); }
  .bs-chip-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: currentColor;
    animation: bs-pulse 1.4s ease-in-out infinite;
  }
  .bs-focus-hint {
    font-size: 10px;
    color: var(--text-ghost);
    margin-left: 0.5rem;
    font-style: italic;
  }
  .bs-stream {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem 0.7rem;
    background: var(--bg-section, color-mix(in srgb, var(--text-primary) 4%, transparent));
    border: 1px solid var(--card-border);
    font-family: var(--font-mono), 'Menlo', 'Monaco', monospace;
    font-size: 12px;
    line-height: 1.55;
    min-height: 200px;
  }
  .bs-empty {
    color: var(--text-muted);
    font-style: italic;
    padding: 1rem;
  }
</style>
