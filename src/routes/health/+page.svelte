<svelte:head>
  <title>Health — Strange Ramblings</title>
  <meta name="description" content="Live health dashboard — readiness, autonomic balance, training load, sleep, body signals." />
  <meta property="og:title" content="Health — Strange Ramblings" />
  <meta property="og:description" content="Live health dashboard — readiness, autonomic balance, training load, sleep, body signals." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://strangeramblings.com/health" />
</svelte:head>

<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SlidePanel from '$lib/components/SlidePanel.svelte';
  import HealthMasthead from '$lib/components/health/HealthMasthead.svelte';
  import HealthSectionNav from '$lib/components/health/HealthSectionNav.svelte';
  import ReadinessHero from '$lib/components/health/ReadinessHero.svelte';
  import SparklineStrip from '$lib/components/health/SparklineStrip.svelte';
  import WeeklyStats from '$lib/components/health/WeeklyStats.svelte';
  import SleepBreakdown from '$lib/components/health/SleepBreakdown.svelte';
  import BodySignals from '$lib/components/health/BodySignals.svelte';
  import ActivityTimeline from '$lib/components/health/ActivityTimeline.svelte';
  import ActivityDetail from '$lib/components/health/ActivityDetail.svelte';
  import AutonomicBalance from '$lib/components/health/AutonomicBalance.svelte';
  import SleepRegularityIndex from '$lib/components/health/SleepRegularityIndex.svelte';
  import CircadianAlignment from '$lib/components/health/CircadianAlignment.svelte';
  import RecoveryDebt from '$lib/components/health/RecoveryDebt.svelte';
  import ACWRInjuryRisk from '$lib/components/health/ACWRInjuryRisk.svelte';
  import TrainingMonotony from '$lib/components/health/TrainingMonotony.svelte';
  import VO2MaxTrend from '$lib/components/health/VO2MaxTrend.svelte';
  import PolarisedDistribution from '$lib/components/health/PolarisedDistribution.svelte';
  import EvidencePanel from '$lib/components/health/EvidencePanel.svelte';

  let { data } = $props();

  type PanelType =
    | 'sleep' | 'activity' | 'signals' | 'stats' | 'readiness'
    | 'evidence'
    | 'autonomic' | 'sri' | 'circadian' | 'recovery-debt'
    | 'acwr' | 'monotony' | 'vo2max' | 'polarised'
    | null;

  let panelOpen = $state(false);
  let panelType = $state<PanelType>(null);
  let panelTitle = $state('');
  let panelData = $state<any>(null);
  let evidenceFocusId = $state<string | null>(null);
  let loadingActivity = $state(false);

  function openPanel(type: PanelType, title: string, pData?: any) {
    panelType = type;
    panelTitle = title;
    panelData = pData ?? null;
    evidenceFocusId = null;
    panelOpen = true;
  }

  function openEvidence(focusId?: string) {
    panelType = 'evidence';
    panelTitle = 'Evidence & Methodology';
    panelData = null;
    evidenceFocusId = focusId ?? null;
    panelOpen = true;
  }

  async function openActivityDetail(event: any) {
    panelType = 'activity';
    panelTitle = event.title || 'Activity';
    panelData = null;
    panelOpen = true;
    loadingActivity = true;
    try {
      const res = await window.fetch(`/api/health/activity/${event.stravaId}`);
      if (res.ok) panelData = await res.json();
    } finally {
      loadingActivity = false;
    }
  }

  function closePanel() {
    panelOpen = false;
    panelType = null;
    evidenceFocusId = null;
  }
</script>

<PageHeader title="HEALTH" />

<HealthMasthead onopenEvidence={() => openEvidence()} />

<section id="readiness">
  <ReadinessHero readiness={data.readiness} onopenDetail={() => openPanel('readiness', 'Readiness', data.readiness)} />
  <SparklineStrip sparklines={data.sparklines || []} />
</section>

