<svelte:head><title>Admin — Strange Ramblings</title></svelte:head>
<script lang="ts">
  import { getContext, onDestroy } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const adminToken = getContext<string>('adminToken');

  function formatDate(unixTs: number | null | undefined): string {
    if (!unixTs) return 'Never';
    return new Date(unixTs * 1000).toLocaleString();
  }

  function statusColor(status: string): string {
    if (status === 'idle') return 'var(--text-ghost)';
    if (status === 'syncing' || status === 'running' || status === 'queued')
      return 'var(--accent)';
    if (status === 'error') return '#8b3a1a';
    if (status === 'cancelled') return 'var(--text-ghost)';
    if (status === 'success') return 'var(--accent)';
    return 'var(--text-ghost)';
  }

  async function syncNow() {
    syncing = true;
    syncError = null;
    try {
      const res = await fetch(`/api/health/sync?token=${adminToken}`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        syncError = body.error ?? `Error ${res.status}`;
      } else {
        syncSuccess = true;
        setTimeout(() => (syncSuccess = false), 4000);
        await invalidateAll();
      }
    } catch (e) {
      syncError = 'Network error';
    } finally {
      syncing = false;
    }
  }

  let syncing = $state(false);
  let syncSuccess = $state(false);
  let syncError = $state<string | null>(null);

  // Backfill range pickers (per service)
  let stravaStart = $state('');
  let stravaEnd = $state('');
  let whoopStart = $state('');
  let whoopEnd = $state('');

  // Active jobs view (replaces server data once a poll lands)
  let recentJobs = $state(data.recentJobs);
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  function hasActiveJobs(jobs: typeof recentJobs): boolean {
    return jobs.some((j) => j.status === 'running' || j.status === 'queued');
  }

  async function pollJobs() {
    try {
      const res = await fetch('/api/health/sync/jobs');
      if (res.ok) {
        const body = await res.json();
        recentJobs = body.jobs;
        if (!hasActiveJobs(recentJobs)) {
          // One last refresh to pick up final sync_state row, then stop polling.
          await invalidateAll();
          return;
        }
      }
    } catch {
      // ignore transient failures
    }
    pollTimer = setTimeout(pollJobs, 1500);
  }

  function startPollingIfActive() {
    if (pollTimer) return;
    if (hasActiveJobs(recentJobs)) {
      pollTimer = setTimeout(pollJobs, 1500);
    }
  }

  // Kick polling on mount if the server-rendered list shows active jobs.
  $effect(() => {
    startPollingIfActive();
  });

  onDestroy(() => {
    if (pollTimer) clearTimeout(pollTimer);
  });

  function toIsoOrUndef(local: string): string | undefined {
    if (!local) return undefined;
    // <input type="datetime-local"> emits "YYYY-MM-DDTHH:MM" in local TZ.
    const d = new Date(local);
    if (isNaN(d.getTime())) return undefined;
    return d.toISOString();
  }

  let backfillError = $state<string | null>(null);

  async function startBackfill(
    service: 'strava' | 'whoop',
    startStr: string,
    endStr: string,
  ) {
    backfillError = null;
    try {
      const res = await fetch(`/api/health/sync/backfill?service=${service}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start: toIsoOrUndef(startStr),
          end: toIsoOrUndef(endStr),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        backfillError = body.error ?? `Error ${res.status}`;
        return;
      }
      // Refresh server data + start polling
      await invalidateAll();
      recentJobs = data.recentJobs;
      pollTimer ??= setTimeout(pollJobs, 800);
    } catch {
      backfillError = 'Network error';
    }
  }

  async function cancelJob(jobId: string) {
    await fetch(`/api/health/sync/jobs/${jobId}/cancel`, { method: 'POST' });
    pollTimer ??= setTimeout(pollJobs, 400);
  }

  const stravaState = $derived(
    data.syncStates.find((s) => s.service === 'strava'),
  );
  const whoopState = $derived(
    data.syncStates.find((s) => s.service === 'whoop'),
  );

  const activeStravaJob = $derived(
    recentJobs.find(
      (j) => (j.service === 'strava' || j.service === 'all') &&
             (j.status === 'running' || j.status === 'queued'),
    ),
  );
  const activeWhoopJob = $derived(
    recentJobs.find(
      (j) => (j.service === 'whoop' || j.service === 'all') &&
             (j.status === 'running' || j.status === 'queued'),
    ),
  );
</script>

<div class="max-w-2xl mx-auto px-6 py-12">
  <!-- Header -->
  <div class="flex items-center justify-between mb-10">
    <a
      href="/"
      class="text-[10px] uppercase tracking-[0.3em]"
      style="color: var(--text-ghost); font-family: var(--font-mono);"
    >
      SR
    </a>
    <h1
      class="text-[10px] uppercase tracking-[0.3em]"
      style="color: var(--text-ghost); font-family: var(--font-mono);"
    >
      Health Connections
    </h1>
  </div>

  <!-- Success banner for just connected -->
  {#if data.justConnected}
    <div
      class="mb-6 p-4 rounded-lg text-sm"
      style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
    >
      Connected <span class="uppercase">{data.justConnected}</span> successfully.
    </div>
  {/if}

  <!-- Sync success banner -->
  {#if syncSuccess}
    <div
      class="mb-6 p-4 rounded-lg text-sm"
      style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
    >
      Sync triggered successfully.
    </div>
  {/if}

  <!-- Sync error banner -->
  {#if syncError}
    <div
      class="mb-6 p-4 rounded-lg text-sm"
      style="background: var(--card-bg); border: 1px solid var(--card-border); color: #8b3a1a; font-family: var(--font-mono);"
    >
      {syncError}
    </div>
  {/if}

  {#if backfillError}
    <div
      class="mb-6 p-4 rounded-lg text-sm"
      style="background: var(--card-bg); border: 1px solid var(--card-border); color: #8b3a1a; font-family: var(--font-mono);"
    >
      {backfillError}
    </div>
  {/if}

  <div class="space-y-4">
    <!-- Strava card -->
    <div
      class="p-5 rounded-xl border"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <div class="flex items-start justify-between">
        <div>
          <p
            class="text-[10px] uppercase tracking-[0.25em] mb-1"
            style="color: var(--text-ghost); font-family: var(--font-mono);"
          >
            Strava
          </p>
          <span
            class="text-[10px] uppercase tracking-[0.2em] px-2 py-0.5 rounded"
            style="font-family: var(--font-mono); background: {data.strava.connected
              ? 'rgba(var(--accent-rgb, 120,80,40), 0.15)'
              : 'rgba(0,0,0,0.08)'}; color: {data.strava.connected
              ? 'var(--accent)'
              : 'var(--text-ghost)'};"
          >
            {data.strava.connected ? 'Connected' : 'Disconnected'}
          </span>
          {#if stravaState}
            <p
              class="text-xs mt-2"
              style="color: var(--text-ghost); font-family: var(--font-mono);"
            >
              Last sync: {formatDate(stravaState.lastSyncAt)} &middot;
              <span style="color: {statusColor(stravaState.status)};"
                >{stravaState.status}</span
              >
              {#if stravaState.recordsSynced != null}
                &middot; {stravaState.recordsSynced} records
              {/if}
            </p>
            {#if stravaState.errorMessage && stravaState.status === 'error'}
              <p
                class="text-[11px] mt-1 break-words"
                style="color: #8b3a1a; font-family: var(--font-mono);"
              >
                {stravaState.errorMessage.slice(0, 240)}
                {stravaState.errorMessage.length > 240 ? '…' : ''}
              </p>
            {/if}
          {/if}
        </div>
        {#if !data.strava.connected}
          <a
            href="/api/health/strava/connect"
            class="text-[10px] uppercase tracking-[0.2em] px-3 py-2 rounded-lg transition-colors"
            style="background: var(--accent); color: white; font-family: var(--font-mono);"
          >
            Connect
          </a>
        {/if}
      </div>

      {#if data.strava.connected}
        <div
          class="mt-4 pt-4"
          style="border-top: 1px solid var(--card-border);"
        >
          <p
            class="text-[10px] uppercase tracking-[0.2em] mb-2"
            style="color: var(--text-ghost); font-family: var(--font-mono);"
          >
            Backfill range (optional)
          </p>
          <div class="flex flex-wrap gap-2 items-end">
            <label class="flex flex-col gap-1">
              <span class="text-[9px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">From</span>
              <input
                type="datetime-local"
                bind:value={stravaStart}
                disabled={!!activeStravaJob}
                class="text-xs px-2 py-1 rounded border"
                style="background: var(--bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-[9px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">To</span>
              <input
                type="datetime-local"
                bind:value={stravaEnd}
                disabled={!!activeStravaJob}
                class="text-xs px-2 py-1 rounded border"
                style="background: var(--bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
              />
            </label>
            <button
              onclick={() => startBackfill('strava', stravaStart, stravaEnd)}
              disabled={!!activeStravaJob}
              class="text-[10px] uppercase tracking-[0.2em] px-3 py-2 rounded-lg disabled:opacity-50"
              style="background: var(--accent); color: white; font-family: var(--font-mono);"
            >
              {activeStravaJob ? 'Running…' : 'Backfill Strava'}
            </button>
            {#if !stravaStart && !stravaEnd}
              <span class="text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
                (no range = all-time)
              </span>
            {/if}
          </div>
          {#if activeStravaJob}
            <div
              class="mt-3 text-xs flex items-center gap-3 flex-wrap"
              style="font-family: var(--font-mono); color: var(--text-ghost);"
            >
              <span style="color: var(--accent);">●</span>
              <span>{activeStravaJob.currentStep ?? activeStravaJob.status}</span>
              <span>{activeStravaJob.recordsSynced} records</span>
              {#if activeStravaJob.pagesDone > 0}
                <span>{activeStravaJob.pagesDone} pages</span>
              {/if}
              <button
                onclick={() => cancelJob(activeStravaJob!.id)}
                class="text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded border"
                style="border-color: var(--card-border); color: var(--text-primary); background: transparent;"
              >
                Cancel
              </button>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Whoop card -->
    <div
      class="p-5 rounded-xl border"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <div class="flex items-start justify-between">
        <div>
          <p
            class="text-[10px] uppercase tracking-[0.25em] mb-1"
            style="color: var(--text-ghost); font-family: var(--font-mono);"
          >
            Whoop
          </p>
          <span
            class="text-[10px] uppercase tracking-[0.2em] px-2 py-0.5 rounded"
            style="font-family: var(--font-mono); background: {data.whoop.connected
              ? 'rgba(var(--accent-rgb, 120,80,40), 0.15)'
              : 'rgba(0,0,0,0.08)'}; color: {data.whoop.connected
              ? 'var(--accent)'
              : 'var(--text-ghost)'};"
          >
            {data.whoop.connected ? 'Connected' : 'Disconnected'}
          </span>
          {#if whoopState}
            <p
              class="text-xs mt-2"
              style="color: var(--text-ghost); font-family: var(--font-mono);"
            >
              Last sync: {formatDate(whoopState.lastSyncAt)} &middot;
              <span style="color: {statusColor(whoopState.status)};"
                >{whoopState.status}</span
              >
              {#if whoopState.recordsSynced != null}
                &middot; {whoopState.recordsSynced} records
              {/if}
            </p>
            {#if whoopState.errorMessage && whoopState.status === 'error'}
              <p
                class="text-[11px] mt-1 break-words"
                style="color: #8b3a1a; font-family: var(--font-mono);"
              >
                {whoopState.errorMessage.slice(0, 240)}
                {whoopState.errorMessage.length > 240 ? '…' : ''}
              </p>
            {/if}
          {/if}
        </div>
        {#if !data.whoop.connected}
          <a
            href="/api/health/whoop/connect"
            class="text-[10px] uppercase tracking-[0.2em] px-3 py-2 rounded-lg transition-colors"
            style="background: var(--accent); color: white; font-family: var(--font-mono);"
          >
            Connect
          </a>
        {/if}
      </div>

      {#if data.whoop.connected}
        <div
          class="mt-4 pt-4"
          style="border-top: 1px solid var(--card-border);"
        >
          <p
            class="text-[10px] uppercase tracking-[0.2em] mb-2"
            style="color: var(--text-ghost); font-family: var(--font-mono);"
          >
            Backfill range (optional)
          </p>
          <div class="flex flex-wrap gap-2 items-end">
            <label class="flex flex-col gap-1">
              <span class="text-[9px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">From</span>
              <input
                type="datetime-local"
                bind:value={whoopStart}
                disabled={!!activeWhoopJob}
                class="text-xs px-2 py-1 rounded border"
                style="background: var(--bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-[9px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">To</span>
              <input
                type="datetime-local"
                bind:value={whoopEnd}
                disabled={!!activeWhoopJob}
                class="text-xs px-2 py-1 rounded border"
                style="background: var(--bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
              />
            </label>
            <button
              onclick={() => startBackfill('whoop', whoopStart, whoopEnd)}
              disabled={!!activeWhoopJob}
              class="text-[10px] uppercase tracking-[0.2em] px-3 py-2 rounded-lg disabled:opacity-50"
              style="background: var(--accent); color: white; font-family: var(--font-mono);"
            >
              {activeWhoopJob ? 'Running…' : 'Backfill Whoop'}
            </button>
            {#if !whoopStart && !whoopEnd}
              <span class="text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
                (no range = all-time)
              </span>
            {/if}
          </div>
          {#if activeWhoopJob}
            <div
              class="mt-3 text-xs flex items-center gap-3 flex-wrap"
              style="font-family: var(--font-mono); color: var(--text-ghost);"
            >
              <span style="color: var(--accent);">●</span>
              <span>{activeWhoopJob.currentStep ?? activeWhoopJob.status}</span>
              <span>{activeWhoopJob.recordsSynced} records</span>
              <button
                onclick={() => cancelJob(activeWhoopJob!.id)}
                class="text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded border"
                style="border-color: var(--card-border); color: var(--text-primary); background: transparent;"
              >
                Cancel
              </button>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Apple Health card -->
    <div
      class="p-5 rounded-xl border"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <div class="flex items-start justify-between">
        <div class="flex-1">
          <p
            class="text-[10px] uppercase tracking-[0.25em] mb-1"
            style="color: var(--text-ghost); font-family: var(--font-mono);"
          >
            Apple Health
          </p>
          <span
            class="text-[10px] uppercase tracking-[0.2em] px-2 py-0.5 rounded"
            style="font-family: var(--font-mono); background: rgba(var(--accent-rgb, 120,80,40), 0.15); color: var(--accent);"
          >
            Webhook
          </span>
          <p
            class="text-xs mt-2 break-all"
            style="color: var(--text-ghost); font-family: var(--font-mono);"
          >
            Endpoint: /api/health/apple/ingest
          </p>
        </div>
      </div>
    </div>
  </div>

  <!-- Blog Posts link -->
  <div class="mt-4">
    <a
      href="/admin/blog?token={adminToken}"
      class="block p-5 rounded-xl border transition-colors"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <div class="flex items-center justify-between">
        <div>
          <p
            class="text-[10px] uppercase tracking-[0.25em] mb-1"
            style="color: var(--text-ghost); font-family: var(--font-mono);"
          >
            Blog Posts
          </p>
          <p
            class="text-xs"
            style="color: var(--text-ghost); font-family: var(--font-mono);"
          >
            Create, edit, and publish posts
          </p>
        </div>
        <span
          class="text-[10px] uppercase tracking-[0.2em]"
          style="color: var(--text-ghost); font-family: var(--font-mono);"
        >
          &rarr;
        </span>
      </div>
    </a>
  </div>

  <!-- Biome Settings link -->
  <div class="mt-4">
    <a
      href="/admin/biome?token={adminToken}"
      class="block p-5 rounded-xl border transition-colors"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <div class="flex items-center justify-between">
        <div>
          <p
            class="text-[10px] uppercase tracking-[0.25em] mb-1"
            style="color: var(--text-ghost); font-family: var(--font-mono);"
          >
            Biome Settings
          </p>
          <p
            class="text-xs"
            style="color: var(--text-ghost); font-family: var(--font-mono);"
          >
            Visual effects, particle density, fog intensity
          </p>
        </div>
        <span
          class="text-[10px] uppercase tracking-[0.2em]"
          style="color: var(--text-ghost); font-family: var(--font-mono);"
        >
          &rarr;
        </span>
      </div>
    </a>
  </div>

  <!-- API Keys link -->
  <div class="mt-4">
    <a
      href="/admin/keys?token={adminToken}"
      class="block p-5 rounded-xl border transition-colors"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <div class="flex items-center justify-between">
        <div>
          <p
            class="text-[10px] uppercase tracking-[0.25em] mb-1"
            style="color: var(--text-ghost); font-family: var(--font-mono);"
          >
            API Keys
          </p>
          <p
            class="text-xs"
            style="color: var(--text-ghost); font-family: var(--font-mono);"
          >
            Z.AI, OpenRouter, ElevenLabs, Tavily — one place to update them all
          </p>
        </div>
        <span
          class="text-[10px] uppercase tracking-[0.2em]"
          style="color: var(--text-ghost); font-family: var(--font-mono);"
        >
          &rarr;
        </span>
      </div>
    </a>
  </div>

  <!-- LLM Models link -->
  <div class="mt-4">
    <a
      href="/admin/models?token={adminToken}"
      class="block p-5 rounded-xl border transition-colors"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <div class="flex items-center justify-between">
        <div>
          <p
            class="text-[10px] uppercase tracking-[0.25em] mb-1"
            style="color: var(--text-ghost); font-family: var(--font-mono);"
          >
            LLM Models
          </p>
          <p
            class="text-xs"
            style="color: var(--text-ghost); font-family: var(--font-mono);"
          >
            Pick default GLM + alt OpenRouter model, browse catalogue, refresh
          </p>
        </div>
        <span
          class="text-[10px] uppercase tracking-[0.2em]"
          style="color: var(--text-ghost); font-family: var(--font-mono);"
        >
          &rarr;
        </span>
      </div>
    </a>
  </div>

  <!-- Custom Tools link -->
  <div class="mt-4">
    <a
      href="/admin/tools?token={adminToken}"
      class="block p-5 rounded-xl border transition-colors"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <div class="flex items-center justify-between">
        <div>
          <p
            class="text-[10px] uppercase tracking-[0.25em] mb-1"
            style="color: var(--text-ghost); font-family: var(--font-mono);"
          >
            Custom Tools
          </p>
          <p
            class="text-xs"
            style="color: var(--text-ghost); font-family: var(--font-mono);"
          >
            Inspect, disable, or delete tools the assistant has built
          </p>
        </div>
        <span
          class="text-[10px] uppercase tracking-[0.2em]"
          style="color: var(--text-ghost); font-family: var(--font-mono);"
        >
          &rarr;
        </span>
      </div>
    </a>
  </div>

  <!-- Sync Now button -->
  <div class="mt-8 flex justify-end">
    <button
      onclick={syncNow}
      disabled={syncing}
      class="text-[10px] uppercase tracking-[0.2em] px-5 py-3 rounded-lg transition-colors disabled:opacity-50"
      style="background: var(--accent); color: white; font-family: var(--font-mono);"
    >
      {syncing ? 'Syncing…' : 'Sync Now'}
    </button>
  </div>

  <!-- Recent backfill jobs -->
  {#if recentJobs.length > 0}
    <div class="mt-10">
      <p
        class="text-[10px] uppercase tracking-[0.3em] mb-3"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >
        Recent Backfill Jobs
      </p>
      <div class="space-y-2">
        {#each recentJobs as job (job.id)}
          <div
            class="p-3 rounded-lg border text-xs"
            style="background: var(--card-bg); border-color: var(--card-border); font-family: var(--font-mono);"
          >
            <div class="flex items-center justify-between gap-3 flex-wrap">
              <div class="flex items-center gap-3 flex-wrap">
                <span class="uppercase tracking-[0.2em]" style="color: var(--text-primary);">
                  {job.service}
                </span>
                <span class="uppercase tracking-[0.2em]" style="color: {statusColor(job.status)};">
                  {job.status}
                </span>
                <span style="color: var(--text-ghost);">{job.recordsSynced} records</span>
                {#if job.currentStep}
                  <span style="color: var(--text-ghost);">{job.currentStep}</span>
                {/if}
              </div>
              <span style="color: var(--text-ghost);">
                {formatDate(job.startedAt)}{job.finishedAt ? ` → ${formatDate(job.finishedAt)}` : ''}
              </span>
            </div>
            {#if job.errorMessage}
              <p
                class="mt-2 text-[11px] break-words"
                style="color: #8b3a1a;"
              >
                {job.errorMessage.slice(0, 240)}{job.errorMessage.length > 240 ? '…' : ''}
              </p>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
