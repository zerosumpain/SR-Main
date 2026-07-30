<script lang="ts">
  /**
   * BuilderChatNode — outcome composer + mid-build interjection surface.
   *
   * The first message starts a build with the configured outcome. Once a
   * buildId is present:
   *   plain text     → inject (queued for next LLM turn)
   *   /btw <text>    → inject (explicit alias for "by the way" — same as plain)
   *   /wtf <text>    → interrupt, then inject (graceful: SIGTERMs the live
   *                    pi child but the builder rolls forward, no destruction)
   *   $ <command>    → shell in the build's workdir
   *   # <text>       → pin note (re-injected every iteration)
   *
   * The build runs in the jkai-builder sidecar regardless of whether the
   * canvas is open; closing/reopening the canvas re-attaches via buildId
   * persisted on this node's config.
   */
  import { onDestroy, untrack } from 'svelte';

  type ChatConfig = {
    prompt?: string;
    thinkingLevel?: string;
    enforceDesignSystem?: boolean;
    planFirst?: boolean;
    modelProvider?: string;
    modelId?: string;
    minIterations?: number | null;
    maxIterations?: number | null;
    maxTotalMinutes?: number | null;
    maxTokensPerHour?: number | null;
    activeMinutesPerHour?: number | null;
    buildId?: string;
    size?: { w: number; h: number };
    history?: Array<{ id: string; role: 'user' | 'system'; content: string; createdAt: string; kind?: string }>;
  };

  type BuildSnapshot = {
    id: string;
    status: string;
    iterationsCompleted: number;
    title: string | null;
    serveConfig: unknown;
    publishedSlug: string | null;
  } | null;

  let {
    nodeId,
    config,
    emitSchemas = [],
    onConfigChange,
  }: {
    nodeId: string;
    config: ChatConfig;
    /** Downstream build-view emit schemas, collected by the canvas. */
    emitSchemas?: string[];
    onConfigChange: (patch: Partial<ChatConfig>) => void;
  } = $props();
  void nodeId;

  /** Sticky-bottom auto-scroll for the history pane. */
  function autoScroll(node: HTMLDivElement): { destroy(): void } {
    let stick = true;
    const onScroll = () => {
      const slack = 60;
      stick = node.scrollHeight - node.scrollTop - node.clientHeight < slack;
    };
    const obs = new MutationObserver(() => {
      if (stick) requestAnimationFrame(() => { node.scrollTop = node.scrollHeight; });
    });
    node.addEventListener('scroll', onScroll);
    obs.observe(node, { childList: true, subtree: true, characterData: true });
    requestAnimationFrame(() => { node.scrollTop = node.scrollHeight; });
    return {
      destroy() {
        node.removeEventListener('scroll', onScroll);
        obs.disconnect();
      },
    };
  }

  const buildId = $derived(String(config.buildId ?? '').trim());
  const prompt = $derived(String(config.prompt ?? ''));

  let input = $state('');
  let busy = $state(false);
  let lastError = $state<string | null>(null);
  let snapshot = $state<BuildSnapshot>(null);
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  // Local scrollback of injects/system events (capped) for canvas-side memory.
  let history = $state<Array<{ id: string; role: 'user' | 'system'; content: string; createdAt: string; kind?: string }>>(
    Array.isArray(config.history) ? config.history.slice(-50) : [],
  );

  // Pre-fill the composer with the configured prompt so users see the outcome
  // they're about to start. Only runs once on mount (when no buildId yet and
  // the input is empty). Writes are wrapped in untrack so reassigning the
  // input $state doesn't retrack the new proxy and re-fire the effect on
  // its own output (Svelte-5 proxy churn).
  let prefilledOnce = false;
  $effect(() => {
    const p = prompt;
    const bId = buildId;
    untrack(() => {
      if (prefilledOnce) return;
      if (bId) { prefilledOnce = true; return; }
      if (input.length === 0 && p.trim()) {
        input = p;
        prefilledOnce = true;
      }
    });
  });

  /**
   * Append to history *and* persist atomically with any other config changes.
   * Returns the new history array so callers can pass it along with their
   * own patch in a single onConfigChange — avoids the
   * read-cached-config-then-patch race that drops fields.
   */
  function appendHistory(
    role: 'user' | 'system',
    content: string,
    kind?: string,
  ): typeof history {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      content,
      createdAt: new Date().toISOString(),
      kind,
    };
    const next = [...history, entry].slice(-50);
    history = next;
    return next;
  }

  /** Single-call pushHistory for inject/note/shell paths (not racing). */
  function pushHistory(role: 'user' | 'system', content: string, kind?: string): void {
    const next = appendHistory(role, content, kind);
    onConfigChange({ history: next });
  }

  /**
   * Build the data-emission contract block appended to a starting prompt.
   *
   * If any downstream build-view nodes have `config.emitSchema` set, that's
   * the explicit, non-negotiable contract — agent emits exactly those
   * fields.
   *
   * If no schemas are set, fall through to verbose-default — agent decides
   * what to emit but is told to default to verbose, always include `type`
   * and `ts`.
   *
   * If there's no build-view downstream at all, we don't append anything
   * (no point asking the agent to emit data nobody's listening for).
   */
  function buildEmissionContract(): string {
    // The system prompt already tells every build to emit on every meaningful
    // event via fetch(window.JKAI_EVENTS_URL,...) + window.parent.postMessage.
    // We only need to convey the *schema* if the user explicitly set one.
    if (!Array.isArray(emitSchemas) || emitSchemas.length === 0) {
      // Verbose default lives in the system prompt; nothing to add here.
      return '';
    }
    const schemaBlock = emitSchemas
      .map((s, i) => emitSchemas.length === 1 ? s : `### Schema ${i + 1}\n${s}`)
      .join('\n\n');
    return [
      '',
      '---',
      '## Data emission contract (NON-NEGOTIABLE)',
      '',
      'The canvas this app is embedded in expects every emission to match the following shape:',
      '',
      schemaBlock,
      '',
      'This **supersedes** the default emission shape from the system prompt. Emit exactly these fields (plus the required `type` and `ts: Date.now()`). Do not omit fields. Do not invent additional top-level fields. The transport (fetch to `window.JKAI_EVENTS_URL` + `window.parent.postMessage`) and frequency (every meaningful event, fire-and-forget, never blocking) follow the system-prompt rules.',
    ].join('\n');
  }

  async function fetchSnapshot(): Promise<void> {
    if (!buildId) { snapshot = null; return; }
    try {
      const r = await fetch(`/api/jkai/builds/${buildId}`);
      if (!r.ok) return;
      const data = await r.json();
      snapshot = {
        id: data.id,
        status: data.status,
        iterationsCompleted: data.iterationsCompleted ?? 0,
        title: data.title ?? null,
        serveConfig: data.serveConfig ?? null,
        publishedSlug: data.publishedSlug ?? null,
      };
    } catch { /* swallow */ }
  }

  $effect(() => {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (!buildId) { snapshot = null; return; }
    void fetchSnapshot();
    pollTimer = setInterval(fetchSnapshot, 6000);
    return () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };
  });

  onDestroy(() => { if (pollTimer) clearInterval(pollTimer); });

  async function startBuild(promptOverride: string): Promise<void> {
    const userPrompt = promptOverride.trim() || prompt.trim();
    if (!userPrompt) {
      lastError = 'Set a prompt in the panel or type one here before starting.';
      return;
    }
    // Append the data-emission contract (explicit schema or verbose default)
    // so the agent bakes in window.parent.postMessage emissions the canvas
    // can capture downstream.
    const finalPrompt = userPrompt + buildEmissionContract();
    busy = true;
    lastError = null;
    try {
      const budget: Record<string, number> = {};
      if (typeof config.maxIterations === 'number') budget.maxIterations = config.maxIterations;
      if (typeof config.maxTotalMinutes === 'number') budget.maxTotalMinutes = config.maxTotalMinutes;
      if (typeof config.maxTokensPerHour === 'number') budget.maxTokensPerHour = config.maxTokensPerHour;
      if (typeof config.activeMinutesPerHour === 'number') budget.activeMinutesPerHour = config.activeMinutesPerHour;
      if (typeof config.minIterations === 'number') budget.minIterations = config.minIterations;
      const body: Record<string, unknown> = {
        prompt: finalPrompt,
        budgetConfig: budget,
        enforceDesignSystem: config.enforceDesignSystem !== false,
        planFirst: config.planFirst === true,
        thinkingLevel: config.thinkingLevel ?? 'medium',
      };
      if (config.modelProvider) body.modelProvider = config.modelProvider;
      if (config.modelId) body.modelId = config.modelId;
      const r = await fetch('/api/jkai/builds', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) {
        lastError = String(data.error ?? `HTTP ${r.status}`);
        return;
      }
      // History + persisted prompt show the user's *original* outcome, not
      // the augmented full prompt — keeps the chat scrollback readable and
      // means the panel/composer pre-fill on next load won't carry the
      // contract block.
      let next = appendHistory('user', userPrompt, 'start');
      const contractApplied = emitSchemas.length > 0
        ? `Data emission contract applied (${emitSchemas.length} schema${emitSchemas.length === 1 ? '' : 's'})`
        : 'Default emission rules from system prompt';
      next = appendHistory('system', `${contractApplied} · build ${data.id.slice(0, 8)}`, 'system');
      onConfigChange({ buildId: data.id, prompt: userPrompt, history: next });
      void fetchSnapshot();
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function postSession(payload: Record<string, unknown>): Promise<boolean> {
    if (!buildId) return false;
    busy = true;
    try {
      const r = await fetch(`/api/jkai/builds/${buildId}/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: r.statusText }));
        lastError = String(err?.error ?? `HTTP ${r.status}`);
        return false;
      }
      lastError = null;
      return true;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      busy = false;
    }
  }

  async function submit(): Promise<void> {
    const raw = input.trim();
    if (!raw || busy) return;
    if (!buildId) { await startBuild(raw); input = ''; return; }
    if (raw.startsWith('# ')) {
      const note = raw.slice(2).trim();
      if (await postSession({ kind: 'note_add', content: note })) {
        pushHistory('user', note, 'note');
        input = '';
      }
    } else if (raw.startsWith('$ ')) {
      const cmd = raw.slice(2).trim();
      if (await postSession({ kind: 'shell', command: cmd })) {
        pushHistory('user', cmd, 'shell');
        input = '';
      }
    } else if (raw.toLowerCase().startsWith('/wtf ')) {
      const text = raw.slice(5).trim();
      // Interrupt first, then inject — graceful: builder finishes the
      // in-flight tool call, the next LLM turn picks up our message.
      const interrupted = await postSession({ kind: 'interrupt' });
      if (interrupted) {
        pushHistory('system', 'Interrupted current turn', 'interrupt');
        if (text && (await postSession({ kind: 'inject', content: text }))) {
          pushHistory('user', text, 'wtf');
        }
        input = '';
      }
    } else if (raw.toLowerCase().startsWith('/btw ')) {
      const text = raw.slice(5).trim();
      if (text && (await postSession({ kind: 'inject', content: text }))) {
        pushHistory('user', text, 'btw');
        input = '';
      }
    } else {
      // Plain text — inject.
      if (await postSession({ kind: 'inject', content: raw })) {
        pushHistory('user', raw, 'inject');
        input = '';
      }
    }
  }

  function onKey(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      e.preventDefault();
      void postSession({ kind: 'interrupt' }).then((ok) => {
        if (ok) pushHistory('system', 'Interrupted current turn', 'interrupt');
      });
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  function clearHistory(): void {
    history = [];
    onConfigChange({ history: [] });
  }

  const statusLabel = $derived(snapshot?.status ?? (buildId ? '…' : 'no build'));
  const previewLink = $derived.by(() => {
    if (!snapshot) return null;
    if (snapshot.publishedSlug) return `/projects/${snapshot.publishedSlug}/`;
    if (snapshot.serveConfig) return `/api/jkai/proxy/${snapshot.id}/`;
    return null;
  });
  const placeholder = $derived(
    !buildId
      ? 'Type the build outcome and press ⏎ to start…'
      : '⏎ inject  ·  /btw text  ·  /wtf text (interrupt)  ·  $ cmd  ·  # note',
  );
</script>

<div class="bcn-body">
  <header class="bcn-status">
    <span class="bcn-pill" data-status={statusLabel}>{statusLabel}</span>
    {#if snapshot}
      <span class="bcn-meta">iter {snapshot.iterationsCompleted}</span>
      {#if snapshot.title}<span class="bcn-meta bcn-title-line">{snapshot.title}</span>{/if}
    {/if}
    {#if previewLink}
      <a class="bcn-link" href={previewLink} target="_blank" rel="noreferrer">↗ open app</a>
    {/if}
    {#if lastError}<span class="bcn-err">{lastError}</span>{/if}
  </header>

  <div class="bcn-history" use:autoScroll>
    {#if history.length === 0}
      <div class="bcn-empty">
        {#if buildId}
          Build <code>{buildId.slice(0, 8)}</code> attached. Type to inject — / for commands.
        {:else}
          Set the outcome and start the build.
        {/if}
      </div>
    {/if}
    {#each history as h (h.id)}
      <div class="bcn-row" data-role={h.role} data-kind={h.kind ?? ''}>
        <span class="bcn-tag">
          {#if h.kind === 'start'}START{:else if h.kind === 'btw'}/btw{:else if h.kind === 'wtf'}/wtf{:else if h.kind === 'note'}#{:else if h.kind === 'shell'}${:else if h.kind === 'inject'}»{:else if h.kind === 'interrupt'}!{:else if h.role === 'system'}sys{:else}you{/if}
        </span>
        <span class="bcn-content">{h.content}</span>
      </div>
    {/each}
  </div>

  <div class="bcn-composer">
    <textarea
      class="bcn-input"
      bind:value={input}
      placeholder={placeholder}
      rows="2"
      onkeydown={onKey}
      disabled={busy}
    ></textarea>
    <div class="bcn-foot">
      <span class="bcn-foot-hint">⏎ send · ⇧⏎ newline</span>
      {#if buildId && history.length > 0}
        <button type="button" class="bcn-foot-link" onclick={clearHistory} title="Clear local history (does not stop the build)">clear</button>
      {/if}
      <button
        type="button"
        class="bcn-send"
        disabled={busy || !input.trim()}
        onclick={() => submit()}
      >{buildId ? 'SEND' : 'START'}</button>
    </div>
  </div>
</div>

<style>
  .bcn-body {
    display: flex; flex-direction: column;
    width: 100%; height: 100%;
    box-sizing: border-box;
    overflow: hidden;
    background: var(--bg);
    color: var(--text-primary);
    font-family: var(--font-body);
  }
  .bcn-status {
    display: flex; align-items: baseline; gap: 0.5rem;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid var(--card-border);
    flex-wrap: wrap;
    flex-shrink: 0;
  }
  .bcn-pill {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.14em;
    padding: 2px 7px; border: 1px solid currentColor;
    color: var(--text-muted);
  }
  .bcn-pill[data-status='running'] { color: var(--accent); }
  .bcn-pill[data-status='completed'] { color: var(--status-success, #10b981); }
  .bcn-pill[data-status='failed'] { color: var(--status-error, #c0392b); }
  .bcn-pill[data-status='paused'] { color: var(--text-ghost); }
  .bcn-meta {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .bcn-title-line {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    flex: 1; min-width: 0;
  }
  .bcn-link {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: var(--accent); text-decoration: none;
    margin-left: auto;
  }
  .bcn-link:hover { text-decoration: underline; }
  .bcn-err {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: var(--status-error, #c0392b);
    margin-left: auto;
    flex-basis: 100%;
  }

  .bcn-history {
    flex: 1; min-height: 0;
    overflow-y: auto;
    padding: 0.4rem 0.6rem;
    display: flex; flex-direction: column; gap: 0.25rem;
    font-family: var(--font-mono), monospace;
    font-size: var(--fs-label);
    line-height: 1.45;
  }
  .bcn-empty {
    color: var(--text-ghost);
    font-style: italic;
    font-size: var(--fs-label);
    padding: 0.5rem 0;
  }
  .bcn-empty code {
    font-family: var(--font-mono);
    color: var(--text-muted);
  }
  .bcn-row {
    display: grid;
    grid-template-columns: 32px 1fr;
    gap: 0.45rem;
    align-items: baseline;
    padding: 2px 4px;
    border-left: 2px solid transparent;
  }
  .bcn-row[data-role='user'] {
    border-left-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 4%, transparent);
  }
  .bcn-row[data-role='system'] { color: var(--text-muted); }
  .bcn-tag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    text-align: right;
  }
  .bcn-row[data-kind='wtf'] .bcn-tag { color: var(--status-error, #c0392b); }
  .bcn-row[data-kind='btw'] .bcn-tag,
  .bcn-row[data-kind='inject'] .bcn-tag { color: var(--accent); }
  .bcn-content {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .bcn-composer {
    display: flex; flex-direction: column;
    border-top: 1px solid var(--card-border);
    padding: 0.4rem 0.6rem;
    gap: 0.3rem;
    flex-shrink: 0;
  }
  .bcn-input {
    width: 100%;
    padding: 0.45rem 0.55rem;
    font-family: var(--font-mono), monospace;
    font-size: var(--fs-body);
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    box-sizing: border-box;
    outline: none;
    resize: none;
  }
  .bcn-input:focus { border-color: var(--accent); }
  .bcn-input:disabled { opacity: 0.6; }
  .bcn-foot {
    display: flex; align-items: center; gap: 0.5rem;
  }
  .bcn-foot-hint {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
  }
  .bcn-foot-link {
    background: transparent; border: none; padding: 0;
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.1em;
    color: var(--text-muted); cursor: pointer;
  }
  .bcn-foot-link:hover { color: var(--accent); }
  .bcn-send {
    margin-left: auto;
    font-family: var(--font-mono), monospace;
    font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    padding: 5px 12px;
    border: 1px solid var(--text-primary);
    background: var(--text-primary);
    color: var(--bg);
    cursor: pointer;
  }
  .bcn-send:disabled { opacity: 0.4; cursor: not-allowed; }
  .bcn-send:hover:not(:disabled) {
    background: var(--accent); border-color: var(--accent);
  }
</style>
