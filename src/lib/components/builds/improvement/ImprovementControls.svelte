<script lang="ts">
  // The self-improvement engine's switches — owner only. Folded in from the
  // retired /admin/ai/improvement page (2026-10-02): the kill switch, Run now,
  // the API catalogue's Verify, and the self-built tools' enable/disable/delete.
  // Every write still goes through /api/admin/*, which hooks.server.ts
  // owner-gates; the page renders this only for the owner and a member's load
  // never carries the catalogue or tool list.
  import { invalidateAll } from '$app/navigation';

  type ApiView = {
    key: string | null;
    data: { name?: string; baseUrl?: string; status?: string; lastVerifiedAt?: string; auth?: { kind?: string } };
  };
  type ToolView = { name: string; description: string; toolset: string; enabled: boolean; runCount: number; errorCount: number };

  let {
    enabled: serverEnabled,
    schedule,
    running: serverRunning,
    apis: serverApis,
    tools: serverTools,
  }: {
    enabled: boolean;
    schedule: { display: string };
    running: boolean;
    apis: ApiView[];
    tools: ToolView[];
  } = $props();

  // Writable deriveds: edited locally after a write the server accepted, and
  // re-seeded from the server whenever the page data reloads.
  let enabled = $derived(serverEnabled);
  let apis = $derived<ApiView[]>(serverApis);
  let tools = $derived<ToolView[]>(serverTools);

  let startedHere = $state(false);
  const running = $derived(serverRunning || startedHere);

  let starting = $state(false);
  let runError = $state('');
  let toggling = $state(false);
  let toggleError = $state('');
  let verifyingKey = $state<string | null>(null);
  let busyTool = $state<string | null>(null);

  // Poll the cheap status endpoint every 10s ONLY while a run is live, and
  // reload the page data once when it finishes so the ledger shows the run.
  $effect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      void poll();
    }, 10_000);
    return () => clearInterval(timer);
  });

  async function poll() {
    try {
      const res = await fetch('/api/admin/improvement/runs');
      if (!res.ok) return;
      const body = await res.json();
      if (body.status && typeof body.status.running === 'boolean' && !body.status.running) {
        await invalidateAll();
        startedHere = false;
      }
    } catch {
      /* transient — the next tick retries */
    }
  }

  async function runNow() {
    starting = true;
    runError = '';
    try {
      const res = await fetch('/api/admin/improvement/run', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) startedHere = true;
      else runError = body.error ?? `Error ${res.status}`;
    } catch {
      runError = 'Network error';
    } finally {
      starting = false;
    }
  }

  async function toggleEnabled() {
    const next = !enabled;
    toggling = true;
    toggleError = '';
    try {
      const res = await fetch('/api/admin/improvement/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (res.ok) enabled = next;
      else toggleError = `Error ${res.status}`;
    } catch {
      toggleError = 'Network error';
    } finally {
      toggling = false;
    }
  }

  async function verifyApi(key: string | null) {
    if (!key) return;
    verifyingKey = key;
    try {
      const res = await fetch('/api/admin/improvement/verify-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      const body = await res.json().catch(() => ({}));
      if (body.status) {
        apis = apis.map((a) =>
          a.key === key ? { ...a, data: { ...a.data, status: body.status, lastVerifiedAt: body.lastVerifiedAt ?? a.data.lastVerifiedAt } } : a,
        );
      }
    } catch {
      /* status simply won't update */
    } finally {
      verifyingKey = null;
    }
  }

  async function setToolEnabled(name: string, next: boolean) {
    busyTool = name;
    try {
      const res = await fetch(`/api/admin/tools/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (res.ok) tools = tools.map((t) => (t.name === name ? { ...t, enabled: next } : t));
    } catch {
      /* ignore */
    } finally {
      busyTool = null;
    }
  }

  async function deleteTool(name: string) {
    if (!confirm(`Delete the self-built tool "${name}"? This cannot be undone.`)) return;
    busyTool = name;
    try {
      const res = await fetch(`/api/admin/tools/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (res.ok) tools = tools.filter((t) => t.name !== name);
    } catch {
      /* ignore */
    } finally {
      busyTool = null;
    }
  }

  function fmtDate(d: string | undefined): string {
    return d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  }
</script>

<section class="ctl" id="controls" aria-label="Self-improvement controls">
  <div class="ctl-hd">
    <span class="ctl-kicker">Controls</span>
    <span class="ctl-meta">owner only · {running ? 'run in progress' : 'idle'}</span>
  </div>

  <div class="ctl-row">
    <label class="sw-row">
      <input type="checkbox" checked={enabled} disabled={toggling} onchange={toggleEnabled} />
      <span>Nightly runs <strong>{enabled ? 'enabled' : 'paused'}</strong></span>
    </label>
    <span class="ctl-hint">Schedule {schedule.display}.</span>
    <div class="ctl-run">
      <button type="button" class="ctl-btn" onclick={runNow} disabled={running || starting}>
        {running ? 'Run in progress…' : starting ? 'Starting…' : 'Run now'}
      </button>
      <span class="ctl-hint">Bypasses the idle gate, keeps budget caps.</span>
      {#if runError}<span class="bad">{runError}</span>{/if}
    </div>
  </div>
  {#if toggleError}<p class="bad">{toggleError}</p>{/if}

  <details class="ctl-sub">
    <summary><span class="ctl-kicker">API catalogue · {apis.length}</span></summary>
    {#if apis.length === 0}
      <p class="ctl-hint">Catalogue empty — it is seeded when the engine first boots.</p>
    {:else}
      <div class="scroll">
        <table>
          <thead><tr><th>Name</th><th>Status</th><th>Auth</th><th>Verified</th><th></th></tr></thead>
          <tbody>
            {#each apis as api (api.key)}
              <tr>
                <td><span>{api.data.name ?? api.key}</span>{#if api.data.baseUrl}<span class="mono dim">{api.data.baseUrl}</span>{/if}</td>
                <td class="mono">{api.data.status ?? 'seeded'}</td>
                <td class="mono">{api.data.auth?.kind ?? 'none'}</td>
                <td class="mono">{fmtDate(api.data.lastVerifiedAt)}</td>
                <td><button type="button" class="link" onclick={() => verifyApi(api.key)} disabled={verifyingKey === api.key}>{verifyingKey === api.key ? 'Verifying…' : 'Verify'}</button></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </details>

  <details class="ctl-sub">
    <summary><span class="ctl-kicker">Self-built tools · {tools.length}</span></summary>
    {#if tools.length === 0}
      <p class="ctl-hint">The engine has not built any runtime tools yet.</p>
    {:else}
      <div class="scroll">
        <table>
          <thead><tr><th>Name</th><th>Toolset</th><th>Runs</th><th>Errors</th><th>State</th><th></th></tr></thead>
          <tbody>
            {#each tools as t (t.name)}
              <tr>
                <td><span class="mono">{t.name}</span>{#if t.description}<span class="dim">{t.description}</span>{/if}</td>
                <td class="mono">{t.toolset}</td>
                <td class="mono">{t.runCount}</td>
                <td class="mono">{t.errorCount}</td>
                <td class="mono">{t.enabled ? 'enabled' : 'disabled'}</td>
                <td class="acts">
                  <button type="button" class="link" onclick={() => setToolEnabled(t.name, !t.enabled)} disabled={busyTool === t.name}>{t.enabled ? 'Disable' : 'Enable'}</button>
                  <button type="button" class="link danger" onclick={() => deleteTool(t.name)} disabled={busyTool === t.name}>Delete</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="ctl-hint">
        Tools the engine ships are enabled and registered live. Manually re-enabling a disabled tool takes
        effect after the next process restart (in-memory registry).
      </p>
    {/if}
  </details>
</section>

<style>
  .ctl { border: 1px solid var(--line-strong); background: var(--surface-rail); padding: 16px clamp(14px, 2vw, 22px); display: flex; flex-direction: column; gap: 14px; }
  .ctl-hd { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: baseline; }
  .ctl-kicker { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.14em; color: var(--accent-ink); }
  .ctl-meta, .ctl-hint { font-size: var(--fs-label-xs); color: var(--text-muted); }
  .ctl-row { display: flex; flex-wrap: wrap; gap: 10px 22px; align-items: center; }
  .ctl-run { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .sw-row { display: inline-flex; gap: 8px; align-items: center; font-size: var(--fs-nav); color: var(--text-primary); cursor: pointer; }
  .ctl-btn { font: inherit; font-size: var(--fs-nav); padding: 6px 14px; border: 1px solid var(--text-primary); border-radius: 2px; background: var(--text-primary); color: var(--surface-rail); cursor: pointer; }
  .ctl-btn:disabled { opacity: 0.55; cursor: default; }
  .ctl-sub { border-top: 1px solid var(--line); padding-top: 12px; }
  .ctl-sub summary { cursor: pointer; }
  .mono { font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .scroll { overflow-x: auto; margin-top: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: var(--fs-label-xs); }
  th { text-align: left; font-family: var(--font-mono); font-weight: 400; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); border-bottom: 1px solid var(--line-strong); padding: 6px 8px; }
  td { padding: 8px; border-bottom: 1px solid var(--line); vertical-align: top; color: var(--text-primary); }
  .dim { display: block; color: var(--text-muted); max-width: 48ch; overflow: hidden; text-overflow: ellipsis; }
  .acts { white-space: nowrap; }
  .link { font: inherit; background: none; border: 0; padding: 0 6px 0 0; color: var(--accent-ink); text-decoration: underline; cursor: pointer; }
  .link.danger { color: var(--error); }
  .link:disabled { opacity: 0.5; cursor: default; }
  .bad { margin: 0; font-size: var(--fs-label-xs); color: var(--error); }
</style>
