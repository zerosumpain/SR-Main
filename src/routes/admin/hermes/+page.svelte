<svelte:head><title>Hermes — Admin</title></svelte:head>
<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';

  let { data, form } = $props();

  type ServiceState = 'active' | 'inactive' | 'failed' | 'activating' | 'unknown';
  type ActionForm = {
    action?: string;
    ok?: boolean;
    stdout?: string;
    stderr?: string;
    durationMs?: number;
    exitCode?: number | null;
  } | null;

  let pending = $state<string | null>(null);
  const result = $derived(form as ActionForm);

  function fmtMs(ms: number): string {
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  }
  function fmtNum(n: number): string {
    return (n ?? 0).toLocaleString();
  }
  function fmtTok(n: number): string {
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
    return String(n ?? 0);
  }
  function stateLabel(s: ServiceState): string {
    return s === 'active' ? 'running' : s === 'inactive' ? 'stopped' : s;
  }

  // SvelteKit's `enhance` calls the callback with { formData, ... } and returns
  // a fn that runs after the response is received. We use it to flip `pending`
  // and refresh `load` so the service-state pills update post-action.
  function submitFn(action: string) {
    return () => {
      pending = action;
      return async ({ update }: { update: (opts?: { reset?: boolean }) => Promise<void> }) => {
        await update({ reset: false });
        await invalidateAll();
        pending = null;
      };
    };
  }
</script>

