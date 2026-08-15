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

  // Wall clock in the rail head — the mark that says the panel is live even when
  // every reading beneath it happens to be idle.
  let clock = $derived(
    new Date(now).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  );

  // Four cells, not five: HEALTH is promoted out of the grid into the rail's
  // hero reading — it is the signal the rest of the page (ECG, biome, pulse
  // line) is built around, so it should not be one tile among equals.
  let tiles = $derived.by<TileVM[]>(() => {
    const j = v?.jkai;
    const b = v?.builder;
    const c = v?.canvas;
    const w = v?.walk;
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
              : 'autonomous builder'
          : 'connecting…',
        state: b ? (b.active ? 'live' : 'static') : 'loading',
        href: '/jkai/builds',
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

<!-- The rail: an instrument panel on the rail surface, not five floating cards.
     Head says what it is and what time it is; the pulse is the hero reading
     because it is the signal the whole page is built around; the rest are cells
     of one grid; the foot is where you go next. -->
<aside class="vitals" aria-label="Live signals from across the site">
  <div class="v-head">
    <span class="metric-label">Vitals / live</span>
    <span class="v-clock">{mounted ? clock : '--:--:--'}</span>
  </div>

  <div class="v-hero">
    <div class="v-hero-read">
      <span class="v-hero-num" class:muted={bpm === null}>{bpm ?? '—'}</span>
      <span class="metric-label muted">bpm / {hrLive ? 'live' : 'no signal'}</span>
    </div>
    <span class="v-hero-dot" data-state={hrLive ? 'live' : 'idle'} aria-hidden="true"></span>
  </div>

  <!-- Gated on `mounted` so the tiles enter client-side and the staggered
       fly-in intro actually plays (Svelte intros don't run for hydrated nodes). -->
  <div class="cellgrid v-grid">
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

  <div class="v-foot">
    <a class="v-btn primary" href="/live">Live tracker →</a>
    <a class="v-btn" href="/health">Health data</a>
  </div>
</aside>

<style>
  .vitals {
    display: flex;
    flex-direction: column;
    width: 100%;
    background: var(--surface-rail);
    border: 1px solid var(--line-strong);
    /* Reserve the panel's height so the tiles flying in client-side don't shift
       the live-walk banner below them on stacked (mobile) layouts. */
    min-height: 392px;
  }

  .v-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 13px 20px;
    border-bottom: 1px solid var(--line);
  }
  .v-clock {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    color: var(--text-ghost);
    font-variant-numeric: tabular-nums;
  }

  .v-hero {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    padding: 20px;
    border-bottom: 1px solid var(--line);
  }
  .v-hero-read {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  /* The one display-scale numeral on the rail. Everything else is mono. */
  .v-hero-num {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: var(--fs-num-xl);
    line-height: 0.8;
    letter-spacing: -0.05em;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
  }
  .v-hero-num.muted {
    color: var(--text-ghost);
  }
  .v-hero-dot {
    width: 9px;
    height: 9px;
    flex: none;
    margin-bottom: 6px;
    border-radius: var(--radius-pill);
    background: var(--accent);
    box-shadow: var(--accent-glow);
  }
  .v-hero-dot[data-state='idle'] {
    background: transparent;
    border: 1.5px solid var(--text-ghost);
    box-shadow: none;
  }
  @media (prefers-reduced-motion: no-preference) {
    .v-hero-dot[data-state='live'] {
      animation: rail-hero-pulse 1.5s ease-in-out infinite;
    }
  }
  @keyframes rail-hero-pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.45;
      transform: scale(0.82);
    }
  }

  /* The grid draws its own top/left edges; the panel already has a border, so
     trim the duplicates and let the cells meet it flush. */
  .v-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    border-top: none;
    border-left: none;
    min-height: 168px;
    align-content: start;
  }
  .v-grid > :global(*:nth-child(2n)) {
    border-right: none;
  }

  .v-foot {
    display: flex;
    gap: 8px;
    margin-top: auto;
    padding: 14px 20px;
  }
  .v-btn {
    display: inline-flex;
    align-items: center;
    padding: 9px 14px;
    border: 1px solid var(--accent-ink-tint-35);
    border-radius: var(--radius-sharp);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--accent-ink);
    text-decoration: none;
    white-space: nowrap;
    transition: background 0.2s var(--ease-out), border-color 0.2s var(--ease-out);
  }
  .v-btn:hover {
    background: var(--accent-ink-tint-06);
  }
  .v-btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .v-btn.primary:hover {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
</style>
