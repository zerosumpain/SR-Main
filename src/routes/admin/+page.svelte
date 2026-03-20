<svelte:head><title>Admin — Strange Ramblings</title></svelte:head>
<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  function formatDate(unixTs: number | null | undefined): string {
    if (!unixTs) return 'Never';
    return new Date(unixTs * 1000).toLocaleString();
  }

  function statusColor(status: string): string {
    if (status === 'idle') return 'var(--text-ghost)';
    if (status === 'syncing') return 'var(--accent)';
    if (status === 'error') return '#8b3a1a';
    return 'var(--text-ghost)';
  }

  async function syncNow() {
    syncing = true;
    syncError = null;
    try {
      const res = await fetch('/api/health/sync', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        syncError = body.error ?? `Error ${res.status}`;
      } else {
        syncSuccess = true;
        setTimeout(() => (syncSuccess = false), 4000);
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

  const stravaState = $derived(
    data.syncStates.find((s) => s.service === 'strava'),
  );
  const whoopState = $derived(
    data.syncStates.find((s) => s.service === 'whoop'),
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
</div>
