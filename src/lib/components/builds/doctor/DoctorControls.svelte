<script lang="ts">
  // The workflow doctor's switches, "Run now" and undo list — owner only.
  // Folded in from the retired /admin/ai/doctor page (2026-10-02); every write
  // still goes through /api/admin/doctor/*, which hooks.server.ts owner-gates.
  // The page renders this only for the owner, and a member's load never
  // carries the findings it lists.
  import { invalidateAll } from '$app/navigation';
  import type { FindingView } from '$lib/workflows/doctor-client';

  type Switch = 'enabled' | 'autoApply' | 'breaker';

  let {
    switches,
    schedule,
    caps,
    running: serverRunning,
    findings,
  }: {
    switches: { enabled: boolean; autoApply: boolean; breaker: boolean };
    schedule: { display: string };
    caps: { breakerFailures: number; workflows: number; fixes: number; quietHours: number };
    running: boolean;
    findings: FindingView[];
  } = $props();

  // The undo list: only a fix that is still in effect can be taken back.
  const applied = $derived(findings.filter((f) => f.status === 'auto_fixed'));
  const open = $derived(findings.filter((f) => f.status === 'proposed' || f.status === 'refused_sensitive'));

  let toggling = $state<Switch | null>(null);
  let toggleError = $state('');
  let starting = $state(false);
  let runError = $state('');
  let busyKey = $state<string | null>(null);
  let findingError = $state('');
  let findingNote = $state('');
  let noteScope = $state<'applied' | 'open' | null>(null);

  // `serverRunning` is the server's truth; `startedHere` covers the gap between
  // clicking Run now and the first reload landing.
  let startedHere = $state(false);
  const running = $derived(serverRunning || startedHere);

  // Re-load every 10s ONLY while a run is live; the handle is a local const
  // torn down on cleanup (svelte5-pitfalls rule 1).
  $effect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      void refresh();
    }, 10_000);
    return () => clearInterval(timer);
  });

  async function refresh() {
    try {
      await invalidateAll();
      startedHere = false;
    } catch {
      /* transient — the next tick retries */
    }
  }

  async function setSwitch(field: Switch, next: boolean) {
    if (field === 'autoApply' && next) {
      const ok = confirm(
        'Arm auto-apply?\n\nThe doctor will edit workflow node configuration unattended at ' +
          `${schedule.display}, without asking. It stays inside the fix whitelist and reverts ` +
          'anything that does not measurably improve, but the writes are real.',
      );
      if (!ok) return;
    }
    toggling = field;
    toggleError = '';
    try {
      const res = await fetch('/api/admin/doctor/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) await invalidateAll();
      else toggleError = body.error ?? `Error ${res.status}`;
    } catch {
      toggleError = 'Network error';
    } finally {
      toggling = null;
    }
  }

  async function runNow() {
    starting = true;
    runError = '';
    try {
      const res = await fetch('/api/admin/doctor/run', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        startedHere = true;
        await invalidateAll();
      } else {
        runError = body.error ?? `Error ${res.status}`;
      }
    } catch {
      runError = 'Network error';
    } finally {
      starting = false;
    }
  }

  async function act(f: FindingView, action: 'accept' | 'dismiss' | 'revert') {
    if (action === 'revert') {
      const what =
        f.revertKind === 'schedule'
          ? `Re-enable the schedule on ${subject(f)}?\n\nIt was paused because it failed every run. If the canvas is still broken it will start failing again immediately.`
          : `Undo this fix on ${subject(f)}?\n\nIt restores ${f.changedFields.join(', ') || 'the previous config'} and will 409 rather than overwrite any edit you have made since.`;
      if (!confirm(what)) return;
    }
    busyKey = f.key;
    findingError = '';
    findingNote = '';
    noteScope = action === 'revert' ? 'applied' : 'open';
    try {
      const res = await fetch('/api/admin/doctor/finding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: f.key, action }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        findingNote = body.message ?? `Marked ${body.status ?? action}.`;
        await invalidateAll();
      } else {
        findingError = body.error ?? `Error ${res.status}`;
      }
    } catch {
      findingError = 'Network error';
    } finally {
      busyKey = null;
    }
  }

  function subject(f: FindingView): string {
    return f.canvasSlug ?? f.workflowName;
  }
  function target(f: FindingView): string {
    return f.nodeLabel ?? f.nodeType ?? (f.revertKind === 'schedule' ? 'schedule' : 'run');
  }
  function fmtDateTime(d: string | null | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
</script>

<section class="ctl" id="controls" aria-label="Doctor controls">
  <div class="ctl-hd">
    <span class="ctl-kicker">Controls</span>
    <span class="ctl-meta">owner only · {running ? 'run in progress' : 'idle'}</span>
  </div>

  <div class="ctl-row">
    <label class="sw-row">
      <input type="checkbox" checked={switches.enabled} disabled={toggling !== null}
        onchange={() => setSwitch('enabled', !switches.enabled)} />
      <span>Nightly runs <strong>{switches.enabled ? 'enabled' : 'paused'}</strong></span>
    </label>
    <span class="ctl-hint">Schedule {schedule.display}. Skipped if you were active in the last hour.</span>
    <div class="ctl-run">
      <button type="button" class="ctl-btn" onclick={runNow} disabled={running || starting}>
        {running ? 'Run in progress…' : starting ? 'Starting…' : 'Run now'}
      </button>
      <span class="ctl-hint">Bypasses the idle gate, keeps every budget and write cap.</span>
      {#if runError}<span class="bad">{runError}</span>{/if}
    </div>
  </div>
  {#if toggleError}<p class="bad">{toggleError}</p>{/if}

  <div class="perm">
    <label class="sw-row">
      <input type="checkbox" checked={switches.breaker} disabled={toggling !== null}
        onchange={() => setSwitch('breaker', !switches.breaker)} />
      <span>Circuit breaker <strong>{switches.breaker ? 'armed' : 'off'}</strong> <span class="ctl-hint">on by default</span></span>
    </label>
    <p class="perm-copy">
      Pauses a cron schedule that has failed {caps.breakerFailures} times in a row with no successes in
      between, by setting <code>workflow_schedules.enabled = false</code>. It never touches node
      configuration, and every pause is listed below with an undo.
    </p>
  </div>

  <div class="perm danger">
    <label class="sw-row">
      <input type="checkbox" checked={switches.autoApply} disabled={toggling !== null}
        onchange={() => setSwitch('autoApply', !switches.autoApply)} />
      <span>Auto-apply config fixes <strong>{switches.autoApply ? 'armed' : 'off'}</strong> <span class="ctl-hint">off by default</span></span>
    </label>
    <p class="perm-copy warn">
      Permits unattended writes to workflow definitions. With this on, the {schedule.display} run edits
      <code>workflow_nodes.config</code> on live canvases with no approval step.
    </p>
    <p class="perm-copy">
      Only an explicit switch-on arms it — unset reads as off, and it re-reads that every night. Writes
      stay inside the fix whitelist, are capped at {caps.workflows} canvases / {caps.fixes} fixes a
      night, skip any canvas a human touched in the last {caps.quietHours} hours, refuse outright on a
      node holding a credential, and are reverted immediately if the lint error count does not fall.
    </p>
  </div>

  <div class="ctl-sub" id="applied-fixes">
    <span class="ctl-kicker">Applied fixes · {applied.length} in effect</span>
    {#if noteScope === 'applied' && findingNote}<p class="good">{findingNote}</p>{/if}
    {#if noteScope === 'applied' && findingError}<p class="bad">{findingError}</p>{/if}
    {#if applied.length === 0}
      <p class="ctl-hint">Nothing has been changed automatically.</p>
    {:else}
      <div class="scroll">
        <table>
          <thead><tr><th>Canvas</th><th>Fix</th><th>Changed</th><th>Lint</th><th>Applied</th><th></th></tr></thead>
          <tbody>
            {#each applied as f (f.key)}
              <tr>
                <td><span class="subject">{subject(f)}</span><span class="mono dim">{target(f)}</span></td>
                <td><span class="mono">{f.fixKindLabel}</span><span class="dim">{f.fix}</span></td>
                <!-- Field NAMES only: a before-image is the payload we refuse to republish. -->
                <td class="mono">{f.revertKind === 'schedule' ? 'schedule paused' : f.changedFields.join(', ') || '—'}</td>
                <td class="mono">{f.verifyBefore !== undefined && f.verifyAfter !== undefined ? `${f.verifyBefore} → ${f.verifyAfter}` : '—'}</td>
                <td>{fmtDateTime(f.updatedAt)}</td>
                <td>
                  <button type="button" class="link danger" onclick={() => act(f, 'revert')} disabled={busyKey === f.key || !f.revertKind}>
                    {f.revertKind === 'schedule' ? 'Re-enable' : 'Revert'}
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

  <div class="ctl-sub" id="open-findings">
    <span class="ctl-kicker">Open findings · {open.length}</span>
    {#if noteScope === 'open' && findingNote}<p class="good">{findingNote}</p>{/if}
    {#if noteScope === 'open' && findingError}<p class="bad">{findingError}</p>{/if}
    {#if open.length === 0}
      <p class="ctl-hint">Nothing open. A finding closes itself when its failure stops arriving.</p>
    {:else}
      <div class="scroll">
        <table>
          <thead><tr><th>Canvas</th><th>Kind</th><th>Symptom</th><th>Seen</th><th>Last</th><th></th></tr></thead>
          <tbody>
            {#each open as f (f.key)}
              <tr>
                <td><span class="subject">{subject(f)}</span><span class="mono dim">{target(f)}</span></td>
                <td class="mono">{f.fixKindLabel}</td>
                <td class="prose">
                  <span>{f.symptom}</span>
                  {#if f.status === 'refused_sensitive'}
                    <span class="refusal">
                      Refused: this node holds a credential{f.sensitiveFields?.length ? ` in ${f.sensitiveFields.join(', ')}` : ''}.
                      Delete the node and recreate it — patching it republishes the value through the workflow audit log.
                    </span>
                  {:else}
                    <span class="dim">{f.fix}</span>
                  {/if}
                </td>
                <td class="mono">{f.occurrences}</td>
                <td>{fmtDateTime(f.lastSeen)}</td>
                <td class="acts">
                  <button type="button" class="link" onclick={() => act(f, 'accept')} disabled={busyKey === f.key}>Accept</button>
                  <button type="button" class="link" onclick={() => act(f, 'dismiss')} disabled={busyKey === f.key}>Dismiss</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="ctl-hint">
        Accept records that you intend to fix it yourself; Dismiss stops it being re-proposed. Both verdicts
        stick — a later run updates the occurrence count but not the status.
      </p>
    {/if}
  </div>
</section>

<style>
  .ctl { border: 1px solid var(--line-strong); background: var(--surface-rail); padding: 16px clamp(14px, 2vw, 22px); margin: 18px 0; display: flex; flex-direction: column; gap: 14px; }
  .ctl-hd { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: baseline; }
  .ctl-kicker { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.14em; color: var(--accent-ink); }
  .ctl-meta, .ctl-hint { font-size: var(--fs-label-xs); color: var(--text-muted); }
  .ctl-row { display: flex; flex-wrap: wrap; gap: 10px 22px; align-items: center; }
  .ctl-run { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .sw-row { display: inline-flex; gap: 8px; align-items: center; font-size: var(--fs-nav); color: var(--text-primary); cursor: pointer; }
  .ctl-btn { font: inherit; font-size: var(--fs-nav); padding: 6px 14px; border: 1px solid var(--text-primary); border-radius: 2px; background: var(--text-primary); color: var(--surface-rail); cursor: pointer; }
  .ctl-btn:disabled { opacity: 0.55; cursor: default; }
  .perm { border-top: 1px solid var(--line); padding-top: 12px; }
  .perm.danger strong { color: var(--error); }
  .perm-copy { margin: 6px 0 0; font-size: var(--fs-label-xs); line-height: 1.55; color: var(--text-muted); max-width: 78ch; }
  .perm-copy.warn { color: var(--error); }
  code, .mono { font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .ctl-sub { border-top: 1px solid var(--line); padding-top: 12px; display: flex; flex-direction: column; gap: 8px; }
  .scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: var(--fs-label-xs); }
  th { text-align: left; font-family: var(--font-mono); font-weight: 400; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); border-bottom: 1px solid var(--line-strong); padding: 6px 8px; }
  td { padding: 8px; border-bottom: 1px solid var(--line); vertical-align: top; color: var(--text-primary); }
  .subject { display: block; }
  .dim { display: block; color: var(--text-muted); }
  .prose { min-width: 240px; }
  .refusal { display: block; margin-top: 4px; padding-left: 8px; border-left: 2px solid var(--error); color: var(--error); }
  .acts { white-space: nowrap; }
  .link { font: inherit; background: none; border: 0; padding: 0 6px 0 0; color: var(--accent-ink); text-decoration: underline; cursor: pointer; }
  .link.danger { color: var(--error); }
  .link:disabled { opacity: 0.5; cursor: default; }
  .bad { margin: 0; font-size: var(--fs-label-xs); color: var(--error); }
  .good { margin: 0; font-size: var(--fs-label-xs); color: var(--accent-ink); }
</style>
