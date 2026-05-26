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
  import Ecg from '$lib/components/shared/Ecg.svelte';
  import LiveWalkBanner from '$lib/components/LiveWalkBanner.svelte';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import { roundPulse } from '$lib/biome/state';
  import { fillStrap } from '$lib/landing/hero-titles-buckets';
  import type { BiomeStore } from '$lib/biome/store.svelte';

  const store = getContext<BiomeStore>('biome');

  let { data } = $props();

  let mounted = $state(false);
  let bgMode = $state<'ecg' | 'biome'>('ecg');

  // Before mount: use server-fetched biome data. After mount: use live store.
  let pulse = $derived(mounted ? store.state.pulse : (data.initialBiome?.pulse ?? 60));
  let temp = $derived(
    mounted ? store.state.weather.temp : (data.initialBiome?.weather?.temp ?? 15),
  );
  let condition = $derived(
    mounted
      ? store.state.weather.condition
      : (data.initialBiome?.weather?.condition ?? 'clear'),
  );
  let town = $derived(mounted ? store.state.town : data.initialBiome?.town);
  let lastSyncedAt = $derived(
    mounted ? store.state.lastSyncedAt : data.initialBiome?.lastSyncedAt,
  );

  let strap = $derived(
    fillStrap(data.heroTitle.strapTemplate, {
      bpm: pulse,
      steps: data.steps,
      temp,
      sky: condition,
    }),
  );

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
    if (data.initialBiome) {
      store.setState(data.initialBiome);
    }
    mounted = true;

    const stored = localStorage.getItem('landing-bg');
    if (stored === 'biome' || stored === 'ecg') bgMode = stored;

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

<!-- HERO — full viewport, /health hero language -->
<section
  class="relative min-h-screen flex flex-col justify-between px-6 sm:px-10 md:px-16 py-8 overflow-hidden"
>
  {#if bgMode === 'biome'}
    <BiomeBackground {store} position="absolute" transparent />
  {:else}
    <div class="absolute inset-0 pointer-events-none">
      <Ecg rhr={roundPulse(pulse)} showGrid={false} />
    </div>
  {/if}

  <!-- Top bar -->
  <SiteNav variant="hero" />

  <!-- Center — hero copy -->
  <div class="relative z-10 flex-1 flex items-center">
    <LandingHero
      tag={heroTag}
      primary={data.heroTitle.primary}
      ghost={data.heroTitle.ghost}
      strap={strap}
      {pulse}
      steps={data.steps}
      {temp}
      {condition}
    />
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
    <span>Signature · {bgMode === 'biome' ? 'Biome' : 'Pulse'} · Live</span>
    {#if syncedText}<span>Synced {syncedText}</span>{/if}
  </div>
</section>

<!-- FOOTER — dense, utilitarian -->
<footer class="px-6 sm:px-10 md:px-16 py-8 flex flex-wrap justify-between items-center gap-4" style="border-top: 2px solid var(--card-border);">
  <p class="brand text-[14px]" style="color: var(--text-ghost);">strange ramblings</p>
  <div class="flex gap-6">
    <a href="https://github.com/jkrup" target="_blank" rel="noopener" class="nav-link">GitHub</a>
    <a href="mailto:john@strangeramblings.com" class="nav-link">Email</a>
    <a href="/health" class="nav-link">Health</a>
    <a href="https://library.strangeramblings.com" class="nav-link">Library</a>
    <a href="/admin" class="nav-link">Admin</a>
  </div>
</footer>

<BackgroundToggle />
