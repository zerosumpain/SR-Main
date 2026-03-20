<svelte:head>
  <title>Health — Strange Ramblings</title>
</svelte:head>

<script lang="ts">
  import ScrollReveal from '$lib/components/ScrollReveal.svelte';
  import SlidePanel from '$lib/components/SlidePanel.svelte';
  import ReadinessHero from '$lib/components/health/ReadinessHero.svelte';
  import SparklineStrip from '$lib/components/health/SparklineStrip.svelte';
  import ActivityTimeline from '$lib/components/health/ActivityTimeline.svelte';
  import SleepBreakdown from '$lib/components/health/SleepBreakdown.svelte';
  import BodySignals from '$lib/components/health/BodySignals.svelte';
  import WeeklyStats from '$lib/components/health/WeeklyStats.svelte';

  let { data } = $props();

  // Panel state
  let panelOpen = $state(false);
  let panelTitle = $state('');
  let panelType = $state<'sleep' | 'activity' | 'signals' | 'stats' | 'readiness' | null>(null);
  let panelData = $state<any>(null);

  function openPanel(type: typeof panelType, title: string, pData?: any) {
    panelType = type;
    panelTitle = title;
    panelData = pData;
    panelOpen = true;
  }

  function closePanel() {
    panelOpen = false;
    panelType = null;
  }
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

<!-- Readiness Hero (full viewport) — clickable for detail -->
<button class="w-full text-left cursor-pointer" onclick={() => openPanel('readiness', 'Readiness', data.readiness)}>
  <ReadinessHero readiness={data.readiness} />
</button>

<!-- Sparklines -->
<div class="h-[8vh]"></div>
<ScrollReveal>
  <SparklineStrip sparklines={data.sparklines} />
</ScrollReveal>

<!-- Weekly Stats -->
<div class="h-[8vh]"></div>
<ScrollReveal>
  <button class="w-full text-left cursor-pointer" onclick={() => openPanel('stats', 'This Week', data.stats)}>
    <WeeklyStats stats={data.stats} />
  </button>
</ScrollReveal>

<!-- Sleep -->
<div class="h-[8vh]"></div>
<ScrollReveal>
  <button class="w-full text-left cursor-pointer" onclick={() => openPanel('sleep', 'Sleep Analysis', data.sleepAnalysis)}>
    <SleepBreakdown sleepAnalysis={data.sleepAnalysis} />
  </button>
</ScrollReveal>

<!-- Body Signals -->
<div class="h-[8vh]"></div>
<ScrollReveal>
  <button class="w-full text-left cursor-pointer" onclick={() => openPanel('signals', 'Body Signals', data.bodySignals)}>
    <BodySignals signals={data.bodySignals} />
  </button>
</ScrollReveal>

<!-- Activity Timeline -->
<div class="h-[8vh]"></div>
<ScrollReveal>
  <ActivityTimeline timeline={data.timeline} />
</ScrollReveal>

<!-- Footer -->
<div class="h-[6vh]"></div>
<footer class="pb-12 text-center">
  <a href="/" class="nav-link text-[10px] uppercase tracking-[0.2em]" style="color: var(--text-whisper); font-family: var(--font-mono);">Home</a>
</footer>

