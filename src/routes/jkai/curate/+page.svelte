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

  function fmtDate(d: string | Date): string {
    const dt = d instanceof Date ? d : new Date(d);
    return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  const STATUS_ACTIVE = ['scoping', 'discovering', 'awaiting-approval', 'generating', 'live-testing', 'awaiting-promotion', 'promoting'];

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

  {#if !data.isHomeserv}
    <div class="host-banner">
      <strong>Curate is homeserv-only.</strong>
      The production VPS doesn't have a git checkout, so worktrees + branches
      can't be created here. Open this page from homeserv instead:
      <a href="http://homeserv:5173/jkai/curate">http://homeserv:5173/jkai/curate</a>
    </div>
  {/if}

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
      <div class="session-list">
        {#each sessions as s (s.id)}
          <a class="session-row" href="/jkai/curate/{s.id}">
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
        {/each}
      </div>
    {/if}
  </section>
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

  .host-banner {
    background: var(--surface-warn, #fff8e1);
    color: var(--text-primary, #1a1008);
    border: 1px solid var(--accent, #c9a96e);
    border-radius: 4px;
    padding: 0.75rem 1rem;
    margin-bottom: 1rem;
    font-size: 0.9rem;
    line-height: 1.5;
  }
  .host-banner strong { display: block; margin-bottom: 0.25rem; }
  .host-banner a {
    font-family: var(--font-mono);
    color: var(--accent);
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
    gap: 1rem;
    padding: 0.6rem 0.5rem;
    border-bottom: 1px solid var(--divider);
    text-decoration: none;
    color: var(--text-primary);
    transition: background 0.1s;
  }
  .session-row:last-child { border-bottom: none; }
  .session-row:hover { background: var(--accent-tint-04); }

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
