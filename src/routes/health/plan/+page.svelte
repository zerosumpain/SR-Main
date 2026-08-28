<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import PlannerMap from '$lib/components/trails/PlannerMap.svelte';
  import LineChart from '$lib/components/trails/LineChart.svelte';
  import DifficultyChip from '$lib/components/trails/DifficultyChip.svelte';
  import GpxDownload from '$lib/components/trails/GpxDownload.svelte';
  import { formatDistance, formatDuration, formatElevation, activityLabel } from '$lib/trails/format';
  import { gradeDifficulty, type Difficulty } from '$lib/trails/difficulty';
  import { networkLabel, type SharedRouteSummary } from '$lib/trails/discover';
  import type { Coord } from '$lib/trails/scoring';

  let { data } = $props();

  const SPORTS = ['run', 'trail_run', 'ride', 'mtb', 'hike', 'walk'] as const;

  // The form opens on what the engine would commission today; every control
  // stays live, so the proposal is a starting point, never a decision.
  let sport = $state<(typeof SPORTS)[number]>(data.proposal?.sport ?? 'run');
  // The start defaults to the last place Home Assistant saw the john device;
  // any manual placement (map tap, geolocation, geocoded place) replaces it.
  let start = $state<[number, number] | null>(
    data.deviceLocation ? [data.deviceLocation.lng, data.deviceLocation.lat] : null,
  );
  let startFromDevice = $state(Boolean(data.deviceLocation));
  let finish = $state<[number, number] | null>(null);
  let mode = $state<'loop' | 'point'>('loop');
  let picking = $state<'start' | 'finish'>('start');

  let targetKm = $state(data.proposal ? Number((data.proposal.distanceM / 1000).toFixed(1)) : 8);
  let climbPerKm = $state<number | null>(null);
  let prefer = $state<'any' | 'steady' | 'spiky'>(data.proposal?.prefer ?? 'any');
  let allowOutAndBack = $state(false);
  let candidateCount = $state(5);

  // Natural-language commissioning.
  let commissionText = $state('');
  let interpreting = $state(false);
  let interpretError = $state<string | null>(null);
  let interpretation = $state<string[]>([]);
  let proposalHint = $state<string | null>(null);

  // Shared OSM routes near the start.
  interface SharedDetail {
    osmId: number;
    name: string;
    coordinates: Coord[];
    distanceM: number;
    ascentM: number | null;
    difficulty: Difficulty;
  }
  let shared = $state<SharedRouteSummary[] | null>(null);
  let discovering = $state(false);
  let discoverError = $state<string | null>(null);
  let sharedDetail = $state<SharedDetail | null>(null);
  let sharedLoadingId = $state<number | null>(null);
  let sharedSaving = $state(false);
  let sharedSavedId = $state<string | null>(null);

  let planning = $state(false);
  let locating = $state(false);
  // Two error slots, not one. A single shared `error` rendered at the bottom of
  // the "What" section put the geolocation failure ~950px below the button that
  // caused it — off-screen, so a denied location permission was
  // indistinguishable from the button doing nothing at all.
  let locationError = $state<string | null>(null);
  let error = $state<string | null>(null);
  let result = $state<{
    routes: Array<{
      rank: number;
      score: number;
      distanceM: number;
      durationS: number;
      ascentM: number | null;
      coordinates: Coord[];
      breakdown: {
        total: number;
        overlap: { ratio: number };
        spurs: { spurs: unknown[]; longestM: number };
        terrain: { score: number; offRoadShare: number; stepsShare: number; mainRoadShare: number };
        profile: { gainPerKm: number; concentration: number };
        notes: string[];
      };
    }>;
    targetDistanceM: number;
    targetSource: string;
    rationale: string[];
    failures?: string[];
  } | null>(null);
  let selected = $state(0);
  let saving = $state(false);
  let savedId = $state<string | null>(null);

  const candidates = $derived(result?.routes.map((r) => r.coordinates) ?? []);
  const chosen = $derived(result?.routes[selected] ?? null);

  // Results are graded against the sport they were planned with — grading
  // against the live chip would silently re-grade old results on every click.
  let plannedSport = $state<(typeof SPORTS)[number]>(data.proposal?.sport ?? 'run');

  // A shared route being viewed takes over the map; clearing it hands the map
  // back to the planned candidates.
  const mapRoutes = $derived(sharedDetail ? [sharedDetail.coordinates] : candidates);
  const mapSelected = $derived(sharedDetail ? 0 : selected);

  const elevationPoints = $derived.by(() => {
    if (!chosen) return [] as [number, number][];
    const out: [number, number][] = [];
    let d = 0;
    const R = 6371008.8;
    for (let i = 0; i < chosen.coordinates.length; i++) {
      if (i > 0) {
        const [lng0, lat0] = chosen.coordinates[i - 1];
        const [lng1, lat1] = chosen.coordinates[i];
        const dLat = ((lat1 - lat0) * Math.PI) / 180;
        const dLng = ((lng1 - lng0) * Math.PI) / 180;
        const x = dLng * Math.cos((((lat0 + lat1) / 2) * Math.PI) / 180);
        d += Math.sqrt(x * x + dLat * dLat) * R;
      }
      const ele = chosen.coordinates[i][2];
      if (typeof ele === 'number') out.push([d, ele]);
    }
    return out;
  });

  function onpick(lngLat: [number, number], which: 'start' | 'finish') {
    if (which === 'start') {
      start = lngLat;
      startFromDevice = false;
    } else {
      finish = lngLat;
    }
    savedId = null;
  }

  function deviceAge(): string {
    const mins = data.deviceLocation?.ageMins;
    if (mins == null) return '';
    return mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      locationError = 'This browser has no geolocation — click the map instead.';
      return;
    }
    // A fix can take several seconds, and without a pending state the button
    // looks broken for the whole wait.
    locating = true;
    locationError = null;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        start = [pos.coords.longitude, pos.coords.latitude];
        startFromDevice = false;
        locating = false;
        locationError = null;
        savedId = null;
      },
      (err) => {
        locating = false;
        locationError =
          err.code === err.PERMISSION_DENIED
            ? 'Location permission is blocked for this site. Allow it in your browser settings, or just click the map.'
            : `Could not get your location: ${err.message}. Click the map instead.`;
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  async function plan() {
    if (!start) {
      error = 'Set a start point first — click the map or use your location.';
      return;
    }
    planning = true;
    error = null;
    savedId = null;
    sharedDetail = null;
    plannedSport = sport;

    try {
      const res = await fetch('/api/trails/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          startLat: start[1],
          startLng: start[0],
          finishLat: mode === 'point' && finish ? finish[1] : undefined,
          finishLng: mode === 'point' && finish ? finish[0] : undefined,
          sport,
          targetDistanceM: targetKm > 0 ? targetKm * 1000 : undefined,
          targetGainPerKm: climbPerKm && climbPerKm > 0 ? climbPerKm : undefined,
          prefer,
          allowOutAndBack,
          candidates: candidateCount,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        error = body?.error ?? `Planning failed (${res.status})`;
        result = null;
        return;
      }
      result = body;
      selected = 0;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      planning = false;
    }
  }

  async function interpretAndPlan() {
    const text = commissionText.trim();
    if (!text) return;
    interpreting = true;
    interpretError = null;
    interpretation = [];

    try {
      const res = await fetch('/api/trails/interpret', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          focus: start ? { lat: start[1], lng: start[0] } : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        interpretError = body?.error ?? `Could not read that (${res.status})`;
        return;
      }

      // Apply only what was actually said; everything else keeps its value.
      const p = body.parsed ?? {};
      if (p.sport) sport = p.sport;
      if (p.targetKm) targetKm = p.targetKm;
      if (p.climbPerKm) climbPerKm = p.climbPerKm;
      if (p.prefer) prefer = p.prefer;
      if (p.allowOutAndBack != null) allowOutAndBack = p.allowOutAndBack;
      if (body.start) {
        start = [body.start.lng, body.start.lat];
        startFromDevice = false;
        savedId = null;
      }
      if (body.finish) {
        finish = [body.finish.lng, body.finish.lat];
        mode = 'point';
      } else if (p.mode) {
        mode = p.mode;
      }
      interpretation = body.interpretation ?? [];

      if (start) {
        await plan();
      } else {
        interpretError =
          'No start point yet — name one (“from …”), tap the map, or use your location.';
      }
    } catch (e) {
      interpretError = e instanceof Error ? e.message : String(e);
    } finally {
      interpreting = false;
    }
  }

  async function applyProposal() {
    const p = data.proposal;
    if (!p) return;
    sport = p.sport;
    targetKm = Number((p.distanceM / 1000).toFixed(1));
    prefer = p.prefer;
    if (start) {
      proposalHint = null;
      await plan();
    } else {
      proposalHint = 'Set a start point first — tap the map below or use your location.';
    }
  }

  async function findShared() {
    if (!start) return;
    discovering = true;
    discoverError = null;
    sharedDetail = null;
    sharedSavedId = null;

    try {
      const res = await fetch(
        `/api/trails/discover?lat=${start[1]}&lng=${start[0]}&sport=${sport}`,
      );
      const body = await res.json();
      if (!res.ok) {
        discoverError = body?.error ?? `Search failed (${res.status})`;
        shared = null;
        return;
      }
      shared = body.routes ?? [];
    } catch (e) {
      discoverError = e instanceof Error ? e.message : String(e);
    } finally {
      discovering = false;
    }
  }

  async function viewShared(osmId: number) {
    sharedLoadingId = osmId;
    discoverError = null;
    try {
      const res = await fetch(`/api/trails/discover?osmId=${osmId}&sport=${sport}`);
      const body = await res.json();
      if (!res.ok) {
        discoverError = body?.error ?? `Could not load that route (${res.status})`;
        return;
      }
      sharedDetail = body;
      sharedSavedId = null;
    } catch (e) {
      discoverError = e instanceof Error ? e.message : String(e);
    } finally {
      sharedLoadingId = null;
    }
  }

  async function saveShared() {
    if (!sharedDetail) return;
    sharedSaving = true;
    try {
      const res = await fetch('/api/trails/routes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: sharedDetail.name,
          sport,
          coordinates: sharedDetail.coordinates,
          distanceM: sharedDetail.distanceM,
          ascentM: sharedDetail.ascentM,
          durationS: sharedDetail.difficulty.estimatedTimeS,
          source: 'imported',
          notes: `Shared route from OpenStreetMap (relation ${sharedDetail.osmId}).`,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        discoverError = body?.error ?? 'Could not save the route';
        return;
      }
      sharedSavedId = body.id;
    } finally {
      sharedSaving = false;
    }
  }

  async function save() {
    if (!chosen) return;
    saving = true;
    try {
      const res = await fetch('/api/trails/routes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: `${activityLabel(sport)} ${(chosen.distanceM / 1000).toFixed(1)} km`,
          sport,
          coordinates: chosen.coordinates,
          distanceM: chosen.distanceM,
          ascentM: chosen.ascentM,
          durationS: chosen.durationS,
          score: chosen.score,
          scoreBreakdown: chosen.breakdown,
          targetDistanceM: result?.targetDistanceM,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        error = body?.error ?? 'Could not save the route';
        return;
      }
      savedId = body.id;
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>Plan a route — Health</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<PageHeader title="Strange Ramblings" />

<main class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">Health · Planner</div>
      <h1>Plan a route</h1>
      <p class="sub">
        Say what you want, or use the form. Candidates come from openrouteservice; the ranking
        is ours — retracing, out-and-back sections, surface, the shape of the climbing — and
        every route gets a difficulty grade.
      </p>
    </div>
    <a class="back-link" href="/health/activities">All activities</a>
  </header>

  {#if !data.configured}
    <section class="nm-sec nm-sec-error">
      <span class="sr-label-tight error">Planner needs a key</span>
      <p class="err-body">Two steps, about a minute:</p>
      <ol class="setup-steps">
        <li>
          Get a free key at
          <a href="https://openrouteservice.org/dev/#/signup" target="_blank" rel="noopener noreferrer">
            openrouteservice.org/dev
          </a>
          — sign up, then copy the token under <strong>Tokens</strong>. 2,500 routes a day, no card.
        </li>
        <li>
          <a href="/admin/ai/apis?provider=openrouteservice">Paste it here</a> and press Save.
        </li>
      </ol>
      <p class="err-note">
        That link opens a single box. Everything else — where the key is sent, which host it may
        reach — is already set, so there is nothing else to fill in. Then reload this page.
      </p>
    </section>
  {/if}

  <section class="nm-sec">
    <div class="nm-sec-hd"><span class="sr-label-tight">Commission</span></div>
    <p class="where-lede">
      Describe it — <strong>“hilly 12 km trail run from Darlington station, one big climb”</strong>
      — and the form fills itself and plans. Anything you leave unsaid, the engine chooses from
      your recent training.
    </p>
    <form
      class="commission"
      onsubmit={(e) => {
        e.preventDefault();
        interpretAndPlan();
      }}
    >
      <input
        class="nm-text-input commission-input"
        type="text"
        placeholder="Describe the route you want…"
        bind:value={commissionText}
        disabled={interpreting}
      />
      <button
        type="submit"
        class="nm-save-btn"
        disabled={interpreting || !commissionText.trim() || !data.configured}
      >
        {interpreting ? 'Reading…' : 'Commission'}
      </button>
    </form>
    {#if interpretation.length}
      <ul class="rationale commission-read">
        {#each interpretation as line (line)}<li>{line}</li>{/each}
      </ul>
    {/if}
    {#if interpretError}
      <p class="error-line">{interpretError}</p>
    {/if}
  </section>

  {#if data.proposal}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Today's proposal</span>
        <span class="nm-sec-meta">from readiness · training load · recent outings</span>
      </div>
      <p class="proposal-line">
        <strong>{activityLabel(data.proposal.sport)}</strong> · {formatDistance(data.proposal.distanceM)}
        {#if data.proposal.prefer !== 'any'}
          · {data.proposal.prefer === 'steady' ? 'steady climbing' : 'one big climb'}
        {/if}
      </p>
      {#if data.proposal.rationale.length}
        <ul class="rationale">
          {#each data.proposal.rationale as line (line)}<li>{line}</li>{/each}
        </ul>
      {/if}
      <div class="actions">
        <button class="nm-save-btn" onclick={applyProposal} disabled={planning || !data.configured}>
          {planning ? 'Planning…' : 'Plan this'}
        </button>
      </div>
      {#if proposalHint}
        <p class="error-line">{proposalHint}</p>
      {/if}
    </section>
  {/if}

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Where</span>
      <span class="nm-sec-meta">
        {#if start && startFromDevice && data.deviceLocation}
          {data.deviceLocation.label} · your device, {deviceAge()}{data.deviceLocation.stale
            ? ' (stale)'
            : ''}
        {:else if start}
          {start[1].toFixed(4)}, {start[0].toFixed(4)}
        {:else}no start set{/if}
      </span>
    </div>

    <p class="where-lede">
      {#if !start}
        <strong>Tap the map</strong> to drop your start point{#if mode === 'point'}, then tap again for
          the finish{/if}. Or use your location.
      {:else if mode === 'point' && !finish}
        Start is set. Now <strong>tap the map</strong> for the finish.
      {:else if startFromDevice}
        Start is where Home Assistant last saw your device — tap the map to move it.
      {:else}
        Start is set — tap the map again to move it.
      {/if}
    </p>

    <div class="where-controls">
      {#if mode === 'point'}
        <!-- Only a real choice when there are two points to place. With one, a
             "Set start" button is already the active mode and pressing it
             changes nothing, which reads as a dead control. -->
        <button type="button" class="chip" class:on={picking === 'start'} onclick={() => (picking = 'start')}>
          Placing: start
        </button>
        <button type="button" class="chip" class:on={picking === 'finish'} onclick={() => (picking = 'finish')}>
          Placing: finish
        </button>
      {/if}
      <button type="button" class="chip" onclick={useMyLocation} disabled={locating}>
        {locating ? 'Locating…' : 'Use my location'}
      </button>
      {#if start}
        <button type="button" class="chip" onclick={() => { start = null; startFromDevice = false; finish = null; result = null; savedId = null; }}>
          Clear
        </button>
      {/if}
    </div>

    {#if locationError}
      <p class="error-line where-error">{locationError}</p>
    {/if}

    <PlannerMap {start} finish={mode === 'point' ? finish : null} candidates={mapRoutes} selectedIndex={mapSelected} {picking} {onpick} />
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd"><span class="sr-label-tight">What</span></div>

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

    <div class="field-row">
      <span class="sr-label-tight">Shape</span>
      <div class="chips">
        <button type="button" class="chip" class:on={mode === 'loop'} onclick={() => (mode = 'loop')}>
          Circular
        </button>
        <button type="button" class="chip" class:on={mode === 'point'} onclick={() => (mode = 'point')}>
          Point to point
        </button>
      </div>
    </div>

    <div class="field-grid">
      <label class="field">
        <span class="sr-label-tight">Distance (km)</span>
        <input class="nm-text-input" type="number" min="1" max="100" step="0.5" bind:value={targetKm} />
      </label>
      <label class="field">
        <span class="sr-label-tight">Climb (m/km, optional)</span>
        <input class="nm-text-input" type="number" min="0" max="200" step="5" bind:value={climbPerKm} />
      </label>
      <label class="field">
        <span class="sr-label-tight">Candidates</span>
        <input class="nm-text-input" type="number" min="2" max="8" step="1" bind:value={candidateCount} />
      </label>
    </div>

    <div class="field-row">
      <span class="sr-label-tight">Climbing</span>
      <div class="chips">
        {#each [['any', 'Any'], ['steady', 'Steady'], ['spiky', 'One big climb']] as [value, label] (value)}
          <button
            type="button"
            class="chip"
            class:on={prefer === value}
            onclick={() => (prefer = value as typeof prefer)}
          >
            {label}
          </button>
        {/each}
      </div>
    </div>

    <label class="toggle">
      <input type="checkbox" bind:checked={allowOutAndBack} />
      <span>
        Allow out-and-back sections
        <em>Off by default: retracing is scored as a fault unless you ask for it.</em>
      </span>
    </label>

    <div class="actions">
      <button class="nm-save-btn" onclick={plan} disabled={planning || !data.configured}>
        {planning ? 'Planning…' : 'Plan routes'}
      </button>
    </div>

    {#if error}
      <p class="error-line">{error}</p>
    {/if}
  </section>

  {#if result}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Candidates</span>
        <span class="nm-sec-meta">
          target {formatDistance(result.targetDistanceM)} · {result.targetSource.replace('-', ' ')}
        </span>
      </div>

      {#if result.rationale.length}
        <ul class="rationale">
          {#each result.rationale as line (line)}<li>{line}</li>{/each}
        </ul>
      {/if}

      <ol class="candidates">
        {#each result.routes as route, i (route.rank)}
          {@const b = route.breakdown}
          {@const diff = gradeDifficulty({
            distanceM: route.distanceM,
            ascentM: route.ascentM,
            sport: plannedSport,
            stepsShare: b.terrain.stepsShare,
          })}
          <li>
            <button
              type="button"
              class="candidate"
              class:on={selected === i && !sharedDetail}
              onclick={() => {
                selected = i;
                sharedDetail = null;
              }}
            >
              <span class="cand-rank">{route.rank}</span>
              <span class="cand-main">
                <span class="cand-top">
                  <strong>{formatDistance(route.distanceM)}</strong>
                  <span class="cand-sub">
                    {formatDuration(route.durationS)} · {formatElevation(route.ascentM)} climb
                  </span>
                </span>
                <span class="cand-notes">
                  {#if b.notes.length}{b.notes.join(' · ')}{:else}Clean loop{/if}
                </span>
              </span>
              <span class="cand-diff">
                <DifficultyChip band={diff.band} title={diff.reasons.join(' ')} />
              </span>
              <span class="cand-scores">
                <span class="score">{Math.round(b.total * 100)}</span>
                <span class="score-label">score</span>
              </span>
            </button>

            {#if selected === i}
              <dl class="breakdown">
                <div><dt>Effort</dt><dd>{diff.equivalentKm} eq-km</dd></div>
                <div><dt>Retraced</dt><dd>{Math.round(b.overlap.ratio * 100)}%</dd></div>
                <div><dt>Out-and-back</dt><dd>{b.spurs.spurs.length}</dd></div>
                <div><dt>Longest spur</dt><dd>{formatElevation(b.spurs.longestM).replace(' m', ' m')}</dd></div>
                <div><dt>Off-road</dt><dd>{Math.round(b.terrain.offRoadShare * 100)}%</dd></div>
                <div><dt>Main road</dt><dd>{Math.round(b.terrain.mainRoadShare * 100)}%</dd></div>
                <div><dt>Climb/km</dt><dd>{Math.round(b.profile.gainPerKm)} m</dd></div>
              </dl>
            {/if}
          </li>
        {/each}
      </ol>

      {#if result.failures?.length}
        <p class="footnote">
          {result.failures.length} candidate{result.failures.length === 1 ? '' : 's'} could not be planned:
          {result.failures.join('; ')}
        </p>
      {/if}

      {#if elevationPoints.length > 1}
        <LineChart
          points={elevationPoints}
          label="Elevation — selected route"
          unitSuffix=" m"
          xKind="distance"
          fill
          colour="var(--accent-ink)"
        />
      {/if}

      <div class="actions">
        <button class="nm-save-btn" onclick={save} disabled={saving || !chosen}>
          {saving ? 'Saving…' : 'Save this route'}
        </button>
        {#if savedId}
          <a class="row-link" href="/health/routes/{savedId}">Saved — open it</a>
          <GpxDownload
            url="/api/trails/routes/{savedId}/gpx"
            name={chosen ? `${activityLabel(plannedSport)} ${(chosen.distanceM / 1000).toFixed(1)} km` : 'route'}
          />
        {/if}
      </div>
    </section>
  {/if}

  {#if start}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Shared routes nearby</span>
        <span class="nm-sec-meta">OpenStreetMap · within 15 km of the start</span>
      </div>

      {#if shared === null}
        <p class="where-lede">
          Named trails other people have mapped and shared — the Teesdale Way, a national cycle
          route — passing near your start.
        </p>
        <div class="actions">
          <button class="chip" onclick={findShared} disabled={discovering}>
            {discovering ? 'Searching…' : 'Find shared routes'}
          </button>
        </div>
      {:else if shared.length === 0}
        <p class="footnote">
          Nothing mapped within 15 km of the start for this sport.
          <button type="button" class="row-link relink" onclick={findShared}>Search again</button>
        </p>
      {:else}
        <ol class="shared-list">
          {#each shared as s (s.osmId)}
            <li>
              <button
                type="button"
                class="candidate"
                class:on={sharedDetail?.osmId === s.osmId}
                onclick={() => viewShared(s.osmId)}
              >
                <span class="cand-main">
                  <span class="cand-top">
                    <strong>{s.name}</strong>
                    {#if s.ref}<span class="cand-sub">{s.ref}</span>{/if}
                  </span>
                  <span class="cand-notes">
                    {networkLabel(s.network)}{#if s.distanceKm}
                      · {s.distanceKm} km{/if}{#if s.operator}
                      · {s.operator}{/if}
                  </span>
                </span>
                <span class="cand-scores">
                  <span class="score-label">
                    {sharedLoadingId === s.osmId ? 'loading…' : 'view'}
                  </span>
                </span>
              </button>

              {#if sharedDetail?.osmId === s.osmId}
                <div class="shared-detail">
                  <p class="shared-stats">
                    <DifficultyChip
                      band={sharedDetail.difficulty.band}
                      title={sharedDetail.difficulty.reasons.join(' ')}
                    />
                    <span>
                      {formatDistance(sharedDetail.distanceM)}
                      {#if sharedDetail.ascentM != null}
                        · {formatElevation(sharedDetail.ascentM)} climb{/if}
                      · about {formatDuration(sharedDetail.difficulty.estimatedTimeS)} — drawn on
                      the map above
                    </span>
                  </p>
                  {#if sharedDetail.difficulty.reasons.length}
                    <ul class="rationale">
                      {#each sharedDetail.difficulty.reasons as line (line)}<li>{line}</li>{/each}
                    </ul>
                  {/if}
                  <div class="actions">
                    <button class="nm-save-btn" onclick={saveShared} disabled={sharedSaving}>
                      {sharedSaving ? 'Saving…' : 'Save this route'}
                    </button>
                    <button type="button" class="chip" onclick={() => (sharedDetail = null)}>
                      Back to candidates
                    </button>
                    {#if sharedSavedId}
                      <a class="row-link" href="/health/routes/{sharedSavedId}">Saved — open it</a>
                      <GpxDownload
                        url="/api/trails/routes/{sharedSavedId}/gpx"
                        name={sharedDetail.name}
                      />
                    {/if}
                  </div>
                </div>
              {/if}
            </li>
          {/each}
        </ol>
      {/if}

      {#if discoverError}
        <p class="error-line">{discoverError}</p>
      {/if}
    </section>
  {/if}
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
    max-width: 64ch;
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

  .err-body {
    margin: 0.4rem 0 0;
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-secondary);
  }
  .err-body code {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
  }

  .setup-steps {
    margin: 0.6rem 0 0.6rem;
    padding-left: 1.2rem;
    font-size: var(--fs-body-sm);
    line-height: 1.6;
    color: var(--text-secondary);
    max-width: 62ch;
  }
  .setup-steps li + li {
    margin-top: 0.35rem;
  }

  .err-note {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    color: var(--text-muted);
    max-width: 62ch;
  }

  .commission {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
    align-items: stretch;
  }
  .commission-input {
    flex: 1 1 20rem;
    min-width: 0;
    /* Inputs stay at 16px so mobile browsers don't zoom the page on focus. */
    font-size: 1rem;
  }
  .commission-read {
    margin-top: 0.75rem;
    margin-bottom: 0;
  }

  .proposal-line {
    margin: 0 0 0.6rem;
    font-family: var(--font-mono);
    font-size: var(--fs-body-sm);
    color: var(--text-primary);
  }

  .shared-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line-strong);
  }
  .shared-detail {
    padding: 0.75rem 0.4rem 1rem;
    border-bottom: 1px solid var(--line-hair);
  }
  .shared-stats {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin: 0 0 0.6rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }
  .relink {
    border: none;
    background: transparent;
    padding: 0;
    cursor: pointer;
  }

  .cand-diff {
    flex-shrink: 0;
  }

  .where-controls,
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .where-controls {
    margin-bottom: 0.75rem;
  }

  .where-lede {
    margin: 0 0 0.7rem;
    font-size: var(--fs-body-sm);
    line-height: 1.5;
    color: var(--text-secondary);
  }

  /* Sits directly under the button that produced it. */
  .where-error {
    margin: 0 0 0.75rem;
    max-width: 62ch;
  }

  .chip:disabled {
    opacity: 0.55;
    cursor: default;
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
  .chip:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .chip.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }

  .field-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-bottom: 0.8rem;
  }

  .field-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 0.9rem;
    margin-bottom: 0.9rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }

  .toggle {
    display: flex;
    gap: 0.55rem;
    align-items: flex-start;
    margin-bottom: 1rem;
    font-size: var(--fs-body-sm);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .toggle input {
    margin-top: 0.2rem;
  }
  .toggle em {
    display: block;
    font-style: normal;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .error-line {
    margin: 0.75rem 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--error);
  }

  .rationale {
    margin: 0 0 1rem;
    padding-left: 1.1rem;
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-secondary);
  }

  .candidates {
    list-style: none;
    margin: 0 0 1rem;
    padding: 0;
    border-top: 1px solid var(--line-strong);
  }

  .candidate {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    width: 100%;
    padding: 0.7rem 0.4rem;
    border: none;
    border-bottom: 1px solid var(--line-hair);
    background: transparent;
    text-align: left;
    cursor: pointer;
    color: inherit;
  }
  .candidate:hover {
    background: var(--surface-sunken);
  }
  .candidate.on {
    background: var(--surface-sunken);
    box-shadow: inset 3px 0 0 var(--accent);
  }

  .cand-rank {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-ghost);
    width: 1.2rem;
    flex-shrink: 0;
  }
  .cand-main {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    flex: 1 1 auto;
    min-width: 0;
  }
  .cand-top {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }
  .cand-sub {
    color: var(--text-muted);
  }
  .cand-notes {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .cand-scores {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    flex-shrink: 0;
  }
  .score {
    font-family: var(--font-mono);
    font-size: var(--fs-num-md);
    color: var(--text-primary);
    line-height: 1;
  }
  .score-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-ghost);
  }

  .breakdown {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
    gap: 0.6rem;
    margin: 0;
    padding: 0.75rem 0.4rem 1rem 2.1rem;
    border-bottom: 1px solid var(--line-hair);
  }
  .breakdown div {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }
  .breakdown dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-ghost);
  }
  .breakdown dd {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }

  .footnote {
    margin: 0 0 1rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }

  .row-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--accent);
    text-decoration: none;
  }
  .row-link:hover {
    text-decoration: underline;
  }
</style>
