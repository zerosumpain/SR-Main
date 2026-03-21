<svelte:head>
  <title>Health — Strange Ramblings</title>
  <meta name="description" content="Live health dashboard — readiness, heart rate, sleep, training load." />
  <meta property="og:title" content="Health — Strange Ramblings" />
  <meta property="og:description" content="Live health dashboard — readiness, heart rate, sleep, training load." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://strangeramblings.com/health" />
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
  import ActivityDetail from '$lib/components/health/ActivityDetail.svelte';

  let { data } = $props();

  // Panel state
  let panelOpen = $state(false);
  let panelTitle = $state('');
  let panelType = $state<'sleep' | 'activity' | 'signals' | 'stats' | 'readiness' | null>(null);
  let panelData = $state<any>(null);
  let loadingActivity = $state(false);

  function openPanel(type: typeof panelType, title: string, pData?: any) {
    panelType = type;
    panelTitle = title;
    panelData = pData;
    panelOpen = true;
  }

  async function openActivityDetail(event: any) {
    panelType = 'activity';
    panelTitle = event.title || 'Activity';
    panelData = null;
    panelOpen = true;
    loadingActivity = true;

    try {
      const url = `/api/health/activity/${event.stravaId}`;
      console.log('[activity] fetching:', url);
      const res = await window.fetch(url);
      console.log('[activity] response:', res.status);
      if (res.ok) {
        const json = await res.json();
        console.log('[activity] got data:', json.name);
        panelData = json;
      } else {
        console.log('[activity] error:', res.status);
      }
    } catch (e) {
      console.error('[activity] fetch failed:', e);
    }
    loadingActivity = false;
  }

  function closePanel() {
    panelOpen = false;
    panelType = null;
  }
</script>

<!-- Nav -->
<div class="fixed top-0 left-0 right-0 z-20 px-6 sm:px-10 md:px-16 py-6 flex justify-between items-start" style="background: linear-gradient(to bottom, var(--bg) 60%, transparent);">
  <a href="/" class="display text-[20px] sm:text-[24px] leading-none">SR</a>
  <nav class="flex gap-6 pt-1">
    <a href="/" class="nav-link">Home</a>
    <a href="/blog" class="nav-link">Writing</a>
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
  <ActivityTimeline timeline={data.timeline} onselect={openActivityDetail} />
</ScrollReveal>

