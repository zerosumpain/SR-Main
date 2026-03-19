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
<section class="h-screen flex flex-col justify-between p-8 md:p-12">
  <!-- Top bar -->
  <div class="flex justify-between items-start">
    <!-- Monogram -->
    <span class="text-5xl font-extralight tracking-wider" style="color: var(--text-primary)">
      SR
    </span>

    <!-- Navigation -->
    <nav class="flex gap-5">
      <a href="/blog" class="text-[11px] uppercase tracking-[0.15em]" style="color: var(--text-ghost)">
        Writing
      </a>
      <a href="/projects" class="text-[11px] uppercase tracking-[0.15em]" style="color: var(--text-ghost)">
        Projects
      </a>
      <a href="#about" class="text-[11px] uppercase tracking-[0.15em]" style="color: var(--text-ghost)">
        About
      </a>
    </nav>
  </div>

  <!-- Center vitals -->
  <div class="flex-1 flex items-center justify-center">
    <p class="text-[9px] uppercase tracking-[0.4em]" style="color: var(--text-whisper)">
      {roundPulse(pulse)} bpm · {Math.round(temp)}°c · {condition}
    </p>
  </div>

  <!-- Empty bottom for balance -->
  <div></div>
</section>

<!-- Act 2: The Trail -->

<!-- About -->
<div class="h-[35vh]"></div>
<section id="about" class="max-w-xl mx-auto px-8">
  <ScrollReveal>
    <div class="backdrop-blur-sm bg-black/30 rounded-lg p-6">
      <p class="text-lg font-light leading-relaxed" style="color: var(--text-secondary)">
        John. Building things with code in London. This site is a canvas —
        a place to think out loud and share what I'm working on.
      </p>
    </div>
  </ScrollReveal>
</section>

<!-- The Biome -->
<div class="h-[35vh]"></div>
<section class="max-w-xl mx-auto px-8">
  <ScrollReveal>
    <div class="backdrop-blur-sm bg-black/30 rounded-lg p-6">
      <p class="text-sm font-light leading-relaxed" style="color: var(--text-ghost)">
        The background you see is alive. It's driven by my heart rate, the local
        weather, and the time of day. When my pulse rises, the particles quicken.
        When it rains outside, it rains here too.
      </p>
    </div>
  </ScrollReveal>
</section>

<!-- Writing -->
<div class="h-[35vh]"></div>
<section class="max-w-xl mx-auto px-8 pb-32">
  <ScrollReveal>
    <div class="backdrop-blur-sm bg-black/30 rounded-lg p-6">
      <h2 class="text-[11px] uppercase tracking-[0.3em] mb-6" style="color: var(--text-ghost)">
        Writing
      </h2>
      <ul class="space-y-3">
        <li>
          <a href="#" class="text-sm font-light hover:text-[var(--accent)] transition-colors" style="color: var(--text-secondary)">
            Post title one
          </a>
        </li>
        <li>
          <a href="#" class="text-sm font-light hover:text-[var(--accent)] transition-colors" style="color: var(--text-secondary)">
            Post title two
          </a>
        </li>
        <li>
          <a href="#" class="text-sm font-light hover:text-[var(--accent)] transition-colors" style="color: var(--text-secondary)">
            Post title three
          </a>
        </li>
      </ul>
      <a href="/blog" class="inline-block mt-4 text-[11px] uppercase tracking-[0.2em] hover:text-[var(--accent)] transition-colors" style="color: var(--text-ghost)">
        See all →
      </a>
    </div>
  </ScrollReveal>
</section>

<!-- Footer -->
<footer class="pb-8 text-center">
  <p class="text-[11px] tracking-[0.15em]" style="color: var(--text-whisper)">
    <a href="https://github.com" class="hover:text-[var(--accent)] transition-colors">GitHub</a>
  </p>
</footer>
