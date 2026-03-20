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
<section class="h-screen flex flex-col justify-between p-8 md:p-12 lg:p-16">
  <!-- Top bar -->
  <div class="flex justify-between items-start">
    <!-- Monogram -->
    <a href="/" class="group flex items-baseline gap-0.5 no-underline">
      <span
        class="text-[56px] md:text-[64px] font-thin tracking-[0.2em] leading-none"
        style="color: var(--text-primary); font-family: var(--font-sans);"
      >S</span>
      <span
        class="text-[56px] md:text-[64px] font-thin tracking-[0.2em] leading-none opacity-60 group-hover:opacity-100 transition-opacity duration-500"
        style="color: var(--accent); font-family: var(--font-sans); opacity: 0.7;"
      >R</span>
    </a>

    <!-- Navigation -->
    <nav class="flex gap-8 pt-3">
      <a href="/blog" class="nav-link text-[11px] uppercase tracking-[0.2em] font-light" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Writing
      </a>
      <a href="/projects" class="nav-link text-[11px] uppercase tracking-[0.2em] font-light" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Projects
      </a>
      <a href="#about" class="nav-link text-[11px] uppercase tracking-[0.2em] font-light" style="color: var(--text-ghost); font-family: var(--font-mono);">
        About
      </a>
    </nav>
  </div>

  <!-- Center vitals -->
  <div class="flex-1 flex items-center justify-center">
    <p
      class="text-[10px] uppercase tracking-[0.5em] font-light"
      style="color: var(--text-whisper); font-family: var(--font-mono);"
    >
      {roundPulse(pulse)} bpm&ensp;·&ensp;{Math.round(temp)}°c&ensp;·&ensp;{condition}
    </p>
  </div>

  <!-- Empty bottom for balance -->
  <div class="h-8"></div>
</section>

<!-- Act 2: The Trail -->

<!-- About -->
<div class="h-[30vh]"></div>
<section id="about" class="max-w-lg mx-auto px-8">
  <ScrollReveal>
    <div class="backdrop-blur-md border rounded-xl p-8" style="background: var(--card-bg); border-color: var(--card-border);">
      <p class="text-base font-normal leading-relaxed tracking-wide" style="color: var(--text-secondary);">
        John. Building things with code in London.
      </p>
      <p class="text-base font-light leading-relaxed tracking-wide mt-3" style="color: var(--text-secondary);">
        This site is a canvas — a place to think out loud and share what I'm working on.
      </p>
    </div>
  </ScrollReveal>
</section>

<!-- The Biome -->
<div class="h-[30vh]"></div>
<section class="max-w-lg mx-auto px-8">
  <ScrollReveal>
    <div class="backdrop-blur-md border rounded-xl p-8" style="background: var(--card-bg); border-color: var(--card-border);">
      <h3
        class="text-[10px] uppercase tracking-[0.3em] mb-4 font-normal"
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
<div class="h-[30vh]"></div>
<section class="max-w-lg mx-auto px-8 pb-32">
  <ScrollReveal>
    <div class="backdrop-blur-md border rounded-xl p-8" style="background: var(--card-bg); border-color: var(--card-border);">
      <h3
        class="text-[10px] uppercase tracking-[0.3em] mb-6 font-normal"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >Writing</h3>
      <ul class="space-y-4">
        <li>
          <span class="text-sm font-normal tracking-wide" style="color: var(--text-secondary);">
            Post title one
          </span>
        </li>
        <li>
          <span class="text-sm font-normal tracking-wide" style="color: var(--text-secondary);">
            Post title two
          </span>
        </li>
        <li>
          <span class="text-sm font-normal tracking-wide" style="color: var(--text-secondary);">
            Post title three
          </span>
        </li>
      </ul>
      <a
        href="/blog"
        class="nav-link inline-block mt-6 text-[10px] uppercase tracking-[0.2em] font-normal"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >
        See all →
      </a>
    </div>
  </ScrollReveal>
</section>

<!-- Footer -->
<footer class="pb-12 text-center">
  <a
    href="https://github.com"
    class="nav-link text-[10px] uppercase tracking-[0.2em] font-normal"
    style="color: var(--text-whisper); font-family: var(--font-mono);"
  >GitHub</a>
</footer>