<HealthSectionNav />

<div class="hp-wrap">
  <section id="autonomic" class="hp-group">
    <h2 class="hp-h">Autonomic</h2>
    <AutonomicBalance data={data.autonomic} onopenDetail={() => openPanel('autonomic', 'Autonomic Balance', data.autonomic)} onopenEvidence={openEvidence} />
  </section>

  <section id="sleep" class="hp-group">
    <h2 class="hp-h">Sleep</h2>
    <button class="hp-card-btn" onclick={() => openPanel('sleep', 'Sleep Analysis', data.sleepAnalysis)}>
      <SleepBreakdown sleepAnalysis={data.sleepAnalysis} />
    </button>
    <SleepRegularityIndex data={data.sleepRegularity} onopenDetail={() => openPanel('sri', 'Sleep Regularity Index', data.sleepRegularity)} onopenEvidence={openEvidence} />
    <CircadianAlignment data={data.circadian} onopenDetail={() => openPanel('circadian', 'Circadian Alignment', data.circadian)} onopenEvidence={openEvidence} />
    <RecoveryDebt data={data.recoveryDebt} onopenDetail={() => openPanel('recovery-debt', 'Recovery Debt', data.recoveryDebt)} onopenEvidence={openEvidence} />
  </section>

  <section id="training" class="hp-group">
    <h2 class="hp-h">Training</h2>
    <button class="hp-card-btn" onclick={() => openPanel('stats', 'This Week', data.stats)}>
      <WeeklyStats stats={data.stats} />
    </button>
    <ACWRInjuryRisk data={data.acwr} onopenDetail={() => openPanel('acwr', 'ACWR — Injury Risk', data.acwr)} onopenEvidence={openEvidence} />
    <TrainingMonotony data={data.monotony} onopenDetail={() => openPanel('monotony', 'Training Monotony', data.monotony)} onopenEvidence={openEvidence} />
    <VO2MaxTrend data={data.vo2max} onopenDetail={() => openPanel('vo2max', 'VO₂max Trend', data.vo2max)} onopenEvidence={openEvidence} />
    <PolarisedDistribution data={data.polarised} onopenDetail={() => openPanel('polarised', 'Polarised Distribution', data.polarised)} onopenEvidence={openEvidence} />
  </section>

  <section id="body" class="hp-group">
    <h2 class="hp-h">Body</h2>
    <button class="hp-card-btn" onclick={() => openPanel('signals', 'Body Signals', data.bodySignals)}>
      <BodySignals signals={data.bodySignals} />
    </button>
  </section>

  <section id="activities" class="hp-group">
    <h2 class="hp-h">Activities</h2>
    <ActivityTimeline timeline={data.timeline} onselect={openActivityDetail} />
  </section>
</div>

