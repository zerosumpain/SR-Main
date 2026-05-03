<script lang="ts">
  /**
   * Phases 5/6/7 — bidirectional session panel rendered inside BuildDetailV2.
   *
   * Connects to /api/jkai/builds/<id>/session via WebSocket. The custom
   * server entry (scripts/server-with-ws.mjs) upgrades + proxies to the
   * jkai-builder unix socket, where packages/jkai-builder/src/ws.ts handles
   * the bidirectional protocol.
   *
   * User input prefix routing in the prompt:
   *   plain text  → {kind:'inject', content}     queue user message
   *   # text      → {kind:'note_add', content}   pin a directive
   *   $ command   → {kind:'shell', command}      run in workdir
   *   Ctrl+C      → {kind:'interrupt'}           SIGTERM the active pi child
   */
  import { onMount, onDestroy } from 'svelte';

  let { buildId }: { buildId: string } = $props();

  type PendingItem = { id: number; role: string; content: string; createdAt: string };
  type NoteItem = { id: number; content: string; createdAt: string };
  type ShellChunk = { stream: 'stdout' | 'stderr'; text: string };

  let ws = $state<WebSocket | null>(null);
  let connected = $state(false);
  let queue = $state<PendingItem[]>([]);
  let notes = $state<NoteItem[]>([]);
  let shellLine = $state<{ command: string; chunks: ShellChunk[]; exitCode: number | null } | null>(null);
  let input = $state('');
  let busy = $state(false);
  let lastError = $state<string | null>(null);

  function connect(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/api/jkai/builds/${buildId}/session`;
    const socket = new WebSocket(url);
    socket.onopen = () => { connected = true; lastError = null; };
    socket.onclose = () => {
      connected = false;
      // Auto-reconnect after 3s — covers transient web-app restarts.
      setTimeout(() => { if (!connected) connect(); }, 3000);
    };
    socket.onerror = () => { lastError = 'session error'; };
    socket.onmessage = (e) => {
      let msg: { kind?: string; [k: string]: unknown };
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.kind === 'pending') queue = (msg.queue as PendingItem[]) ?? [];
      else if (msg.kind === 'notes') notes = (msg.notes as NoteItem[]) ?? [];
      else if (msg.kind === 'shell_start') shellLine = { command: String(msg.command ?? ''), chunks: [], exitCode: null };
      else if (msg.kind === 'shell_chunk' && shellLine) {
        shellLine = { ...shellLine, chunks: [...shellLine.chunks, { stream: msg.stream as 'stdout' | 'stderr', text: String(msg.text ?? '') }] };
      } else if (msg.kind === 'shell_end' && shellLine) {
        shellLine = { ...shellLine, exitCode: Number(msg.exitCode ?? 0) };
      } else if (msg.kind === 'interrupted') {
        lastError = msg.ok ? null : 'no active iteration to interrupt';
      } else if (msg.kind === 'error') {
        lastError = String(msg.message ?? 'session error');
      }
    };
    ws = socket;
  }

  function send(payload: unknown): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) { lastError = 'not connected'; return; }
    ws.send(JSON.stringify(payload));
  }

  async function submit(): Promise<void> {
    const raw = input.trim();
    if (!raw || busy) return;
    busy = true;
    try {
      if (raw.startsWith('# ')) send({ kind: 'note_add', content: raw.slice(2).trim() });
      else if (raw.startsWith('$ ')) send({ kind: 'shell', command: raw.slice(2).trim() });
      else send({ kind: 'inject', content: raw });
      input = '';
    } finally {
      busy = false;
    }
  }

  function interrupt(): void { send({ kind: 'interrupt' }); }
  function removeNote(id: number): void { send({ kind: 'note_remove', id }); }
  function removeQueued(id: number): void { send({ kind: 'inject_remove', id }); }

  function onKey(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      e.preventDefault();
      interrupt();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  onMount(connect);
  onDestroy(() => { try { ws?.close(); } catch { /* swallow */ } });
</script>

<section class="bsp">
  <header class="bsp-hdr">
    <span class="bsp-title">Session</span>
    <span class="bsp-status" class:connected>{connected ? '● connected' : '○ connecting…'}</span>
    {#if lastError}<span class="bsp-err">{lastError}</span>{/if}
  </header>

  {#if notes.length > 0}
    <ul class="bsp-list bsp-notes">
      {#each notes as n (n.id)}
        <li class="bsp-row">
          <span class="bsp-tag">note</span>
          <span class="bsp-content">{n.content}</span>
          <button class="bsp-x" type="button" onclick={() => removeNote(n.id)} title="Remove note">×</button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if queue.length > 0}
    <ul class="bsp-list bsp-queue">
      {#each queue as q (q.id)}
        <li class="bsp-row">
          <span class="bsp-tag bsp-tag-queue">queued</span>
          <span class="bsp-content">{q.content}</span>
          <button class="bsp-x" type="button" onclick={() => removeQueued(q.id)} title="Cancel injected message">×</button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if shellLine}
    <div class="bsp-shell">
      <div class="bsp-shell-cmd">$ {shellLine.command}</div>
      {#each shellLine.chunks as c, i (i)}
        <div class="bsp-shell-out" class:err={c.stream === 'stderr'}>{c.text}</div>
      {/each}
      {#if shellLine.exitCode !== null}
        <div class="bsp-shell-exit">exit {shellLine.exitCode}</div>
      {/if}
    </div>
  {/if}

  <div class="bsp-input-row">
    <textarea
      class="bsp-input"
      bind:value={input}
      placeholder="Type to inject; prefix `# ` to pin a note; `$ ` to run a shell command; Ctrl+C to interrupt"
      rows="2"
      onkeydown={onKey}
      disabled={!connected || busy}
    ></textarea>
    <div class="bsp-input-actions">
      <button class="bsp-send" type="button" onclick={submit} disabled={!connected || busy || !input.trim()}>Send</button>
      <button class="bsp-int" type="button" onclick={interrupt} disabled={!connected} title="Ctrl+C">Interrupt</button>
    </div>
  </div>
</section>

<style>
  .bsp {
    border: 2px solid var(--text-primary, #1f1c18);
    background: var(--bg, #ede4d4);
    padding: 0.75rem 0.9rem;
    font-family: var(--font-body);
    margin-top: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .bsp-hdr {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    border-bottom: 1px dashed var(--card-border, #d4cfc6);
    padding-bottom: 0.4rem;
  }
  .bsp-title {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
  }
  .bsp-status {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted, #6b675f);
  }
  .bsp-status.connected { color: var(--color-emerald, #10b981); }
  .bsp-err {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--status-error, #c0392b);
    margin-left: auto;
  }
  .bsp-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.25rem; }
  .bsp-row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.5rem;
    align-items: baseline;
    padding: 0.25rem 0.4rem;
    background: color-mix(in srgb, var(--text-primary, #1f1c18) 4%, transparent);
    border-left: 3px solid var(--text-primary, #1f1c18);
  }
  .bsp-tag {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted, #6b675f);
  }
  .bsp-tag-queue { color: var(--accent, #2d7d46); }
  .bsp-content {
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.875rem;
  }
  .bsp-x {
    background: transparent;
    border: 1px solid var(--card-border, #d4cfc6);
    width: 22px;
    height: 22px;
    cursor: pointer;
    padding: 0;
    line-height: 1;
    color: var(--text-muted, #6b675f);
  }
  .bsp-x:hover { color: var(--status-error, #c0392b); border-color: var(--status-error, #c0392b); }
  .bsp-shell {
    border: 1px solid var(--card-border, #d4cfc6);
    padding: 0.4rem 0.6rem;
    font-family: var(--font-mono), monospace;
    font-size: 0.8rem;
  }
  .bsp-shell-cmd { color: var(--accent, #2d7d46); }
  .bsp-shell-out { white-space: pre-wrap; }
  .bsp-shell-out.err { color: var(--status-error, #c0392b); }
  .bsp-shell-exit { color: var(--text-muted, #6b675f); margin-top: 0.25rem; }
  .bsp-input-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.5rem;
    align-items: stretch;
  }
  .bsp-input {
    font-family: var(--font-mono), monospace;
    font-size: 0.85rem;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--text-primary, #1f1c18);
    background: var(--bg, #ede4d4);
    color: var(--text-primary, #1f1c18);
    resize: vertical;
    min-height: 2.5rem;
    box-sizing: border-box;
  }
  .bsp-input:focus { outline: none; border-color: var(--accent, #2d7d46); }
  .bsp-input-actions { display: flex; flex-direction: column; gap: 0.25rem; }
  .bsp-send, .bsp-int {
    font-family: var(--font-mono), monospace;
    font-size: 0.78rem;
    padding: 0.35rem 0.7rem;
    border: 1px solid var(--text-primary, #1f1c18);
    background: var(--text-primary, #1f1c18);
    color: var(--bg, #ede4d4);
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .bsp-send:disabled, .bsp-int:disabled { opacity: 0.4; cursor: not-allowed; }
  .bsp-int { background: var(--bg, #ede4d4); color: var(--text-primary, #1f1c18); }
  .bsp-send:hover:not(:disabled) { background: var(--accent, #2d7d46); border-color: var(--accent, #2d7d46); }
  .bsp-int:hover:not(:disabled) { color: var(--status-error, #c0392b); border-color: var(--status-error, #c0392b); }
</style>
