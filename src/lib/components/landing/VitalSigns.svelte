<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import VitalTile from './VitalTile.svelte';
  import { roundPulse } from '$lib/biome/state';
  import type { BiomeStore } from '$lib/biome/store.svelte';

  interface VitalsPayload {
    jkai: { activeJobs: number };
    builder: {
      stage: string;
      active: boolean;
      shippedCount: number;
      lastShippedTitle: string | null;
      lastShippedHref: string | null;
    };
    canvas: { count: number; lastRunAt: string | null };
    walk: {
      active: boolean;
      distanceKm: number | null;
      routeName: string | null;
      startedAt: number | null;
      elevationGainM: number | null;
    };
    estate: { liveSignals: number; services: number };
    generatedAt: string;
  }

  // Health BPM rides the shared biome store (already public + lerped), exactly
  // like the hero/ECG — no extra fetch. Everything else comes from one public
  // aggregator poll.
  const store = getContext<BiomeStore>('biome');

  let mounted = $state(false);
  let v = $state<VitalsPayload | null>(null);
  let now = $state(Date.now());

  onMount(() => {
    mounted = true;
    async function poll() {
      try {
        const r = await fetch('/api/landing/vitals');
        if (r.ok) v = await r.json();
      } catch {
        /* keep last-known; the landing page never errors on a tile */
      }
    }
    poll();
    const iv = setInterval(poll, 15_000);
    // Re-tick relative-time strings ("synced 2m ago") without re-fetching.
    const tick = setInterval(() => (now = Date.now()), 30_000);
    return () => {
      clearInterval(iv);
      clearInterval(tick);
    };
  });

  function rel(iso: string | null | undefined, ref: number): string {
    if (!iso) return '';
    const secs = Math.round((ref - Date.parse(iso)) / 1000);
    if (!Number.isFinite(secs) || secs < 90) return 'just now';
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  }

  function elapsed(startedAt: number, ref: number): string {
    const ms = ref - startedAt;
    if (!Number.isFinite(ms) || ms < 0) return '';
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return h === 0 ? `${m}m` : `${h}h ${m}m`;
  }

  // Health is "live" only once the store is seeded AND a real HR source exists —
  // the store's default pulse (60) is a placeholder, never shown as live.
  let hrLive = $derived(mounted && !!store?.state?.sources?.heartRate && store.state.pulse > 0);
  let bpm = $derived(hrLive ? roundPulse(store.state.pulse) : null);

  type TileState = 'live' | 'idle' | 'stale' | 'static' | 'loading';
  interface TileVM {
    label: string;
    num: number | null;
    fallback: string;
    unit: string;
    sub: string;
    state: TileState;
    href: string;
    dp: number | null;
  }

  let tiles = $derived.by<TileVM[]>(() => {
    const j = v?.jkai;
    const b = v?.builder;
    const c = v?.canvas;
    const w = v?.walk;
    const e = v?.estate;
    return [
      {
        label: 'JKAI',
        num: j ? j.activeJobs : null,
        fallback: '—',
        unit: 'ACTIVE',
        sub: j ? (j.activeJobs > 0 ? 'jobs running now' : 'orchestrator idle') : 'connecting…',
        state: j ? (j.activeJobs > 0 ? 'live' : 'idle') : 'loading',
        href: '/jkai',
        dp: null,
      },
      {
        label: 'BUILDER',
        num: b ? b.shippedCount : null,
        fallback: '—',
        unit: 'SHIPPED',
        sub: b
          ? b.active
            ? `${b.stage} now…`
            : b.lastShippedTitle
              ? `last: ${b.lastShippedTitle}`
              : 'idle'
          : 'connecting…',
        state: b ? (b.active ? 'live' : 'static') : 'loading',
        href: '/jkai/builds',
        dp: null,
      },
      {
        label: 'HEALTH',
        num: bpm,
        fallback: '—',
        unit: 'BPM',
        sub: hrLive
          ? store.state.lastSyncedAt
            ? `synced ${rel(store.state.lastSyncedAt, now)}`
            : 'live'
          : 'no live signal',
        state: hrLive ? (store.state.stale ? 'stale' : 'live') : 'idle',
        href: '/health',
        dp: null,
      },
      {
        label: 'LIVE WALK',
        num: w && w.active && w.distanceKm != null ? w.distanceKm : null,
        fallback: w && w.active ? '0' : '—',
        unit: w && w.active ? 'KM' : 'GPS',
        dp: 1,
        sub: w
          ? w.active
            ? `${w.routeName ?? 'activity'}${w.startedAt ? ' · ' + elapsed(w.startedAt, now) : ''}`
            : 'idle — no activity'
          : 'connecting…',
        state: w ? (w.active ? 'live' : 'idle') : 'loading',
        href: '/live',
      },
      {
        label: 'DATA ESTATE',
        num: e ? e.liveSignals : null,
        fallback: '—',
        unit: 'LIVE SIGNALS',
        sub: e ? `${e.services} gov services` : 'connecting…',
        state: e ? 'static' : 'loading',
        href: '/projects/dfe-data-estate',
        dp: null,
      },
      {
        label: 'CANVAS',
        num: c ? c.count : null,
        fallback: '—',
        unit: 'CANVASES',
        sub: c ? (c.lastRunAt ? `last run ${rel(c.lastRunAt, now)}` : 'no runs yet') : 'connecting…',
        state: c ? 'static' : 'loading',
        href: '/jkai/canvas',
        dp: null,
      },
    ];
  });
</script>

<div class="vitals" aria-label="Live signals from across the site">
  <!-- Gated on `mounted` so the tiles enter client-side and the staggered
       fly-in intro actually plays (Svelte intros don't run for hydrated nodes). -->
  {#if mounted}
    {#each tiles as t, i (t.label)}
      <VitalTile
        label={t.label}
        num={t.num}
        fallback={t.fallback}
        unit={t.unit}
        sub={t.sub}
        state={t.state}
        href={t.href}
        dp={t.dp}
        delay={60 * i}
      />
    {/each}
  {/if}
</div>

<style>
  .vitals {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    width: 100%;
    /* Reserve ~3 rows so the tiles flying in client-side don't shift the
       live-walk banner below them on stacked (mobile) layouts. */
    min-height: 232px;
    align-content: start;
  }
</style>
