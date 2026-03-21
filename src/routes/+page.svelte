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
  import { getContext } from 'svelte';
  import ScrollReveal from '$lib/components/ScrollReveal.svelte';
  import { roundPulse } from '$lib/biome/state';
  import type { BiomeStore } from '$lib/biome/store.svelte';

  import { onMount } from 'svelte';
  const store = getContext<BiomeStore>('biome');

  let { data } = $props();

  let mounted = $state(false);

  // Before mount: use server-fetched biome data. After mount: use live store.
  let pulse = $derived(mounted ? store.state.pulse : (data.initialBiome?.pulse ?? 60));
  let temp = $derived(mounted ? store.state.weather.temp : (data.initialBiome?.weather?.temp ?? 15));
  let condition = $derived(mounted ? store.state.weather.condition : (data.initialBiome?.weather?.condition ?? 'clear'));

  onMount(() => {
    if (data.initialBiome) {
      store.setState(data.initialBiome);
    }
    mounted = true;
  });
</script>

<!-- HERO — full viewport, heavy type -->
<section class="min-h-screen flex flex-col justify-between px-6 sm:px-10 md:px-16 py-8">
  <!-- Top bar -->
  <div class="flex justify-between items-start">
    <a href="/" class="display text-[28px] sm:text-[32px] leading-none no-underline" style="color: var(--text-primary);">
      STRANGE<br>RAMBLINGS
    </a>

    <nav class="flex gap-6 pt-1">
      <a href="/projects" class="nav-link">Projects</a>
      <a href="/blog" class="nav-link">Writing</a>
      <a href="/health" class="nav-link">Health</a>
    </nav>
  </div>

  <!-- Center — stats + explainer side by side -->
  <div class="flex-1 flex items-center">
    <div class="w-full grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-16 items-center">
      <!-- Left: vitals -->
      <div class="text-center md:text-right">
        <p class="display text-[64px] sm:text-[96px] md:text-[120px]" style="color: var(--accent);">
          {roundPulse(pulse)}
        </p>
        <p class="label mt-2">
          BPM&ensp;/&ensp;{data.steps?.toLocaleString() || '—'} STEPS
        </p>
        <p class="label mt-1">
          {Math.round(temp)}°C&ensp;/&ensp;{condition.toUpperCase()}
        </p>
      </div>

      <!-- Right: explainer with accent strip -->
      <div class="accent-strip max-w-[200px]">
        <p class="text-base font-medium leading-relaxed" style="color: var(--text-primary);">
          This is me, from about 15 minutes ago.
        </p>
        <p class="text-sm leading-relaxed mt-2" style="color: var(--text-secondary);">
          The background is my heart rate. Below is today's steps, distance, and the weather
          wherever I am, right now.
        </p>
      </div>
    </div>
  </div>

  <!-- Bottom — scroll prompt -->
  <div class="text-center">
    <p class="label" style="opacity: 0.4;">SCROLL</p>
  </div>
</section>

<!-- DIVIDER -->
<hr class="rule" />

<!-- THE BIOME — explanation as a bold callout -->
<section class="px-6 sm:px-10 md:px-16 py-12">
  <ScrollReveal>
    <div class="max-w-4xl">
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
        <p class="label">Writing</p>
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
  <p class="display text-[14px]" style="color: var(--text-ghost);">STRANGE RAMBLINGS</p>
  <div class="flex gap-6">
    <a href="https://github.com/jkrup" target="_blank" rel="noopener" class="nav-link">GitHub</a>
    <a href="mailto:john@strangeramblings.com" class="nav-link">Email</a>
    <a href="/health" class="nav-link">Health</a>
    <a href="/admin" class="nav-link">Admin</a>
  </div>
</footer>
