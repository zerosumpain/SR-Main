<script lang="ts">
  import { replaceState } from '$app/navigation';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import TrackThumb from '$lib/components/trails/TrackThumb.svelte';
  import FormSpark from '$lib/components/trails/FormSpark.svelte';
  import type { SegmentTerrain } from '$lib/trails/segments/naming';
  import type { FormDirection } from '$lib/trails/segments/form';
  import { formatDuration } from '$lib/trails/format';
  import {
    activityLabel,
    formatDistance,
    formatElevation,
    formatPace,
    formatSpeed,
    isPaceSport,
  } from '$lib/trails/format';

  let { data } = $props();

  type SegmentRow = (typeof data.segments)[number];

  // --- filters & sort -------------------------------------------------------
  // The whole list is already here; every control below is a $derived pass
  // over it, seeded once from the URL so dashboard deep links land filtered.

  const TERRAINS: Array<{ key: SegmentTerrain; label: string }> = [
    { key: 'climb', label: 'Climbs' },
    { key: 'descent', label: 'Descents' },
    { key: 'rolling', label: 'Rolling' },
    { key: 'flat', label: 'Flat' },
  ];

  const FORMS: Array<{ key: FormDirection; label: string }> = [
    { key: 'improving', label: 'Improving' },
    { key: 'holding', label: 'Holding' },
    { key: 'slipping', label: 'Slipping' },
  ];

  const SORTS = [
    { key: 'efforts', label: 'Most efforts' },
    { key: 'improving', label: 'Improving fastest' },
    { key: 'gettable', label: 'Closest to a PB' },
    { key: 'climb', label: 'Biggest climb' },
    { key: 'steepest', label: 'Steepest' },
    { key: 'longest', label: 'Longest' },
    { key: 'fastest', label: 'Fastest' },
    { key: 'efficiency', label: 'Best efficiency' },
    { key: 'cost', label: 'Lowest cost' },
    { key: 'recent', label: 'Recently run' },
  ] as const;
  type SortKey = (typeof SORTS)[number]['key'];

  const isTerrain = (v: string | null): v is SegmentTerrain =>
    TERRAINS.some((t) => t.key === v);
  const isForm = (v: string | null): v is FormDirection => FORMS.some((f) => f.key === v);
  const isSort = (v: string | null): v is SortKey => SORTS.some((s) => s.key === v);

  // Validated like terrain and sort below: a stale link's unknown type must
  // fall back to the unfiltered view, not an inexplicable empty page.
  let activeType = $state<string | null>(
    data.types.some((t) => t.activityType === data.initial.type) ? data.initial.type : null,
  );
  let activeTerrain = $state<SegmentTerrain | null>(
    isTerrain(data.initial.terrain) ? data.initial.terrain : null,
  );
  // `terrain=offroad` is accepted as a spelling of the offroad toggle so older
  // links keep working; it is written back as its own param, because offroad
  // and terrain are independent filters and must not fight over one key.
  let offroadOnly = $state(data.initial.offroad === '1' || data.initial.terrain === 'offroad');
  let activeForm = $state<FormDirection | null>(
    isForm(data.initial.form) ? data.initial.form : null,
  );
  let sortKey = $state<SortKey>(isSort(data.initial.sort) ? data.initial.sort : 'efforts');

  /** Keep the address bar honest so a filtered view survives a copy-paste. */
  function syncUrl() {
    const params = new URLSearchParams();
    if (activeType) params.set('type', activeType);
    if (activeTerrain) params.set('terrain', activeTerrain);
    if (offroadOnly) params.set('offroad', '1');
    if (activeForm) params.set('form', activeForm);
    if (sortKey !== 'efforts') params.set('sort', sortKey);
    const qs = params.toString();
    replaceState(qs ? `?${qs}` : '/health/segments', {});
  }

  const filtered = $derived(
    data.segments.filter(
      (s) =>
        (!activeType || s.activityType === activeType) &&
        (!activeTerrain || s.terrain === activeTerrain) &&
        (!offroadOnly || s.offroad) &&
        (!activeForm || s.form.direction === activeForm),
    ),
  );

  // Pace, EF and cost only compare within one kind of moving (a ride's EF sits
  // around 4 and would top every mixed list), so on those sorts a segment's
  // value counts only when the set is one sport or the segment is a pace sport
  // — the same rule the records panel applies. Nulls sink: a segment that
  // cannot compete still exists.
  const comparableValue = (s: SegmentRow, v: number | null): number | null =>
    activeType || isPaceSport(s.activityType) ? v : null;

  function bySortKey(a: SegmentRow, b: SegmentRow): number {
    const nullsLast = (
      va: number | null,
      vb: number | null,
      dir: 1 | -1,
    ): number => {
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * dir;
    };
    switch (sortKey) {
      case 'climb':
        return b.elevationGainM - a.elevationGainM;
      case 'steepest':
        // Magnitude: with the Descents chip on, −15% is steeper than −0.5%.
        return Math.abs(b.gradientPct) - Math.abs(a.gradientPct);
      case 'longest':
        return b.distanceM - a.distanceM;
      case 'fastest':
        return nullsLast(comparableValue(a, a.bests.paceSPerKm), comparableValue(b, b.bests.paceSPerKm), 1);
      case 'efficiency':
        return nullsLast(
          comparableValue(a, a.bests.efficiencyFactor),
          comparableValue(b, b.bests.efficiencyFactor),
          -1,
        );
      case 'cost':
        return nullsLast(comparableValue(a, a.bests.beatsPerKm), comparableValue(b, b.bests.beatsPerKm), 1);
      case 'improving':
        // Most negative delta first — the number is a TIME, so falling is faster.
        return nullsLast(a.form.deltaPct, b.form.deltaPct, 1);
      case 'gettable':
        // Smallest gap between the recent best and the all-time PB. A segment
        // sitting 2% off its PB is a target; one sitting 40% off is a different
        // day in different weather.
        return nullsLast(a.form.gapPct, b.form.gapPct, 1);
      case 'recent':
        return nullsLast(a.lastEffortAt, b.lastEffortAt, -1);
      default:
        return b.effortCount - a.effortCount || b.distanceM - a.distanceM;
    }
  }

  const sorted = $derived([...filtered].sort(bySortKey));

  const filtering = $derived(
    activeType != null || activeTerrain != null || offroadOnly || activeForm != null,
  );

  function clearFilters() {
    activeType = null;
    activeTerrain = null;
    activeForm = null;
    offroadOnly = false;
    syncUrl();
  }

  // --- records over the filtered set -----------------------------------------

  interface Record_ {
    label: string;
    value: string;
    segment: SegmentRow;
  }

  const records = $derived.by((): Record_[] => {
    if (filtered.length === 0) return [];
    const top = (
      pool: SegmentRow[],
      read: (s: SegmentRow) => number | null,
      pick: 'min' | 'max',
    ): SegmentRow | null => {
      let best: SegmentRow | null = null;
      let bestValue = 0;
      for (const s of pool) {
        const v = read(s);
        if (v == null || !Number.isFinite(v)) continue;
        if (!best || (pick === 'min' ? v < bestValue : v > bestValue)) {
          best = s;
          bestValue = v;
        }
      }
      return best;
    };

    // Pace, EF and cost only compare within one kind of moving: a ride's EF
    // sits around 4 and would own the record forever. With a type filter the
    // set is already one sport; without one, those three records read over the
    // pace sports only. Climb, length and effort counts compare across anything.
    const comparable = activeType
      ? filtered
      : filtered.filter((s) => isPaceSport(s.activityType));

    const out: Record_[] = [];
    const fastest = top(comparable, (s) => s.bests.paceSPerKm, 'min');
    if (fastest)
      out.push({
        label: 'Fastest',
        value: isPaceSport(fastest.activityType)
          ? formatPace(fastest.bests.paceSPerKm)
          : formatSpeed(fastest.bests.paceSPerKm),
        segment: fastest,
      });
    const efficient = top(comparable, (s) => s.bests.efficiencyFactor, 'max');
    if (efficient)
      out.push({
        label: 'Best efficiency',
        value: efficient.bests.efficiencyFactor!.toFixed(2),
        segment: efficient,
      });
    const cheapest = top(comparable, (s) => s.bests.beatsPerKm, 'min');
    if (cheapest)
      out.push({
        label: 'Lowest cost',
        value: `${Math.round(cheapest.bests.beatsPerKm!)} b/km`,
        segment: cheapest,
      });
    const climb = top(filtered, (s) => s.elevationGainM, 'max');
    if (climb && climb.elevationGainM > 0)
      out.push({
        label: 'Biggest climb',
        value: `+${formatElevation(climb.elevationGainM)}`,
        segment: climb,
      });
    const longest = top(filtered, (s) => s.distanceM, 'max');
    if (longest)
      out.push({ label: 'Longest', value: formatDistance(longest.distanceM), segment: longest });
    const busiest = top(filtered, (s) => s.effortCount, 'max');
    if (busiest)
      out.push({ label: 'Most run', value: `${busiest.effortCount} efforts`, segment: busiest });
    return out;
  });

  // --- rebuild ---------------------------------------------------------------

  let rebuilding = $state(false);
  let rebuildNote = $state<string | null>(null);

  async function rebuild() {
    if (rebuilding) return;
    rebuilding = true;
    rebuildNote = null;
    try {
      const res = await fetch('/api/trails/segments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const body = await res.json();
      if (!res.ok) {
        rebuildNote = body?.error ?? 'Rebuild failed.';
        return;
      }
      rebuildNote =
        `${body.segments} segments from ${body.activitiesConsidered} activities ` +
        `(${body.created} new, ${body.kept} kept, ${body.removed} retired) in ` +
        `${(body.elapsedMs / 1000).toFixed(1)}s. Reload to see them.`;
    } catch (err) {
      rebuildNote = (err as Error)?.message ?? 'Rebuild failed.';
    } finally {
      rebuilding = false;
    }
  }
</script>

<svelte:head>
  <title>Segments — Health</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<PageHeader title="Strange Ramblings" />

<main class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">Health · Segments</div>
      <h1>Ground you have covered twice</h1>
      <p class="sub">
        Stretches of at least 500 m that turn up in more than one outing of the same kind, matched
        wherever two traces stay within 20 m of each other. Each one gets a name and a leaderboard.
      </p>
    </div>
    <nav class="hdr-nav">
      <a href="/health">Dashboard</a>
      <a href="/health/activities">All activities</a>
    </nav>
  </header>

  {#if data.error}
    <div class="nm-sec nm-sec-error"><span class="sr-label-tight error">{data.error}</span></div>
  {/if}

  {#if data.segments.length > 0}
    <div class="controls">
      {#if data.types.length > 1}
        <div class="chip-row" role="group" aria-label="Activity type">
          <button
            type="button"
            class="chip"
            class:on={!activeType}
            onclick={() => {
              activeType = null;
              syncUrl();
            }}
          >
            All <span class="count">{data.types.reduce((n, t) => n + t.count, 0)}</span>
          </button>
          {#each data.types as type (type.activityType)}
            <button
              type="button"
              class="chip"
              class:on={activeType === type.activityType}
              onclick={() => {
                activeType = activeType === type.activityType ? null : type.activityType;
                syncUrl();
              }}
            >
              {activityLabel(type.activityType)} <span class="count">{type.count}</span>
            </button>
          {/each}
        </div>
      {/if}

      <div class="chip-row" role="group" aria-label="Terrain">
        {#each TERRAINS as terrain (terrain.key)}
          <button
            type="button"
            class="chip"
            class:on={activeTerrain === terrain.key}
            onclick={() => {
              activeTerrain = activeTerrain === terrain.key ? null : terrain.key;
              syncUrl();
            }}
          >
            {terrain.label}
          </button>
        {/each}
        <button
          type="button"
          class="chip"
          class:on={offroadOnly}
          title="Trail runs, MTB and hikes — the sports that only happen off the tarmac"
          onclick={() => {
            offroadOnly = !offroadOnly;
            syncUrl();
          }}
        >
          Offroad
        </button>
      </div>

      <div class="chip-row" role="group" aria-label="Form">
        {#each FORMS as f (f.key)}
          <button
            type="button"
            class="chip"
            class:on={activeForm === f.key}
            title="The last three efforts' median time against the three before them"
            onclick={() => {
              activeForm = activeForm === f.key ? null : f.key;
              syncUrl();
            }}
          >
            {f.label}
          </button>
        {/each}
      </div>

      <label class="sort">
        <span class="sr-label-tight">Sort</span>
        <select
          bind:value={sortKey}
          onchange={syncUrl}
        >
          {#each SORTS as sort (sort.key)}
            <option value={sort.key}>{sort.label}</option>
          {/each}
        </select>
      </label>
    </div>

    {#if records.length > 0}
      <section class="nm-sec">
        <div class="nm-sec-hd">
          <span class="sr-label-tight">Records</span>
          <span class="nm-sec-meta">
            best single readouts across {filtering ? 'the filtered' : 'all'}
            {filtered.length} segment{filtered.length === 1 ? '' : 's'}
          </span>
        </div>
        <dl class="records cellgrid">
          {#each records as record (record.label)}
            <div>
              <dt>{record.label}</dt>
              <dd>{record.value}</dd>
              <a class="rec-seg" href="/health/segments/{record.segment.id}">
                {record.segment.name}
              </a>
            </div>
          {/each}
        </dl>
      </section>
    {/if}
  {/if}

  {#if data.segments.length === 0}
    <section class="nm-sec">
      <p class="empty-title">No segments yet.</p>
      <p class="empty-body">
        Either nothing has been walked, run or ridden twice yet, or the segments have not been
        built. Building reads every stored GPS trace and compares it against the others.
      </p>
      <button type="button" class="rebuild" disabled={rebuilding} onclick={rebuild}>
        {rebuilding ? 'Building…' : 'Build segments'}
      </button>
      {#if rebuildNote}<p class="note">{rebuildNote}</p>{/if}
    </section>
  {:else if sorted.length === 0}
    <section class="nm-sec">
      <p class="empty-title">Nothing matches these filters.</p>
      <button type="button" class="rebuild" onclick={clearFilters}>Clear filters</button>
    </section>
  {:else}
    {#if data.chains.length}
      <section class="nm-sec chains">
        <div class="nm-sec-hd">
          <span class="sr-label-tight">Chains</span>
          <span class="nm-sec-meta">
            segments taken one straight after the other · best combined time
          </span>
        </div>
        <ol class="chain-list">
          {#each data.chains as chain (chain.key)}
            <li class="chain-row">
              <span class="chain-names">
                <a href="/health/segments/{chain.firstSegmentId}">{chain.firstName}</a>
                <span class="chain-arrow" aria-hidden="true">→</span>
                {#if chain.secondSegmentId > 0}
                  <a href="/health/segments/{chain.secondSegmentId}">{chain.secondName}</a>
                {:else}
                  <span>{chain.secondName}</span>
                {/if}
              </span>
              <span class="chain-time">{formatDuration(chain.bestElapsedS)}</span>
              <span class="chain-n">{chain.occurrences}×</span>
            </li>
          {/each}
        </ol>
        <p class="foot-note">
          Timed from the start of the first to the end of the second, so the transition between
          them counts — that is the part you actually get better at. A gap of more than two
          minutes is not a chain.
        </p>
      </section>
    {/if}

    <ol class="segment-list">
      {#each sorted as segment (segment.id)}
        <li>
          <a class="segment-row" href="/health/segments/{segment.id}" data-segment-row>
            <TrackThumb polyline={segment.polyline} />
            <div class="row-main">
              <span class="row-name">{segment.name}</span>
              <span class="row-meta">
                <span class="type-tag">{activityLabel(segment.activityType)}</span>
                {segment.shortDescriptor}{segment.offroad ? ' · offroad' : ''}
              </span>
            </div>
            <div class="row-bests">
              <span class="best">
                <span class="best-l">{isPaceSport(segment.activityType) ? 'pace' : 'speed'}</span>
                <span class="best-v">
                  {segment.bests.paceSPerKm == null
                    ? '—'
                    : isPaceSport(segment.activityType)
                      ? formatPace(segment.bests.paceSPerKm)
                      : formatSpeed(segment.bests.paceSPerKm)}
                </span>
              </span>
              <span class="best">
                <span class="best-l">effic.</span>
                <span class="best-v">{segment.bests.efficiencyFactor?.toFixed(2) ?? '—'}</span>
              </span>
              <span class="best">
                <span class="best-l">cost</span>
                <span class="best-v">
                  {segment.bests.beatsPerKm == null
                    ? '—'
                    : `${Math.round(segment.bests.beatsPerKm)} b/km`}
                </span>
              </span>
            </div>
            <span class="row-form">
              <FormSpark form={segment.form} />
            </span>
            <span class="row-efforts">
              <span class="efforts-n">{segment.effortCount}</span>
              <span class="efforts-l">efforts</span>
            </span>
          </a>
        </li>
      {/each}
    </ol>

    <footer class="foot">
      <button type="button" class="rebuild" disabled={rebuilding} onclick={rebuild}>
        {rebuilding ? 'Rebuilding…' : 'Rebuild segments'}
      </button>
      <p class="foot-note">
        Best pace, efficiency (metres per minute per beat — higher is better) and cost (heartbeats
        per kilometre — lower is better) are each segment's single best effort. A rebuild
        recomputes everything from the stored traces; segments that land on the same ground keep
        their name, so nothing you have learned gets renamed.
      </p>
      {#if rebuildNote}<p class="note">{rebuildNote}</p>{/if}
    </footer>
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
  .hdr-nav {
    display: flex;
    gap: 1rem;
    flex-shrink: 0;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .hdr-nav a {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent);
    text-decoration: none;
  }
  .hdr-nav a:hover {
    text-decoration: underline;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem 1.5rem;
    margin-bottom: 1.5rem;
  }
  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    padding: 0.3rem 0.6rem;
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
  .chip .count {
    opacity: 0.65;
    margin-left: 0.3rem;
  }

  .sort {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto;
  }
  .sort select {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
    background: var(--bg);
    border: 1px solid var(--line-strong);
    padding: 0.3rem 0.5rem;
    cursor: pointer;
  }
  .sort select:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  /* The shared .cellgrid primitive draws the one-border-per-edge cells; this
     block only sets the columns and the tighter stat padding. */
  .records {
    grid-template-columns: repeat(auto-fit, minmax(10.5rem, 1fr));
    margin: 0;
  }
  .records > div {
    background: var(--bg);
    padding: 0.7rem 0.85rem;
  }
  .records dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
  }
  .records dd {
    margin: 0.25rem 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-body-lg);
    color: var(--text-primary);
  }
  .rec-seg {
    display: block;
    margin-top: 0.2rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rec-seg:hover {
    text-decoration: underline;
  }

  .segment-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .segment-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto auto;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 0.25rem;
    border-bottom: 1px solid var(--line-hair);
    text-decoration: none;
    color: inherit;
  }
  .segment-row:hover {
    background: var(--surface-sunken);
  }
  .row-main {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }
  .row-name {
    font-family: var(--font-mono);
    font-size: var(--fs-body);
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }
  .row-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .type-tag {
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--accent);
    margin-right: 0.5rem;
  }

  .row-bests {
    display: flex;
    gap: 1.25rem;
  }
  .best {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    font-family: var(--font-mono);
    min-width: 4.5rem;
  }
  .best-l {
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
  }
  .best-v {
    font-size: var(--fs-label);
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .row-form {
    min-width: 0;
    justify-self: end;
  }

  .row-efforts {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    font-family: var(--font-mono);
  }
  .efforts-n {
    font-size: var(--fs-body-lg);
    color: var(--text-primary);
  }
  .efforts-l {
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
  }

  .foot {
    margin-top: 2rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--line-hair);
  }
  .rebuild {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 0.5rem 1rem;
    color: var(--text-primary);
    background: none;
    border: 1px solid var(--line-strong);
    cursor: pointer;
  }
  .rebuild:hover:not(:disabled) {
    color: var(--accent);
    border-color: var(--accent);
  }
  .rebuild:disabled {
    opacity: 0.55;
    cursor: progress;
  }
  .foot-note,
  .note {
    margin: 0.6rem 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    color: var(--text-muted);
    max-width: 70ch;
  }
  .note {
    color: var(--text-secondary);
  }

  .empty-title {
    margin: 0 0 0.4rem;
    font-size: var(--fs-body-lg);
    color: var(--text-primary);
  }
  .empty-body {
    margin: 0 0 1rem;
    font-size: 0.95rem;
    line-height: 1.55;
    color: var(--text-secondary);
    max-width: 62ch;
  }

  .chains {
    margin-bottom: 1.5rem;
  }
  .chain-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line-hair);
  }
  .chain-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: baseline;
    gap: 1rem;
    padding: 0.55rem 0.25rem;
    border-bottom: 1px solid var(--line-hair);
  }
  .chain-names {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
  }
  .chain-names a {
    color: var(--accent);
    text-decoration: none;
  }
  .chain-names a:hover {
    text-decoration: underline;
  }
  .chain-arrow {
    color: var(--text-ghost);
  }
  .chain-time {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }
  .chain-n {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    color: var(--text-ghost);
  }

  @media (max-width: 900px) {
    .row-bests {
      display: none;
    }
    .segment-row {
      grid-template-columns: auto minmax(0, 1fr) auto auto;
    }
  }

  @media (max-width: 640px) {
    .page-hdr {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.75rem;
    }
    .sort {
      margin-left: 0;
    }
    .segment-row {
      grid-template-columns: auto minmax(0, 1fr);
    }
    .row-form {
      grid-column: 2;
      justify-self: start;
    }
    .row-efforts {
      grid-column: 2;
      flex-direction: row;
      align-items: baseline;
      gap: 0.35rem;
    }
  }
</style>
