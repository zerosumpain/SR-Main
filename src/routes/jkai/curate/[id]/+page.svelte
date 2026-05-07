<svelte:head><title>Curate session — JKAI</title></svelte:head>

<script lang="ts">
  import { onDestroy } from 'svelte';

  // ── types ────────────────────────────────────────────────────────────────

  type CurateStatus =
    | 'scoping' | 'discovering' | 'awaiting-approval'
    | 'generating' | 'live-testing' | 'awaiting-promotion'
    | 'promoting' | 'promoted' | 'aborted' | 'error' | 'ended';

  type ChatMsg = { id: string; role: 'user' | 'assistant'; text: string };
  type DiscoveryLine = { text: string };
  type TestResult = { scenario: string; ok: boolean; output?: string; error?: string };
  type PromoteStep = { step: string; status: 'running' | 'ok' | 'failed'; detail?: string };

  // ── props + server data ──────────────────────────────────────────────────

  let { data } = $props();
  const sessionId = data.session.id as string;

  // ── reactive state ───────────────────────────────────────────────────────

  let status = $state<CurateStatus>(data.session.status as CurateStatus);
  let goal = $state<string>(data.session.goal ?? data.session.targetType ?? '');
  let proposal = $state<Record<string, unknown> | null>(
    (data.session.proposal as Record<string, unknown>) ?? null,
  );

  let messages = $state<ChatMsg[]>([]);
  let discoveryLines = $state<DiscoveryLine[]>([]);
  let testResults = $state<TestResult[]>([]);
  let promoteSteps = $state<PromoteStep[]>([]);

  // ── user input ───────────────────────────────────────────────────────────

  let chatInput = $state('');
  let redirectInput = $state('');
  let chatBusy = $state(false);
  let actionBusy = $state(false);
  let actionError = $state<string | null>(null);

  // ── discovery panel collapse ─────────────────────────────────────────────

  let discoveryOpen = $state(true);

  // ── SSE ─────────────────────────────────────────────────────────────────

  let es: EventSource | null = null;

  function connectSSE() {
    es = new EventSource(`/api/curate/sessions/${sessionId}/messages`);

    es.addEventListener('msg', (e) => {
      const d = JSON.parse(e.data) as { role: string; text: string };
      messages = [
        ...messages,
        { id: crypto.randomUUID(), role: d.role as 'user' | 'assistant', text: d.text },
      ];
      scrollChat();
    });

    es.addEventListener('discovery', (e) => {
      const d = JSON.parse(e.data) as { text: string };
      discoveryLines = [...discoveryLines, { text: d.text }];
    });

    es.addEventListener('phase', (e) => {
      const d = JSON.parse(e.data) as { status: CurateStatus; goal?: string };
      status = d.status;
      if (d.goal) goal = d.goal;
      if (status === 'discovering') { discoveryLines = []; discoveryOpen = true; }
      if (status === 'live-testing') testResults = [];
      if (status === 'promoting') promoteSteps = [];
    });

    es.addEventListener('test-result', (e) => {
      const d = JSON.parse(e.data) as TestResult;
      testResults = [...testResults, d];
    });

    es.addEventListener('promote-step', (e) => {
      const d = JSON.parse(e.data) as PromoteStep;
      // Update existing step or append new one.
      const idx = promoteSteps.findIndex((p) => p.step === d.step);
      if (idx >= 0) {
        promoteSteps = promoteSteps.map((p, i) => (i === idx ? d : p));
      } else {
        promoteSteps = [...promoteSteps, d];
      }
    });

    // proposal arrives as a phase event with status=awaiting-approval
    // but also possibly as a separate 'proposal' event if the engine sends one.
    es.addEventListener('proposal', (e) => {
      proposal = JSON.parse(e.data) as Record<string, unknown>;
    });

    es.onerror = () => {
      // Reconnect on error after a short back-off (browser handles reconnect
      // for SSE automatically, but make sure we don't leak the old instance).
    };
  }

  $effect(() => {
    connectSSE();
    return () => {
      es?.close();
      es = null;
    };
  });

  // ── chat scroll ──────────────────────────────────────────────────────────

  let chatEl: HTMLDivElement | null = $state(null);

  function scrollChat() {
    if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
  }

  // ── actions ──────────────────────────────────────────────────────────────

  async function postGate(path: string, body?: Record<string, unknown>) {
    actionBusy = true;
    actionError = null;
    try {
      const res = await fetch(`/api/curate/sessions/${sessionId}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        actionError = b.message ?? `HTTP ${res.status}`;
      }
    } catch (err) {
      actionError = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      actionBusy = false;
    }
  }

  async function sendChat(e: SubmitEvent) {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || chatBusy) return;
    chatBusy = true;
    chatInput = '';
    try {
      const res = await fetch(`/api/curate/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        actionError = b.message ?? `HTTP ${res.status}`;
      } else {
        // Optimistic: add user message immediately; SSE echo will arrive shortly.
        messages = [...messages, { id: crypto.randomUUID(), role: 'user', text }];
        scrollChat();
      }
    } catch (err) {
      actionError = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      chatBusy = false;
    }
  }

  async function sendRedirect(e: SubmitEvent) {
    e.preventDefault();
    const text = redirectInput.trim();
    if (!text) return;
    redirectInput = '';
    await postGate('redirect', { text });
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  const CHAT_ACTIVE = new Set<CurateStatus>(['scoping']);
  const REDIRECT_ACTIVE = new Set<CurateStatus>(['discovering', 'awaiting-approval']);

  function fmtProposalKey(k: string): string {
    return k.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
  }

  function isObj(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  }

  onDestroy(() => {
    es?.close();
    es = null;
  });
</script>

<div class="wrap">
  <!-- ── Header ──────────────────────────────────────────────────────────── -->
  <header class="page-hdr">
    <div class="hdr-left">
      <a class="back-link" href="/jkai/curate">← curate</a>
      <h1 class="session-goal">{goal || 'New session'}</h1>
    </div>
    <div class="hdr-right">
      <span class="status-pill" data-status={status}>{status}</span>
      {#if status !== 'promoted' && status !== 'aborted' && status !== 'ended' && status !== 'error'}
        <button
          type="button"
          class="btn-danger"
          disabled={actionBusy}
          onclick={() => postGate('abort')}
        >Abort</button>
      {/if}
    </div>
  </header>

  {#if actionError}
    <div class="action-error">{actionError}</div>
  {/if}

  <!-- ── Chat panel ────────────────────────────────────────────────────────
       Active during scoping. Visible (read-only) throughout.
  -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">chat</span>
      {#if status === 'scoping'}
        <span class="nm-sec-meta">scoping in progress</span>
      {/if}
    </div>

    <div class="chat-messages" bind:this={chatEl}>
      {#if messages.length === 0}
        <div class="chat-empty">
          {#if status === 'scoping'}
            Waiting for messages…
          {:else}
            Scope conversation complete.
          {/if}
        </div>
      {:else}
        {#each messages as m (m.id)}
          <div class="chat-msg" class:user={m.role === 'user'} class:assistant={m.role === 'assistant'}>
            <span class="msg-role">{m.role}</span>
            <span class="msg-text">{m.text}</span>
          </div>
        {/each}
      {/if}
    </div>

    {#if CHAT_ACTIVE.has(status)}
      <form onsubmit={sendChat} class="chat-form">
        <textarea
          class="nm-text-input chat-textarea"
          placeholder="Reply… (Enter to send, Shift+Enter for newline)"
          bind:value={chatInput}
          disabled={chatBusy}
          rows="2"
          onkeydown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
              e.preventDefault();
              (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
            }
          }}
        ></textarea>
        <button type="submit" class="nm-save-btn" disabled={chatBusy || !chatInput.trim()}>
          {chatBusy ? '…' : 'Send'}
        </button>
      </form>
    {/if}

    {#if REDIRECT_ACTIVE.has(status)}
      <form onsubmit={sendRedirect} class="chat-form">
        <textarea
          class="nm-text-input chat-textarea"
          placeholder="Redirect discovery… (Enter to send, Shift+Enter for newline)"
          bind:value={redirectInput}
          rows="2"
          onkeydown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
              e.preventDefault();
              (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
            }
          }}
        ></textarea>
        <button type="submit" class="nm-save-btn" disabled={!redirectInput.trim() || actionBusy}>
          Redirect
        </button>
      </form>
    {/if}
  </section>

  <!-- ── Discovery feed ───────────────────────────────────────────────────
       Collapsible. Shows streaming discovery narration lines.
  -->
  {#if status === 'discovering' || discoveryLines.length > 0}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">discovery</span>
        <span class="nm-sec-meta">{discoveryLines.length} entries</span>
        <button
          type="button"
          class="collapse-btn"
          onclick={() => { discoveryOpen = !discoveryOpen; }}
        >{discoveryOpen ? '▲ collapse' : '▼ expand'}</button>
      </div>
      {#if discoveryOpen}
        <div class="discovery-feed">
          {#if discoveryLines.length === 0}
            <div class="feed-empty">Waiting for discovery narration…</div>
          {:else}
            {#each discoveryLines as line, i (i)}
              <div class="feed-line">{line.text}</div>
            {/each}
          {/if}
        </div>
      {/if}
    </section>
  {/if}

  <!-- ── Proposal card ────────────────────────────────────────────────────
       Rendered during awaiting-approval.
  -->
  {#if status === 'awaiting-approval' || (proposal && status !== 'scoping')}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">proposal</span>
        {#if status === 'awaiting-approval'}
          <span class="nm-sec-meta">awaiting your decision</span>
        {/if}
      </div>

      {#if proposal}
        <div class="proposal-body">
          {#each Object.entries(proposal) as [k, v] (k)}
            <div class="prop-row">
              <span class="prop-key">{fmtProposalKey(k)}</span>
              <span class="prop-val">
                {#if Array.isArray(v)}
                  <ul class="prop-list">
                    {#each v as item, i (i)}
                      <li>{typeof item === 'string' ? item : JSON.stringify(item)}</li>
                    {/each}
                  </ul>
                {:else if isObj(v)}
                  <pre class="prop-json">{JSON.stringify(v, null, 2)}</pre>
                {:else}
                  {String(v)}
                {/if}
              </span>
            </div>
          {/each}
        </div>
      {:else}
        <div class="feed-empty">Proposal loading…</div>
      {/if}

      {#if status === 'awaiting-approval'}
        <div class="proposal-actions">
          <button
            type="button"
            class="nm-save-btn"
            disabled={actionBusy}
            onclick={() => postGate('approve')}
          >Approve — generate</button>
          <button
            type="button"
            class="nm-btn-ghost"
            disabled={actionBusy}
            onclick={() => postGate('abort')}
          >Reject</button>
        </div>
      {/if}
    </section>
  {/if}

  <!-- ── Live-test panel ──────────────────────────────────────────────────
       Shows test case results. Active during live-testing.
  -->
  {#if status === 'live-testing' || testResults.length > 0}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">live tests</span>
        <span class="nm-sec-meta">
          {testResults.filter((r) => r.ok).length}/{testResults.length} passing
        </span>
      </div>

      {#if data.session.devServerPort}
        <p class="preview-link">
          Preview the generated node in the canvas:
          <a class="row-link" href="/curate-preview/{data.session.id}/jkai/canvas" target="_blank" rel="noopener">
            open preview ↗
          </a>
        </p>
      {/if}

      {#if testResults.length === 0}
        <div class="feed-empty">Running test cases…</div>
      {:else}
        <div class="test-list">
          {#each testResults as r, i (i)}
            <div class="test-row" class:ok={r.ok} class:fail={!r.ok}>
              <span class="test-status">{r.ok ? '✓' : '✗'}</span>
              <div class="test-body">
                <div class="test-scenario">{r.scenario}</div>
                {#if r.output}
                  <pre class="test-output">{r.output}</pre>
                {/if}
                {#if r.error}
                  <div class="test-error">{r.error}</div>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}

      {#if status === 'live-testing'}
        <div class="test-actions">
          <button
            type="button"
            class="nm-save-btn"
            disabled={actionBusy || testResults.length === 0}
            onclick={() => postGate('promote')}
          >Looks right — promote</button>
          <button
            type="button"
            class="nm-btn-ghost"
            disabled={actionBusy}
            onclick={() => postGate('approve')}
          >Iterate</button>
          <button
            type="button"
            class="btn-danger"
            disabled={actionBusy}
            onclick={() => postGate('abort')}
          >Abort</button>
        </div>
      {/if}
    </section>
  {/if}

  <!-- ── Promote checklist ────────────────────────────────────────────────
       Stepwise checklist driven by promote-step SSE events.
  -->
  {#if status === 'promoting' || status === 'promoted' || promoteSteps.length > 0}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">promote</span>
        {#if status === 'promoting'}
          <span class="nm-sec-meta">in progress…</span>
        {:else if status === 'promoted'}
          <span class="nm-sec-meta promoted-meta">complete</span>
        {/if}
      </div>

      {#if promoteSteps.length === 0}
        <div class="feed-empty">Starting promote pipeline…</div>
      {:else}
        <ol class="promote-list">
          {#each promoteSteps as s, i (i)}
            <li class="promote-step" data-step-status={s.status}>
              <span class="step-icon">
                {#if s.status === 'running'}⋯{:else if s.status === 'ok'}✓{:else}✗{/if}
              </span>
              <div class="step-body">
                <span class="step-name">{s.step}</span>
                {#if s.detail}
                  <span class="step-detail">{s.detail}</span>
                {/if}
              </div>
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  {/if}

  <!-- ── Promoted summary ──────────────────────────────────────────────────
       Success card after promoted.
  -->
  {#if status === 'promoted'}
    <section class="nm-sec success-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">promoted</span>
      </div>
      <div class="success-body">
        <div class="success-headline">Node promoted successfully.</div>
        <p class="success-sub">
          The new node is merged, deployed, and available in the workflow canvas.
        </p>
        <div class="success-links">
          <a class="nm-save-btn" href="/jkai/canvas">Open canvas</a>
          <a class="nm-btn-ghost" href="/jkai/curate">Back to curate</a>
        </div>
      </div>
    </section>
  {/if}

  <!-- ── Error / Aborted ──────────────────────────────────────────────────
  -->
  {#if status === 'error' || status === 'aborted'}
    <section class="nm-sec error-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight error">{status}</span>
      </div>
      <div class="error-body">
        {#if status === 'error'}
          An error occurred. Check iteration log or restart a new session.
        {:else}
          Session aborted.
        {/if}
        <a class="back-link" href="/jkai/curate">← back to curate</a>
      </div>
    </section>
  {/if}
</div>

<style>
  .wrap {
    max-width: 860px;
    margin: 2rem auto 4rem;
    padding: 0 1.5rem;
    color: var(--text-primary);
    font-family: var(--font-body);
  }

  /* ── Header ── */
  .page-hdr {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 1.5rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid var(--text-primary);
  }
  .hdr-left {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-width: 0;
  }
  .hdr-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-shrink: 0;
  }
  .back-link {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent);
    text-decoration: none;
  }
  .back-link:hover { text-decoration: underline; }

  .session-goal {
    margin: 0;
    font-family: var(--font-brand);
    font-size: 1.4rem;
    font-weight: 500;
    line-height: 1.2;
    color: var(--text-primary);
    text-transform: lowercase;
    letter-spacing: -0.01em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 55ch;
  }

  /* ── Status pill ── */
  .status-pill {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 3px 8px;
    border-radius: 2px;
    border: 1px solid;
    flex-shrink: 0;
  }
  .status-pill[data-status="scoping"] {
    color: var(--text-secondary);
    border-color: var(--card-border);
    background: var(--bg-section);
  }
  .status-pill[data-status="discovering"],
  .status-pill[data-status="generating"],
  .status-pill[data-status="live-testing"],
  .status-pill[data-status="promoting"] {
    color: #8b5e00;
    border-color: rgba(196, 140, 10, 0.4);
    background: rgba(196, 140, 10, 0.08);
  }
  .status-pill[data-status="awaiting-approval"],
  .status-pill[data-status="awaiting-promotion"] {
    color: #7a5200;
    border-color: rgba(196, 140, 10, 0.6);
    background: rgba(196, 140, 10, 0.14);
  }
  .status-pill[data-status="promoted"],
  .status-pill[data-status="ended"] {
    color: #2e6e47;
    border-color: rgba(46, 110, 71, 0.4);
    background: rgba(46, 110, 71, 0.08);
  }
  .status-pill[data-status="error"],
  .status-pill[data-status="aborted"] {
    color: #8a2020;
    border-color: rgba(194, 68, 68, 0.4);
    background: rgba(194, 68, 68, 0.08);
  }

  /* ── Buttons ── */
  .btn-danger {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 5px 12px;
    background: transparent;
    color: #c44;
    border: 1px solid rgba(194, 68, 68, 0.4);
    cursor: pointer;
  }
  .btn-danger:hover:not(:disabled) {
    background: rgba(194, 68, 68, 0.08);
  }
  .btn-danger:disabled { opacity: 0.5; cursor: not-allowed; }

  /* ── Error banner ── */
  .action-error {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--status-error);
    border: 1px solid rgba(194, 68, 68, 0.3);
    background: rgba(194, 68, 68, 0.06);
    padding: 0.4rem 0.75rem;
    margin-bottom: 1rem;
  }

  /* ── Chat ── */
  .chat-messages {
    max-height: 280px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 0.5rem;
    padding-right: 2px;
  }
  .chat-empty {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-ghost);
    padding: 0.5rem 0;
  }
  .chat-msg {
    display: flex;
    gap: 0.6rem;
    padding: 0.35rem 0.5rem;
    border-radius: 2px;
  }
  .chat-msg.user { background: var(--accent-tint-04); }
  .chat-msg.assistant { background: var(--bg-section); }
  .msg-role {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
    flex-shrink: 0;
    padding-top: 2px;
    width: 5ch;
  }
  .chat-msg.user .msg-role { color: var(--accent); }
  .msg-text {
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .chat-form {
    display: flex;
    gap: 0.5rem;
    align-items: stretch;
    margin-top: 0.5rem;
  }
  .chat-textarea {
    flex: 1;
    resize: vertical;
    min-height: 2.5rem;
    font-family: inherit;
  }

  /* ── Discovery feed ── */
  .discovery-feed {
    max-height: 220px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .feed-empty, .feed-line {
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.55;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .feed-empty { color: var(--text-ghost); }

  .preview-link {
    margin: 0.5rem 0 1rem;
    font-size: 0.85rem;
    color: var(--text-muted);
  }
  .collapse-btn {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    margin-left: auto;
  }
  .collapse-btn:hover { color: var(--text-primary); }

  /* ── Proposal ── */
  .proposal-body {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-bottom: 0.75rem;
  }
  .prop-row {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
    border-bottom: 1px solid var(--divider);
    padding-bottom: 0.5rem;
  }
  .prop-row:last-child { border-bottom: none; }
  .prop-key {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    flex-shrink: 0;
    width: 14ch;
    padding-top: 1px;
  }
  .prop-val {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-primary);
    flex: 1;
    min-width: 0;
    word-break: break-word;
  }
  .prop-list {
    margin: 0;
    padding-left: 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .prop-json {
    margin: 0;
    font-size: 10px;
    overflow-x: auto;
    background: var(--bg-section);
    border: 1px solid var(--card-border);
    padding: 4px 8px;
    line-height: 1.5;
  }

  .proposal-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-top: 0.75rem;
  }

  /* ── Live test ── */
  .test-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 0.5rem;
  }
  .test-row {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
    padding: 0.4rem 0.5rem;
    border-radius: 2px;
    border-left: 2px solid var(--card-border);
  }
  .test-row.ok { border-left-color: #6ab88a; background: rgba(106, 184, 138, 0.06); }
  .test-row.fail { border-left-color: #c25b5b; background: rgba(194, 68, 68, 0.06); }
  .test-status {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    flex-shrink: 0;
    width: 1.2ch;
  }
  .test-row.ok .test-status { color: #2e6e47; }
  .test-row.fail .test-status { color: #8a2020; }
  .test-body { flex: 1; min-width: 0; }
  .test-scenario {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    color: var(--text-primary);
  }
  .test-output {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
    margin: 2px 0 0;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .test-error {
    font-family: var(--font-mono);
    font-size: 10px;
    color: #c25b5b;
    margin-top: 2px;
  }
  .test-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-top: 0.75rem;
  }

  /* ── Promote checklist ── */
  .promote-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .promote-step {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
    padding: 0.35rem 0.5rem;
    border-radius: 2px;
  }
  .promote-step[data-step-status="running"] { background: rgba(196, 140, 10, 0.06); }
  .promote-step[data-step-status="ok"] { background: rgba(106, 184, 138, 0.06); }
  .promote-step[data-step-status="failed"] { background: rgba(194, 68, 68, 0.06); }
  .step-icon {
    font-family: var(--font-mono);
    font-size: 12px;
    width: 1.2ch;
    flex-shrink: 0;
  }
  .promote-step[data-step-status="running"] .step-icon { color: #8b5e00; }
  .promote-step[data-step-status="ok"] .step-icon { color: #2e6e47; }
  .promote-step[data-step-status="failed"] .step-icon { color: #8a2020; }
  .step-body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }
  .step-name {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    color: var(--text-primary);
  }
  .step-detail {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
    word-break: break-word;
  }
  .promoted-meta { color: #2e6e47 !important; }

  /* ── Success ── */
  .success-sec { border-color: rgba(46, 110, 71, 0.4) !important; }
  .success-body { display: flex; flex-direction: column; gap: 0.6rem; }
  .success-headline {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 500;
    color: #2e6e47;
  }
  .success-sub {
    font-size: 0.9rem;
    color: var(--text-secondary);
    margin: 0;
  }
  .success-links { display: flex; gap: 0.5rem; align-items: center; }

  /* ── Error ── */
  .error-sec { border-color: rgba(194, 68, 68, 0.4) !important; }
  .error-body {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-secondary);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .sr-label-tight.error { color: #c44; }
</style>