<footer class="hp-footer">
  <div class="hp-sync">
    {#if data.syncState?.length}
      {#each data.syncState as sync}
        {@const lastSync = sync.lastSyncAt || sync.last_sync_at}
        {@const ago = lastSync ? Math.round((Date.now() / 1000 - lastSync) / 60) : null}
        {@const isStale = ago !== null && ago > 120}
        <span class="hp-sync-row" class:stale={isStale}>
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
  <div class="hp-links">
    <a href="/" class="hp-link">Home</a>
    <a href="/admin" class="hp-link">Admin</a>
  </div>
</footer>

<SlidePanel open={panelOpen} onclose={closePanel} title={panelTitle}>
  {#if panelType === 'evidence'}
    <EvidencePanel focusId={evidenceFocusId} />
  {:else if panelType === 'activity'}
    {#if loadingActivity}
      <p class="hp-loading">Loading activity…</p>
    {:else if panelData}
      <ActivityDetail activity={panelData} />
    {:else}
      <p class="hp-loading">Activity not found.</p>
    {/if}
  {:else if panelType === 'readiness' && panelData}
    {@const factorMeta = {
      recovery: { desc: 'Whoop recovery score. Measures how prepared your body is for strain based on HRV, resting heart rate, and sleep.', goodMin: 67, unit: '' },
      hrvTrend: { desc: 'Heart rate variability trend over 7 days. Higher HRV generally indicates better cardiovascular fitness and recovery.', goodMin: 60, unit: '' },
      sleepQuality: { desc: 'Sleep performance percentage from Whoop.', goodMin: 70, unit: '%' },
      loadBalance: { desc: 'Acute-to-chronic workload ratio. Optimal range is 0.8–1.3.', goodMin: 80, unit: '' },
    } as Record<string, any>}
    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">Readiness · {Math.round(panelData.score)}</span></div>
      <p class="hp-detail-recom">{panelData.recommendation}</p>
    </section>
    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">Composite factors</span></div>
      {#each Object.entries(panelData.factors) as [key, factor]}
        {@const meta = factorMeta[key] || { desc: '', goodMin: 50, unit: '' }}
        {@const val = Math.round((factor as any).value)}
        <div class="hp-factor">
          <div class="hp-factor-row">
            <span class="sr-label-tight">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
            <span class="hp-factor-val" class:good={val >= meta.goodMin}>
              {#if key === 'hrvTrend' && (factor as any).raw != null}
                {Math.round((factor as any).raw)} ms
              {:else}
                {val}{meta.unit}
              {/if}
            </span>
          </div>
          <div class="hp-bar"><div class="hp-bar-fill" class:good={val >= meta.goodMin} style="width:{Math.min(100, val)}%;"></div></div>
          <p class="hp-factor-desc">{meta.desc}</p>
        </div>
      {/each}
    </section>

  {:else if panelType === 'sleep' && panelData}
    {#if panelData.latest}
      {@const hrs = panelData.latest.totalDuration / 3600000}
      <section class="nm-sec">
        <div class="nm-sec-hd"><span class="sr-label-tight">Last night</span></div>
        <div class="hp-factor-row" style="margin-bottom: 4px;">
          <span style="font-size: 22px; font-weight: 300; color: var(--text-primary); font-family: var(--font-display);">{hrs.toFixed(1)}</span>
          <span class="hp-signal-unit">hours</span>
        </div>
        <p class="hp-detail-recom">
          {hrs >= 7.5 ? 'Within the recommended 7–9 hour range.' : hrs >= 6 ? 'Below the recommended 7–9 hours. Aim for more.' : 'Significantly below recommended sleep. Recovery will be impacted.'}
        </p>
      </section>

      <section class="nm-sec">
        <div class="nm-sec-hd"><span class="sr-label-tight">Sleep stages</span></div>
        {#each [
          { label: 'Light Sleep', pct: panelData.latest.lightPercent, color: '#b8a88c', desc: 'Body temperature drops, muscles relax. Important for memory consolidation and motor learning.', ideal: '40–60%' },
          { label: 'Deep Sleep', pct: panelData.latest.deepPercent, color: '#8b6914', desc: 'Growth hormone release, tissue repair, immune function. The most physically restorative stage.', ideal: '15–25%' },
          { label: 'REM Sleep', pct: panelData.latest.remPercent, color: 'var(--accent)', desc: 'Brain processes emotions and consolidates memories. Increases in later sleep cycles — cutting sleep short reduces REM.', ideal: '20–25%' },
          { label: 'Awake', pct: panelData.latest.awakePercent, color: 'var(--text-whisper)', desc: 'Brief awakenings are normal. Excessive wake time reduces sleep efficiency.', ideal: '<10%' },
        ] as stage}
          <div class="hp-factor">
            <div class="hp-factor-row">
              <span class="sr-label-tight">{stage.label}</span>
              <span class="hp-factor-val" style="color: {stage.color};">{stage.pct}%</span>
            </div>
            <div class="hp-stage-bar"><div class="hp-stage-bar-fill" style="width:{stage.pct}%; background:{stage.color};"></div></div>
            <p class="hp-factor-desc">{stage.desc} <span style="color: var(--text-whisper);">Ideal: {stage.ideal}</span></p>
          </div>
        {/each}
      </section>

      <section class="nm-sec">
        <div class="nm-sec-hd"><span class="sr-label-tight">Metrics</span></div>
        {#each [
          { label: 'Performance', value: panelData.latest.performance, desc: 'How much sleep you got relative to what your body needed. Accounts for sleep debt, recent strain, and baseline need.', good: 85 },
          { label: 'Consistency', value: panelData.latest.consistency, desc: 'How regular your sleep schedule is. Consistent bed and wake times improve circadian rhythm and sleep quality.', good: 75 },
          { label: 'Efficiency', value: panelData.latest.efficiency, desc: 'Percentage of time in bed actually spent asleep. Higher efficiency means less time lying awake.', good: 85 },
        ] as metric}
          <div class="hp-factor">
            <div class="hp-factor-row">
              <span class="sr-label-tight">{metric.label}</span>
              <span class="hp-factor-val" class:good={metric.value >= metric.good}>{Math.round(metric.value)}%</span>
            </div>
            <div class="hp-bar"><div class="hp-bar-fill" class:good={metric.value >= metric.good} style="width:{metric.value}%;"></div></div>
            <p class="hp-factor-desc">{metric.desc}</p>
          </div>
        {/each}
      </section>
    {/if}

    {#if panelData.trend?.length}
      <section class="nm-sec">
        <div class="nm-sec-hd"><span class="sr-label-tight">Recent nights</span></div>
        {#each panelData.trend as night}
          {@const nightHrs = night.duration / 3600000}
          <div class="hp-trend-row">
            <span>{night.date}</span>
            <span style="color: {nightHrs >= 7 ? 'var(--text-secondary)' : 'var(--text-ghost)'};">{nightHrs.toFixed(1)}h · {Math.round(night.performance)}%</span>
          </div>
        {/each}
      </section>
    {/if}

  {:else if panelType === 'signals' && panelData}
    {@const signalMeta = {
      heart_rate: { label: 'Heart Rate', desc: 'Average heart rate from Apple Health. Resting rate is measured separately — this includes active periods.', normalLow: 60, normalHigh: 100, context: 'A normal resting heart rate for adults is 60–100 bpm. Athletes often have lower resting rates (40–60 bpm).' },
      heart_rate_variability: { label: 'HRV', desc: 'Heart rate variability — the variation in time between heartbeats. Higher is generally better, indicating your nervous system is adaptable.', normalLow: 20, normalHigh: 80, context: 'HRV varies hugely by age and fitness. Your personal baseline matters more than population norms. Track your own trend.' },
      resting_heart_rate: { label: 'Resting HR', desc: 'Heart rate at rest, typically measured during sleep. A key indicator of cardiovascular fitness and recovery.', normalLow: 40, normalHigh: 70, context: 'Lower resting HR generally indicates better fitness. A sudden increase may signal illness, stress, or poor recovery.' },
      oxygen_saturation: { label: 'SpO₂', desc: 'Blood oxygen saturation. The percentage of haemoglobin carrying oxygen. Measured via pulse oximetry.', normalLow: 95, normalHigh: 100, context: 'Normal is 95–100%. Below 95% may indicate respiratory issues. Altitude also affects readings.' },
      respiratory_rate: { label: 'Respiratory Rate', desc: 'Breaths per minute, typically measured during sleep. Reflects respiratory and cardiovascular health.', normalLow: 12, normalHigh: 20, context: 'Normal adult range is 12–20 breaths/min at rest. Elevated rates can indicate stress, illness, or poor fitness.' },
    } as Record<string, any>}
    {#each panelData as signal}
      {@const meta = signalMeta[signal.metric] || { label: signal.metric, desc: '', normalLow: 0, normalHigh: 100, context: '' }}
      {@const inRange = signal.current >= meta.normalLow && signal.current <= meta.normalHigh}
      {@const range = meta.normalHigh - meta.normalLow}
      {@const extendedLow = meta.normalLow - range * 0.3}
      {@const extendedHigh = meta.normalHigh + range * 0.3}
      {@const totalRange = extendedHigh - extendedLow}
      {@const normalStart = ((meta.normalLow - extendedLow) / totalRange) * 100}
      {@const normalWidth = (range / totalRange) * 100}
      {@const markerPos = Math.min(100, Math.max(0, ((signal.current - extendedLow) / totalRange) * 100))}
      <section class="nm-sec">
        <div class="nm-sec-hd" style="display: flex; justify-content: space-between; align-items: baseline;">
          <span class="sr-label-tight">{meta.label}</span>
          <span style="font-size: 10px; color: var(--text-ghost);">{signal.trend === 'up' ? '↑' : signal.trend === 'down' ? '↓' : '→'}</span>
        </div>
        <div style="margin-bottom: 6px;">
          <span class="hp-signal-val">{Math.round(signal.current)}</span>
          <span class="hp-signal-unit"> {signal.unit}</span>
        </div>
        <div class="hp-range-bar">
          <div class="hp-range-band" style="left:{normalStart}%; width:{normalWidth}%;"></div>
          <div class="hp-range-marker" class:bad={!inRange} style="left:{markerPos}%;"></div>
        </div>
        <div class="hp-range-axis">
          <span>{meta.normalLow}</span>
          <span>normal range</span>
          <span>{meta.normalHigh}</span>
        </div>
        <div class="hp-trend-row" style="margin-top: 6px;">
          <span>7-day avg: {Math.round(signal.average7d)} {signal.unit}</span>
          <span>Δ {signal.current > signal.average7d ? '+' : ''}{Math.round(signal.current - signal.average7d)} {signal.unit}</span>
        </div>
        <p class="hp-factor-desc" style="margin-top: 8px;">{meta.desc}</p>
        <p class="hp-factor-desc" style="color: var(--text-whisper);">{meta.context}</p>
      </section>
    {/each}

  {:else if panelType === 'stats' && panelData}
    <section class="nm-sec">
      <p class="hp-detail-recom">Summary of your last 7 days of activity from Strava and Whoop.</p>
    </section>

    {#if panelData.weekly}
      <section class="nm-sec">
        <div class="nm-sec-hd"><span class="sr-label-tight">Weekly overview</span></div>
        {#each [
          { label: 'Activities', value: panelData.weekly.activities, unit: '', desc: 'Total recorded activities from Strava' },
          { label: 'Distance', value: (panelData.weekly.totalDistance / 1000).toFixed(1), unit: 'km', desc: 'Combined distance across all activities' },
          { label: 'Duration', value: Math.round(panelData.weekly.totalDuration / 60), unit: 'min', desc: 'Total moving time' },
          { label: 'Elevation', value: Math.round(panelData.weekly.totalElevation), unit: 'm', desc: 'Total elevation gained' },
          { label: 'Avg Recovery', value: panelData.weekly.avgRecovery, unit: '%', desc: 'Mean Whoop recovery score. Above 67% is green.' },
          { label: 'Avg Sleep', value: panelData.weekly.avgSleep, unit: '%', desc: "Mean sleep performance. Above 85% means you're meeting your sleep need." },
        ] as stat}
          <div class="hp-factor">
            <div class="hp-factor-row">
              <span class="sr-label-tight">{stat.label}</span>
              <span class="hp-factor-val">{stat.value} {stat.unit}</span>
            </div>
            <p class="hp-factor-desc">{stat.desc}</p>
          </div>
        {/each}
      </section>
    {/if}

    {#if panelData.personalRecords?.length}
      <section class="nm-sec">
        <div class="nm-sec-hd"><span class="sr-label-tight">Personal records</span></div>
        <p class="hp-detail-recom" style="margin-bottom: 6px;">All-time bests from your Strava history.</p>
        {#each panelData.personalRecords as pr}
          <div class="hp-factor">
            <div class="hp-factor-row">
              <span class="sr-label-tight">{pr.label}</span>
              <span class="hp-factor-val" style="color: var(--accent);">{pr.value} {pr.unit}</span>
            </div>
            <p class="hp-factor-desc">{pr.date}</p>
          </div>
        {/each}
      </section>
    {/if}
  {/if}
</SlidePanel>

<style>
  .hp-wrap { max-width: 1200px; margin: 0 auto; padding: 1rem 1.5rem 2rem; display: flex; flex-direction: column; gap: 2rem; }
  .hp-group { display: flex; flex-direction: column; gap: 0.75rem; scroll-margin-top: 60px; }
  .hp-h {
    font-family: var(--font-mono); font-size: 11px; text-transform: uppercase;
    letter-spacing: 0.18em; color: var(--accent); margin: 0 0 0.25rem;
    padding-bottom: 0.5rem; border-bottom: 2px solid var(--text-primary);
  }
  .hp-card-btn { background: none; border: 0; padding: 0; text-align: left; cursor: pointer; color: inherit; }
  .hp-footer {
    max-width: 1200px; margin: 0 auto; padding: 1.5rem;
    display: flex; flex-wrap: wrap; gap: 1rem; justify-content: space-between;
    border-top: 2px solid var(--text-primary);
  }
  .hp-sync { display: flex; flex-wrap: wrap; gap: 0.75rem; font-family: var(--font-mono); font-size: 9px; color: var(--text-ghost); }
  .hp-sync-row.stale { color: #c4570a; }
  .hp-links { display: flex; gap: 1rem; }
  .hp-link {
    font-family: var(--font-mono); font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.12em; color: var(--accent); text-decoration: none;
  }
  .hp-link:hover { text-decoration: underline; }
  .hp-loading { font-family: var(--font-mono); font-size: 12px; color: var(--text-ghost); padding: 2rem 0; text-align: center; }
  .hp-detail-recom { font-size: 13px; line-height: 1.5; color: var(--text-secondary); margin: 0; }
  .hp-factor { display: flex; flex-direction: column; gap: 4px; padding: 0.5rem 0; border-bottom: 1px dotted var(--card-border); }
  .hp-factor:last-child { border-bottom: 0; }
  .hp-factor-row { display: flex; justify-content: space-between; align-items: center; }
  .hp-factor-val { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); }
  .hp-factor-val.good { color: var(--accent); }
  .hp-factor-desc { margin: 4px 0 0; font-size: 11px; line-height: 1.45; color: var(--text-ghost); }
  .hp-bar { height: 2px; background: var(--card-border); }
  .hp-bar-fill { height: 2px; background: var(--text-ghost); }
  .hp-bar-fill.good { background: var(--accent); }
  .hp-stage-bar { height: 2px; background: var(--card-border); margin-top: 4px; }
  .hp-stage-bar-fill { height: 2px; }
  .hp-signal-val { font-size: 22px; font-weight: 300; color: var(--text-primary); font-family: var(--font-display); }
  .hp-signal-unit { font-size: 11px; color: var(--text-ghost); }
  .hp-range-bar { position: relative; height: 2px; background: var(--card-border); }
  .hp-range-band { position: absolute; height: 2px; background: var(--accent); opacity: 0.25; }
  .hp-range-marker { position: absolute; width: 8px; height: 8px; top: -3px; transform: translateX(-50%); background: var(--accent); }
  .hp-range-marker.bad { background: #c44; }
  .hp-range-axis { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 9px; color: var(--text-ghost); margin-top: 4px; }
  .hp-trend-row { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); padding: 2px 0; }
</style>
