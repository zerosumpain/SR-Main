<svelte:head>
  <title>Strange Ramblings</title>
  <meta name="description" content="A living canvas. Personal experiments in code, design, and everything between." />
</svelte:head>

<script lang="ts">
  import { getContext } from 'svelte';
  import ScrollReveal from '$lib/components/ScrollReveal.svelte';
  import { roundPulse } from '$lib/biome/state';
  import type { BiomeStore } from '$lib/biome/store.svelte';

  const store = getContext<BiomeStore>('biome');

  let pulse = $derived(store.state.pulse);
  let temp = $derived(store.state.weather.temp);
  let condition = $derived(store.state.weather.condition);
</script>

<!-- Act 1: The Breath -->
<section class="h-screen flex flex-col justify-between p-6 sm:p-8 md:p-12 lg:p-16">
  <!-- Top bar -->
  <div class="flex justify-between items-start">
    <!-- Monogram -->
    <a href="/" class="group flex items-baseline no-underline select-none">
      <span
        class="text-[48px] sm:text-[56px] md:text-[64px] font-thin tracking-[0.15em] leading-none"
        style="color: var(--text-primary); font-family: var(--font-sans);"
      >S</span><span
        class="text-[48px] sm:text-[56px] md:text-[64px] font-thin tracking-[0.15em] leading-none transition-opacity duration-500"
        style="color: var(--accent); font-family: var(--font-sans); opacity: 0.55;"
      >R</span>
    </a>

    <!-- Navigation -->
    <nav class="flex gap-5 sm:gap-8 pt-4 sm:pt-5">
      <a href="/blog" class="nav-link text-[10px] sm:text-[11px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Writing
      </a>
      <a href="/projects" class="nav-link text-[10px] sm:text-[11px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Projects
      </a>
      <a href="#about" class="nav-link text-[10px] sm:text-[11px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">
        About
      </a>
    </nav>
  </div>

  <!-- Center vitals -->
  <div class="flex-1 flex items-center justify-center">
    <p
      class="text-[9px] sm:text-[10px] uppercase tracking-[0.5em]"
      style="color: var(--text-whisper); font-family: var(--font-mono);"
    >
      {roundPulse(pulse)} bpm&ensp;·&ensp;{Math.round(temp)}°c&ensp;·&ensp;{condition}
    </p>
  </div>

  <!-- Subtle scroll cue -->
  <div class="flex justify-center pb-4 opacity-20">
    <svg width="16" height="24" viewBox="0 0 16 24" fill="none" stroke="currentColor" stroke-width="1" style="color: var(--text-ghost);">
      <rect x="1" y="1" width="14" height="22" rx="7" />
      <circle cx="8" cy="7" r="1.5" fill="currentColor" class="animate-bounce" style="animation-duration: 2s;" />
    </svg>
  </div>
</section>

<!-- Act 2: The Trail -->

<!-- About -->
<div class="h-[25vh] sm:h-[30vh]"></div>
<section id="about" class="max-w-lg mx-auto px-6 sm:px-8">
  <ScrollReveal>
    <div class="backdrop-blur-md border rounded-xl p-6 sm:p-8" style="background: var(--card-bg); border-color: var(--card-border);">
      <p class="text-base font-normal leading-relaxed tracking-wide" style="color: var(--text-primary);">
        John.
      </p>
      <p class="text-sm sm:text-base font-normal leading-relaxed tracking-wide mt-2" style="color: var(--text-secondary);">
        Building things with code in London. This site is a canvas —
        a place to think out loud and share what I'm working on.
      </p>
    </div>
  </ScrollReveal>
</section>

<!-- The Biome -->
<div class="h-[25vh] sm:h-[30vh]"></div>
<section class="max-w-lg mx-auto px-6 sm:px-8">
  <ScrollReveal>
    <div class="backdrop-blur-md border rounded-xl p-6 sm:p-8" style="background: var(--card-bg); border-color: var(--card-border);">
      <h3
        class="text-[10px] uppercase tracking-[0.3em] mb-4"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >The Biome</h3>
      <p class="text-sm font-normal leading-relaxed tracking-wide" style="color: var(--text-secondary);">
        The background you see is alive. It's driven by my heart rate,
        the local weather, and the time of day. When my pulse rises,
        the particles quicken. When it rains outside, it rains here too.
      </p>
    </div>
  </ScrollReveal>
</section>

<!-- Writing -->
<div class="h-[25vh] sm:h-[30vh]"></div>
<section class="max-w-lg mx-auto px-6 sm:px-8 pb-24 sm:pb-32">
  <ScrollReveal>
    <div class="backdrop-blur-md border rounded-xl p-6 sm:p-8" style="background: var(--card-bg); border-color: var(--card-border);">
      <h3
        class="text-[10px] uppercase tracking-[0.3em] mb-6"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >Writing</h3>
      <ul class="space-y-4">
        <li>
          <span class="text-sm font-normal tracking-wide" style="color: var(--text-secondary);">
            Building a living background with biometric data
          </span>
        </li>
        <li>
          <span class="text-sm font-normal tracking-wide" style="color: var(--text-secondary);">
            Rewriting everything in Svelte, again
          </span>
        </li>
        <li>
          <span class="text-sm font-normal tracking-wide" style="color: var(--text-secondary);">
            On personal sites as creative expression
          </span>
        </li>
      </ul>
      <a
        href="/blog"
        class="nav-link inline-block mt-6 text-[10px] uppercase tracking-[0.2em]"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >
        See all →
      </a>
    </div>
  </ScrollReveal>
</section>

<!-- Footer -->
<footer class="pb-12 flex justify-center gap-6">
  <a
    href="https://github.com/jkrup"
    target="_blank"
    rel="noopener"
    class="nav-link text-[10px] uppercase tracking-[0.2em]"
    style="color: var(--text-whisper); font-family: var(--font-mono);"
  >GitHub</a>
  <span style="color: var(--text-whisper); opacity: 0.4;">·</span>
  <a
    href="mailto:john@strangeramblings.com"
    class="nav-link text-[10px] uppercase tracking-[0.2em]"
    style="color: var(--text-whisper); font-family: var(--font-mono);"
  >Email</a>
</footer>
