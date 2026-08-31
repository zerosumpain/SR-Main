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

  let {
    deploys = null,
  }: {
    /** Today's shipping, read off the same release showcase the Shipped section
     *  uses. Null when the loader had nothing to say. */
    deploys?: { today: number; peak: number; latestAt: string | null } | null;
  } = $props();

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

  {#if deploys}
    <div class="v-deploys">
      <span class="metric-label">Deploys today</span>
      <p class="v-deploys-read">
        <span class="v-deploys-n">{deploys.today}</span>
        shipped
        {#if deploys.latestAt}<span class="v-sep" aria-hidden="true">/</span>latest {deploys.latestAt}{/if}
      </p>
      <span class="v-deploys-bar" aria-hidden="true">
        <span
          class="v-deploys-fill"
          style="width: {Math.min(100, Math.round((deploys.today / Math.max(1, deploys.peak)) * 100))}%"
        ></span>
      </span>
    </div>
  {/if}

  <div class="v-foot">
    <a class="v-btn primary" href="/live">Live tracker →</a>
    <a class="v-btn" href="/health">Health data</a>
  </div>
</aside>

<style>
  /* The instrument slab.
   *
   * The rail wears the cover register the /health owner pages and the daydream
   * hub open with: an ink ground (#1a1008), cream type, and burnt orange
   * lifted to --accent-on-dark because #c4570a scores 2.6:1 on this ground.
   * Petrol has no role here — it is the counter-accent on PAPER, and there is
   * no paper left in this panel.
   *
   * It used to be a cream panel on a cream page, which meant the one live
   * surface on the front door read as furniture. */
  .vitals {
    display: flex;
    flex-direction: column;
    width: 100%;
    background: var(--text-primary);
    color: var(--bg);
    border: 1px solid var(--text-primary);
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
    border-bottom: 1px solid rgba(237, 228, 212, 0.16);
  }
  /* The kicker, in the cover's own colour. Scoped past the global
     `.metric-label` utility, which is written for paper. */
  .v-head .metric-label {
    color: var(--accent-on-dark);
  }
  .v-clock {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    color: rgba(237, 228, 212, 0.42);
    font-variant-numeric: tabular-nums;
  }

  /* The pulse band takes the rail's slack. The rail is as tall as the hero, and
     the alternative was a pool of dead space between the readings and the way
     out — better that the air sits under the signature numeral, which is what
     the panel is for. */
  .v-hero {
    display: flex;
    /* The band takes the panel's slack and CENTRES the numeral in it. Bottom
       alignment put every one of those pixels above the figure, which on the
       cream panel was invisible and on ink was a hole the size of the hero
       type beside it. Centred, the air belongs to the figure. */
    flex: 1 1 auto;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 20px;
    border-bottom: 1px solid rgba(237, 228, 212, 0.16);
  }
  .v-hero-read {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .v-hero .metric-label {
    color: rgba(237, 228, 212, 0.55);
  }
  /* The one display-scale numeral on the rail. Everything else is mono. */
  .v-hero-num {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: var(--fs-num-xl);
    line-height: 0.8;
    letter-spacing: -0.05em;
    font-variant-numeric: tabular-nums;
    color: var(--bg);
  }
  /* No live reading. Mono and a step down, so the panel says "nothing to
     report" rather than drawing a display-weight em-dash the size of a bar. */
  .v-hero-num.muted {
    font-family: var(--font-mono);
    font-weight: 400;
    font-size: var(--fs-num-lg);
    letter-spacing: 0;
    color: rgba(237, 228, 212, 0.35);
  }
  .v-hero-dot {
    width: 9px;
    height: 9px;
    flex: none;
    margin-bottom: 6px;
    border-radius: var(--radius-pill);
    background: var(--accent-on-dark);
    /* A glow, not elevation — the one sanctioned shadow in this system. */
    box-shadow: 0 0 8px rgba(232, 134, 58, 0.55);
  }
  .v-hero-dot[data-state='idle'] {
    background: transparent;
    border: 1.5px solid rgba(237, 228, 212, 0.35);
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
     trim the duplicates and let the cells meet it flush. The `cellgrid` utility
     rules the hairlines in --line-strong, which is ink on ink — every cell
     border has to be relit for the dark ground. */
  .v-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    border-top: none;
    border-left: none;
    flex: none;
    align-content: start;
  }
  .v-grid > :global(*) {
    border-color: rgba(237, 228, 212, 0.16);
  }
  .v-grid > :global(*:nth-child(2n)) {
    border-right: none;
  }

  /* Today's shipping — the band that keeps the rail from ending in dead space
     between the readings and the way out. */
  .v-deploys {
    display: flex;
    flex-direction: column;
    gap: 9px;
    margin-top: auto;
    padding: 16px 20px;
    border-top: 1px solid rgba(237, 228, 212, 0.16);
  }
  .v-deploys .metric-label {
    color: rgba(237, 228, 212, 0.55);
  }
  .v-deploys-read {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.6);
  }
  .v-deploys-n {
    color: var(--bg);
    font-variant-numeric: tabular-nums;
    margin-right: 0.5ch;
  }
  .v-sep {
    color: rgba(237, 228, 212, 0.3);
    margin: 0 0.5ch;
  }
  .v-deploys-bar {
    display: block;
    height: 4px;
    background: rgba(237, 228, 212, 0.16);
  }
  .v-deploys-fill {
    display: block;
    height: 100%;
    background: var(--accent-on-dark);
  }

  .v-foot {
    display: flex;
    gap: 8px;
    padding: 14px 20px;
  }
  /* Without the deploys band there is nothing to push the foot down, so it
     takes the slack itself. */
  .vitals:not(:has(.v-deploys)) .v-foot {
    margin-top: auto;
  }
  /* The `ds-power` shape from the daydream cover: a cream outline that fills
     with the lifted accent on hover. Radius 0 — the pill belonged to the paper
     register this panel has left. */
  .v-btn {
    display: inline-flex;
    align-items: center;
    padding: 9px 14px;
    border: 1px solid rgba(237, 228, 212, 0.3);
    border-radius: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--bg);
    text-decoration: none;
    white-space: nowrap;
    transition:
      background var(--t-fast) var(--ease-out),
      border-color var(--t-fast) var(--ease-out),
      color var(--t-fast) var(--ease-out);
  }
  .v-btn:hover {
    background: var(--accent-on-dark);
    border-color: var(--accent-on-dark);
    color: var(--text-primary);
  }
  .v-btn:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: 2px;
  }
  .v-btn.primary {
    background: var(--accent-on-dark);
    border-color: var(--accent-on-dark);
    color: var(--text-primary);
  }
  .v-btn.primary:hover {
    background: var(--bg);
    border-color: var(--bg);
    color: var(--text-primary);
  }
</style>
