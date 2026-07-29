<svelte:head>
  <title>Strange Ramblings</title>
  <meta name="description" content="Building things with code in London. A living canvas." />
  <meta property="og:title" content="Strange Ramblings" />
  <meta property="og:description" content="Building things with code in London. A living canvas." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://strangeramblings.com" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="Strange Ramblings" />
  <meta name="twitter:description" content="Building things with code in London. A living canvas." />
</svelte:head>

<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import BiomeBackground from '$lib/components/BiomeBackground.svelte';
  import BackgroundToggle from '$lib/components/landing/BackgroundToggle.svelte';
  import LandingHero from '$lib/components/landing/LandingHero.svelte';
  import VitalSigns from '$lib/components/landing/VitalSigns.svelte';
  import FeatureIndex from '$lib/components/landing/FeatureIndex.svelte';
  import ShippedSeam from '$lib/components/landing/ShippedSeam.svelte';
  import Ecg from '$lib/components/shared/Ecg.svelte';
  import EcgAscii from '$lib/components/shared/EcgAscii.svelte';
  import LiveWalkBanner from '$lib/components/LiveWalkBanner.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { roundPulse } from '$lib/biome/state';
  import { fillStrap } from '$lib/landing/hero-titles-buckets';
  import type { BiomeStore } from '$lib/biome/store.svelte';

  const store = getContext<BiomeStore>('biome');

  let { data } = $props();

  let mounted = $state(false);
  let bgMode = $state<'ecg' | 'biome'>('ecg');
  // Render the live heartbeat as the glowing line ('line') or as a sweeping
  // ASCII trace ('ascii'). Toggled from the footer, persisted in localStorage.
  let ecgStyle = $state<'line' | 'ascii'>('line');

  function setBgMode(mode: 'ecg' | 'biome') {
    bgMode = mode;
    localStorage.setItem('landing-bg', mode);
    window.dispatchEvent(new CustomEvent('landing-bg-change', { detail: { mode } }));
  }

  function toggleEcgStyle() {
    ecgStyle = ecgStyle === 'ascii' ? 'line' : 'ascii';
    localStorage.setItem('ecg-style', ecgStyle);
    // Switching to ASCII implies wanting to see the pulse — bring the ECG
    // forward if the biome background is currently up.
    if (ecgStyle === 'ascii' && bgMode !== 'ecg') setBgMode('ecg');
  }

  // initialBiome is streamed, so it isn't in the SSR HTML — pre-mount uses
  // sensible defaults and the live store takes over once mounted (onMount seeds
  // it from the resolved stream, then its own polling keeps it current).
  let pulse = $derived(mounted ? store.state.pulse : 60);
  let temp = $derived(mounted ? store.state.weather.temp : 15);
  let condition = $derived(mounted ? store.state.weather.condition : 'clear');
  let town = $derived(mounted ? store.state.town : undefined);
  let lastSyncedAt = $derived(mounted ? store.state.lastSyncedAt : undefined);

  // Deterministic copy shown until the snapped heroTitle streams in. Mirrors the
  // resting-state fallback the title service uses, so it rarely visibly swaps.
  const FALLBACK_HERO = {
    primary: 'STILL.',
    ghost: 'FOR NOW.',
    strapTemplate:
      '{bpm} beats, {steps} steps, {temp} of {sky}. The day has not been agreed to yet.',
  };

  function makeStrap(template: string): string {
    return fillStrap(template, { bpm: pulse, steps: data.steps, temp, sky: condition });
  }

  let heroTag = $derived(
    `RIGHT NOW · ${data.dateStr}` + (town ? ` · ${town.toUpperCase()}` : ''),
  );

  let now = $state(Date.now());

  function formatSynced(iso: string | undefined, ref: number): string {
    if (!iso) return '';
    const secs = Math.round((ref - Date.parse(iso)) / 1000);
    if (!Number.isFinite(secs) || secs < 90) return 'just now';
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  }

  let syncedText = $derived(formatSynced(lastSyncedAt, now));

  onMount(() => {
    // initialBiome is streamed from the server load, so seed the store once it
    // resolves; the store's own polling takes over from there.
    Promise.resolve(data.initialBiome).then((b) => {
      if (b) store.setState(b);
    });
    mounted = true;

    const stored = localStorage.getItem('landing-bg');
    if (stored === 'biome' || stored === 'ecg') bgMode = stored;

    const storedStyle = localStorage.getItem('ecg-style');
    if (storedStyle === 'ascii' || storedStyle === 'line') ecgStyle = storedStyle;

    function handleBgChange(e: Event) {
      bgMode = (e as CustomEvent<{ mode: 'ecg' | 'biome' }>).detail.mode;
    }
    window.addEventListener('landing-bg-change', handleBgChange);

    const tick = setInterval(() => (now = Date.now()), 30_000);

    return () => {
      window.removeEventListener('landing-bg-change', handleBgChange);
      clearInterval(tick);
    };
  });
</script>

<PageHeader title="strange ramblings" titleHref="/" />

<!-- HERO — viewport minus nav -->
<section
  class="relative flex flex-col justify-between px-6 sm:px-10 md:px-16 py-8 overflow-hidden"
  style="min-height: calc(100vh - var(--site-nav-height));"
