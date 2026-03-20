<svelte:head>
  <title>Strange Ramblings</title>
  <meta name="description" content="Building things with code in London. A living canvas." />
</svelte:head>

<script lang="ts">
  import { getContext } from 'svelte';
  import ScrollReveal from '$lib/components/ScrollReveal.svelte';
  import { roundPulse } from '$lib/biome/state';
  import type { BiomeStore } from '$lib/biome/store.svelte';

  const store = getContext<BiomeStore>('biome');

  let { data } = $props();

  let pulse = $derived(store.state.pulse);
  let temp = $derived(store.state.weather.temp);
  let condition = $derived(store.state.weather.condition);
</script>

<!-- HERO — full viewport, heavy type -->
<section class="min-h-screen flex flex-col justify-between px-6 sm:px-10 md:px-16 py-8">
  <!-- Top bar -->
  <div class="flex justify-between items-start">
    <a href="/" class="display text-[28px] sm:text-[32px] leading-none no-underline" style="color: var(--text-primary);">
      STRANGE<br>RAMBLINGS
    </a>

    <nav class="flex gap-6 pt-1">
      <a href="/blog" class="nav-link">Writing</a>
      <a href="/health" class="nav-link">Health</a>
      <a href="#about" class="nav-link">About</a>
    </nav>
  </div>

  <!-- Center — vitals as a statement -->
  <div class="flex-1 flex items-center justify-center">
    <div class="text-center">
      <p class="display text-[64px] sm:text-[96px] md:text-[128px]" style="color: var(--accent);">
        {roundPulse(pulse)}
      </p>
      <p class="label mt-2">
        BPM&ensp;/&ensp;{Math.round(temp)}°C&ensp;/&ensp;{condition.toUpperCase()}
      </p>
    </div>
  </div>

  <!-- Bottom — scroll prompt -->
  <div class="text-center">
    <p class="label" style="opacity: 0.4;">SCROLL</p>
  </div>
</section>

<!-- ABOUT — wide, dense, no card wrapper -->
<section id="about" class="px-6 sm:px-10 md:px-16 py-12" style="background: var(--bg-section);">
  <ScrollReveal>
    <div class="max-w-4xl">
      <p class="label mb-4">About</p>
      <h2 class="display text-[32px] sm:text-[40px] md:text-[48px] mb-6" style="color: var(--text-primary);">
        BUILDING THINGS<br>WITH CODE IN LONDON.
      </h2>
      <div class="accent-strip max-w-2xl">
        <p class="text-base sm:text-lg leading-relaxed" style="color: var(--text-secondary);">
          This site is a canvas — a place to think out loud and share what I'm working on.
          The background you see is alive. It's driven by my heart rate, the local weather,
          and the time of day.
        </p>
      </div>
    </div>
  </ScrollReveal>
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
  </div>
</footer>
