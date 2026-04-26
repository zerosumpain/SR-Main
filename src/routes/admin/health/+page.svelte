<svelte:head><title>Health Connections — Admin</title></svelte:head>
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  function fmtDate(unixTs: number | null | undefined): string {
    if (!unixTs) return 'Never';
    return new Date(unixTs * 1000).toLocaleString();
  }

  let syncing = $state(false);
  let syncSuccess = $state(false);
  let syncError = $state<string | null>(null);

  async function syncNow() {
    syncing = true;
    syncError = null;
    try {
      const res = await fetch(`/api/health/sync`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        syncError = body.error ?? `Error ${res.status}`;
      } else {
        syncSuccess = true;
        setTimeout(() => (syncSuccess = false), 4000);
        await invalidateAll();
      }
    } catch {
      syncError = 'Network error';
    } finally {
      syncing = false;
    }
  }

  let stravaStart = $state('');
  let stravaEnd = $state('');
  let whoopStart = $state('');
  let whoopEnd = $state('');

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
          await invalidateAll();
          return;
        }
      }
    } catch {
      // ignore transient
    }
    pollTimer = setTimeout(pollJobs, 1500);
  }

  $effect(() => {
    if (!pollTimer && hasActiveJobs(recentJobs)) {
      pollTimer = setTimeout(pollJobs, 1500);
    }
  });

  onDestroy(() => { if (pollTimer) clearTimeout(pollTimer); });

  function toIso(local: string): string | undefined {
    if (!local) return undefined;
    const d = new Date(local);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  }

  let backfillError = $state<string | null>(null);

  async function startBackfill(service: 'strava' | 'whoop', start: string, end: string) {
    backfillError = null;
    try {
      const res = await fetch(`/api/health/sync/backfill?service=${service}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: toIso(start), end: toIso(end) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        backfillError = body.error ?? `Error ${res.status}`;
        return;
      }
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

  const stravaState = $derived(data.syncStates.find((s) => s.service === 'strava'));
  const whoopState = $derived(data.syncStates.find((s) => s.service === 'whoop'));

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

<PageWrap>
  <PageHeader
    kicker="Health"
    title="Connections & Sync"
    sub="Manage Strava, Whoop, and Apple Health pipelines. Backfill ranges or trigger an on-demand sync."
  >
    {#snippet actions()}
      <button class="nm-save-btn" onclick={syncNow} disabled={syncing}>
        {syncing ? 'Syncing…' : 'Sync now'}
      </button>
    {/snippet}
  </PageHeader>

  {#if data.justConnected}
    <div class="banner banner-success">Connected <strong>{data.justConnected}</strong> successfully.</div>
  {/if}
  {#if syncSuccess}
    <div class="banner banner-success">Sync triggered.</div>
  {/if}
  {#if syncError}
    <div class="banner banner-error">{syncError}</div>
  {/if}
  {#if backfillError}
    <div class="banner banner-error">{backfillError}</div>
  {/if}

  <!-- Strava -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Strava</span>
      <span
        class="nm-pill"
        data-state={data.strava.connected ? 'connected' : 'disconnected'}
      >{data.strava.connected ? 'Connected' : 'Disconnected'}</span>
      <span class="nm-sec-meta">
        {#if stravaState}
          last sync {fmtDate(stravaState.lastSyncAt)}
          {#if stravaState.recordsSynced != null} · {stravaState.recordsSynced} records{/if}
        {/if}
      </span>
    </div>

    {#if stravaState?.errorMessage && stravaState.status === 'error'}
      <div class="banner banner-error">{stravaState.errorMessage.slice(0, 280)}{stravaState.errorMessage.length > 280 ? '…' : ''}</div>
    {/if}

    {#if !data.strava.connected}
      <a class="nm-save-btn" href="/api/health/strava/connect">Connect Strava</a>
    {:else}
      <div class="backfill-row">
        <label class="nm-field">
          <span class="sr-label-tight">From</span>
          <input class="nm-text-input" type="datetime-local" bind:value={stravaStart} disabled={!!activeStravaJob} />
        </label>
        <label class="nm-field">
          <span class="sr-label-tight">To</span>
          <input class="nm-text-input" type="datetime-local" bind:value={stravaEnd} disabled={!!activeStravaJob} />
        </label>
        <button
          class="nm-save-btn"
          onclick={() => startBackfill('strava', stravaStart, stravaEnd)}
          disabled={!!activeStravaJob}
        >
          {activeStravaJob ? 'Running…' : 'Backfill'}
        </button>
        {#if !stravaStart && !stravaEnd}
          <span class="hint">empty range = all-time</span>
        {/if}
      </div>
      {#if activeStravaJob}
        <div class="active-line">
          <span class="live-dot"></span>
          <span>{activeStravaJob.currentStep ?? activeStravaJob.status}</span>
          <span>· {activeStravaJob.recordsSynced} records</span>
          {#if activeStravaJob.pagesDone > 0}<span>· {activeStravaJob.pagesDone} pages</span>{/if}
          <button class="nm-link-btn" onclick={() => cancelJob(activeStravaJob!.id)}>Cancel</button>
        </div>
      {/if}
    {/if}
  </section>

  <!-- Whoop -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Whoop</span>
      <span
        class="nm-pill"
        data-state={data.whoop.connected ? 'connected' : 'disconnected'}
      >{data.whoop.connected ? 'Connected' : 'Disconnected'}</span>
      <span class="nm-sec-meta">
        {#if whoopState}
          last sync {fmtDate(whoopState.lastSyncAt)}
          {#if whoopState.recordsSynced != null} · {whoopState.recordsSynced} records{/if}
        {/if}
      </span>
    </div>

    {#if whoopState?.errorMessage && whoopState.status === 'error'}
      <div class="banner banner-error">{whoopState.errorMessage.slice(0, 280)}{whoopState.errorMessage.length > 280 ? '…' : ''}</div>
    {/if}

    {#if !data.whoop.connected}
      <a class="nm-save-btn" href="/api/health/whoop/connect">Connect Whoop</a>
    {:else}
      <div class="backfill-row">
        <label class="nm-field">
          <span class="sr-label-tight">From</span>
          <input class="nm-text-input" type="datetime-local" bind:value={whoopStart} disabled={!!activeWhoopJob} />
        </label>
        <label class="nm-field">
          <span class="sr-label-tight">To</span>
          <input class="nm-text-input" type="datetime-local" bind:value={whoopEnd} disabled={!!activeWhoopJob} />
        </label>
        <button
          class="nm-save-btn"
          onclick={() => startBackfill('whoop', whoopStart, whoopEnd)}
          disabled={!!activeWhoopJob}
        >
          {activeWhoopJob ? 'Running…' : 'Backfill'}
        </button>
        {#if !whoopStart && !whoopEnd}
          <span class="hint">empty range = all-time</span>
        {/if}
      </div>
      {#if activeWhoopJob}
        <div class="active-line">
          <span class="live-dot"></span>
          <span>{activeWhoopJob.currentStep ?? activeWhoopJob.status}</span>
          <span>· {activeWhoopJob.recordsSynced} records</span>
          <button class="nm-link-btn" onclick={() => cancelJob(activeWhoopJob!.id)}>Cancel</button>
        </div>
      {/if}
    {/if}
  </section>

  <!-- Apple Health -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Apple Health</span>
      <span class="nm-pill" data-state="connected">Webhook</span>
      <span class="nm-sec-meta">/api/health/apple/ingest</span>
    </div>
    <p class="muted">HR + activity from the Apple device webhook. No backfill controls — data lands as the watch reports it.</p>
  </section>

  <!-- Recent jobs -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Recent Backfill Jobs</span>
      <span class="nm-sec-meta">{recentJobs.length}</span>
    </div>

    {#if recentJobs.length === 0}
      <div class="nm-empty">No backfill jobs yet.</div>
    {:else}
      <table class="nm-table">
        <thead>
          <tr>
            <th>Service</th>
            <th>Status</th>
            <th>Records</th>
            <th>Step</th>
            <th>Started</th>
            <th>Finished</th>
          </tr>
        </thead>
        <tbody>
          {#each recentJobs as job (job.id)}
            <tr>
              <td>{job.service}</td>
              <td><span class="nm-pill" data-state={job.status}>{job.status}</span></td>
              <td>{job.recordsSynced}</td>
              <td>{job.currentStep ?? '—'}</td>
              <td>{fmtDate(job.startedAt)}</td>
              <td>{job.finishedAt ? fmtDate(job.finishedAt) : '—'}</td>
            </tr>
            {#if job.errorMessage}
              <tr><td colspan="6" class="row-err">{job.errorMessage.slice(0, 280)}{job.errorMessage.length > 280 ? '…' : ''}</td></tr>
            {/if}
          {/each}
        </tbody>
      </table>
    {/if}
  </section>
</PageWrap>

<style>
  .backfill-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    align-items: end;
  }
  .backfill-row .nm-field { min-width: 180px; }
  .hint {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
  }
  .active-line {
    margin-top: 0.6rem;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-secondary);
  }
  .muted {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-secondary);
  }
  .row-err {
    font-family: var(--font-mono);
    font-size: 10px;
    color: #c44;
    background: rgba(196, 68, 68, 0.05);
  }
</style>