>
  {#if bgMode === 'biome'}
    <BiomeBackground {store} position="absolute" transparent />
  {:else}
    <div class="absolute inset-0 pointer-events-none">
      {#if ecgStyle === 'ascii'}
        <EcgAscii rhr={roundPulse(pulse)} steps={data.steps} />
      {:else}
        <Ecg rhr={roundPulse(pulse)} showGrid={false} />
      {/if}
    </div>
  {/if}

  <!-- Center — hero copy (left) + live "Vital Signs" tiles (right). heroTitle is
       streamed; render fallback copy until it lands so the hero paints without
       waiting on the external weather fetch. The tiles sit at z-10 over the ECG
       and stack below the copy on narrow viewports. -->
  <div class="relative z-10 flex-1 flex items-center">
    <div class="hero-grid">
      <div class="hero-copy">
        {#await data.heroTitle}
          <LandingHero
            tag={heroTag}
            primary={FALLBACK_HERO.primary}
            ghost={FALLBACK_HERO.ghost}
            strap={makeStrap(FALLBACK_HERO.strapTemplate)}
            {pulse}
            steps={data.steps}
            {temp}
            {condition}
          />
        {:then heroTitle}
          <LandingHero
            tag={heroTag}
            primary={heroTitle.primary}
            ghost={heroTitle.ghost}
            strap={makeStrap(heroTitle.strapTemplate)}
            {pulse}
            steps={data.steps}
            {temp}
            {condition}
          />
        {/await}
      </div>
      <aside class="hero-aside">
        <VitalSigns />
      </aside>
    </div>
  </div>

  <!-- Live walk banner -->
  <div class="relative z-10 text-center mt-4">
    <LiveWalkBanner />
  </div>

  <!-- Footer meta bar -->
  <div
    class="relative z-10 flex justify-between items-center"
    style="font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-muted);"
  >
    <span
      >Signature · {bgMode === 'biome'
        ? 'Biome'
        : ecgStyle === 'ascii'
          ? 'Pulse · ASCII'
          : 'Pulse'} · Live</span
    >
    {#if syncedText}<span>Synced {syncedText}</span>{/if}
  </div>
</section>

<!-- SHIPPED — the record of every deploy, as one continuous mark. Sits directly
     under the hero: it is the substance, and "More" is the closer. -->
<ShippedSeam data={data.releases} />

<!-- MORE — terminal-index of the non-live field studies, tools and writing -->
<FeatureIndex isOwner={data.isOwner} />

<!-- FOOTER — dense, utilitarian -->
<footer class="px-6 sm:px-10 md:px-16 py-8 flex flex-wrap justify-between items-center gap-4" style="border-top: 2px solid var(--card-border);">
  <p class="brand text-[14px]" style="color: var(--text-ghost);">strange ramblings</p>
  <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
    <button
      type="button"
      class="ecg-toggle"
      onclick={toggleEcgStyle}
      aria-pressed={ecgStyle === 'ascii'}
      title="Render the live heartbeat as a line or as sweeping ASCII characters"
      aria-label="Toggle heartbeat ASCII rendering"
    >
      <span class="ecg-toggle-key">Pulse</span>
      <span class="ecg-toggle-val" class:on={ecgStyle === 'ascii'}>
        {ecgStyle === 'ascii' ? 'ASCII' : 'Line'}
      </span>
    </button>
    <a href="https://github.com/jkrup" target="_blank" rel="noopener" class="nav-link">GitHub</a>
    <a href="mailto:john@strangeramblings.com" class="nav-link">Email</a>
    <a href="/health" class="nav-link">Health</a>
    <a href="https://library.strangeramblings.com" class="nav-link">Library</a>
    <a href="/admin" class="nav-link">Admin</a>
  </div>
</footer>

<BackgroundToggle />

<style>
  /* Footer toggle for the heartbeat render mode (orange line ⇄ ASCII). */
  .ecg-toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px 4px 12px;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-pill);
    background: var(--card-bg);
    cursor: pointer;
    line-height: 1;
    transition:
      border-color 0.15s ease,
      background 0.15s ease;
  }
  .ecg-toggle:hover {
    border-color: var(--accent);
  }
  .ecg-toggle-key {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  .ecg-toggle-val {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
    min-width: 42px;
    text-align: center;
    padding: 3px 8px;
    border-radius: var(--radius-pill);
    background: var(--surface-overlay);
    transition:
      color 0.15s ease,
      background 0.15s ease;
  }
  .ecg-toggle-val.on {
    color: var(--accent);
    background: var(--accent-tint-14);
  }

  /* Hero splits into copy (left) + live Vital Signs tiles (right) on wide
     viewports, and stacks the tiles below the copy under 1024px. */
  .hero-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
    gap: clamp(28px, 4vw, 64px);
    align-items: center;
    width: 100%;
  }
  .hero-copy {
    min-width: 0;
  }
  .hero-aside {
    width: 100%;
  }
  @media (max-width: 1024px) {
    .hero-grid {
      grid-template-columns: 1fr;
      gap: 32px;
    }
    .hero-aside {
      max-width: 440px;
    }
  }
</style>