<!-- Footer + Sync Status -->
<div class="h-[6vh]"></div>
<footer class="px-6 sm:px-10 md:px-16 py-6 flex flex-wrap justify-between items-center gap-4" style="border-top: 2px solid var(--card-border);">
  <div class="flex flex-wrap gap-4">
    {#if data.syncState?.length}
      {#each data.syncState as sync}
        {@const lastSync = sync.lastSyncAt || sync.last_sync_at}
        {@const ago = lastSync ? Math.round((Date.now() / 1000 - lastSync) / 60) : null}
        {@const isStale = ago !== null && ago > 120}
        <span class="label" style="font-size: 9px; color: {isStale ? '#c4570a' : 'var(--text-ghost)'};">
          {sync.service}:
          {#if ago !== null}
            {ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`}
            {#if sync.status === 'error' || sync.status === 'syncing'}
              · {sync.status}
            {/if}
          {:else}
            never
          {/if}
        </span>
      {/each}
    {/if}
  </div>
  <a href="/" class="nav-link">Home</a>
  <a href="/admin" class="nav-link">Admin</a>
</footer>

<!-- Slide-over Panel -->
<SlidePanel open={panelOpen} onclose={closePanel} title={panelTitle}>
  {#if panelType === 'readiness' && panelData}
    {@const factorMeta = {
      recovery: { desc: 'Whoop recovery score. Measures how prepared your body is for strain based on HRV, resting heart rate, and sleep.', low: 0, high: 100, goodMin: 67, unit: '' },
      hrvTrend: { desc: 'Heart rate variability trend over 7 days. Higher HRV generally indicates better cardiovascular fitness and recovery.', low: 0, high: 100, goodMin: 60, unit: '' },
      sleepQuality: { desc: 'Sleep performance percentage from Whoop. Compares actual sleep obtained to your body\'s calculated sleep need.', low: 0, high: 100, goodMin: 70, unit: '%' },
      loadBalance: { desc: 'Acute-to-chronic workload ratio (ACWR). Compares your last 7 days of strain to your 28-day average. Optimal range is 0.8–1.3.', low: 0, high: 100, goodMin: 80, unit: '' },
    } as Record<string, any>}

    <div class="space-y-6">
      <div class="text-center">
        <p class="text-[60px] font-thin" style="color: var(--accent);">{Math.round(panelData.score)}</p>
        <p class="text-sm" style="color: var(--text-secondary);">{panelData.label}</p>
        <p class="text-xs mt-2 max-w-xs mx-auto" style="color: var(--text-ghost);">
          A composite score from recovery, HRV trend, sleep quality, and training load balance. Updated daily from Whoop and Apple Health data.
        </p>
      </div>

      <!-- Recommendation -->
      <div class="p-3 rounded-lg" style="background: var(--card-bg); border: 1px solid var(--card-border);">
        <p class="text-xs" style="color: var(--text-secondary);">{panelData.recommendation}</p>
      </div>

      <!-- Factors with explainers -->
      <div class="space-y-5">
        {#each Object.entries(panelData.factors) as [key, factor]}
          {@const meta = factorMeta[key] || { desc: '', low: 0, high: 100, goodMin: 50 }}
          {@const val = Math.round((factor as any).value)}
          <div>
            <div class="flex justify-between items-center mb-1">
              <span class="text-[10px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">
                {key.replace(/([A-Z])/g, ' $1').trim()}
              </span>
              <span class="text-sm font-normal" style="color: {val >= meta.goodMin ? 'var(--accent)' : val >= meta.goodMin * 0.7 ? 'var(--text-secondary)' : '#8b3a1a'};">
                {val}{meta.unit}
              </span>
            </div>
            <!-- Range bar with marker -->
            <div class="relative h-2 rounded-full" style="background: var(--card-border);">
              <div class="h-2 rounded-full" style="width: {Math.min(100, val)}%; background: {val >= meta.goodMin ? 'var(--accent)' : val >= meta.goodMin * 0.7 ? 'var(--text-ghost)' : '#8b3a1a'};"></div>
            </div>
            <div class="flex justify-between mt-0.5">
              <span class="text-[8px]" style="color: var(--text-whisper); font-family: var(--font-mono);">0</span>
              <span class="text-[8px]" style="color: var(--text-whisper); font-family: var(--font-mono);">100</span>
            </div>
            <p class="text-[10px] mt-1 leading-relaxed" style="color: var(--text-ghost);">{meta.desc}</p>
            <p class="text-[9px] mt-0.5" style="color: var(--text-whisper); font-family: var(--font-mono);">
              Contributes {((factor as any).weight * 100).toFixed(0)}% to readiness
              {#if (factor as any).direction} · trending {(factor as any).direction}{/if}
              {#if (factor as any).zone} · zone: {(factor as any).zone}{/if}
            </p>
          </div>
        {/each}
      </div>
    </div>

  {:else if panelType === 'sleep' && panelData}
    <div class="space-y-6">
      {#if panelData.latest}
        {@const hrs = (panelData.latest.totalDuration / 3600000)}
        <div>
          <p class="text-3xl font-light" style="color: var(--text-primary);">
            {hrs.toFixed(1)} <span class="text-sm" style="color: var(--text-ghost);">hours</span>
          </p>
          <p class="text-[10px] mt-1" style="color: var(--text-ghost);">
            {hrs >= 7.5 ? 'Within the recommended 7-9 hour range.' : hrs >= 6 ? 'Below the recommended 7-9 hours. Aim for more.' : 'Significantly below recommended sleep. Recovery will be impacted.'}
          </p>
        </div>

        <!-- Stage bar -->
        <div class="space-y-3">
          {#each [
            { label: 'Light Sleep', pct: panelData.latest.lightPercent, color: '#b8a88c', desc: 'Body temperature drops, muscles relax. Important for memory consolidation and motor learning.', ideal: '40-60%' },
            { label: 'Deep Sleep', pct: panelData.latest.deepPercent, color: '#8b6914', desc: 'Growth hormone release, tissue repair, immune function. The most physically restorative stage.', ideal: '15-25%' },
            { label: 'REM Sleep', pct: panelData.latest.remPercent, color: 'var(--accent)', desc: 'Brain processes emotions and consolidates memories. Increases in later sleep cycles — cutting sleep short reduces REM.', ideal: '20-25%' },
            { label: 'Awake', pct: panelData.latest.awakePercent, color: 'var(--text-whisper)', desc: 'Brief awakenings are normal. Excessive wake time reduces sleep efficiency.', ideal: '<10%' },
          ] as stage}
            <div class="p-3 rounded-lg" style="background: var(--card-bg);">
              <div class="flex items-center gap-2 mb-1">
                <div class="w-2.5 h-2.5 rounded-full" style="background: {stage.color};"></div>
                <span class="text-sm" style="color: var(--text-primary);">{stage.label}</span>
                <span class="text-sm ml-auto" style="color: var(--text-secondary); font-family: var(--font-mono);">{stage.pct}%</span>
              </div>
              <div class="h-1.5 rounded-full mb-2" style="background: var(--card-border);">
                <div class="h-1.5 rounded-full" style="width: {stage.pct}%; background: {stage.color};"></div>
              </div>
              <p class="text-[10px] leading-relaxed" style="color: var(--text-ghost);">{stage.desc}</p>
              <p class="text-[9px] mt-1" style="color: var(--text-whisper); font-family: var(--font-mono);">Ideal range: {stage.ideal}</p>
            </div>
          {/each}
        </div>

        <!-- Metrics -->
        <div class="space-y-3 pt-4" style="border-top: 1px solid var(--card-border);">
          {#each [
            { label: 'Performance', value: panelData.latest.performance, desc: 'How much sleep you got relative to what your body needed. Accounts for sleep debt, recent strain, and baseline need.', good: 85 },
            { label: 'Consistency', value: panelData.latest.consistency, desc: 'How regular your sleep schedule is. Consistent bed and wake times improve circadian rhythm and sleep quality.', good: 75 },
            { label: 'Efficiency', value: panelData.latest.efficiency, desc: 'Percentage of time in bed actually spent asleep. Higher efficiency means less time lying awake.', good: 85 },
          ] as metric}
            <div>
              <div class="flex justify-between items-center">
                <span class="text-sm" style="color: var(--text-primary);">{metric.label}</span>
                <span class="text-sm" style="color: {metric.value >= metric.good ? 'var(--accent)' : 'var(--text-secondary)'}; font-family: var(--font-mono);">{Math.round(metric.value)}%</span>
              </div>
              <div class="h-1.5 rounded-full mt-1" style="background: var(--card-border);">
                <div class="h-1.5 rounded-full" style="width: {metric.value}%; background: {metric.value >= metric.good ? 'var(--accent)' : 'var(--text-ghost)'};"></div>
              </div>
              <p class="text-[10px] mt-1 leading-relaxed" style="color: var(--text-ghost);">{metric.desc}</p>
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
              {@const nightHrs = night.duration / 3600000}
              <div class="flex justify-between text-sm">
                <span style="color: var(--text-ghost); font-family: var(--font-mono);">{night.date}</span>
                <span style="color: {nightHrs >= 7 ? 'var(--text-secondary)' : 'var(--text-ghost)'};">
                  {nightHrs.toFixed(1)}h · {Math.round(night.performance)}%
                </span>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>

  {:else if panelType === 'signals' && panelData}
    {@const signalMeta = {
      heart_rate: { label: 'Heart Rate', desc: 'Average heart rate from Apple Health. Resting rate is measured separately — this includes active periods.', normalLow: 60, normalHigh: 100, context: 'A normal resting heart rate for adults is 60-100 bpm. Athletes often have lower resting rates (40-60 bpm).' },
      heart_rate_variability: { label: 'HRV', desc: 'Heart rate variability — the variation in time between heartbeats. Higher is generally better, indicating your nervous system is adaptable.', normalLow: 20, normalHigh: 80, context: 'HRV varies hugely by age and fitness. Your personal baseline matters more than population norms. Track your own trend.' },
      resting_heart_rate: { label: 'Resting HR', desc: 'Heart rate at rest, typically measured during sleep. A key indicator of cardiovascular fitness and recovery.', normalLow: 40, normalHigh: 70, context: 'Lower resting HR generally indicates better fitness. A sudden increase may signal illness, stress, or poor recovery.' },
      oxygen_saturation: { label: 'SpO₂', desc: 'Blood oxygen saturation. The percentage of haemoglobin carrying oxygen. Measured via pulse oximetry.', normalLow: 95, normalHigh: 100, context: 'Normal is 95-100%. Below 95% may indicate respiratory issues. Altitude also affects readings.' },
      respiratory_rate: { label: 'Respiratory Rate', desc: 'Breaths per minute, typically measured during sleep. Reflects respiratory and cardiovascular health.', normalLow: 12, normalHigh: 20, context: 'Normal adult range is 12-20 breaths/min at rest. Elevated rates can indicate stress, illness, or poor fitness.' },
    } as Record<string, any>}

    <div class="space-y-5">
      {#each panelData as signal}
        {@const meta = signalMeta[signal.metric] || { label: signal.metric, desc: '', normalLow: 0, normalHigh: 100, context: '' }}
        {@const inRange = signal.current >= meta.normalLow && signal.current <= meta.normalHigh}
        <div class="p-4 rounded-xl border" style="background: var(--card-bg); border-color: var(--card-border);">
          <div class="flex justify-between items-start">
            <div>
              <p class="text-[10px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">
                {meta.label}
              </p>
              <p class="text-2xl font-light mt-1" style="color: var(--text-primary);">
                {Math.round(signal.current)} <span class="text-sm" style="color: var(--text-ghost);">{signal.unit}</span>
              </p>
            </div>
            <span class="text-xl">{signal.trend === 'up' ? '↑' : signal.trend === 'down' ? '↓' : '→'}</span>
          </div>

          <!-- Range indicator -->
          <div class="mt-3">
            {#if true}
              {@const range = meta.normalHigh - meta.normalLow}
              {@const extendedLow = meta.normalLow - range * 0.3}
              {@const extendedHigh = meta.normalHigh + range * 0.3}
              {@const totalRange = extendedHigh - extendedLow}
              {@const normalStart = ((meta.normalLow - extendedLow) / totalRange) * 100}
              {@const normalWidth = (range / totalRange) * 100}
              {@const markerPos = Math.min(100, Math.max(0, ((signal.current - extendedLow) / totalRange) * 100))}
              <div class="relative h-1.5 rounded-full" style="background: var(--card-border);">
                <!-- Normal range highlight -->
                <div class="absolute h-1.5 rounded-full" style="left: {normalStart}%; width: {normalWidth}%; background: var(--accent); opacity: 0.25;"></div>
                <!-- Current value marker -->
                <div class="absolute w-2.5 h-2.5 rounded-full -top-0.5" style="left: calc({markerPos}% - 5px); background: {inRange ? 'var(--accent)' : '#8b3a1a'};"></div>
              </div>
            {/if}
            <div class="flex justify-between mt-1">
              <span class="text-[8px]" style="color: var(--text-whisper); font-family: var(--font-mono);">{meta.normalLow}</span>
              <span class="text-[8px]" style="color: var(--text-whisper); font-family: var(--font-mono);">normal range</span>
              <span class="text-[8px]" style="color: var(--text-whisper); font-family: var(--font-mono);">{meta.normalHigh}</span>
            </div>
          </div>

          <!-- 7-day context -->
          <div class="flex justify-between mt-3 text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
            <span>7-day avg: {Math.round(signal.average7d)} {signal.unit}</span>
            <span>Δ {signal.current > signal.average7d ? '+' : ''}{Math.round(signal.current - signal.average7d)} {signal.unit}</span>
          </div>

          <!-- Explainer -->
          <p class="text-[10px] mt-3 leading-relaxed" style="color: var(--text-ghost);">{meta.desc}</p>
          <p class="text-[9px] mt-1 leading-relaxed" style="color: var(--text-whisper);">{meta.context}</p>
        </div>
      {/each}
    </div>

  {:else if panelType === 'activity'}
    {#if loadingActivity}
      <div class="flex items-center justify-center py-12">
        <p class="text-sm" style="color: var(--text-ghost); font-family: var(--font-mono);">Loading activity...</p>
      </div>
    {:else if panelData}
      <ActivityDetail activity={panelData} />
    {:else}
      <p class="text-sm" style="color: var(--text-ghost);">Activity not found.</p>
    {/if}

  {:else if panelType === 'stats' && panelData}
    <div class="space-y-6">
      <p class="text-[10px] leading-relaxed" style="color: var(--text-ghost);">
        Summary of your last 7 days of activity from Strava and Whoop.
      </p>

      {#if panelData.weekly}
        <div class="space-y-4">
          {#each [
            { label: 'Activities', value: panelData.weekly.activities, unit: '', desc: 'Total recorded activities from Strava' },
            { label: 'Distance', value: (panelData.weekly.totalDistance / 1000).toFixed(1), unit: 'km', desc: 'Combined distance across all activities' },
            { label: 'Duration', value: Math.round(panelData.weekly.totalDuration / 60), unit: 'min', desc: 'Total moving time' },
            { label: 'Elevation', value: Math.round(panelData.weekly.totalElevation), unit: 'm', desc: 'Total elevation gained' },
            { label: 'Avg Recovery', value: panelData.weekly.avgRecovery, unit: '%', desc: 'Mean Whoop recovery score. Above 67% is green.' },
            { label: 'Avg Sleep', value: panelData.weekly.avgSleep, unit: '%', desc: 'Mean sleep performance. Above 85% means you\'re meeting your sleep need.' },
          ] as stat}
            <div class="py-2" style="border-bottom: 1px solid var(--card-border);">
              <div class="flex justify-between items-center">
                <span class="text-sm" style="color: var(--text-secondary);">{stat.label}</span>
                <span class="text-sm" style="color: var(--text-primary); font-family: var(--font-mono);">{stat.value} {stat.unit}</span>
              </div>
              <p class="text-[9px] mt-0.5" style="color: var(--text-whisper);">{stat.desc}</p>
            </div>
          {/each}
        </div>
      {/if}

      {#if panelData.personalRecords?.length}
        <div class="pt-2">
          <p class="text-[10px] uppercase tracking-[0.2em] mb-4" style="color: var(--text-ghost); font-family: var(--font-mono);">Personal Records</p>
          <p class="text-[10px] mb-3" style="color: var(--text-ghost);">All-time bests from your Strava history.</p>
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
