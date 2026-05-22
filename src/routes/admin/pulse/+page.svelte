<svelte:head><title>Pulse — Admin</title></svelte:head>
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  let { data } = $props();

  type LiveSnapshot = {
    now: number;
    orchestratorJobs: Array<{
      id: string;
      status: string;
      phase: string;
      currentStep: string | null;
      elapsedMs: number;
      startedAt: number;
      lastEventAt: number;
      lastHeartbeatAt: number;
      idleMs: number;
      idleKillInMs: number;
      hardKillInMs: number;
      nextHeartbeatInMs: number;
      workflowId: string | null;
      conversationId: string | null;
      chatNodeId: string | null;
      message: string;
    }>;
    followUps: Array<{
      id: string;
      taskType: string;
      taskId: string;
      conversationId: string;
      retries: number;
      dueAt: number;
      dueInMs: number;
      projectedNextBackoffMs: number;
    }>;
    activeRuns: Array<{
      id: string;
      workflowId: string;
      workflowName: string;
      status: string;
      trigger: string;
      startedAt: string | null;
      heartbeatAt: string | null;
      pausedAtNodeId: string | null;
    }>;
    cronJobs: Array<{ scheduleId: string; nextRunMs: number | null; paused: boolean }>;
    recentPulses: Array<{
      ts: number;
      jobId: string;
      kind: 'heartbeat' | 'phase_change' | 'watchdog_kill' | 'job_start' | 'job_done' | 'job_error';
      phase: string;
      summary: string;
      elapsedMs: number;
    }>;
    thresholds: {
      heartbeatIntervalMs: number;
      idleTimeoutMs: number;
      hardTimeoutMs: number;
      followupWorkerIntervalMs: number;
      followupBaseIntervalMs: number;
      followupMaxRetries: number;
    };
    engine: { activeRuns: number; queued: number; cap: number; loopMaxMs: number };
    healthSync: Array<{
      service: string;
      status: string;
      lastSyncAt: number;
      lastSuccessfulSyncAt: number | null;
      recordsSynced: number | null;
      errorMessage: string | null;
    }>;
  };

  type Schedule = {
    id: string;
    workflowId: string;
    workflowName: string;
    type: string;
    expression: string | null;
    enabled: boolean;
    lastRunAt: string | null;
    nextRunAt: string | null;
  };

  type FeedItem = {
    ts: number;
    kind: string;
    source: string;
    summary: string;
    status: string | null;
    durationMs: number | null;
    link: string | null;
    raw: Record<string, unknown>;
  };

  let live = $state<LiveSnapshot>(data.live);
  let schedules = $state<Schedule[]>(data.schedules);
  let feed = $state<FeedItem[]>(data.feed);

  let activeTab = $state<'live' | 'heartbeat' | 'scheduled' | 'background' | 'reference'>('live');

  type ScheduledCallback = {
    id: string;
    name: string;
    description: string;
    kind: 'reply' | 'tool' | 'orchestrator-turn';
    conversationId: string | null;
    payload: Record<string, unknown>;
    fireAt: string;
    status: 'pending' | 'fired' | 'failed' | 'cancelled';
    source: string;
    firedAt: string | null;
    error: string | null;
    totalCostUsd: number;
    createdAt: string;
  };
  let scheduled = $state<ScheduledCallback[]>([]);
  let scheduledLoaded = $state(false);

  async function loadScheduled() {
    const res = await fetch('/api/admin/pulse/scheduled');
    if (!res.ok) return;
    const d = await res.json();
    scheduled = d.callbacks;
    scheduledLoaded = true;
  }

  async function patchScheduled(id: string, action: 'cancel' | 'fire-now') {
    try {
      const res = await fetch('/api/admin/pulse/scheduled', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        flash('error', d.message || `Action failed (${res.status})`);
        return;
      }
      flash('success', action === 'cancel' ? 'Cancelled' : 'Fired');
      await loadScheduled();
    } catch (e) {
      flash('error', e instanceof Error ? e.message : 'Action failed');
    }
  }

  async function deleteScheduled(id: string) {
    if (!confirm('Delete this callback permanently?')) return;
    const res = await fetch(`/api/admin/pulse/scheduled?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) { flash('error', `Delete failed (${res.status})`); return; }
    flash('success', 'Deleted');
    await loadScheduled();
  }

  type Action = {
    id: string;
    name: string;
    description: string;
    kind: 'system-scan' | 'targeted';
    goal: string | null;
    prompt: string | null;
    cadenceSeconds: number;
    status: 'active' | 'paused' | 'done' | 'failed';
    conversationId: string | null;
    source: 'orchestrator' | 'system' | 'manual';
    activeHoursStart: string | null;
    activeHoursEnd: string | null;
    activeHoursTz: string | null;
    config: Record<string, unknown>;
    lastRunAt: string | null;
    nextRunAt: string | null;
    totalRuns: number;
    totalCostUsd: number;
    cost24hUsd: number;
    completedAt: string | null;
    handlerKnown: boolean;
    countsLast24h: Record<string, number>;
  };
  type ActionPulse = {
    id: number;
    actionId: string;
    ts: string;
    outcome: 'fired' | 'ok' | 'skipped' | 'error' | 'completed';
    summary: string;
    details: Record<string, unknown> | null;
    durationMs: number | null;
    conversationId: string | null;
    jobId: string | null;
    costUsd: number;
  };

  let actions = $state<Action[]>([]);
  let actionsLoaded = $state(false);
  let pulsesByAction = $state<Record<string, ActionPulse[]>>({});
  let openActionId = $state<string | null>(null);
  let cadenceDraft = $state<Record<string, number>>({});
  let runningActionId = $state<string | null>(null);

  async function loadActions() {
    const res = await fetch('/api/admin/pulse/actions');
    if (!res.ok) return;
    const d = await res.json();
    actions = d.actions;
    actionsLoaded = true;
  }

  async function loadActionPulses(actionId: string) {
    const res = await fetch(`/api/admin/pulse/actions/${actionId}/pulses?limit=30`);
    if (!res.ok) return;
    const d = await res.json();
    pulsesByAction = { ...pulsesByAction, [actionId]: d.pulses };
  }

  async function patchAction(id: string, patch: Record<string, unknown>) {
    try {
      const res = await fetch('/api/admin/pulse/actions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        flash('error', d.message || `Update failed (${res.status})`);
        return;
      }
      flash('success', 'Updated');
      await loadActions();
    } catch (e) {
      flash('error', e instanceof Error ? e.message : 'Update failed');
    }
  }

  async function runActionNow(id: string) {
    runningActionId = id;
    try {
      const res = await fetch(`/api/admin/pulse/actions/${id}/run`, { method: 'POST' });
      if (!res.ok) {
        flash('error', `Run failed (${res.status})`);
        return;
      }
      const d = await res.json();
      flash('success', `Ran: ${d.result.outcome} — ${d.result.summary}`);
      await Promise.all([loadActions(), loadActionPulses(id)]);
    } finally {
      runningActionId = null;
    }
  }

  async function deleteAction(id: string) {
    if (!confirm('Delete this action permanently? Pulse history is also removed.')) return;
    try {
      const res = await fetch(`/api/admin/pulse/actions?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) {
        flash('error', `Delete failed (${res.status})`);
        return;
      }
      flash('success', 'Deleted');
      await loadActions();
    } catch (e) {
      flash('error', e instanceof Error ? e.message : 'Delete failed');
    }
  }

  function fmtMoney(usd: number): string {
    if (!Number.isFinite(usd)) return '—';
    if (usd === 0) return '$0';
    if (usd < 0.001) return `<$0.001`;
    if (usd < 1) return `$${usd.toFixed(4)}`;
    return `$${usd.toFixed(2)}`;
  }

  function fmtCadence(sec: number): string {
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.round(sec / 60)}m`;
    if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
    return `${(sec / 86400).toFixed(1)}d`;
  }
  let liveTimer: ReturnType<typeof setInterval> | null = null;
  let lastLiveAt = $state(Date.now());
  let banner = $state<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  let bannerTimer: ReturnType<typeof setTimeout> | null = null;

  function flash(kind: 'success' | 'error' | 'info', text: string, ms = 2500) {
    banner = { kind, text };
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { banner = null; }, ms);
  }

  async function refreshLive() {
    try {
      const res = await fetch('/api/admin/pulse/live');
      if (!res.ok) return;
      live = await res.json();
      lastLiveAt = Date.now();
    } catch { /* keep last state */ }
  }

  async function refreshSchedules() {
    const res = await fetch('/api/admin/pulse/schedules');
    if (res.ok) {
      const d = await res.json();
      schedules = d.schedules;
    }
  }

  async function refreshFeed() {
    const res = await fetch('/api/admin/pulse/feed?limit=200');
    if (res.ok) {
      const d = await res.json();
      feed = d.items;
    }
  }

  async function toggleSchedule(s: Schedule) {
    const next = !s.enabled;
    try {
      const res = await fetch('/api/admin/pulse/schedules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: s.id, enabled: next }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        flash('error', d.error || `Toggle failed (${res.status})`);
        return;
      }
      flash('success', `${next ? 'Enabled' : 'Paused'} ${s.workflowName}`);
      await Promise.all([refreshSchedules(), refreshLive()]);
    } catch (e) {
      flash('error', e instanceof Error ? e.message : 'Toggle failed');
    }
  }

  onMount(() => {
    liveTimer = setInterval(() => {
      if (activeTab === 'live') refreshLive();
      if (activeTab === 'heartbeat' && actionsLoaded) loadActions();
      if (activeTab === 'scheduled' && scheduledLoaded) loadScheduled();
    }, 3000);
    // Pre-load once even if user starts on a different tab.
    loadActions();
    loadScheduled();
  });

  onDestroy(() => {
    if (liveTimer) clearInterval(liveTimer);
    if (bannerTimer) clearTimeout(bannerTimer);
  });

  function fmtRelative(ms: number): string {
    if (!ms || !Number.isFinite(ms)) return '—';
    const diff = Date.now() - ms;
    const abs = Math.abs(diff);
    const past = diff >= 0;
    if (abs < 1000) return past ? 'now' : 'in <1s';
    const s = Math.round(abs / 1000);
    if (s < 60) return past ? `${s}s ago` : `in ${s}s`;
    const m = Math.round(s / 60);
    if (m < 60) return past ? `${m}m ago` : `in ${m}m`;
    const h = Math.round(m / 60);
    if (h < 48) return past ? `${h}h ago` : `in ${h}h`;
    const d = Math.round(h / 24);
    return past ? `${d}d ago` : `in ${d}d`;
  }

  function fmtDuration(ms: number | null | undefined): string {
    if (ms == null || !Number.isFinite(ms)) return '—';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
    return `${(ms / 3_600_000).toFixed(1)}h`;
  }

  function fmtTs(ts: string | number | null | undefined): string {
    if (!ts) return '—';
    const ms = typeof ts === 'number' ? ts : new Date(ts).getTime();
    if (!Number.isFinite(ms)) return '—';
    return new Date(ms).toLocaleString(undefined, { hour12: false });
  }

  function statusClass(status: string | null): string {
    if (!status) return 'st-unknown';
    const s = status.toLowerCase();
    if (s === 'running' || s === 'syncing' || s === 'pending') return 'st-running';
    if (s === 'paused') return 'st-paused';
    if (s === 'completed' || s === 'success' || s === 'idle' || s === 'done') return 'st-ok';
    if (s === 'failed' || s === 'error' || s === 'cancelled') return 'st-err';
    return 'st-unknown';
  }

  let openRowKey = $state<string | null>(null);
  function rowKey(prefix: string, id: string) { return `${prefix}:${id}`; }

  // System catalogue: hard-coded recurring services, mirrors the actual
  // boot-time setInterval / setTimeout / event-driven activations. The page
  // surfaces these so the user knows what fires even when the in-memory
  // state is empty.
  const systemCatalogue = [
    {
      name: 'Job heartbeat',
      cadence: '5s while a job is running',
      desc: 'Each chat job ticks a heartbeat into the SSE stream so the UI can show "thinking… 35s". Phase + summary + elapsedMs. Fires extra on phase change.',
      file: 'src/lib/workflows/chat/job-store.ts:191',
    },
    {
      name: 'Job watchdog',
      cadence: '15s; kills at 120s idle / 600s total',
      desc: 'Per-job interval that aborts the job if no event has fired for 2 minutes (the idle ceiling) or the job has been alive for 10 minutes total.',
      file: 'src/lib/workflows/chat/job-store.ts:142',
    },
    {
      name: 'Workflow run reaper',
      cadence: '5 min',
      desc: 'Scans workflow_runs for rows in running/paused/pending whose heartbeat_at is older than 5 min and marks them failed/abandoned.',
      file: 'src/lib/workflows/engine-runtime.ts:91',
    },
    {
      name: 'Workflow cron scheduler',
      cadence: 'per-row cron expression (croner)',
      desc: 'Reads workflow_schedules where type=cron AND enabled=true at boot, then registers a Cron handle per row. Fires runScheduledWorkflow on each tick.',
      file: 'src/lib/workflows/scheduler.ts:17',
    },
    {
      name: 'Health sync',
      cadence: 'every SYNC_INTERVAL_MS (default 1h), first run +30s after boot',
      desc: 'Pulls Strava activities and Whoop workouts/sleep/recovery/cycles. Updates health_sync_state on each tick.',
      file: 'src/lib/health/scheduler.ts:4',
    },
    {
      name: 'Gmail watcher',
      cadence: '45s per active account',
      desc: 'Polls users.history.list using gmail_history_cursors.history_id; matches new messages against gmail_watches; emits on gmailEventBus.',
      file: 'src/lib/workflows/gmail/watcher.ts:75',
    },
    {
      name: 'Follow-up queue worker',
      cadence: '15s, lazily started on first enqueue',
      desc: '"I\'ll check back in N minutes" pattern. In-memory queue; stops itself when empty. Re-checks task status with 1.2× exponential backoff capped at 5 min, max 40 retries.',
      file: 'src/lib/workflows/chat/followup-queue.ts:124',
    },
    {
      name: 'Orphan-attachment sweep',
      cadence: '1h (immediate on boot then every hour)',
      desc: 'Deletes jkai_attachments rows where message_id IS NULL and created_at < 24h ago, plus the file on disk.',
      file: 'src/lib/jkai/media/sweep.ts:29',
    },
    {
      name: 'Engine event-loop monitor',
      cadence: 'continuous histogram, read on each /api/health/workflow-engine probe',
      desc: 'perf_hooks.monitorEventLoopDelay({resolution:50}). The 60s systemd timer hits the probe; if loopMaxMs ≥ 5000 the probe returns 503 and systemd restarts the service.',
      file: 'src/lib/workflows/engine-runtime.ts:154',
    },
  ] as const;

  // Heartbeat process explainer — stages a typical chat heartbeat goes
  // through. Useful for "what happens" question.
  const heartbeatProcess = [
    { step: 1, label: 'Job created', detail: 'createJob() inserts an OrchestratorJob into the in-memory map. Fires startWatchdog and startHeartbeat. lastEventAt = now.' },
    { step: 2, label: 'Phase: starting', detail: 'Initial phase. Heartbeat ticker fires immediately so the UI sees "starting 0s" without waiting.' },
    { step: 3, label: 'Phase: thinking', detail: 'setJobPhase(\"thinking\", \"Calling LLM…\") on each LLM round. currentStep is the visible label.' },
    { step: 4, label: 'Tick every 5s', detail: 'startHeartbeat() unconditionally fires {type:heartbeat, summary, phase, elapsedMs}. Watchdog stays happy because publishJobEvent() updates lastEventAt.' },
    { step: 5, label: 'Tool call', detail: 'Phase shifts to tool_running; tool_start/tool_result events fire as each tool runs. currentStep = "Running <tool>…".' },
    { step: 6, label: 'Stream tokens', detail: 'On first token, phase becomes "Streaming reply…" (handled in general-chat). Tokens flow as type:token deltas.' },
    { step: 7, label: 'Done / error', detail: 'publishJobEvent({type:done|error}). job.status flips. Both heartbeat and watchdog clear themselves on the next tick when status !== running.' },
    { step: 8, label: 'Watchdog kill', detail: 'If 120s pass with no event (heartbeat stopped firing, e.g. a hung subprocess), the watchdog aborts the AbortController, sets status=error, publishes an error event.' },
  ] as const;
</script>

<div class="page-hdr">
  <h1>Pulse</h1>
  <p class="kicker">background activity — heartbeats, schedules, recurring services</p>
</div>

{#if banner}
  <div class={`banner banner-${banner.kind}`}>{banner.text}</div>
{/if}

<!-- Lane-aligned stat strip -->
<div class="lane-strip">
  <button class="lane-card" class:active={activeTab === 'heartbeat'} onclick={() => activeTab = 'heartbeat'}>
    <div class="lane-label">Heartbeat</div>
    <div class="lane-value">{actions.filter((a) => a.status === 'active').length}</div>
    <div class="lane-meta">{actions.length} total · {actions.reduce((s, a) => s + a.cost24hUsd, 0).toFixed(4) === '0.0000' ? '$0' : `$${actions.reduce((s, a) => s + a.cost24hUsd, 0).toFixed(4)}`} 24h</div>
  </button>
  <button class="lane-card" class:active={activeTab === 'scheduled'} onclick={() => activeTab = 'scheduled'}>
    <div class="lane-label">Scheduled</div>
    <div class="lane-value">{scheduled.filter((c) => c.status === 'pending').length}</div>
    <div class="lane-meta">{scheduled.length} total</div>
  </button>
  <button class="lane-card" class:active={activeTab === 'background'} onclick={() => activeTab = 'background'}>
    <div class="lane-label">Background</div>
    <div class="lane-value">{live.activeRuns.length + live.orchestratorJobs.length}</div>
    <div class="lane-meta">{live.cronJobs.length} cron · {live.engine.activeRuns}/{live.engine.cap} slots</div>
  </button>
  <button class="lane-card" class:active={activeTab === 'live'} onclick={() => activeTab = 'live'}>
    <div class="lane-label">Engine</div>
    <div class="lane-value">{live.engine.loopMaxMs.toFixed(0)}<span class="lane-unit">ms</span></div>
    <div class="lane-meta">loop max · 503 at ≥5000</div>
  </button>
</div>

<div class="nm-tabs">
  <button class="nm-tab" class:active={activeTab === 'live'} aria-current={activeTab === 'live' ? 'page' : undefined} onclick={() => activeTab = 'live'}>
    Live
  </button>
  <button class="nm-tab" class:active={activeTab === 'heartbeat'} aria-current={activeTab === 'heartbeat' ? 'page' : undefined} onclick={() => activeTab = 'heartbeat'}>
    Heartbeat
  </button>
  <button class="nm-tab" class:active={activeTab === 'scheduled'} aria-current={activeTab === 'scheduled' ? 'page' : undefined} onclick={() => activeTab = 'scheduled'}>
    Scheduled
  </button>
  <button class="nm-tab" class:active={activeTab === 'background'} aria-current={activeTab === 'background' ? 'page' : undefined} onclick={() => activeTab = 'background'}>
    Background
  </button>
  <button class="nm-tab" class:active={activeTab === 'reference'} aria-current={activeTab === 'reference' ? 'page' : undefined} onclick={() => activeTab = 'reference'}>
    Reference
  </button>
</div>


{#if activeTab === 'live'}
  <div class="live-meta">
    <span>Last refresh: {fmtRelative(lastLiveAt)}</span>
    <button class="link-btn" onclick={refreshLive}>refresh now</button>
  </div>

  {#if live.orchestratorJobs.length === 0 && live.activeRuns.length === 0 && live.followUps.length === 0}
    <p class="empty">Nothing in flight.</p>
  {:else}
    <ul class="flow-list">
      {#each live.orchestratorJobs as j (j.id)}
        <li class="flow-row">
          <span class="flow-pip">●</span>
          <span class="flow-kind">chat job</span>
          <span class="flow-name">{j.currentStep ?? j.phase}</span>
          <span class="flow-meta">{fmtDuration(j.elapsedMs)} · {j.idleKillInMs < 60_000 ? `kill in ${fmtDuration(j.idleKillInMs)}` : 'healthy'}</span>
          <span class="flow-id mono-tiny">{j.id.slice(0, 8)}</span>
        </li>
      {/each}
      {#each live.activeRuns as r (r.id)}
        <li class="flow-row">
          <span class="flow-pip">▶</span>
          <span class="flow-kind">workflow run</span>
          <span class="flow-name"><a class="row-link" href={`/jkai/canvas/${r.workflowId}`}>{r.workflowName}</a></span>
          <span class="flow-meta">{r.status} · {r.heartbeatAt ? fmtRelative(new Date(r.heartbeatAt).getTime()) : '—'}</span>
          <span class="flow-id mono-tiny">{r.id.slice(0, 8)}</span>
        </li>
      {/each}
      {#each live.followUps as f (f.id)}
        <li class="flow-row">
          <span class="flow-pip">⟳</span>
          <span class="flow-kind">follow-up</span>
          <span class="flow-name">{f.taskType}/{f.taskId.slice(0, 8)}</span>
          <span class="flow-meta">{f.dueInMs > 0 ? `due in ${fmtDuration(f.dueInMs)}` : 'now'} · retry {f.retries}</span>
          <span class="flow-id mono-tiny">{f.id.slice(0, 8)}</span>
        </li>
      {/each}
    </ul>
  {/if}

  <details class="collapsible">
    <summary>Pulse stream — last {live.recentPulses.length} events</summary>
    {#if live.recentPulses.length === 0}
      <p class="empty">None recorded yet.</p>
    {:else}
      <ol class="pulse-stream">
        {#each live.recentPulses.slice(0, 50) as p, i (i)}
          <li class={`pulse pulse-${p.kind}`}>
            <span class="pulse-time">{fmtRelative(p.ts)}</span>
            <span class="pulse-kind">{p.kind}</span>
            <span class="pulse-job mono-tiny">{p.jobId.slice(0, 8)}</span>
            <span class="pulse-summary">{p.summary}</span>
          </li>
        {/each}
      </ol>
    {/if}
  </details>

  <details class="collapsible">
    <summary>Health sync</summary>
    <table class="nm-table">
      <thead><tr><th>Service</th><th>Status</th><th>Last sync</th><th>Records</th></tr></thead>
      <tbody>
        {#each live.healthSync as s (s.service)}
          <tr>
            <td>{s.service}</td>
            <td><span class={`pill ${statusClass(s.status)}`}>{s.status}</span></td>
            <td>{fmtTs(s.lastSyncAt * 1000)}</td>
            <td>{s.recordsSynced ?? 0}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </details>
{/if}

{#if activeTab === 'heartbeat'}
  <details class="collapsible">
    <summary>About heartbeat</summary>
    <p class="hint">
      Perpetual agent watches. Each row pulses on its own cadence; the LLM tick reads injected live state of whatever it's watching and decides — post a status, mark <code>DONE:</code>, or stay silent. Rows attach automatically on <code>build_create</code> / <code>research_start</code> / <code>workflow_run</code>; the orchestrator can also register ad-hoc watchers via <code>register_heartbeat_action</code>.
    </p>
  </details>

  {#if !actionsLoaded}
    <p class="empty">Loading…</p>
  {:else if actions.length === 0}
    <p class="empty">No actions.</p>
  {:else}
    <table class="nm-table">
      <thead>
        <tr><th>Action</th><th>Status</th><th>Cadence</th><th>Next</th><th>Runs</th><th>Cost (24h)</th><th></th><th></th></tr>
      </thead>
      <tbody>
        {#each actions as a (a.id)}
          {@const isOpen = openActionId === a.id}
          <tr>
            <td>
              <div class="act-name">{a.name}</div>
              <div class="mono-tiny dim">{a.kind} · {a.source}</div>
            </td>
            <td><span class={`pill st-${a.status === 'active' ? 'running' : a.status === 'done' ? 'ok' : a.status === 'failed' ? 'err' : 'paused'}`}>{a.status}</span></td>
            <td>{fmtCadence(a.cadenceSeconds)}</td>
            <td>{a.nextRunAt && a.status === 'active' ? fmtRelative(new Date(a.nextRunAt).getTime()) : '—'}</td>
            <td>{a.totalRuns}</td>
            <td class="mono-tiny">{fmtMoney(a.cost24hUsd)}</td>
            <td>
              {#if a.status === 'active'}<button class="link-btn" onclick={() => patchAction(a.id, { status: 'paused' })}>pause</button>
              {:else if a.status === 'paused'}<button class="link-btn" onclick={() => patchAction(a.id, { status: 'active' })}>resume</button>
              {:else if a.status === 'done'}<button class="link-btn" onclick={() => patchAction(a.id, { status: 'active' })}>reactivate</button>{/if}
            </td>
            <td><button class="link-btn" onclick={async () => { openActionId = isOpen ? null : a.id; if (!isOpen) { await loadActionPulses(a.id); cadenceDraft[a.id] = a.cadenceSeconds; } }}>{isOpen ? '−' : '+'}</button></td>
          </tr>
          {#if isOpen}
            <tr><td colspan="8" class="row-detail">
              {#if a.description}<p class="act-desc">{a.description}</p>{/if}
              {#if a.goal}<div class="kv"><span>goal:</span><span>{a.goal}</span></div>{/if}
              {#if a.prompt}<div class="kv"><span>prompt:</span><span>{a.prompt}</span></div>{/if}
              {#if a.conversationId}<div class="kv"><span>conversation:</span><span class="mono-tiny"><a class="row-link" href={`/jkai?conv=${a.conversationId}`}>{a.conversationId.slice(0, 12)}…</a></span></div>{/if}
              <div class="kv"><span>active hours:</span><span class="mono-tiny">{a.activeHoursStart && a.activeHoursEnd ? `${a.activeHoursStart}–${a.activeHoursEnd} ${a.activeHoursTz ?? ''}` : '24/7'}</span></div>
              <div class="kv"><span>last run:</span><span>{a.lastRunAt ? fmtTs(a.lastRunAt) : '—'}</span></div>
              <div class="kv"><span>total cost:</span><span>{fmtMoney(a.totalCostUsd)}</span></div>

              <div class="act-controls">
                <label class="ctrl">
                  <span>Cadence (s)</span>
                  <input type="number" min="30" max="86400" bind:value={cadenceDraft[a.id]} class="nm-text-input small" />
                  <button class="link-btn" onclick={() => patchAction(a.id, { cadenceSeconds: cadenceDraft[a.id] })} disabled={cadenceDraft[a.id] === a.cadenceSeconds}>save</button>
                </label>
                <button class="link-btn" onclick={() => runActionNow(a.id)} disabled={runningActionId === a.id || !a.handlerKnown}>{runningActionId === a.id ? 'running…' : 'run now'}</button>
                {#if a.status !== 'done'}<button class="link-btn" onclick={() => patchAction(a.id, { status: 'done' })}>mark done</button>{/if}
                <button class="link-btn" style="color: #c44;" onclick={() => deleteAction(a.id)}>delete</button>
              </div>

              {#if pulsesByAction[a.id] && pulsesByAction[a.id].length > 0}
                <details class="collapsible">
                  <summary>Recent pulses ({pulsesByAction[a.id].length})</summary>
                  <table class="nm-table inset">
                    <thead><tr><th>When</th><th>Outcome</th><th>Summary</th><th>Cost</th></tr></thead>
                    <tbody>
                      {#each pulsesByAction[a.id] as p (p.id)}
                        <tr>
                          <td>{fmtRelative(new Date(p.ts).getTime())}</td>
                          <td><span class={`pill st-${p.outcome === 'fired' || p.outcome === 'completed' ? 'ok' : p.outcome === 'error' ? 'err' : p.outcome === 'ok' ? 'info' : 'paused'}`}>{p.outcome}</span></td>
                          <td class="summary-cell">{p.summary}</td>
                          <td class="mono-tiny">{fmtMoney(p.costUsd)}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </details>
              {/if}
            </td></tr>
          {/if}
        {/each}
      </tbody>
    </table>
  {/if}
{/if}

{#if activeTab === 'scheduled'}
  <details class="collapsible">
    <summary>About scheduled callbacks</summary>
    <p class="hint">
      One-shot time-based fires. Three kinds: <strong>reply</strong> (post fixed text, no LLM), <strong>tool</strong> (call a registered tool with given args, no LLM), <strong>orchestrator-turn</strong> (synthetic user message + LLM turn with tools enabled). Engine ticks every 10s.
    </p>
  </details>

  {#if !scheduledLoaded}
    <p class="empty">Loading…</p>
  {:else if scheduled.length === 0}
    <p class="empty">No scheduled callbacks.</p>
  {:else}
    <table class="nm-table">
      <thead>
        <tr><th>Name</th><th>Kind</th><th>Status</th><th>Fire</th><th>Cost</th><th></th><th></th></tr>
      </thead>
      <tbody>
        {#each scheduled as c (c.id)}
          {@const detailKey = `sch-${c.id}`}
          {@const fireMs = new Date(c.fireAt).getTime()}
          <tr>
            <td>
              <div class="act-name">{c.name}</div>
              <div class="mono-tiny dim">{c.description.slice(0, 80)}</div>
            </td>
            <td class="mono-tiny">{c.kind}</td>
            <td><span class={`pill st-${c.status === 'pending' ? 'running' : c.status === 'fired' ? 'ok' : c.status === 'cancelled' ? 'paused' : 'err'}`}>{c.status}</span></td>
            <td>
              {#if c.status === 'pending'}<span class={fireMs - Date.now() < 60_000 ? 'warn' : ''}>{fmtRelative(fireMs)}</span>
              {:else}<span class="dim">{c.firedAt ? fmtRelative(new Date(c.firedAt).getTime()) : '—'}</span>{/if}
            </td>
            <td class="mono-tiny">{fmtMoney(c.totalCostUsd)}</td>
            <td>
              {#if c.status === 'pending'}<button class="link-btn" onclick={() => patchScheduled(c.id, 'fire-now')}>fire now</button>
              {:else}<button class="link-btn" style="color: #c44;" onclick={() => deleteScheduled(c.id)}>delete</button>{/if}
              {#if c.status === 'pending'}<button class="link-btn" onclick={() => patchScheduled(c.id, 'cancel')}>cancel</button>{/if}
            </td>
            <td><button class="link-btn" onclick={() => openRowKey = openRowKey === detailKey ? null : detailKey}>{openRowKey === detailKey ? '−' : '+'}</button></td>
          </tr>
          {#if openRowKey === detailKey}
            <tr><td colspan="7" class="row-detail">
              {#if c.conversationId}<div class="kv"><span>conversation:</span><span class="mono-tiny"><a class="row-link" href={`/jkai?conv=${c.conversationId}`}>{c.conversationId.slice(0, 12)}…</a></span></div>{/if}
              <div class="kv"><span>fire at:</span><span>{fmtTs(fireMs)}</span></div>
              <div class="kv"><span>source:</span><span>{c.source}</span></div>
              {#if c.error}<div class="kv"><span>error:</span><span class="err-cell">{c.error}</span></div>{/if}
              <details class="collapsible">
                <summary>payload</summary>
                <pre class="raw">{JSON.stringify(c.payload, null, 2)}</pre>
              </details>
            </td></tr>
          {/if}
        {/each}
      </tbody>
    </table>
  {/if}
{/if}

{#if activeTab === 'background'}
  <details class="collapsible">
    <summary>About background tasks</summary>
    <p class="hint">
      Long-running watched work — workflow cron schedules and recent run history (workflow_runs / scraper / health sync). Heartbeat watchers attach to these automatically when the orchestrator kicks them off.
    </p>
  </details>

  <h3 class="sec-title">Cron schedules</h3>
  {#if schedules.length === 0}
    <p class="empty">No schedules.</p>
  {:else}
    <table class="nm-table">
      <thead><tr><th>Workflow</th><th>Expression</th><th>Last run</th><th>Next run</th><th></th></tr></thead>
      <tbody>
        {#each schedules as s (s.id)}
          <tr>
            <td><a class="row-link" href={`/jkai/canvas/${s.workflowId}`}>{s.workflowName}</a></td>
            <td class="mono-tiny">{s.expression ?? '(none)'}</td>
            <td>{s.lastRunAt ? fmtRelative(new Date(s.lastRunAt).getTime()) : '—'}</td>
            <td>{s.nextRunAt ? fmtRelative(new Date(s.nextRunAt).getTime()) : '—'}</td>
            <td>
              <button class="toggle-btn" class:on={s.enabled} onclick={() => toggleSchedule(s)}>{s.enabled ? 'on' : 'off'}</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  <h3 class="sec-title">Recent activity</h3>
  {#if feed.length === 0}
    <p class="empty">No recent events.</p>
  {:else}
    <table class="nm-table">
      <thead><tr><th>When</th><th>Source</th><th>Summary</th><th>Status</th><th></th></tr></thead>
      <tbody>
        {#each feed.slice(0, 30) as f, i (i)}
          {@const k = rowKey('feed', String(i))}
          <tr>
            <td>{fmtRelative(f.ts)}</td>
            <td>{f.source}</td>
            <td class="summary-cell">{f.summary}</td>
            <td>{f.status ?? '—'}</td>
            <td>
              {#if f.link}<a class="row-link" href={f.link}>open</a>{:else}<button class="link-btn" onclick={() => openRowKey = openRowKey === k ? null : k}>{openRowKey === k ? '−' : '+'}</button>{/if}
            </td>
          </tr>
          {#if openRowKey === k}
            <tr><td colspan="5" class="row-detail"><pre class="raw">{JSON.stringify(f.raw, null, 2)}</pre></td></tr>
          {/if}
        {/each}
      </tbody>
    </table>
  {/if}
{/if}

{#if activeTab === 'reference'}
  <details class="collapsible">
    <summary>Heartbeat lifecycle (8 stages)</summary>
    <ol class="process-list">
      {#each heartbeatProcess as p}
        <li>
          <div class="process-step-num">{p.step}</div>
          <div class="process-step-body">
            <div class="process-step-label">{p.label}</div>
            <div class="process-step-detail">{p.detail}</div>
          </div>
        </li>
      {/each}
    </ol>
  </details>

  <details class="collapsible">
    <summary>System schedulers ({systemCatalogue.length})</summary>
    <p class="hint">Recurring services with hardcoded cadences. To change, edit the file and redeploy.</p>
    <div class="sys-grid">
      {#each systemCatalogue as sys}
        <article class="sys-card">
          <header>
            <h3>{sys.name}</h3>
            <span class="sys-cadence">{sys.cadence}</span>
          </header>
          <p>{sys.desc}</p>
          <code class="sys-file">{sys.file}</code>
        </article>
      {/each}
    </div>
  </details>

  <details class="collapsible">
    <summary>Tickers (current configuration)</summary>
    <table class="nm-table">
      <thead><tr><th>Ticker</th><th>Cadence</th><th>Threshold</th><th>Source</th></tr></thead>
      <tbody>
        <tr><td>Job heartbeat</td><td>{fmtDuration(live.thresholds.heartbeatIntervalMs)}</td><td>—</td><td class="mono-tiny">job-store.ts:191</td></tr>
        <tr><td>Idle watchdog</td><td>15s</td><td>{fmtDuration(live.thresholds.idleTimeoutMs)} idle / {fmtDuration(live.thresholds.hardTimeoutMs)} total</td><td class="mono-tiny">job-store.ts:142</td></tr>
        <tr><td>Follow-up worker</td><td>{fmtDuration(live.thresholds.followupWorkerIntervalMs)}</td><td>{live.thresholds.followupMaxRetries} retries max</td><td class="mono-tiny">followup-queue.ts:124</td></tr>
        <tr><td>Heartbeat engine</td><td>30s</td><td>per-action cadence_seconds</td><td class="mono-tiny">heartbeat/engine.ts</td></tr>
        <tr><td>Scheduled engine</td><td>10s</td><td>fire_at &lt;= now</td><td class="mono-tiny">scheduled/engine.ts</td></tr>
      </tbody>
    </table>
  </details>
{/if}

<style>
  .page-hdr { margin-bottom: 1.5rem; }
  .page-hdr h1 { font-family: var(--font-brand); font-size: 2rem; font-weight: 500; line-height: 1; letter-spacing: -0.01em; text-transform: lowercase; color: var(--text-primary); margin: 0; }
  .kicker { font-family: var(--font-mono); font-size: 11px; color: var(--text-ghost); text-transform: uppercase; letter-spacing: 0.16em; margin: 0.4rem 0 0; }

  .live-meta { display: flex; gap: 1rem; align-items: center; font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); margin: 0.75rem 0 0.5rem; }
  .link-btn { background: none; border: none; padding: 0; font: inherit; color: var(--accent); cursor: pointer; text-decoration: underline dotted; }
  .link-btn:hover { color: var(--text-primary); }

  .sec-title { font-family: var(--font-mono); font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-ghost); margin: 1.5rem 0 0.5rem; }
  .empty { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); padding: 0.6rem 0.8rem; border: 1px dashed var(--card-border); margin: 0 0 1rem; }
  .hint { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); line-height: 1.55; margin: 0.5rem 0 1rem; }

  .mono-tiny { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); white-space: nowrap; }
  .summary-cell { max-width: 460px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .err-cell { color: #c44; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .pill { display: inline-block; padding: 1px 7px; border-radius: 999px; font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; border: 1px solid currentColor; }
  .st-running { color: #2d6cdf; }
  .st-paused { color: #b0892a; }
  .st-ok { color: #2d7a3a; }
  .st-err { color: #c44; }
  .st-unknown { color: var(--text-muted); }
  .st-info { color: var(--accent); }

  .tab-count { font-family: var(--font-mono); font-size: 9px; color: var(--text-ghost); border: 1px solid var(--card-border); padding: 1px 5px; border-radius: 8px; margin-left: 0.4rem; }

  .row-detail { background: var(--bg-section); }
  .row-detail .kv { display: flex; gap: 1rem; padding: 3px 0; font-family: var(--font-mono); font-size: 11px; }
  .row-detail .kv > span:first-child { color: var(--text-ghost); width: 130px; flex: none; }
  .row-detail .kv > span:last-child { color: var(--text-primary); word-break: break-word; }
  .row-detail .raw { font-family: var(--font-mono); font-size: 10px; color: var(--text-secondary); background: var(--bg-base); border: 1px solid var(--card-border); padding: 0.7rem; margin: 0.4rem 0; max-height: 400px; overflow: auto; }

  .toggle-btn { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--card-border); background: var(--bg-section); color: var(--text-muted); cursor: pointer; }
  .toggle-btn.on { color: #2d7a3a; border-color: rgba(45, 122, 58, 0.5); background: rgba(45, 122, 58, 0.06); }
  .toggle-btn:hover { color: var(--text-primary); }

  .sys-grid { display: grid; gap: 0.85rem; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
  .sys-card { background: var(--bg-section); border: 1px solid var(--card-border); padding: 0.95rem 1.05rem; }
  .sys-card header { display: flex; justify-content: space-between; align-items: baseline; gap: 0.6rem; margin-bottom: 0.5rem; }
  .sys-card h3 { font-family: var(--font-brand); font-weight: 500; font-size: 1.05rem; margin: 0; text-transform: lowercase; letter-spacing: -0.005em; color: var(--text-primary); }
  .sys-card .sys-cadence { font-family: var(--font-mono); font-size: 10px; color: var(--accent); text-transform: uppercase; letter-spacing: 0.1em; }
  .sys-card p { font-family: var(--font-sans); font-size: 13px; line-height: 1.5; color: var(--text-secondary); margin: 0 0 0.55rem; }
  .sys-card .sys-file { font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); }

  .process-list { list-style: none; padding: 0; margin: 0; counter-reset: ps; }
  .process-list li { display: flex; gap: 0.8rem; padding: 0.7rem 0; border-bottom: 1px solid var(--divider); }
  .process-list li:last-child { border-bottom: none; }
  .process-step-num { font-family: var(--font-brand); font-size: 1.4rem; font-weight: 500; color: var(--accent); width: 2rem; flex: none; line-height: 1; padding-top: 0.15rem; }
  .process-step-label { font-family: var(--font-mono); font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-primary); }
  .process-step-detail { font-family: var(--font-sans); font-size: 13px; line-height: 1.5; color: var(--text-secondary); margin-top: 0.2rem; }

  /* Heartbeat tab */
  .layer-explainer { background: var(--bg-section); border: 1px solid var(--card-border); padding: 1rem 1.1rem; margin: 0.5rem 0 1.5rem; }
  .layer-grid { display: grid; gap: 0.6rem; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin: 0.5rem 0 0.8rem; }
  .layer-card { padding: 0.7rem 0.8rem; border-left: 3px solid var(--card-border); background: var(--bg-base); }
  .layer-card .layer-cad { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-ghost); margin-bottom: 0.3rem; }
  .layer-card .layer-name { font-family: var(--font-brand); font-size: 1.1rem; font-weight: 500; text-transform: lowercase; letter-spacing: -0.005em; color: var(--text-primary); margin-bottom: 0.3rem; }
  .layer-card .layer-desc { font-family: var(--font-sans); font-size: 12px; line-height: 1.45; color: var(--text-secondary); }
  .layer-min { border-left-color: #2d7a3a; }
  .layer-sec { border-left-color: #2d6cdf; }
  .layer-actions { border-left-color: #c44; }
  .layer-poll { border-left-color: #b0892a; }
  .layer-content { border-left-color: var(--accent); }
  .layer-gap { font-family: var(--font-sans); font-size: 12px; line-height: 1.5; color: var(--text-secondary); margin: 0.5rem 0 0; padding: 0.6rem 0.8rem; border-left: 3px solid #c44; background: var(--bg-base); }
  .layer-fill { font-family: var(--font-sans); font-size: 12px; line-height: 1.5; color: var(--text-secondary); margin: 0.5rem 0 0; padding: 0.6rem 0.8rem; border-left: 3px solid #2d7a3a; background: var(--bg-base); }

  .bar-row { display: flex; align-items: center; gap: 0.55rem; }
  .bar { flex: 1; min-width: 60px; height: 4px; background: var(--bg-base); border: 1px solid var(--card-border); }
  .bar-fill { height: 100%; background: var(--accent); transition: width 200ms ease; }
  .warn { color: #b0892a; }
  .warn .bar-fill { background: #b0892a; }
  .danger { color: #c44; }
  .danger .bar-fill { background: #c44; }

  .pulse-stream { list-style: none; padding: 0; margin: 0; max-height: 480px; overflow-y: auto; border: 1px solid var(--card-border); background: var(--bg-base); }
  .pulse-stream .pulse { display: grid; grid-template-columns: 80px 110px 80px 100px 60px 1fr; gap: 0.6rem; align-items: baseline; padding: 4px 10px; border-bottom: 1px solid var(--divider); font-family: var(--font-mono); font-size: 10px; }
  .pulse-stream .pulse:last-child { border-bottom: none; }
  .pulse-stream .pulse-time { color: var(--text-ghost); }
  .pulse-stream .pulse-kind { font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; font-size: 9px; }
  .pulse-stream .pulse-job { color: var(--text-muted); }
  .pulse-stream .pulse-phase { color: var(--text-secondary); text-transform: lowercase; }
  .pulse-stream .pulse-elapsed { color: var(--text-muted); text-align: right; }
  .pulse-stream .pulse-summary { color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pulse-heartbeat .pulse-kind { color: #2d6cdf; }
  .pulse-phase_change .pulse-kind { color: var(--accent); }
  .pulse-job_start .pulse-kind { color: #2d7a3a; }
  .pulse-job_done .pulse-kind { color: #2d7a3a; }
  .pulse-job_error .pulse-kind { color: #c44; }
  .pulse-watchdog_kill { background: rgba(196, 68, 68, 0.06); }
  .pulse-watchdog_kill .pulse-kind { color: #c44; }
  @media (max-width: 720px) {
    .pulse-stream .pulse { grid-template-columns: 70px 90px 1fr; }
    .pulse-stream .pulse > :nth-child(n+4) { display: none; }
  }

  /* Activities tab */
  .act-name { font-family: var(--font-mono); font-size: 11px; font-weight: 500; color: var(--text-primary); text-transform: lowercase; }
  .act-desc { font-family: var(--font-sans); font-size: 12px; line-height: 1.5; color: var(--text-secondary); margin: 0 0 0.6rem; }
  .act-controls { display: flex; gap: 0.7rem; align-items: center; flex-wrap: wrap; padding: 0.4rem 0; margin-bottom: 0.5rem; border-bottom: 1px solid var(--divider); }
  .ctrl { display: flex; gap: 0.4rem; align-items: center; font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }
  .ctrl > span { white-space: nowrap; }
  .nm-text-input.small { font-size: 11px; padding: 3px 6px; max-width: 9rem; }
  .nm-text-input { font-family: var(--font-mono); border: 1px solid var(--card-border); background: var(--bg-base); color: var(--text-primary); padding: 4px 8px; }
  .act-config { margin: 0.4rem 0 0.6rem; }
  .act-config summary { cursor: pointer; color: var(--text-muted); }
  .sec-title-tight { margin-top: 0.5rem; }
  .nm-table.inset { border: 1px solid var(--card-border); }
  .nm-table.inset td, .nm-table.inset th { font-size: 10px; }
  .dim { color: var(--text-ghost); font-style: italic; }
  .pill + .pill { margin-left: 4px; }

  /* Lane-aligned compact stat strip */
  .lane-strip { display: grid; gap: 0.6rem; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin: 0 0 1.25rem; }
  .lane-card { text-align: left; padding: 0.7rem 0.9rem; background: var(--bg-section); border: 1px solid var(--card-border); cursor: pointer; transition: border-color 120ms ease, background 120ms ease; }
  .lane-card:hover { border-color: var(--accent); background: var(--bg-base); }
  .lane-card.active { border-color: var(--accent); border-left-width: 3px; }
  .lane-label { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--text-ghost); margin-bottom: 0.2rem; }
  .lane-value { font-family: var(--font-brand); font-size: 1.6rem; font-weight: 500; color: var(--text-primary); line-height: 1; letter-spacing: -0.01em; }
  .lane-unit { font-size: 0.7rem; color: var(--text-muted); margin-left: 2px; }
  .lane-meta { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); margin-top: 0.3rem; }

  /* Flow list — compact 1-row-per-thing for the Live tab */
  .flow-list { list-style: none; padding: 0; margin: 0 0 0.8rem; border: 1px solid var(--card-border); background: var(--bg-section); }
  .flow-row { display: grid; grid-template-columns: 24px 90px 1fr 220px 80px; gap: 0.6rem; align-items: center; padding: 6px 12px; border-bottom: 1px solid var(--divider); font-family: var(--font-mono); font-size: 11px; }
  .flow-row:last-child { border-bottom: none; }
  .flow-pip { color: var(--accent); }
  .flow-kind { color: var(--text-ghost); text-transform: uppercase; letter-spacing: 0.08em; font-size: 9px; }
  .flow-name { color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .flow-meta { color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .flow-id { color: var(--text-ghost); text-align: right; }
  @media (max-width: 720px) {
    .flow-row { grid-template-columns: 24px 1fr; }
    .flow-row > :nth-child(n+3) { display: none; }
  }

  /* Collapsibles */
  .collapsible { margin: 0.8rem 0; border: 1px solid var(--card-border); background: var(--bg-section); }
  .collapsible > summary { cursor: pointer; padding: 8px 12px; font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); user-select: none; list-style: none; }
  .collapsible > summary::-webkit-details-marker { display: none; }
  .collapsible > summary::before { content: '▸ '; color: var(--text-ghost); margin-right: 4px; }
  .collapsible[open] > summary::before { content: '▾ '; }
  .collapsible > :not(summary) { padding: 0 12px 12px; }
</style>
