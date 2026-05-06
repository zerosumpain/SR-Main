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

  type ActivityRow = (typeof data.recentActivities)[number];
  let featured = $state<ActivityRow[]>(data.featuredActivities);
  let recent = $state<ActivityRow[]>(data.recentActivities);
  let featureBusyId = $state<number | null>(null);
  let featureError = $state<string | null>(null);
  let captionDraft = $state<Record<number, string>>({});

  // ---------- Discovery filters ----------
  type SortMode = 'epic' | 'date' | 'distance' | 'elevation' | 'duration';
  let sortMode = $state<SortMode>('date');
  let minKm = $state<number>(0);
  let minElev = $state<number>(0);
  let hideFeatured = $state<boolean>(false);
  let activeSports = $state<Record<string, boolean>>({});

  const allSports = $derived.by(() => {
    const set = new Set<string>();
    for (const a of recent) set.add(a.sportType || a.type);
    return [...set].sort();
  });

  // Composite "epicness" — weighted to surface long, climby, lengthy efforts.
  // 1 km ≈ 1 elev m ≈ 6 minutes of moving time on this scale.
  function epicScore(a: ActivityRow): number {
    const km = a.distance / 1000;
    const elevM = a.totalElevationGain || 0;
    const moveMin = a.movingTime / 60;
    return km * 5 + elevM + moveMin / 6;
  }

  const filteredRecent = $derived.by(() => {
    const anySportSelected = Object.values(activeSports).some(Boolean);
    let rows = recent.filter((a) => {
      if (hideFeatured && a.featured) return false;
      if (a.distance / 1000 < minKm) return false;
      if ((a.totalElevationGain || 0) < minElev) return false;
      if (anySportSelected && !activeSports[a.sportType || a.type]) return false;
      return true;
    });
    rows = rows.slice().sort((x, y) => {
      switch (sortMode) {
        case 'epic': return epicScore(y) - epicScore(x);
        case 'distance': return y.distance - x.distance;
        case 'elevation': return (y.totalElevationGain || 0) - (x.totalElevationGain || 0);
        case 'duration': return y.movingTime - x.movingTime;
        case 'date':
        default: return y.startDate - x.startDate;
      }
    });
    return rows;
  });

  function toggleSport(sport: string) {
    activeSports = { ...activeSports, [sport]: !activeSports[sport] };
  }
  function clearFilters() {
    minKm = 0;
    minElev = 0;
    hideFeatured = false;
    activeSports = {};
    sortMode = 'date';
  }
  function presetEpicCandidates() {
    minKm = 15;
    minElev = 500;
    hideFeatured = true;
    sortMode = 'epic';
  }

  function fmtKm(m: number): string {
    return (m / 1000).toFixed(1);
  }
  function fmtDur(s: number): string {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m}m`;
  }
  function fmtDay(unix: number): string {
    return new Date(unix * 1000).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  async function patchActivity(
    id: number,
    body: { featured?: boolean; featuredOrder?: number | null; featuredCaption?: string | null },
  ): Promise<boolean> {
    featureError = null;
    featureBusyId = id;
    try {
      const res = await fetch(`/api/health/activity/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        featureError = errBody.error ?? `Error ${res.status}`;
        return false;
      }
      return true;
    } catch {
      featureError = 'Network error';
      return false;
    } finally {
      featureBusyId = null;
    }
  }

  async function reloadActivities() {
    const [allRes, featRes] = await Promise.all([
      fetch('/api/health/activity?limit=60'),
      fetch('/api/health/activity?featured=1&limit=200'),
    ]);
    if (allRes.ok) recent = (await allRes.json()).activities;
    if (featRes.ok) featured = (await featRes.json()).activities;
  }

  async function toggleFeatured(activity: ActivityRow) {
    const ok = await patchActivity(activity.id, { featured: !activity.featured });
    if (ok) await reloadActivities();
  }

  async function saveCaption(activity: ActivityRow) {
    const next = (captionDraft[activity.id] ?? activity.featuredCaption ?? '').trim();
    const ok = await patchActivity(activity.id, { featuredCaption: next.length === 0 ? null : next });
    if (ok) {
      delete captionDraft[activity.id];
      await reloadActivities();
    }
  }

  async function moveFeatured(activity: ActivityRow, dir: -1 | 1) {
    const idx = featured.findIndex((a) => a.id === activity.id);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= featured.length) return;
    const ordered = [...featured];
    [ordered[idx], ordered[swapIdx]] = [ordered[swapIdx], ordered[idx]];
    // Persist 1-based order for everyone in the list to keep it deterministic.
    for (let i = 0; i < ordered.length; i++) {
      const a = ordered[i];
      if (a.featuredOrder !== i + 1) {
        const ok = await patchActivity(a.id, { featuredOrder: i + 1 });
        if (!ok) return;
      }
    }
    await reloadActivities();
  }

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

  <!-- Epic activities (featured) -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Epic Activities · /health</span>
      <span class="nm-sec-meta">{featured.length} featured</span>
    </div>
    <p class="muted">Mark Strava activities as featured to surface them in the "Epic Activities" rail on the public /health page. Add an optional caption, reorder with the arrows.</p>

    {#if featureError}
      <div class="banner banner-error">{featureError}</div>
    {/if}

    {#if featured.length === 0}
      <div class="nm-empty">Nothing featured yet. Pick one from the recent list below.</div>
    {:else}
      <ul class="ep-list">
        {#each featured as a, i (a.id)}
          <li class="ep-row">
            <div class="ep-meta">
              <p class="ep-title">{a.name}</p>
              <p class="ep-sub">
                <span>{a.sportType || a.type}</span>
                <span>· {fmtDay(a.startDate)}</span>
                <span>· {fmtKm(a.distance)} km</span>
                <span>· {fmtDur(a.movingTime)}</span>
                {#if a.totalElevationGain}<span>· {Math.round(a.totalElevationGain)} m</span>{/if}
              </p>
            </div>

            <div class="ep-caption">
              <input
                class="nm-text-input"
                type="text"
                maxlength="280"
                placeholder="Optional caption shown on /health"
                value={captionDraft[a.id] ?? a.featuredCaption ?? ''}
                oninput={(e) => (captionDraft[a.id] = (e.currentTarget as HTMLInputElement).value)}
              />
              <button
                class="nm-link-btn"
                disabled={featureBusyId === a.id}
                onclick={() => saveCaption(a)}
              >Save caption</button>
            </div>

            <div class="ep-actions">
              <button class="nm-link-btn" onclick={() => moveFeatured(a, -1)} disabled={i === 0 || featureBusyId === a.id} title="Move up">↑</button>
              <button class="nm-link-btn" onclick={() => moveFeatured(a, 1)} disabled={i === featured.length - 1 || featureBusyId === a.id} title="Move down">↓</button>
              <button class="nm-link-btn danger" onclick={() => toggleFeatured(a)} disabled={featureBusyId === a.id}>Remove</button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- Pick from recent -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Strava Activities · Picker</span>
      <span class="nm-sec-meta">{filteredRecent.length} / {recent.length}</span>
    </div>

    {#if recent.length === 0}
      <div class="nm-empty">No Strava activities synced yet. Connect Strava and run a backfill above.</div>
    {:else}
      <div class="ep-filters">
        <div class="ep-filter-row">
          <span class="sr-label-tight">Sort</span>
          <select class="nm-text-input" bind:value={sortMode}>
            <option value="date">Date (newest first)</option>
            <option value="epic">Epicness (combined score)</option>
            <option value="distance">Distance</option>
            <option value="elevation">Elevation gain</option>
            <option value="duration">Moving time</option>
          </select>
          <label class="ep-filter-num">
            <span class="sr-label-tight">Min km</span>
            <input class="nm-text-input" type="number" min="0" step="1" bind:value={minKm} />
          </label>
          <label class="ep-filter-num">
            <span class="sr-label-tight">Min elev (m)</span>
            <input class="nm-text-input" type="number" min="0" step="50" bind:value={minElev} />
          </label>
          <label class="ep-toggle">
            <input type="checkbox" bind:checked={hideFeatured} />
            <span>Hide already featured</span>
          </label>
          <button class="nm-link-btn" onclick={presetEpicCandidates} title="≥15 km · ≥500 m climb · sort by epicness">Epic candidates</button>
          <button class="nm-link-btn" onclick={clearFilters}>Clear</button>
        </div>
        <div class="ep-filter-row ep-chips">
          <span class="sr-label-tight">Sport</span>
          {#each allSports as sport (sport)}
            <button
              class="nm-chip"
              class:on={activeSports[sport]}
              onclick={() => toggleSport(sport)}
            >{sport}</button>
          {/each}
        </div>
      </div>

      {#if filteredRecent.length === 0}
        <div class="nm-empty">No activities match the current filters.</div>
      {:else}
        <table class="nm-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Activity</th>
              <th>Type</th>
              <th>Distance</th>
              <th>Time</th>
              <th>Elev</th>
              {#if sortMode === 'epic'}<th>Score</th>{/if}
              <th>Featured</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredRecent as a (a.id)}
              <tr>
                <td>{fmtDay(a.startDate)}</td>
                <td class="ep-name">{a.name}</td>
                <td>{a.sportType || a.type}</td>
                <td>{fmtKm(a.distance)} km</td>
                <td>{fmtDur(a.movingTime)}</td>
                <td>{a.totalElevationGain ? `${Math.round(a.totalElevationGain)}m` : '—'}</td>
                {#if sortMode === 'epic'}<td class="ep-score">{Math.round(epicScore(a))}</td>{/if}
                <td>
                  <button
                    class="nm-link-btn"
                    class:on={a.featured}
                    disabled={featureBusyId === a.id}
                    onclick={() => toggleFeatured(a)}
                  >{a.featured ? '★ featured' : '☆ feature'}</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {/if}
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

  .ep-list {
    list-style: none;
    padding: 0;
    margin: 0.6rem 0 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .ep-row {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1.6fr) auto;
    gap: 0.75rem;
    align-items: center;
    padding: 0.55rem 0.6rem;
    border: 1px solid var(--divider);
    background: var(--card-bg, transparent);
  }
  .ep-meta { min-width: 0; }
  .ep-title {
    margin: 0;
    font-size: 13px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ep-sub {
    margin: 2px 0 0;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .ep-caption {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    min-width: 0;
  }
  .ep-caption .nm-text-input {
    flex: 1;
    min-width: 0;
  }
  .ep-actions {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .ep-name {
    max-width: 360px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .nm-link-btn.on {
    color: var(--accent);
  }
  .nm-link-btn.danger {
    color: #c44;
  }

  @media (max-width: 720px) {
    .ep-row {
      grid-template-columns: 1fr;
    }
  }

  .ep-filters {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0.4rem 0 0.8rem;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--divider);
    background: var(--card-bg, transparent);
  }
  .ep-filter-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
  }
  .ep-filter-row > .nm-text-input,
  .ep-filter-row select {
    width: auto;
    min-width: 140px;
  }
  .ep-filter-num {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ep-filter-num input {
    width: 90px;
  }
  .ep-toggle {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 12px;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .ep-chips {
    gap: 0.35rem;
  }
  .nm-chip {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    padding: 3px 8px;
    border: 1px solid var(--divider);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    text-transform: uppercase;
  }
  .nm-chip:hover {
    border-color: var(--text-muted);
  }
  .nm-chip.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }
  .ep-score {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--accent);
  }
</style>
