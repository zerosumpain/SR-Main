<svelte:head><title>Curate — JKAI</title></svelte:head>

<script lang="ts">
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';

  let { data } = $props();

  let sessions = $state(untrack(() => data.sessions));
  let goal = $state('');
  let targetType = $state('');
  let submitting = $state(false);
  let submitError = $state<string | null>(null);
  let selected = $state<Set<string>>(new Set());
  let bulkBusy = $state(false);
  let rowBusyId = $state<string | null>(null);
  let toast = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);

  function showToast(kind: 'ok' | 'err', text: string) {
    toast = { kind, text };
    setTimeout(() => { toast = null; }, 2200);
  }

  function fmtDate(d: string | Date): string {
    const dt = d instanceof Date ? d : new Date(d);
    return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  const STATUS_ACTIVE = ['scoping', 'discovering', 'awaiting-approval', 'generating', 'live-testing', 'awaiting-promotion', 'promoting'];

  function toggleSelected(id: string, e: Event) {
    e.preventDefault();
    e.stopPropagation();
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }
  function selectAll() {
    if (selected.size === sessions.length && sessions.length > 0) selected = new Set();
    else selected = new Set(sessions.map((s: any) => s.id));
  }
  function clearSelection() { selected = new Set(); }

  async function deleteOne(s: any, e: Event) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete session "${s.goal ?? s.targetType ?? s.id}"?\nIts worktree on disk is reaped separately by the hourly cleaner.`)) return;
    rowBusyId = s.id;
    try {
      const r = await fetch(`/api/curate/sessions/${s.id}`, { method: 'DELETE' });
      if (r.ok) {
        sessions = sessions.filter((x: any) => x.id !== s.id);
        showToast('ok', 'Deleted');
      } else {
        showToast('err', 'Delete failed');
      }
    } finally {
      rowBusyId = null;
    }
  }

  async function bulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} session${selected.size === 1 ? '' : 's'}?`)) return;
    bulkBusy = true;
    const ids = Array.from(selected);
    let okCount = 0, errCount = 0;
    for (const id of ids) {
      try {
        const r = await fetch(`/api/curate/sessions/${id}`, { method: 'DELETE' });
        if (r.ok) {
          sessions = sessions.filter((x: any) => x.id !== id);
          okCount++;
        } else errCount++;
      } catch { errCount++; }
    }
    selected = new Set();
    bulkBusy = false;
    showToast(errCount === 0 ? 'ok' : 'err', `Deleted ${okCount}${errCount ? ` · ${errCount} failed` : ''}`);
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    const msg = goal.trim();
    if (!msg) return;
    submitting = true;
    submitError = null;
    try {
      const res = await fetch('/api/curate/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initialMessage: msg,
          ...(targetType.trim() ? { targetType: targetType.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        submitError = body.message ?? `HTTP ${res.status}`;
        return;
      }
      const { sessionId } = await res.json();
      await goto(`/jkai/curate/${sessionId}`);
    } catch (err) {
      submitError = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      submitting = false;
    }
  }
</script>

<div class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">JKAI / Curate</div>
      <h1>curate a node</h1>
      <p class="sub">
        Describe what you need. The engine will scope the goal, research
        existing patterns, generate a workflow node, run live tests, and
        promote it — guided by you at every gate.
      </p>
    </div>
    <a class="back-link" href="/jkai">← jkai</a>
  </header>

  <!-- New curate form -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">new curate session</span>
    </div>
    <form onsubmit={handleSubmit} class="form-row">
      <div class="form-fields">
        <input
          type="text"
          class="nm-text-input"
          placeholder="Describe the node you want to build…"
          bind:value={goal}
          disabled={submitting}
          required
        />
        <input
          type="text"
          class="nm-text-input type-input"
          placeholder="target type (optional, e.g. apple-calendar)"
          bind:value={targetType}
          disabled={submitting}
        />
      </div>
      <button type="submit" class="nm-save-btn" disabled={submitting || !goal.trim()}>
        {submitting ? 'Starting…' : 'Start'}
      </button>
    </form>
    {#if submitError}
      <div class="form-error">{submitError}</div>
    {/if}
  </section>

  <!-- Active sessions -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">active sessions</span>
      <span class="nm-sec-meta">{sessions.length} session{sessions.length === 1 ? '' : 's'}</span>
    </div>

    {#if sessions.length === 0}
      <div class="empty">No active sessions. Start one above.</div>
    {:else}
      <div class="bulk-bar" class:visible={selected.size > 0}>
        <button class="link" type="button" onclick={selectAll}>
          {selected.size === sessions.length && sessions.length > 0 ? 'Deselect all' : 'Select all'}
        </button>
        <span class="dim">{selected.size} selected</span>
        <span class="spacer"></span>
        <button class="link danger" type="button" onclick={bulkDelete} disabled={bulkBusy}>
          {bulkBusy ? 'Deleting…' : `Delete ${selected.size}`}
        </button>
        <button class="link" type="button" onclick={clearSelection}>Cancel</button>
      </div>
      <div class="session-list">
        {#each sessions as s (s.id)}
          {@const isSelected = selected.has(s.id)}
          {@const isBusy = rowBusyId === s.id}
          <div class="session-row" class:selected={isSelected}>
            <button
              class="row-check"
              type="button"
              aria-label={isSelected ? 'Deselect' : 'Select'}
              aria-pressed={isSelected}
              onclick={(e) => toggleSelected(s.id, e)}
            >
              {#if isSelected}✓{:else}&nbsp;{/if}
            </button>
            <a class="session-link" href="/jkai/curate/{s.id}">
              <div class="session-main">
                <div class="session-goal">{s.goal ?? s.targetType ?? 'Untitled session'}</div>
                <div class="session-meta">
                  <code class="type-chip">{s.targetType}</code>
                  <span class="dot">·</span>
                  <span>{fmtDate(s.createdAt)}</span>
                </div>
              </div>
              <span class="status-pill" data-status={s.status}>{s.status}</span>
            </a>
            <button
              type="button"
              class="row-del"
              title="Delete session"
              aria-label="Delete session"
              disabled={isBusy}
              onclick={(e) => deleteOne(s, e)}
            >✕</button>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  {#if toast}
    <div class="toast" data-kind={toast.kind}>{toast.text}</div>
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

  .page-hdr {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 1.5rem;
    margin-bottom: 1.75rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid var(--text-primary);
  }
  .kicker {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--accent);
    margin-bottom: 0.35rem;
  }
  .page-hdr h1 {
    margin: 0;
    font-family: var(--font-brand);
    font-size: 1.75rem;
    font-weight: 500;
    line-height: 1.1;
    color: var(--text-primary);
    text-transform: lowercase;
    letter-spacing: -0.01em;
    display: inline-flex;
    align-items: baseline;
    gap: 0.45ch;
  }
  .page-hdr h1::before {
    content: '>';
    color: var(--accent);
    opacity: 0.7;
    font-weight: 500;
  }
  .sub {
    margin: 0.6rem 0 0;
    font-size: 0.9rem;
    line-height: 1.5;
    color: var(--text-secondary);
    max-width: 62ch;
  }
  .back-link {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent);
    text-decoration: none;
    flex-shrink: 0;
  }
  .back-link:hover { text-decoration: underline; }

  /* form */
  .form-row {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
  }
  .form-fields {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    min-width: 0;
  }
  .type-input { font-size: 11px; }

  .form-error {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--status-error);
    margin-top: 0.4rem;
  }

  /* bulk-bar (mirrors the /builds bulk-bar) */
  .bulk-bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.5rem;
    background: var(--bg);
    border: 1px solid var(--card-border);
    visibility: hidden;
    opacity: 0;
    transition: opacity 100ms ease;
  }
  .bulk-bar.visible { visibility: visible; opacity: 1; }
  .bulk-bar .spacer { flex: 1; }
  .link {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    background: none;
    border: none;
    color: var(--text-primary);
    cursor: pointer;
    padding: 0.25rem 0.4rem;
  }
  .link:disabled { opacity: 0.5; cursor: not-allowed; }
  .link.danger { color: #b43232; }
  .link:hover { text-decoration: underline; }
  .dim {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  /* session list */
  .session-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .session-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.5rem;
    border-bottom: 1px solid var(--divider);
    color: var(--text-primary);
    transition: background 0.1s;
  }
  .session-row:last-child { border-bottom: none; }
  .session-row:hover { background: var(--accent-tint-04); }
  .session-row.selected { background: var(--accent-tint-08); }

  .row-check {
    width: 18px;
    height: 18px;
    border: 1px solid var(--card-border);
    background: var(--bg);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--accent);
    padding: 0;
    flex-shrink: 0;
    transition: border-color 80ms ease;
  }
  .row-check:hover { border-color: var(--text-primary); }
  .session-row.selected .row-check { background: var(--accent); border-color: var(--accent); color: var(--bg); }

  .session-link {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex: 1;
    min-width: 0;
    text-decoration: none;
    color: inherit;
  }

  .row-del {
    flex-shrink: 0;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 1px solid rgba(180, 50, 50, 0.4);
    background: transparent;
    color: #b43232;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1;
    transition: all 80ms ease;
  }
  .row-del:hover:not(:disabled) {
    background: #b43232;
    color: white;
    border-color: #b43232;
  }
  .row-del:disabled { opacity: 0.4; cursor: not-allowed; }

  .toast {
    position: fixed;
    bottom: 1.5rem;
    left: 50%;
    transform: translateX(-50%);
    padding: 0.55rem 0.9rem;
    background: var(--text-primary);
    color: var(--bg);
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    border: 1px solid var(--text-primary);
    z-index: 100;
  }
  .toast[data-kind="err"] { background: #b43232; border-color: #b43232; color: white; }

  .session-main { flex: 1; min-width: 0; }
  .session-goal {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .session-meta {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
    margin-top: 2px;
  }
  .dot { opacity: 0.4; }
  .type-chip {
    font-size: 10px;
    font-family: var(--font-mono);
    background: var(--accent-tint-08);
    border: 1px solid var(--accent-tint-25);
    padding: 1px 5px;
    border-radius: 2px;
    color: var(--accent);
  }

  .empty {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-ghost);
    padding: 0.5rem 0;
  }

  /* status pill */
  .status-pill {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 2px 7px;
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
</style>
