<script lang="ts">
  import { getContext, onMount, type Snippet } from 'svelte';
  import VitalTile from './VitalTile.svelte';
  import { fillStrap } from '$lib/landing/hero-titles-buckets';
  import type { VitalsStore } from '$lib/vitals/store.svelte';

  interface HeroCopy {
    primary: string;
    ghost: string;
    strapTemplate: string;
  }

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
    walk: { active: boolean };
    generatedAt: string;
  }

  // Health BPM rides the shared vitals store (already public + lerped), exactly
  // like the hero/ECG — no extra fetch. Everything else comes from one public
  // aggregator poll.
  const store = getContext<VitalsStore>('vitals');

  let {
    deploys = null,
    heroTitle,
    fallbackHero,
    steps,
    statusBackground,
  }: {
    /** Today's shipping, read off the same release showcase the Shipped section
     *  uses. Null when the loader had nothing to say. */
    deploys?: { today: number; peak: number; latestAt: string | null } | null;
    /** Dynamic copy selected from the current live readings. */
    heroTitle: Promise<HeroCopy>;
    /** Deterministic first-paint copy while the live selection streams in. */
    fallbackHero: HeroCopy;
    steps: number;
    statusBackground?: Snippet;
  } = $props();

  let mounted = $state(false);
  let v = $state<VitalsPayload | null>(null);
  let now = $state(Date.now());

  onMount(() => {
    mounted = true;
    let stopped = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const hasLiveWork = () => !!(v?.jkai.activeJobs || v?.builder.active || v?.walk.active);
    const schedule = () => {
      if (stopped || document.hidden) return;
      if (pollTimer) clearTimeout(pollTimer);
      // Active work merits the old live cadence. An idle dashboard does not:
      // its expensive aggregates change rarely and are also cached server-side.
      pollTimer = setTimeout(poll, hasLiveWork() ? 15_000 : 60_000);
    };

    async function poll() {
      try {
        const r = await fetch('/api/landing/vitals');
        if (r.ok) v = await r.json();
      } catch {
        /* keep last-known; the landing page never errors on a tile */
      } finally {
        schedule();
      }
    }
    void poll();

    const onVisibility = () => {
      if (document.hidden) {
        if (pollTimer) clearTimeout(pollTimer);
        pollTimer = null;
      } else {
        void poll();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Re-tick relative-time strings ("synced 2m ago") without re-fetching.
    const tick = setInterval(() => (now = Date.now()), 30_000);
    return () => {
      stopped = true;
      if (pollTimer) clearTimeout(pollTimer);
      document.removeEventListener('visibilitychange', onVisibility);
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

  // Health is "live" only once the store is seeded AND a real HR source exists —
  // the store's default pulse (60) is a placeholder, never shown as live.
  let hrLive = $derived(mounted && !!store?.state?.sources?.heartRate && store.state.pulse > 0);
  let pulse = $derived(mounted ? store.state.pulse : 60);
  let temp = $derived(mounted ? store.state.weather.temp : 15);
  let condition = $derived(mounted ? store.state.weather.condition : 'clear');

  function makeStrap(template: string): string {
    return fillStrap(template, { bpm: pulse, steps, temp, sky: condition });
  }

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

  // Four cells, not five: health still drives the open status cell through its
  // headline and live strap, so it should not also appear as a card.
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
        num: null,
        fallback: w && w.active ? 'LIVE' : '—',
        unit: 'GPS',
        dp: null,
        sub: w ? (w.active ? 'activity in progress' : 'idle — no activity') : 'connecting…',
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

{#snippet status(copy: HeroCopy)}
  <div class="v-status">
    <p class="v-status-label">And his current status is&hellip;</p>
    <p class="v-status-head">
      <span>{copy.primary}</span>
      <span class="ghost">{copy.ghost}</span>
    </p>
    <p class="v-status-strap">{makeStrap(copy.strapTemplate)}</p>
  </div>
{/snippet}

<!-- The rail: an instrument panel on the rail surface, not five floating cards.
     Head says what it is and what time it is; the live hero copy occupies the
     open cell; the rest are cells of one grid; the foot is where you go next. -->
<aside class="vitals" aria-label="Live signals from across the site">
  <div class="v-head">
    <span class="metric-label">Vitals / live</span>
    <span class="v-clock">{mounted ? clock : '--:--:--'}</span>
  </div>

  <div class="v-hero">
    {#if statusBackground}
      <div class="v-status-background" aria-hidden="true">
        {@render statusBackground()}
      </div>
    {/if}
    {#await heroTitle}
      {@render status(fallbackHero)}
    {:then copy}
      {@render status(copy)}
    {/await}
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
   * surface on the front door read as furniture.
   *
   * The ink is painted by the BANDS, not by this container: the status band is
   * a window cut clean through the instrument, and a ground here would sit
   * behind it and fill the hole in again. */
  .vitals {
    display: flex;
    flex-direction: column;
    width: 100%;
    background: transparent;
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
    background: var(--text-primary);
    /* No rule: the band below is a window now, so the value change is the edge
       and a cream-alpha hairline drawn on it paints nothing anyway. */
    border-bottom: none;
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

  /* The status band takes the rail's slack. The rail is as tall as the hero, and
     the alternative was a pool of dead space between the readings and the way
     out — better that the air sits around the live copy selected from the same
     readings that drive the rest of the page.
     
     A WINDOW, inside an ink frame. The band is the tallest thing in the rail,
     so on ink it was the single biggest solid mass on the front door and the
     page read as intense. Painting nothing here does better than the cream
     fill that replaced it: it takes that mass out, it makes the live copy the
     one open cell of an otherwise dark instrument, and it holds the ECG
     behind the words selected by the current readings.
     The kicker above it and the deck below it stay ink, so the masthead's L
     still runs unbroken from the nav down the rail's edge. */
  .v-hero {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    display: flex;
    /* The band takes the panel's slack and centres the compact status in it. */
    flex: 1 1 auto;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 20px;
    /* Type stays ink: what shows through the window is the cream page. */
    background: transparent;
    color: var(--text-primary);
    /* Value change is the edge on both sides — no rule above, none below. */
    border-bottom: none;
  }
  .v-status-background {
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
  }
  .v-status {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .v-status-label {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 600;
    letter-spacing: var(--tracking-label-wide);
    line-height: 1.3;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .v-status-head {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: clamp(24px, 2.25vw, 34px);
    line-height: 0.94;
    letter-spacing: -0.036em;
    text-transform: uppercase;
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }
  .v-status-head .ghost {
    color: var(--text-ghost);
  }
  .v-status-strap {
    margin: 0;
    max-width: 34ch;
    font-size: var(--fs-body-sm);
    line-height: 1.45;
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }
  .v-hero-dot {
    position: relative;
    width: 9px;
    height: 9px;
    flex: none;
    margin-bottom: 6px;
    border-radius: var(--radius-pill);
    background: var(--accent);
    /* A glow, not elevation — the one sanctioned shadow in this system. */
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
     trim the duplicates and let the cells meet it flush. The `cellgrid` utility
     rules the hairlines in --line-strong, which is ink on ink — every cell
     border has to be relit for the dark ground. */
  .v-grid {
    background: var(--text-primary);
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
    background: var(--text-primary);
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
    background: var(--text-primary);
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
