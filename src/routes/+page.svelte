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
  import ScrollReveal from '$lib/components/ScrollReveal.svelte';
  import BiomeBackground from '$lib/components/BiomeBackground.svelte';
  import BackgroundToggle from '$lib/components/landing/BackgroundToggle.svelte';
  import LandingHero from '$lib/components/landing/LandingHero.svelte';
  import Ecg from '$lib/components/shared/Ecg.svelte';
  import LiveWalkBanner from '$lib/components/LiveWalkBanner.svelte';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import { roundPulse } from '$lib/biome/state';
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

  const heroTag = `RIGHT NOW · ${new Date()
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    .toUpperCase()} · LONDON`;

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
    return () => window.removeEventListener('landing-bg-change', handleBgChange);
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
      <Ecg rhr={roundPulse(pulse)} />
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
      strap={data.heroTitle.strap}
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
    <span style="opacity: 0.5;">Scroll ↓</span>
  </div>
</section>

<!-- DIVIDER -->
<hr class="rule" />

<!-- THE BIOME — explanation as a bold callout -->
<section class="px-6 sm:px-10 md:px-16 py-12">
  <ScrollReveal>
    <div class="max-w-4xl">
      <p class="label" style="color: var(--text-ghost); margin-bottom: 4px;">02 / SIGNATURE</p>
      <p class="label mb-4">The Biome</p>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div class="accent-strip">
          <p class="display text-[20px] mb-2" style="color: var(--text-primary);">PULSE</p>
          <p class="text-sm leading-relaxed" style="color: var(--text-secondary);">
            When my heart rate rises, the particles quicken. Each beat pulses through the field.
          </p>
        </div>
        <div class="accent-strip">
          <p class="display text-[20px] mb-2" style="color: var(--text-primary);">WEATHER</p>
          <p class="text-sm leading-relaxed" style="color: var(--text-secondary);">
            When it rains outside, it rains here too. Wind direction and speed drive particle drift.
          </p>
        </div>
        <div class="accent-strip">
          <p class="display text-[20px] mb-2" style="color: var(--text-primary);">RECOVERY</p>
          <p class="text-sm leading-relaxed" style="color: var(--text-secondary);">
            Colour intensity tracks recovery score. Higher recovery means more vivid particles.
          </p>
        </div>
      </div>
    </div>
  </ScrollReveal>
</section>

<!-- DIVIDER -->
<hr class="rule" />

<!-- WRITING — full width, list style -->
<section class="px-6 sm:px-10 md:px-16 py-12" style="background: var(--bg-section);">
  <ScrollReveal>
    <div class="max-w-4xl">
      <div class="flex justify-between items-end mb-6">
        <div>
          <p class="label" style="color: var(--text-ghost); margin-bottom: 4px;">03 / WRITING</p>
          <p class="label">Writing</p>
        </div>
        <a href="/blog" class="nav-link">All posts →</a>
      </div>

      {#if data.posts.length}
        <div class="space-y-0">
          {#each data.posts as post, i}
            <a
              href="/blog/{post.slug}"
              class="block py-4 group transition-colors hover:bg-[rgba(196,87,10,0.04)]"
              style="border-top: 1px solid var(--divider);"
            >
              <div class="flex justify-between items-baseline gap-4">
                <span class="text-base sm:text-lg font-medium group-hover:text-[var(--accent)] transition-colors" style="color: var(--text-primary);">
                  {post.title}
                </span>
                <span class="label shrink-0" style="font-size: 10px;">
                  {post.publishedAt ? new Date(post.publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}
                </span>
              </div>
            </a>
          {/each}
          <div style="border-top: 1px solid var(--divider);"></div>
        </div>
      {:else}
        <p class="text-sm" style="color: var(--text-muted);">Nothing published yet.</p>
      {/if}
    </div>
  </ScrollReveal>
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
