<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import PlannerMap from '$lib/components/trails/PlannerMap.svelte';
  import LineChart from '$lib/components/trails/LineChart.svelte';
  import { formatDistance, formatDuration, formatElevation, activityLabel } from '$lib/trails/format';
  import type { Coord } from '$lib/trails/scoring';

  let { data } = $props();

  const SPORTS = ['run', 'trail_run', 'ride', 'mtb', 'hike', 'walk'] as const;

  let sport = $state<(typeof SPORTS)[number]>('run');
  let start = $state<[number, number] | null>(null);
  let finish = $state<[number, number] | null>(null);
  let mode = $state<'loop' | 'point'>('loop');
  let picking = $state<'start' | 'finish'>('start');

  let targetKm = $state(data.suggested ? Number((data.suggested.distanceM / 1000).toFixed(1)) : 8);
  let climbPerKm = $state<number | null>(null);
  let prefer = $state<'any' | 'steady' | 'spiky'>('any');
  let allowOutAndBack = $state(false);
  let candidateCount = $state(5);

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
    if (which === 'start') start = lngLat;
    else finish = lngLat;
    savedId = null;
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
  <title>Plan a route — Trails</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<PageHeader title="Strange Ramblings" />

<main class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">Trails · Planner</div>
      <h1>Plan a route</h1>
      <p class="sub">
        Candidates come from openrouteservice; the ranking is ours — retracing, out-and-back
        sections, surface and the shape of the climbing.
      </p>
    </div>
    <a class="back-link" href="/trails">All trails</a>
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
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Where</span>
      <span class="nm-sec-meta">
        {#if start}{start[1].toFixed(4)}, {start[0].toFixed(4)}{:else}no start set{/if}
      </span>
    </div>

    <p class="where-lede">
      {#if !start}
        <strong>Tap the map</strong> to drop your start point{#if mode === 'point'}, then tap again for
          the finish{/if}. Or use your location.
      {:else if mode === 'point' && !finish}
        Start is set. Now <strong>tap the map</strong> for the finish.
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
        <button type="button" class="chip" onclick={() => { start = null; finish = null; result = null; savedId = null; }}>
          Clear
        </button>
      {/if}
    </div>

    {#if locationError}
      <p class="error-line where-error">{locationError}</p>
    {/if}

    <PlannerMap {start} finish={mode === 'point' ? finish : null} {candidates} selectedIndex={selected} {picking} {onpick} />
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
          <li>
            <button type="button" class="candidate" class:on={selected === i} onclick={() => (selected = i)}>
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
              <span class="cand-scores">
                <span class="score">{Math.round(b.total * 100)}</span>
                <span class="score-label">score</span>
              </span>
            </button>

            {#if selected === i}
              <dl class="breakdown">
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
          <a class="row-link" href="/trails/routes/{savedId}">Saved — open it</a>
          <a class="row-link" href="/api/trails/routes/{savedId}/gpx">Download GPX</a>
        {/if}
      </div>
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
