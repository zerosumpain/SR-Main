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
        {#if data.canManage}
          Running on <code>{data.hostname}</code>. Service-control actions are live.
        {:else}
          Read-only view (host <code>{data.hostname}</code> is not the Hermes runtime).
          Visit <code>http://homeserv:5173/admin/hermes</code> to manage services.
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
      <span class="sr-label-tight">Engine sessions</span>
      <a class="nm-sec-meta sessions-link" href="/admin/hermes/sessions">Open inspector →</a>
    </div>
    <p class="sessions-note mono">
      Browse, full-text-search, and read the engine's real session store (with
      jkai-conversation correlation) in the
      <a href="/admin/hermes/sessions">session inspector</a>.
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
    background: var(--accent-hover, #a84808);
    border-color: var(--accent-hover, #a84808);
  }

  /* --- Action result panel --- */
  .result {
    margin-top: 1rem;
    border: 1px solid var(--card-border);
    background: rgba(26, 16, 8, 0.03);
    padding: 8px 10px;
  }
  .result.ok { border-color: var(--accent-tint-35, var(--card-border)); }
  .result.bad { border-color: #c44; }
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
    background: #2a0a0a;
    color: #f4cfcf;
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
</style>