<!-- Slide-over Panel -->
<SlidePanel open={panelOpen} onclose={closePanel} title={panelTitle}>
  {#if panelType === 'readiness' && panelData}
    <div class="space-y-6">
      <div class="text-center">
        <p class="text-[60px] font-thin" style="color: var(--accent);">{Math.round(panelData.score)}</p>
        <p class="text-sm" style="color: var(--text-secondary);">{panelData.label}</p>
        <p class="text-xs mt-1" style="color: var(--text-ghost);">{panelData.recommendation}</p>
      </div>

      <div class="space-y-4">
        {#each Object.entries(panelData.factors) as [key, factor]}
          <div>
            <div class="flex justify-between items-center mb-1">
              <span class="text-[10px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">
                {key.replace(/([A-Z])/g, ' $1').trim()}
              </span>
              <span class="text-sm" style="color: var(--text-primary);">
                {Math.round((factor as any).value)}
              </span>
            </div>
            <div class="h-2 rounded-full" style="background: var(--card-border);">
              <div
                class="h-2 rounded-full transition-all"
                style="width: {Math.min(100, (factor as any).value)}%; background: var(--accent);"
              ></div>
            </div>
            <p class="text-[9px] mt-1" style="color: var(--text-ghost); font-family: var(--font-mono);">
              Weight: {((factor as any).weight * 100).toFixed(0)}%
              {#if (factor as any).direction}
                · Trend: {(factor as any).direction}
              {/if}
              {#if (factor as any).zone}
                · Zone: {(factor as any).zone}
              {/if}
            </p>
          </div>
        {/each}
      </div>
    </div>

  {:else if panelType === 'sleep' && panelData}
    <div class="space-y-6">
      {#if panelData.latest}
        <div>
          <p class="text-3xl font-light" style="color: var(--text-primary);">
            {(panelData.latest.totalDuration / 3600000).toFixed(1)} <span class="text-sm" style="color: var(--text-ghost);">hours</span>
          </p>
        </div>

        <!-- Detailed stages -->
        <div class="space-y-3">
          {#each [
            { label: 'Light Sleep', pct: panelData.latest.lightPercent, color: '#b8a88c', desc: 'Body repair, memory consolidation' },
            { label: 'Deep Sleep', pct: panelData.latest.deepPercent, color: '#8b6914', desc: 'Physical recovery, immune function' },
            { label: 'REM Sleep', pct: panelData.latest.remPercent, color: 'var(--accent)', desc: 'Cognitive recovery, dreaming' },
            { label: 'Awake', pct: panelData.latest.awakePercent, color: 'var(--text-whisper)', desc: 'Time awake during sleep' },
          ] as stage}
            <div class="flex items-center gap-3">
              <div class="w-3 h-3 rounded-full" style="background: {stage.color};"></div>
              <div class="flex-1">
                <div class="flex justify-between">
                  <span class="text-sm" style="color: var(--text-primary);">{stage.label}</span>
                  <span class="text-sm" style="color: var(--text-secondary); font-family: var(--font-mono);">{stage.pct}%</span>
                </div>
                <p class="text-[9px]" style="color: var(--text-ghost);">{stage.desc}</p>
              </div>
            </div>
          {/each}
        </div>

        <!-- Metrics detail -->
        <div class="space-y-3 pt-4" style="border-top: 1px solid var(--card-border);">
          {#each [
            { label: 'Performance', value: panelData.latest.performance, desc: 'How well you slept vs your need' },
            { label: 'Consistency', value: panelData.latest.consistency, desc: 'How regular your sleep schedule is' },
            { label: 'Efficiency', value: panelData.latest.efficiency, desc: 'Time asleep vs time in bed' },
          ] as metric}
            <div>
              <div class="flex justify-between items-center">
                <span class="text-sm" style="color: var(--text-primary);">{metric.label}</span>
                <span class="text-sm" style="color: var(--text-secondary); font-family: var(--font-mono);">{Math.round(metric.value)}%</span>
              </div>
              <div class="h-1.5 rounded-full mt-1" style="background: var(--card-border);">
                <div class="h-1.5 rounded-full" style="width: {metric.value}%; background: var(--accent);"></div>
              </div>
              <p class="text-[9px] mt-0.5" style="color: var(--text-ghost);">{metric.desc}</p>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Trend -->
      {#if panelData.trend?.length}
        <div class="pt-4" style="border-top: 1px solid var(--card-border);">
          <p class="text-[10px] uppercase tracking-[0.2em] mb-3" style="color: var(--text-ghost); font-family: var(--font-mono);">Recent Nights</p>
          <div class="space-y-2">
            {#each panelData.trend as night}
              <div class="flex justify-between text-sm">
                <span style="color: var(--text-ghost); font-family: var(--font-mono);">{night.date}</span>
                <span style="color: var(--text-secondary);">
                  {(night.duration / 3600000).toFixed(1)}h · {Math.round(night.performance)}%
                </span>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>

  {:else if panelType === 'signals' && panelData}
    <div class="space-y-5">
      {#each panelData as signal}
        {@const labels = { heart_rate: 'Heart Rate', heart_rate_variability: 'HRV', resting_heart_rate: 'Resting HR', oxygen_saturation: 'SpO₂', respiratory_rate: 'Resp Rate' } as Record<string, string>}
        <div class="p-4 rounded-xl border" style="background: var(--card-bg); border-color: var(--card-border);">
          <div class="flex justify-between items-start">
            <div>
              <p class="text-[10px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">
                {labels[signal.metric] || signal.metric}
              </p>
              <p class="text-2xl font-light mt-1" style="color: var(--text-primary);">
                {Math.round(signal.current)} <span class="text-sm" style="color: var(--text-ghost);">{signal.unit}</span>
              </p>
            </div>
            <span class="text-xl">{signal.trend === 'up' ? '↑' : signal.trend === 'down' ? '↓' : '→'}</span>
          </div>
          <div class="flex justify-between mt-3 text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
            <span>7-day avg: {Math.round(signal.average7d)} {signal.unit}</span>
            <span>Δ {signal.current > signal.average7d ? '+' : ''}{Math.round(signal.current - signal.average7d)} {signal.unit}</span>
          </div>
        </div>
      {/each}
    </div>

  {:else if panelType === 'stats' && panelData}
    <div class="space-y-6">
      {#if panelData.weekly}
        <div class="space-y-4">
          {#each [
            { label: 'Activities', value: panelData.weekly.activities, unit: '' },
            { label: 'Distance', value: (panelData.weekly.totalDistance / 1000).toFixed(1), unit: 'km' },
            { label: 'Duration', value: Math.round(panelData.weekly.totalDuration / 60), unit: 'min' },
            { label: 'Elevation', value: Math.round(panelData.weekly.totalElevation), unit: 'm' },
            { label: 'Avg Recovery', value: panelData.weekly.avgRecovery, unit: '%' },
            { label: 'Avg Sleep', value: panelData.weekly.avgSleep, unit: '%' },
          ] as stat}
            <div class="flex justify-between items-center py-2" style="border-bottom: 1px solid var(--card-border);">
              <span class="text-sm" style="color: var(--text-secondary);">{stat.label}</span>
              <span class="text-sm" style="color: var(--text-primary); font-family: var(--font-mono);">{stat.value} {stat.unit}</span>
            </div>
          {/each}
        </div>
      {/if}

      {#if panelData.personalRecords?.length}
        <div class="pt-2">
          <p class="text-[10px] uppercase tracking-[0.2em] mb-4" style="color: var(--text-ghost); font-family: var(--font-mono);">Personal Records</p>
          {#each panelData.personalRecords as pr}
            <div class="flex justify-between items-center py-2" style="border-bottom: 1px solid var(--card-border);">
              <div>
                <span class="text-sm" style="color: var(--text-primary);">{pr.label}</span>
                <p class="text-[9px]" style="color: var(--text-ghost); font-family: var(--font-mono);">{pr.date}</p>
              </div>
              <span class="text-sm font-light" style="color: var(--accent); font-family: var(--font-mono);">{pr.value} {pr.unit}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</SlidePanel>
