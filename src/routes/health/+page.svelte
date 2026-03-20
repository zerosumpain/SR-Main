<svelte:head>
  <title>Health — Strange Ramblings</title>
</svelte:head>

<script lang="ts">
  import ScrollReveal from '$lib/components/ScrollReveal.svelte';
  import ReadinessHero from '$lib/components/health/ReadinessHero.svelte';
  import SparklineStrip from '$lib/components/health/SparklineStrip.svelte';
  import ActivityTimeline from '$lib/components/health/ActivityTimeline.svelte';
  import SleepBreakdown from '$lib/components/health/SleepBreakdown.svelte';
  import BodySignals from '$lib/components/health/BodySignals.svelte';
  import WeeklyStats from '$lib/components/health/WeeklyStats.svelte';

  let { data } = $props();
</script>

<!-- Nav -->
<div class="fixed top-0 left-0 right-0 z-20 p-6 sm:p-8 flex justify-between items-start">
  <a href="/" class="group flex items-baseline no-underline select-none">
    <span class="text-[36px] font-thin tracking-[0.15em] leading-none" style="color: var(--text-primary); font-family: var(--font-sans);">S</span><span class="text-[36px] font-thin tracking-[0.15em] leading-none" style="color: var(--accent); font-family: var(--font-sans); opacity: 0.55;">R</span>
  </a>
  <nav class="flex gap-5 pt-2">
    <a href="/" class="nav-link text-[10px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">Home</a>
    <a href="/blog" class="nav-link text-[10px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">Writing</a>
  </nav>
</div>

<!-- Readiness Hero (full viewport) -->
<ReadinessHero readiness={data.readiness} />

<!-- Sparklines -->
<div class="h-[15vh]"></div>
<ScrollReveal>
  <SparklineStrip sparklines={data.sparklines} />
</ScrollReveal>

<!-- Weekly Stats -->
<div class="h-[20vh]"></div>
<ScrollReveal>
  <WeeklyStats stats={data.stats} />
</ScrollReveal>

<!-- Sleep -->
<div class="h-[20vh]"></div>
<ScrollReveal>
  <SleepBreakdown sleepAnalysis={data.sleepAnalysis} />
</ScrollReveal>

<!-- Body Signals -->
<div class="h-[20vh]"></div>
<ScrollReveal>
  <BodySignals signals={data.bodySignals} />
</ScrollReveal>

<!-- Activity Timeline -->
<div class="h-[20vh]"></div>
<ScrollReveal>
  <ActivityTimeline timeline={data.timeline} />
</ScrollReveal>

<!-- Footer spacer -->
<div class="h-[10vh]"></div>
<footer class="pb-12 text-center">
  <a href="/" class="nav-link text-[10px] uppercase tracking-[0.2em]" style="color: var(--text-whisper); font-family: var(--font-mono);">Home</a>
</footer>
