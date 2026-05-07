<script lang="ts">
  /**
   * BuilderPiNode — live terminal for an active build, embedded in canvas.
   *
   * Subscribes to /api/jkai/builds/<id>/stream (SSE) and renders persisted
   * log events as a chronological tagged-line feed (mirrors BuildSession.svelte
   * but compressed for canvas use). Live deltas are merged in via streamId.
   *
   * Visible elapsed timer + iteration ETA (mean of past iteration
   * durationMs × remaining iterations of the configured budget).
   *
   * Pause / Stop are graceful: they call the existing endpoints, which
   * delegate to builderClient.{pauseBuild,stopBuild} — the builder finishes
   * the current tool call before parking. Mid-write file edits are not
   * destroyed.
   */
  import { onDestroy } from 'svelte';
  import ShikiCodeBlock from './ShikiCodeBlock.svelte';

  type PiConfig = {
    buildId?: string;
    showThinking?: boolean;
    showTools?: boolean;
    showLint?: boolean;
    autoScroll?: boolean;
  };

  type LogLine = {
    id: number;
    type: string;
    content: string;
    iterationId: string | null;
    streaming?: boolean;
  };

  type Iteration = {
    id: string;
    number: number;
    status: string;
    durationMs: number | null;
  };

  type BuildRow = {
    id: string;
    status: string;
    iterationsCompleted: number;
    title: string | null;
    serveConfig: unknown;
    publishedSlug: string | null;
    budgetConfig?: { maxIterations?: number; maxTotalMinutes?: number } | null;
    createdAt?: string;
    updatedAt?: string;
    completedAt?: string | null;
    startedAt?: string | null;
  };

  let {
    nodeId,
    config,
    resolvedBuildId,
    onConfigChange,
  }: {
    nodeId: string;
    config: PiConfig;
    /** Inherited from upstream Builder Chat node (resolved by canvas page). */
    resolvedBuildId: string | null;
    onConfigChange: (patch: Partial<PiConfig>) => void;
  } = $props();
  void onConfigChange;
  void nodeId;

  const buildId = $derived(
    String(config.buildId ?? '').trim() || resolvedBuildId || '',
  );

  let build = $state<BuildRow | null>(null);
  let iterations = $state<Iteration[]>([]);
  let lines = $state<LogLine[]>([]);
  const liveBuffers = $state<Record<string, { type: string; content: string; iterationId: string | null }>>({});

  let connected = $state(false);
  let acting = $state<string | null>(null);
  let nowMs = $state(Date.now());
  let scroller: HTMLDivElement | undefined = $state();
  let stickToBottom = $state(true);

  let es: EventSource | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;
  let lastBuildId = '';

  async function refresh(): Promise<void> {
    if (!buildId) return;
    try {
      const r = await fetch(`/api/jkai/builds/${buildId}`);
      if (!r.ok) return;
      const data = await r.json();
      const { iterations: iters, ...rest } = data ?? {};
      build = rest as BuildRow;
      if (Array.isArray(iters)) iterations = iters as Iteration[];
    } catch { /* swallow */ }
  }

  async function fetchLogs(): Promise<void> {
    // Page-server load already provides logs for the /jkai/builds/[id]
    // route, but here we don't have that — fall back to scanning iterations
    // and waiting for SSE to populate `lines`. Persisted history is only
    // scanned on attach (via SSE replay if the builder ring buffer is set up;
    // otherwise from this point on).
  }

  function disconnect(): void {
    if (es) { try { es.close(); } catch { /* swallow */ } es = null; }
    connected = false;
  }

  function connect(): void {
    if (!buildId) return;
    disconnect();
    es = new EventSource(`/api/jkai/builds/${buildId}/stream`);
    es.onopen = () => { connected = true; };
    es.onerror = () => { connected = false; };
    es.onmessage = (e) => {
      try {
        const id = parseInt(e.lastEventId || '0', 10);
        const payload = JSON.parse(e.data);
        if (payload.type === 'stage') return; // BuildView consumes stage events
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
        if (stickToBottom && (config.autoScroll !== false)) {
          requestAnimationFrame(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
        }
      } catch { /* swallow */ }
    };
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

  $effect(() => {
    const id = buildId;
    if (id !== lastBuildId) {
      // Build target changed — clear and reattach.
      lastBuildId = id;
      lines = [];
      for (const k of Object.keys(liveBuffers)) delete liveBuffers[k];
      build = null;
      iterations = [];
      disconnect();
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (!id) return;
      void refresh();
      void fetchLogs();
      connect();
      pollTimer = setInterval(refresh, 7000);
    }
    return () => {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    };
  });

  $effect(() => {
    elapsedTimer = setInterval(() => { nowMs = Date.now(); }, 1000);
    return () => { if (elapsedTimer) clearInterval(elapsedTimer); };
  });

  onDestroy(() => {
    disconnect();
    if (elapsedTimer) clearInterval(elapsedTimer);
    if (pollTimer) clearInterval(pollTimer);
  });

  // ──────────────────────────────────────────────────────────────────
  // Derived: status, elapsed, ETA, filtered render list
  // ──────────────────────────────────────────────────────────────────

  const isTerminal = $derived(
    !!build && ['completed', 'failed', 'paused'].includes(build.status),
  );
  const startMs = $derived.by(() => {
    if (!build) return 0;
    const s = build.startedAt ?? build.createdAt;
    return s ? new Date(s).getTime() : 0;
  });
  const endMs = $derived(build?.completedAt ? new Date(build.completedAt).getTime() : null);
  const elapsedMs = $derived.by(() => {
    if (!build || !startMs) return 0;
    if (isTerminal) return Math.max(0, (endMs ?? nowMs) - startMs);
    return Math.max(0, nowMs - startMs);
  });

  const completedIterations = $derived(
    iterations.filter((i) => i.number > 0 && i.status === 'completed' && typeof i.durationMs === 'number'),
  );
  const meanIterMs = $derived.by(() => {
    if (completedIterations.length === 0) return null;
    const total = completedIterations.reduce((a, b) => a + (b.durationMs ?? 0), 0);
    return total / completedIterations.length;
  });
  const maxIterations = $derived(build?.budgetConfig?.maxIterations ?? null);
  const completedCount = $derived(build?.iterationsCompleted ?? 0);
  const remainingIterations = $derived.by(() => {
    if (!maxIterations || completedCount >= maxIterations) return null;
    return maxIterations - completedCount;
  });
  const etaMs = $derived.by(() => {
    if (isTerminal) return null;
    if (!meanIterMs || !remainingIterations) return null;
    return Math.round(meanIterMs * remainingIterations);
  });

  function fmt(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  /**
   * Split a content string on triple-backtick code fences. Prose chunks render
   * as plain text; code chunks render as <pre><code> with a copy button.
   * Tolerates an unclosed final fence (live streaming) by treating the
   * remainder as code with the parsed language hint.
   */
  type Block = { kind: 'prose' | 'code'; content: string; lang?: string };
  function parseBlocks(text: string): Block[] {
    const out: Block[] = [];
    let i = 0;
    while (i < text.length) {
      const fenceStart = text.indexOf('```', i);
      if (fenceStart === -1) {
        if (i < text.length) out.push({ kind: 'prose', content: text.slice(i) });
        break;
      }
      if (fenceStart > i) out.push({ kind: 'prose', content: text.slice(i, fenceStart) });
      const langEnd = text.indexOf('\n', fenceStart + 3);
      if (langEnd === -1) {
        // Fence opener with no newline — treat the trailing tokens as a code lang
        out.push({ kind: 'code', content: '', lang: text.slice(fenceStart + 3).trim() || undefined });
        break;
      }
      const lang = text.slice(fenceStart + 3, langEnd).trim();
      const fenceEnd = text.indexOf('```', langEnd + 1);
      if (fenceEnd === -1) {
        out.push({ kind: 'code', content: text.slice(langEnd + 1), lang: lang || undefined });
        break;
      }
      out.push({
        kind: 'code',
        content: text.slice(langEnd + 1, fenceEnd).replace(/\n$/, ''),
        lang: lang || undefined,
      });
      i = fenceEnd + 3;
      if (text[i] === '\n') i += 1;
    }
    return out;
  }


  const visibleLines = $derived.by(() => {
    const showThinking = config.showThinking !== false;
    const showTools = config.showTools !== false;
    const showLint = config.showLint !== false;
    return lines.filter((l) => {
      if (l.type === 'thinking' && !showThinking) return false;
      if ((l.type === 'tool' || l.type === 'output') && !showTools) return false;
      if (l.type === 'lint' && !showLint) return false;
      return true;
    });
  });

  const liveEntries = $derived(Object.entries(liveBuffers));

  function tagFor(t: string): string {
    if (t === 'text') return 'agent';
    if (t === 'thinking') return 'thinks';
    if (t === 'tool' || t === 'code') return 'tool';
    if (t === 'output') return 'bash';
    if (t === 'lint') return 'lint';
    if (t === 'error') return 'error';
    if (t === 'system') return 'sys';
    return t;
  }

  /**
   * Default language hint for line types that go straight into a code block
   * (no fence parsing). `tool` is JSON if the content parses as JSON,
   * otherwise plain text — agent tools sometimes return plain prose.
   */
  function defaultLangFor(t: string, content: string): string {
    if (t === 'output') return 'bash';
    if (t === 'lint') return 'text';
    if (t === 'error') return 'text';
    if (t === 'tool' || t === 'code') {
      const trimmed = content.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
          (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try { JSON.parse(trimmed); return 'json'; } catch { /* fall through */ }
      }
      return 'text';
    }
    return 'text';
  }

  /** Line types rendered as a single Shiki code block (no fence parsing). */
  const CODE_BLOCK_TYPES = new Set(['output', 'tool', 'code', 'lint', 'error']);
  /** Line types that mix prose + parsed code fences (agent narration). */
  const MIXED_PROSE_TYPES = new Set(['text']);

  async function controlAction(action: 'pause' | 'resume' | 'stop' | 'restart'): Promise<void> {
    if (!buildId) return;
    acting = action;
    try {
      await fetch(`/api/jkai/builds/${buildId}/${action}`, { method: 'POST' });
      await refresh();
    } finally { acting = null; }
  }

  function onScroll(): void {
    if (!scroller) return;
    const slack = 80;
    stickToBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < slack;
  }
</script>

<div class="bpn-body">
  <header class="bpn-status">
    {#if !buildId}
      <span class="bpn-empty-hdr">No build attached — connect a Builder Chat or set a Build ID in the panel.</span>
    {:else}
      <span class="bpn-pill" data-status={build?.status ?? 'pending'}>{build?.status ?? '…'}</span>
      <span class="bpn-meta">iter {completedCount}{maxIterations ? `/${maxIterations}` : ''}</span>
      <span class="bpn-meta">⏱ {fmt(elapsedMs)}{isTerminal ? ' (final)' : ''}</span>
      {#if etaMs !== null}
        <span class="bpn-meta bpn-eta" title="Estimated time to budget exhaustion (mean past iteration duration × remaining)">
          ETA ≈ {fmt(etaMs)}
        </span>
      {/if}
      <span class="bpn-meta bpn-conn" class:connected>{connected ? '● live' : '○ offline'}</span>
      <div class="bpn-acts">
        {#if build?.status === 'running'}
          <button class="bpn-act" disabled={acting !== null} onclick={() => controlAction('pause')} title="Pause gracefully — current tool finishes first" type="button">Pause</button>
          <button class="bpn-act" disabled={acting !== null} onclick={() => controlAction('stop')} title="Stop gracefully — work-in-progress is preserved" type="button">Stop</button>
        {:else if build?.status === 'paused'}
          <button class="bpn-act primary" disabled={acting !== null} onclick={() => controlAction('resume')} type="button">Resume</button>
          <button class="bpn-act" disabled={acting !== null} onclick={() => controlAction('stop')} type="button">Stop</button>
        {:else if build?.status === 'failed'}
          <button class="bpn-act" disabled={acting !== null} onclick={() => controlAction('restart')} type="button">Restart</button>
        {/if}
      </div>
    {/if}
  </header>

  <div
    class="bpn-stream"
    bind:this={scroller}
    onscroll={onScroll}
    role="log"
    aria-live="polite"
  >
    {#if !buildId}
      <div class="bpn-empty">Waiting for a build…</div>
    {:else if visibleLines.length === 0 && liveEntries.length === 0}
      <div class="bpn-empty">Listening for activity…</div>
    {:else}
      {#each visibleLines as line (line.id)}
        <div class="bpn-line" data-type={line.type}>
          <span class="bpn-tag">[{tagFor(line.type)}]</span>
          {#if CODE_BLOCK_TYPES.has(line.type)}
            <div class="bpn-content bpn-content-mixed">
              <ShikiCodeBlock content={line.content} lang={defaultLangFor(line.type, line.content)} />
            </div>
          {:else if MIXED_PROSE_TYPES.has(line.type)}
            {@const blocks = parseBlocks(line.content)}
            {#if blocks.some((b) => b.kind === 'code')}
              <div class="bpn-content bpn-content-mixed">
                {#each blocks as b, bi (`${line.id}:${bi}`)}
                  {#if b.kind === 'prose' && b.content.trim().length > 0}
                    <span class="bpn-prose">{b.content}</span>
                  {:else if b.kind === 'code'}
                    <ShikiCodeBlock content={b.content} lang={b.lang} />
                  {/if}
                {/each}
              </div>
            {:else}
              <span class="bpn-content">{line.content}</span>
            {/if}
          {:else}
            <span class="bpn-content">{line.content}</span>
          {/if}
        </div>
      {/each}
      {#each liveEntries as [k, b] (k)}
        <div class="bpn-line bpn-live" data-type={b.type}>
          <span class="bpn-tag">[{tagFor(b.type)}]</span>
          {#if CODE_BLOCK_TYPES.has(b.type)}
            <div class="bpn-content bpn-content-mixed">
              <ShikiCodeBlock content={b.content} lang={defaultLangFor(b.type, b.content)} />
              <span class="bpn-cursor">▊</span>
            </div>
          {:else if MIXED_PROSE_TYPES.has(b.type)}
            {@const lblocks = parseBlocks(b.content)}
            {#if lblocks.some((bl) => bl.kind === 'code')}
              <div class="bpn-content bpn-content-mixed">
                {#each lblocks as bl, bi (`${k}:${bi}`)}
                  {#if bl.kind === 'prose' && bl.content.trim().length > 0}
                    <span class="bpn-prose">{bl.content}</span>
                  {:else if bl.kind === 'code'}
                    <ShikiCodeBlock content={bl.content} lang={bl.lang} />
                  {/if}
                {/each}
                <span class="bpn-cursor">▊</span>
              </div>
            {:else}
              <span class="bpn-content">{b.content}<span class="bpn-cursor">▊</span></span>
            {/if}
          {:else}
            <span class="bpn-content">{b.content}<span class="bpn-cursor">▊</span></span>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .bpn-body {
    display: flex; flex-direction: column;
    width: 100%; height: 100%;
    box-sizing: border-box;
    overflow: hidden;
    background: var(--bg);
    color: var(--text-primary);
    font-family: var(--font-body);
  }

  .bpn-status {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid var(--card-border);
    flex-wrap: wrap;
    flex-shrink: 0;
  }
  .bpn-empty-hdr {
    font-family: var(--font-mono); font-size: 10px;
    color: var(--text-ghost);
    font-style: italic;
  }
  .bpn-pill {
    font-family: var(--font-mono); font-size: 9px;
    text-transform: uppercase; letter-spacing: 0.14em;
    padding: 2px 7px; border: 1px solid currentColor;
    color: var(--text-muted);
  }
  .bpn-pill[data-status='running'] { color: var(--accent); }
  .bpn-pill[data-status='completed'] { color: var(--status-success, #10b981); }
  .bpn-pill[data-status='failed'] { color: var(--status-error, #c0392b); }
  .bpn-pill[data-status='paused'] { color: var(--text-ghost); }
  .bpn-meta {
    font-family: var(--font-mono); font-size: 10px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .bpn-eta {
    color: var(--text-primary);
    font-weight: 600;
  }
  .bpn-conn { margin-left: auto; }
  .bpn-conn.connected { color: var(--color-emerald, #10b981); }

  .bpn-acts { display: flex; gap: 0.25rem; flex-shrink: 0; flex-basis: 100%; }
  .bpn-act {
    font-family: var(--font-mono); font-size: 9px;
    text-transform: uppercase; letter-spacing: 0.1em;
    padding: 4px 9px;
    border: 1px solid var(--text-primary);
    background: var(--bg);
    color: var(--text-primary);
    cursor: pointer;
  }
  .bpn-act.primary { background: var(--text-primary); color: var(--bg); }
  .bpn-act:disabled { opacity: 0.4; cursor: not-allowed; }
  .bpn-act:hover:not(:disabled) { background: var(--accent); color: var(--bg); border-color: var(--accent); }

  .bpn-stream {
    flex: 1; min-height: 0;
    overflow-y: auto;
    padding: 0.4rem 0.6rem;
    background: color-mix(in srgb, var(--text-primary) 4%, transparent);
    font-family: var(--font-mono), monospace;
    font-size: 11px;
    line-height: 1.5;
  }
  .bpn-empty {
    color: var(--text-muted);
    font-style: italic;
    padding: 0.5rem 0;
  }
  .bpn-line {
    display: grid;
    grid-template-columns: 56px 1fr;
    gap: 0.4rem;
    padding: 1px 0;
    border-left: 2px solid transparent;
    padding-left: 6px;
    margin-left: -6px;
  }
  .bpn-line[data-type='text'] .bpn-tag { color: var(--text-primary); }
  .bpn-line[data-type='thinking'] { opacity: 0.85; }
  .bpn-line[data-type='thinking'] .bpn-content { color: var(--text-muted); font-style: italic; }
  .bpn-line[data-type='thinking'] .bpn-tag { color: var(--text-muted); }
  .bpn-line[data-type='tool'] .bpn-tag,
  .bpn-line[data-type='code'] .bpn-tag,
  .bpn-line[data-type='output'] .bpn-tag { color: var(--accent); }
  .bpn-line[data-type='lint'] .bpn-tag,
  .bpn-line[data-type='error'] .bpn-tag { color: var(--status-error, #c0392b); }
  .bpn-line[data-type='system'] .bpn-tag,
  .bpn-line[data-type='system'] .bpn-content { color: var(--text-ghost); }
  .bpn-tag {
    font-size: 9px;
    text-transform: lowercase;
    color: var(--text-muted);
    text-align: right;
  }
  .bpn-content {
    white-space: pre-wrap;
    word-break: break-word;
  }
  .bpn-live { border-left-color: var(--accent); }
  .bpn-cursor {
    display: inline-block;
    margin-left: 1px;
    color: var(--accent);
    animation: bpn-blink 1s steps(1) infinite;
  }
  @keyframes bpn-blink { 0%, 50% { opacity: 1; } 50.01%, 100% { opacity: 0; } }

  /* Mixed prose + code block rendering for text / tool / output lines. */
  .bpn-content-mixed {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-width: 0;
  }
  .bpn-prose {
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
