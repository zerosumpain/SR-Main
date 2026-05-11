<svelte:head><title>Hermes — Admin</title></svelte:head>
<script lang="ts">
  let { data } = $props();

  type SessionRow = {
    id: number;
    hermesSessionId: string;
    kind: 'build' | 'canvas_chat' | 'curate' | 'manual';
    kindId: string;
    createdAt: string | Date;
  };

  const openSessions = data.openSessions as SessionRow[];
  const health = data.health as { ok: boolean; ts: number } | null;
  const flagEnabled = data.flagEnabled as boolean;

  function fmtDate(d: string | Date): string {
    const dt = typeof d === 'string' ? new Date(d) : d;
    return dt.toLocaleString();
  }
</script>

<div class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">Hermes</div>
      <h1>Engine sessions, health, flag state</h1>
      <p class="sub">
        Read-only view of the <code>jkai-hermes</code> gateway. Open sessions are
        tracked in Postgres (<code>hermes_sessions</code>); platform health is
        probed live against <code>{'/platforms/jkai/health'}</code>.
      </p>
    </div>
    <a class="back-link" href="/admin">← Admin</a>
  </header>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Health</span>
      <span class="nm-sec-meta">jkai platform</span>
    </div>
    {#if health}
      <div class="line ok">
        <span class="dot ok"></span>
        <span class="mono">platform: OK (ts={health.ts})</span>
      </div>
    {:else}
      <div class="line bad">
        <span class="dot bad"></span>
        <span class="mono">platform: unreachable</span>
      </div>
    {/if}

    <div class="line">
      <span class="dot {flagEnabled ? 'ok' : 'off'}"></span>
      <span class="mono">
        flag <code>JKAI_HERMES_CANVAS_CHAT</code>: {flagEnabled ? 'on' : 'off'}
      </span>
    </div>
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Open sessions</span>
      <span class="nm-sec-meta">
        {openSessions.length} {openSessions.length === 1 ? 'session' : 'sessions'}
      </span>
    </div>

    {#if openSessions.length === 0}
      <div class="empty mono">No open Hermes sessions.</div>
    {:else}
      <ul class="rows">
        {#each openSessions as s (s.id)}
          <li class="row">
            <span class="kind-pill mono">{s.kind}</span>
            <span class="mono kind-id">{s.kindId}</span>
            <span class="mono session-id">{s.hermesSessionId}</span>
            <span class="mono created">{fmtDate(s.createdAt)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Skills / Memory / Providers</span>
    </div>
    <p class="stub">
      Phase 1 read-only stub. Full management UI lands in later phases.
    </p>
  </section>
</div>

<style>
  .wrap {
    max-width: 980px;
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
    font-size: 0.95rem;
    line-height: 1.45;
    color: var(--text-secondary);
    max-width: 60ch;
  }
  .sub code, code {
    font-family: var(--font-mono);
    font-size: 0.85em;
    background: var(--code-bg);
    color: var(--code-text);
    padding: 0.08rem 0.38rem;
    border-radius: 2px;
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

  .mono {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-primary);
  }

  .line {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 4px 0;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-ghost);
    flex-shrink: 0;
  }
  .dot.ok { background: var(--accent); }
  .dot.bad { background: #c44; }
  .dot.off { background: var(--text-ghost); }
  .line.bad .mono { color: #c44; }

  .empty {
    color: var(--text-ghost);
    padding: 6px 0;
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .row {
    display: grid;
    grid-template-columns: 110px minmax(0, 1fr) minmax(0, 1.5fr) auto;
    gap: 0.9rem;
    align-items: center;
    padding: 6px 8px;
    background: rgba(26, 16, 8, 0.04);
    border: 1px solid var(--card-border);
  }
  .kind-pill {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
    background: var(--accent-tint-08, rgba(0, 0, 0, 0.04));
    padding: 2px 6px;
    border: 1px solid var(--card-border);
    text-align: center;
  }
  .kind-id, .session-id {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .session-id { color: var(--text-secondary); }
  .created {
    color: var(--text-ghost);
    font-size: 11px;
    white-space: nowrap;
  }

  @media (max-width: 720px) {
    .row {
      grid-template-columns: 1fr;
      gap: 2px;
    }
  }

  .stub {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-ghost);
    padding: 4px 0;
  }
</style>