<div class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">Hermes</div>
      <h1>Engine sessions, health, service control</h1>
      <p class="sub">
        {#if data.direct}
          Running on <code>{data.hostname}</code>. Service-control actions are live.
        {:else if data.canManage}
          Proxying to homeserv over Tailscale (this host: <code>{data.hostname}</code>). Reads + actions are live.
        {:else}
          Unavailable — host <code>{data.hostname}</code> has no homeserv route configured.
        {/if}
      </p>
    </div>
    <a class="back-link" href="/admin">← Admin</a>
  </header>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Service control</span>
      <span class="nm-sec-meta">
        {data.version ?? 'unknown version'}
      </span>
    </div>

    <div class="svc-grid">
      <div class="svc">
        <span class="svc-name mono">jkai-hermes</span>
        <span class="dot {data.services.gateway === 'active' ? 'ok' : data.services.gateway === 'failed' ? 'bad' : 'off'}"></span>
        <span class="svc-state mono">{stateLabel(data.services.gateway)}</span>
      </div>
      <div class="svc">
        <span class="svc-name mono">jkai-hermes-dashboard</span>
        <span class="dot {data.services.dashboard === 'active' ? 'ok' : data.services.dashboard === 'failed' ? 'bad' : 'off'}"></span>
        <span class="svc-state mono">{stateLabel(data.services.dashboard)}</span>
      </div>
    </div>

    <div class="btn-row">
      <form method="POST" action="?/restart_gateway" use:enhance={submitFn('restart_gateway')}>
        <button class="nm-save-btn" disabled={!data.canManage || pending !== null}>
          {pending === 'restart_gateway' ? '…' : 'Restart gateway'}
        </button>
      </form>
      <form method="POST" action="?/restart_dashboard" use:enhance={submitFn('restart_dashboard')}>
        <button class="nm-save-btn" disabled={!data.canManage || pending !== null}>
          {pending === 'restart_dashboard' ? '…' : 'Restart dashboard'}
        </button>
      </form>
      <form method="POST" action="?/restart_all" use:enhance={submitFn('restart_all')}>
        <button class="nm-save-btn" disabled={!data.canManage || pending !== null}>
          {pending === 'restart_all' ? '…' : 'Restart all'}
        </button>
      </form>
      <span class="btn-sep"></span>
      <form method="POST" action="?/update_check" use:enhance={submitFn('update_check')}>
        <button class="nm-save-btn ghost" disabled={!data.canManage || pending !== null}>
          {pending === 'update_check' ? '…' : 'Check update'}
        </button>
      </form>
      <form method="POST" action="?/update_hermes" use:enhance={submitFn('update_hermes')}>
        <button
          class="nm-save-btn primary"
          disabled={!data.canManage || pending !== null}
          onclick={(e) => {
            if (!confirm('Run `hermes update --yes --no-backup` and restart both services? This can take 1–3 minutes.')) e.preventDefault();
          }}
        >
          {pending === 'update_hermes' ? 'updating…' : 'Update Hermes'}
        </button>
      </form>
    </div>

    {#if result?.action}
      <div class="result {result.ok ? 'ok' : 'bad'}">
        <div class="result-hd mono">
          <span class="dot {result.ok ? 'ok' : 'bad'}"></span>
          <span>{result.action}</span>
          <span class="result-meta">
            {result.ok ? 'ok' : `exit ${result.exitCode ?? '?'}`} · {fmtMs(result.durationMs ?? 0)}
          </span>
        </div>
        {#if result.stdout}
          <pre class="result-out">{result.stdout}</pre>
        {/if}
        {#if result.stderr && result.stderr.trim()}
          <pre class="result-err">{result.stderr}</pre>
        {/if}
      </div>
    {/if}
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Health</span>
      <span class="nm-sec-meta">jkai platform</span>
    </div>
    {#if data.health}
      <div class="line ok">
        <span class="dot ok"></span>
        <span class="mono">platform: OK (ts={data.health.ts})</span>
      </div>
    {:else}
      <div class="line bad">
        <span class="dot bad"></span>
        <span class="mono">platform: unreachable</span>
      </div>
    {/if}

    <div class="line">
      <span class="dot {data.flagEnabled ? 'ok' : 'off'}"></span>
      <span class="mono">
        flag <code>JKAI_HERMES_CANVAS_CHAT</code>: {data.flagEnabled ? 'on' : 'off'}
      </span>
    </div>
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Telemetry</span>
      <span class="tele-days">
        {#each [7, 30, 90] as d (d)}
          <a class="day-pill" class:active={data.telemetryDays === d} href={`?days=${d}`} data-sveltekit-noscroll>{d}d</a>
        {/each}
      </span>
    </div>

    {#if !data.telemetry}
      <p class="tele-note mono">
        Telemetry reads the engine's session store on the Hermes host — open
        <code>http://homeserv:5173/admin/hermes</code> to see it.
      </p>
    {:else}
      {@const t = data.telemetry}
      <div class="stat-grid">
        <div class="stat"><span class="stat-v">{fmtNum(t.overview.sessions)}</span><span class="stat-l">sessions</span></div>
        <div class="stat"><span class="stat-v">{fmtNum(t.overview.messages)}</span><span class="stat-l">messages</span></div>
        <div class="stat"><span class="stat-v">{fmtNum(t.overview.toolCalls)}</span><span class="stat-l">tool calls</span></div>
        <div class="stat"><span class="stat-v">{fmtTok(t.overview.inputTokens)}</span><span class="stat-l">input tok</span></div>
        <div class="stat"><span class="stat-v">{fmtTok(t.overview.outputTokens)}</span><span class="stat-l">output tok</span></div>
        <div class="stat"><span class="stat-v">${t.overview.costUsd.toFixed(2)}</span><span class="stat-l">est. cost</span></div>
      </div>

      {#if t.activity.length > 0}
        {@const peak = Math.max(...t.activity.map((a) => a.sessions), 1)}
        <div class="spark" role="img" aria-label="sessions per day">
          {#each t.activity as a (a.day)}
            <div class="spark-col" title={`${a.day}: ${a.sessions} sessions`}>
              <div class="spark-bar" style={`height:${Math.max(6, Math.round((a.sessions / peak) * 100))}%`}></div>
            </div>
          {/each}
        </div>
        <div class="spark-cap mono">sessions/day · last {t.days}d</div>
      {/if}

      <div class="tele-cols">
        <div class="tele-col">
          <div class="tele-col-h mono">Models</div>
          {#each t.byModel as m (m.model)}
            <div class="tele-row"><span class="tr-name mono">{m.model}</span><span class="tr-v mono">{m.sessions} · ${m.costUsd.toFixed(2)}</span></div>
          {/each}
        </div>
        <div class="tele-col">
          <div class="tele-col-h mono">Tools</div>
          {#each t.topTools as tool (tool.tool)}
            <div class="tele-row"><span class="tr-name mono">{tool.tool}</span><span class="tr-v mono">{fmtNum(tool.calls)}</span></div>
          {/each}
        </div>
        <div class="tele-col">
          <div class="tele-col-h mono">Platforms</div>
          {#each t.byPlatform as p (p.source)}
            <div class="tele-row"><span class="tr-name mono">{p.source}</span><span class="tr-v mono">{p.sessions} · ${p.costUsd.toFixed(2)}</span></div>
          {/each}
        </div>
      </div>

      {#if t.topSessions.length > 0}
        <div class="tele-col-h mono costliest-h">Costliest sessions</div>
        {#each t.topSessions as s (s.id)}
          <a class="tele-row link" href={`/admin/hermes/sessions/${s.id}`}>
            <span class="tr-name">{s.title || '(untitled)'}</span>
            <span class="tr-v mono">{s.messageCount} msg · {s.costUsd != null ? `$${s.costUsd.toFixed(2)}` : '—'}</span>
          </a>
        {/each}
      {/if}
    {/if}

    {#if data.curator}
      <details class="curator">
        <summary class="mono">curator status</summary>
        <pre>{data.curator}</pre>
      </details>
    {/if}
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Engine sessions</span>
      <a class="nm-sec-meta sessions-link" href="/admin/hermes/sessions">Open inspector →</a>
    </div>
    <p class="sessions-note mono">
      Browse, full-text-search, and read the engine's real session store (with
      jkai-conversation correlation) in the
      <a href="/admin/hermes/sessions">session inspector</a>.
    </p>
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Cron jobs</span>
      <a class="nm-sec-meta sessions-link" href="/admin/hermes/cron">Open cron →</a>
    </div>
    <p class="sessions-note mono">
      Schedule engine jobs — reminders, watchdogs, recurring agent runs — on the
      <a href="/admin/hermes/cron">cron authoring panel</a>. Distinct from the
      Postgres workflow schedules at <a href="/admin/scheduled">/admin/scheduled</a>.
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

  .sessions-link { color: var(--accent); text-decoration: none; }
  .sessions-link:hover { text-decoration: underline; }
  .sessions-note { font-size: 0.85rem; color: var(--text-secondary); margin: 0.4rem 0 0; }
  .sessions-note a { color: var(--accent); text-decoration: none; }
  .sessions-note a:hover { text-decoration: underline; }

  /* ── Telemetry ── */
  .tele-days { display: inline-flex; gap: 0.3rem; }
  .day-pill { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.15rem 0.45rem; border: 1px solid var(--card-border); border-radius: 4px; color: var(--text-secondary); text-decoration: none; }
  .day-pill.active { color: var(--bg); background: var(--accent); border-color: var(--accent); }
  .tele-note { font-size: 0.85rem; color: var(--text-secondary); margin: 0.6rem 0 0; }
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 0.6rem; margin: 0.8rem 0; }
  .stat { display: flex; flex-direction: column; gap: 0.15rem; padding: 0.6rem 0.7rem; border: 1px solid var(--card-border); border-radius: var(--radius-round); background: var(--bg-section); }
  .stat-v { font-family: var(--font-mono); font-size: 1.15rem; color: var(--text-primary); font-weight: 600; }
  .stat-l { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
  .spark { display: flex; align-items: flex-end; gap: 2px; height: 48px; margin-top: 0.4rem; }
  .spark-col { flex: 1; height: 100%; display: flex; align-items: flex-end; }
  .spark-bar { width: 100%; background: var(--accent); border-radius: 2px 2px 0 0; opacity: 0.8; min-height: 3px; }
  .spark-cap { font-size: 10px; color: var(--text-ghost, var(--text-muted)); margin-top: 0.25rem; }
  .tele-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem 1.5rem; margin-top: 1rem; }
  .tele-col-h { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); margin-bottom: 0.35rem; }
  .costliest-h { margin-top: 1rem; }
  .tele-row { display: flex; justify-content: space-between; align-items: baseline; gap: 0.8rem; padding: 0.25rem 0; border-bottom: 1px solid var(--card-border); font-size: 12px; }
  .tele-row:last-child { border-bottom: none; }
  .tr-name { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tr-v { color: var(--text-primary); white-space: nowrap; flex-shrink: 0; }
  a.tele-row.link { text-decoration: none; }
  a.tele-row.link:hover { background: var(--bg-section); }
  a.tele-row.link .tr-name { color: var(--accent); }
  .curator { margin-top: 1rem; }
  .curator summary { font-size: 11px; color: var(--text-secondary); cursor: pointer; }
  .curator pre { margin: 0.5rem 0 0; font-size: 11px; line-height: 1.45; color: var(--text-secondary); background: var(--bg-section); border: 1px solid var(--card-border); border-radius: var(--radius-round); padding: 0.7rem; overflow-x: auto; white-space: pre-wrap; word-break: break-word; max-height: 22rem; overflow-y: auto; }

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
  .dot.bad { background: var(--error); }
  .dot.off { background: var(--text-ghost); }
  .line.bad .mono { color: var(--error); }

  /* --- Service control --- */
  .svc-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 0.5rem 1rem;
    margin-bottom: 0.9rem;
  }
  .svc {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 6px 10px;
    background: rgba(26, 16, 8, 0.04);
    border: 1px solid var(--card-border);
  }
  .svc-name { flex: 1; min-width: 0; }
  .svc-state {
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 10px;
  }

  .btn-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }
  .btn-row form { margin: 0; }
  .btn-sep {
    width: 1px;
    height: 24px;
    background: var(--card-border);
    margin: 0 0.3rem;
  }
  .nm-save-btn {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 6px 11px;
    background: var(--text-primary);
    color: var(--bg);
    border: 1px solid var(--text-primary);
    border-radius: 2px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .nm-save-btn:hover:not(:disabled) {
    background: var(--accent);
    border-color: var(--accent);
  }
  .nm-save-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .nm-save-btn.ghost {
    background: transparent;
    color: var(--text-primary);
  }
  .nm-save-btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .nm-save-btn.primary:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }

  /* --- Action result panel --- */
  .result {
    margin-top: 1rem;
    border: 1px solid var(--card-border);
    background: rgba(26, 16, 8, 0.03);
    padding: 8px 10px;
  }
  .result.ok { border-color: var(--accent-tint-35); }
  .result.bad { border-color: var(--error); }
  .result-hd {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 11px;
    color: var(--text-secondary);
  }
  .result-meta {
    margin-left: auto;
    color: var(--text-ghost);
    font-size: 10px;
  }
  .result-out, .result-err {
    margin: 6px 0 0;
    padding: 8px 10px;
    background: var(--code-bg);
    color: var(--code-text);
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.45;
    border-radius: 2px;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 360px;
    overflow: auto;
  }
  .result-err {
    background: var(--error-bg);
    color: var(--error);
  }

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
    background: var(--accent-tint-08);
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
</style>
