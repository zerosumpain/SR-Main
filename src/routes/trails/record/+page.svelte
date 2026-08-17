<script lang="ts">
  import { onDestroy } from 'svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { startTracking, requestWakeLock, type Fix, type TrackerHandle } from '$lib/trails/field/tracker';
  import { routeProgress, type LngLat } from '$lib/trails/field/nav';
  import { haversineM, type TrackPoint } from '$lib/trails/track';
  import type { Coord } from '$lib/trails/scoring';
  import { formatDistance, formatDuration, formatPace, formatElevation, activityLabel } from '$lib/trails/format';

  let { data } = $props();

  const SPORTS = ['run', 'trail_run', 'ride', 'mtb', 'hike', 'walk'] as const;

  let sport = $state<(typeof SPORTS)[number]>(
    (data.route?.sport as (typeof SPORTS)[number]) ?? 'run',
  );
  let status = $state<'idle' | 'recording' | 'paused' | 'finished'>('idle');
  let error = $state<string | null>(null);
  let saving = $state(false);
  let savedActivityId = $state<string | null>(null);

  // Live stats, read by the template — genuinely reactive.
  let distanceM = $state(0);
  let elapsedS = $state(0);
  let movingS = $state(0);
  let ascentM = $state(0);
  let fixAccuracy = $state<number | null>(null);
  let pointCount = $state(0);
  let offRouteM = $state<number | null>(null);
  let progressFraction = $state<number | null>(null);
  let remainingM = $state<number | null>(null);

  // Machinery — deliberately NOT $state. A tracker handle or interval id that
  // an effect both reads and writes subscribes that effect to itself.
  let tracker: TrackerHandle | null = null;
  let wakeLock: { release: () => void } | null = null;
  let ticker: ReturnType<typeof setInterval> | null = null;
  let track: TrackPoint[] = [];
  let startedAtMs = 0;
  let pausedAccumS = 0;
  let lastFix: Fix | null = null;
  let lastElevation: number | null = null;
  const clientId = crypto.randomUUID();

  const routeLine: LngLat[] = data.route
    ? (data.route.coordinates as Coord[]).map(([lng, lat]) => [lng, lat] as LngLat)
    : [];

  const paceSPerKm = $derived(distanceM > 0 ? (movingS / distanceM) * 1000 : null);

  function onFix(fix: Fix, verdict: string) {
    fixAccuracy = fix.accuracy;
    if (verdict === 'reject' || status !== 'recording') return;

    if (lastFix) {
      distanceM += haversineM([lastFix.lng, lastFix.lat], [fix.lng, fix.lat]);
    }
    // Same 1 m threshold the ingest uses — barometric altitude jitters at rest
    // and summing raw deltas turns flat ground into hundreds of metres of climb.
    if (fix.elevation != null) {
      if (lastElevation != null && fix.elevation - lastElevation > 1) {
        ascentM += fix.elevation - lastElevation;
        lastElevation = fix.elevation;
      } else if (lastElevation == null || fix.elevation < lastElevation - 1) {
        lastElevation = fix.elevation;
      }
    }

    lastFix = fix;
    track.push([
      fix.lng,
      fix.lat,
      fix.elevation,
      Math.round((fix.timestamp - startedAtMs) / 1000),
    ]);
    pointCount = track.length;

    if (routeLine.length > 1) {
      const p = routeProgress([fix.lng, fix.lat], routeLine);
      if (p) {
        offRouteM = p.offRouteM;
        progressFraction = p.fraction;
        remainingM = p.remainingM;
      }
    }
  }

  function tick() {
    if (status !== 'recording') return;
    elapsedS = Math.round((Date.now() - startedAtMs) / 1000);
    movingS = elapsedS - pausedAccumS;
  }

  async function begin() {
    error = null;
    if (!navigator.geolocation) {
      error = 'This browser has no geolocation.';
      return;
    }
    startedAtMs = Date.now();
    track = [];
    distanceM = 0;
    ascentM = 0;
    elapsedS = 0;
    movingS = 0;
    pausedAccumS = 0;
    lastFix = null;
    lastElevation = null;
    savedActivityId = null;
    status = 'recording';

    wakeLock = await requestWakeLock();
    tracker = startTracking({
      onFix,
      onError: (e) => (error = `GPS: ${e.message}`),
    });
    ticker = setInterval(tick, 1000);
  }

  function pause() {
    if (status !== 'recording') return;
    status = 'paused';
    lastFix = null; // do not draw a straight line across the pause
  }

  function resume() {
    if (status !== 'paused') return;
    status = 'recording';
  }

  function cleanup() {
    tracker?.stop();
    tracker = null;
    wakeLock?.release();
    wakeLock = null;
    if (ticker) clearInterval(ticker);
    ticker = null;
  }

  function finish() {
    cleanup();
    status = 'finished';
  }

  function discard() {
    cleanup();
    track = [];
    pointCount = 0;
    status = 'idle';
    savedActivityId = null;
  }

  async function save() {
    if (track.length < 2) {
      error = 'Not enough GPS points to save.';
      return;
    }
    saving = true;
    error = null;
    try {
      const res = await fetch('/api/trails/recordings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId,
          name: data.route ? data.route.name : `${activityLabel(sport)} recording`,
          sport,
          startedAt: Math.round(startedAtMs / 1000),
          finishedAt: Math.round(startedAtMs / 1000) + elapsedS,
          movingS,
          track,
          routeId: data.route?.id ?? null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        error = body?.error ?? 'Could not save the recording';
        return;
      }
      savedActivityId = body.activityId;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  onDestroy(cleanup);
</script>

<svelte:head>
  <title>Record — Trails</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<PageHeader title="Strange Ramblings" />

<main class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">Trails · Record</div>
      <h1>Record</h1>
      <p class="sub">
        {#if data.route}Following <strong>{data.route.name}</strong>.{:else}Free recording — it will
          land on /trails as an activity when you save.{/if}
      </p>
    </div>
    <a class="back-link" href="/trails">All trails</a>
  </header>

  <section class="nm-sec live">
    <div class="big">
      <span class="big-value">{formatDistance(distanceM)}</span>
      <span class="sr-label-tight">Distance</span>
    </div>
    <div class="big">
      <span class="big-value">{formatDuration(elapsedS)}</span>
      <span class="sr-label-tight">Elapsed</span>
    </div>
    <div class="big">
      <span class="big-value">{formatPace(paceSPerKm)}</span>
      <span class="sr-label-tight">Pace</span>
    </div>
    <div class="big">
      <span class="big-value">{formatElevation(ascentM)}</span>
      <span class="sr-label-tight">Climb</span>
    </div>
  </section>

  {#if data.route && progressFraction != null}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Along the route</span>
        <span class="nm-sec-meta">{formatDistance(remainingM ?? 0)} to go</span>
      </div>
      <div class="bar"><span style:width="{progressFraction * 100}%"></span></div>
      {#if offRouteM != null}
        <p class="off-route" class:warn={offRouteM > 50}>
          {offRouteM > 50 ? 'Off route' : 'On route'} — {Math.round(offRouteM)} m from the line
        </p>
      {/if}
    </section>
  {/if}

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Status</span>
      <span class="nm-sec-meta">
        {pointCount} points{#if fixAccuracy != null} · ±{Math.round(fixAccuracy)} m{/if}
      </span>
    </div>

    {#if status === 'idle'}
      <div class="field-row">
        <span class="sr-label-tight">Sport</span>
        <div class="chips">
          {#each SPORTS as s (s)}
            <button type="button" class="chip" class:on={sport === s} onclick={() => (sport = s)}>
              {activityLabel(s)}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <div class="actions">
      {#if status === 'idle'}
        <button class="nm-save-btn" onclick={begin}>Start recording</button>
      {:else if status === 'recording'}
        <button class="nm-save-btn" onclick={pause}>Pause</button>
        <button class="row-link" onclick={finish}>Finish</button>
      {:else if status === 'paused'}
        <button class="nm-save-btn" onclick={resume}>Resume</button>
        <button class="row-link" onclick={finish}>Finish</button>
      {:else}
        <button class="nm-save-btn" onclick={save} disabled={saving || !!savedActivityId}>
          {saving ? 'Saving…' : savedActivityId ? 'Saved' : 'Save activity'}
        </button>
        {#if savedActivityId}
          <a class="row-link" href="/trails/{encodeURIComponent(savedActivityId)}">Open it</a>
        {:else}
          <button class="row-link danger" onclick={discard}>Discard</button>
        {/if}
      {/if}
    </div>

    {#if error}<p class="error-line">{error}</p>{/if}

    {#if status === 'recording' || status === 'paused'}
      <p class="note">
        Keep this tab open. The screen is held awake where the browser allows it, but a
        backgrounded tab may have its GPS throttled by the phone.
      </p>
    {/if}
  </section>
</main>

<style>
  .wrap {
    max-width: 1100px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
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
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--accent);
    margin-bottom: 0.35rem;
  }
  .page-hdr h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 2.2rem;
    font-weight: 900;
    line-height: 1.05;
  }
  .sub {
    margin: 0.6rem 0 0;
    font-size: 0.95rem;
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .back-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent);
    text-decoration: none;
    flex-shrink: 0;
  }

  .live {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1rem;
  }
  @media (max-width: 700px) {
    .live {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .big {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }
  .big-value {
    font-family: var(--font-mono);
    font-size: var(--fs-num-lg);
    line-height: 1;
    color: var(--text-primary);
  }

  .bar {
    height: 8px;
    background: var(--surface-sunken);
    border: 1px solid var(--line-hair);
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .off-route {
    margin: 0.5rem 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-muted);
  }
  .off-route.warn {
    color: var(--error);
  }

  .field-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-bottom: 0.9rem;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    padding: 0.35rem 0.65rem;
    border: 1px solid var(--line-strong);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .chip.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 1.1rem;
    flex-wrap: wrap;
  }
  .row-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--accent);
    text-decoration: none;
  }
  .row-link.danger {
    color: var(--error);
  }
  .error-line {
    margin: 0.75rem 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--error);
  }
  .note {
    margin: 0.75rem 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    line-height: 1.5;
    max-width: 62ch;
  }
</style>
