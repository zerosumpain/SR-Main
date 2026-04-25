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
    panelTitle = 'Evidence & methodology';
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

  // Stats helpers for inline display
  function fmtKm(m?: number): string { return m ? (m / 1000).toFixed(1) : '0'; }
  function fmtDur(s?: number): string {
    if (!s) return '0m';
    const h = Math.floor(s / 3600); const m = Math.round((s % 3600) / 60);
    return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
  }
</script>

<PageHeader title="HEALTH" />

<div class="hp">
  <HealthMasthead onopenEvidence={() => openEvidence()} />

  <div class="hp-wrap">

    <ReadinessHero
      readiness={data.readiness}
      onopenDetail={() => openPanel('readiness', 'Readiness', data.readiness)}
    />

    <SparklineStrip sparklines={data.sparklines || []} />

    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Autonomic</span>
        <span class="nm-sec-meta">HRV / RHR vs personal baseline</span>
      </div>
      <div class="rows">
        <AutonomicBalance
          data={data.autonomic}
          onopenDetail={() => openPanel('autonomic', 'Autonomic Balance', data.autonomic)}
          onopenEvidence={openEvidence}
        />
      </div>
    </section>

    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Sleep</span>
        <span class="nm-sec-meta">last night · 14d trend</span>
      </div>
      <div class="rows">
        <SleepBreakdown
          sleepAnalysis={data.sleepAnalysis}
          onopenDetail={() => openPanel('sleep', 'Sleep analysis', data.sleepAnalysis)}
          onopenEvidence={openEvidence}
        />
        <SleepRegularityIndex
          data={data.sleepRegularity}
          onopenDetail={() => openPanel('sri', 'Sleep Regularity Index', data.sleepRegularity)}
          onopenEvidence={openEvidence}
        />
        <CircadianAlignment
          data={data.circadian}
          onopenDetail={() => openPanel('circadian', 'Circadian Alignment', data.circadian)}
          onopenEvidence={openEvidence}
        />
        <RecoveryDebt
          data={data.recoveryDebt}
          onopenDetail={() => openPanel('recovery-debt', 'Recovery Debt', data.recoveryDebt)}
          onopenEvidence={openEvidence}
        />
      </div>
    </section>

    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Training</span>
        {#if data.stats?.weekly}
          <span class="nm-sec-meta">
            {data.stats.weekly.activities} activities ·
            {fmtKm(data.stats.weekly.totalDistance)}km ·
            {fmtDur(data.stats.weekly.totalDuration)}
          </span>
        {/if}
      </div>
      <WeeklyStats
        stats={data.stats}
        onopenDetail={() => openPanel('stats', 'This week', data.stats)}
      />
      <div class="rows">
        <ACWRInjuryRisk
          data={data.acwr}
          onopenDetail={() => openPanel('acwr', 'ACWR — Injury Risk', data.acwr)}
          onopenEvidence={openEvidence}
        />
        <TrainingMonotony
          data={data.monotony}
          onopenDetail={() => openPanel('monotony', 'Training Monotony', data.monotony)}
          onopenEvidence={openEvidence}
        />
        <VO2MaxTrend
          data={data.vo2max}
          onopenDetail={() => openPanel('vo2max', 'VO₂max trend', data.vo2max)}
          onopenEvidence={openEvidence}
        />
        <PolarisedDistribution
          data={data.polarised}
          onopenDetail={() => openPanel('polarised', 'Intensity distribution', data.polarised)}
          onopenEvidence={openEvidence}
        />
      </div>
    </section>

    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Body signals</span>
        <span class="nm-sec-meta">7d averages · normal-range bars</span>
      </div>
      <div class="rows">
        <BodySignals
          signals={data.bodySignals}
          onopenDetail={() => openPanel('signals', 'Body signals', data.bodySignals)}
        />
      </div>
    </section>

    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Recent activity</span>
        <span class="nm-sec-meta">{data.timeline?.events?.length ?? 0} events</span>
      </div>
      <div class="rows">
        <ActivityTimeline timeline={data.timeline} onselect={openActivityDetail} />
      </div>
    </section>

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
  </div>
</div>

<SlidePanel open={panelOpen} onclose={closePanel} title={panelTitle}>
  <div class="hp-panel">
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
        hrvTrend: { desc: 'Heart rate variability trend over 7 days. Higher HRV generally indicates better recovery.', goodMin: 60, unit: '' },
        sleepQuality: { desc: 'Sleep performance percentage from Whoop.', goodMin: 70, unit: '%' },
        loadBalance: { desc: 'Acute-to-chronic workload ratio. Optimal range is 0.8–1.3.', goodMin: 80, unit: '' },
      } as Record<string, any>}

      <div class="p-hero">
        <span class="p-num">{Math.round(panelData.score)}</span>
        <span class="p-num-lbl">{panelData.label?.toLowerCase?.() ?? ''}</span>
      </div>
      <p class="p-recom">{panelData.recommendation}</p>

      <div class="p-rule">Composite factors</div>
      {#each Object.entries(panelData.factors) as [key, factor]}
        {@const meta = factorMeta[key] || { desc: '', goodMin: 50, unit: '' }}
        {@const val = Math.round((factor as any).value)}
        {@const isHrv = key === 'hrvTrend' && (factor as any).raw != null}
        {@const good = val >= meta.goodMin}
        <div class="p-row">
          <div class="p-row-line">
            <span class="p-row-key">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
            <span class="p-row-val" class:good>
              {#if isHrv}{Math.round((factor as any).raw)} ms{:else}{val}{meta.unit}{/if}
            </span>
          </div>
          <span class="p-bar"><span class="p-bar-fill" class:good style="width:{Math.min(100, val)}%;"></span></span>
          <p class="p-desc">{meta.desc}</p>
        </div>
      {/each}

    {:else if panelType === 'sleep' && panelData}
      {#if panelData.latest}
        {@const hrs = panelData.latest.totalDuration / 3600000}
        <div class="p-hero">
          <span class="p-num">{hrs.toFixed(1)}</span>
          <span class="p-num-lbl">hours · {Math.round(panelData.latest.performance)}% perf</span>
        </div>
        <p class="p-recom">
          {hrs >= 7.5 ? 'Within the recommended 7–9 hour range.'
            : hrs >= 6 ? 'Below the recommended 7–9 hours. Aim for more.'
            : 'Significantly below recommended sleep. Recovery will be impacted.'}
        </p>

        <div class="p-rule">Sleep stages</div>
        {#each [
          { label: 'Light',  pct: panelData.latest.lightPercent, color: 'var(--accent-tint-35)', desc: 'Body temperature drops, muscles relax. Memory consolidation, motor learning.', ideal: '40–60%' },
          { label: 'Deep',   pct: panelData.latest.deepPercent,  color: 'var(--accent)',          desc: 'Growth hormone release, tissue repair, immune function. Most physically restorative.', ideal: '15–25%' },
          { label: 'REM',    pct: panelData.latest.remPercent,   color: 'var(--text-secondary)',  desc: 'Brain processes emotions and consolidates memories. Increases in later cycles.', ideal: '20–25%' },
          { label: 'Awake',  pct: panelData.latest.awakePercent, color: 'var(--text-ghost)',      desc: 'Brief awakenings are normal. Excessive wake time reduces sleep efficiency.', ideal: '<10%' },
        ] as stage}
          <div class="p-row">
            <div class="p-row-line">
              <span class="p-row-key">{stage.label}</span>
              <span class="p-row-val" style="color:{stage.color};">{stage.pct}%</span>
            </div>
            <span class="p-bar"><span class="p-bar-fill" style="width:{stage.pct}%; background:{stage.color};"></span></span>
            <p class="p-desc">{stage.desc} <span class="p-desc-meta">Ideal {stage.ideal}.</span></p>
          </div>
        {/each}

        <div class="p-rule">Last-night metrics</div>
        {#each [
          { label: 'Performance', value: panelData.latest.performance, desc: 'How much sleep you got vs your need. Accounts for debt, recent strain, baseline.', good: 85 },
          { label: 'Consistency', value: panelData.latest.consistency, desc: 'How regular your bed/wake times are. Drives circadian alignment.', good: 75 },
          { label: 'Efficiency',  value: panelData.latest.efficiency,  desc: 'Time in bed actually asleep. Higher = less time lying awake.', good: 85 },
        ] as m}
          {@const good = m.value >= m.good}
          <div class="p-row">
            <div class="p-row-line">
              <span class="p-row-key">{m.label}</span>
              <span class="p-row-val" class:good>{Math.round(m.value)}%</span>
            </div>
            <span class="p-bar"><span class="p-bar-fill" class:good style="width:{m.value}%;"></span></span>
            <p class="p-desc">{m.desc}</p>
          </div>
        {/each}
      {/if}

      {#if panelData.trend?.length}
        <div class="p-rule">Recent nights</div>
        {#each panelData.trend as night}
          {@const nightHrs = night.duration / 3600000}
          <div class="p-line">
            <span class="p-line-k">{night.date}</span>
            <span class="p-line-v">{nightHrs.toFixed(1)}h · {Math.round(night.performance)}%</span>
          </div>
        {/each}
      {/if}

    {:else if panelType === 'signals' && panelData}
      {@const signalMeta = {
        heart_rate: { label: 'Heart rate', desc: 'Average heart rate from Apple Health. Includes active periods.', normalLow: 60, normalHigh: 100, context: 'Normal resting HR for adults: 60–100 bpm. Athletes often 40–60.' },
        heart_rate_variability: { label: 'HRV', desc: 'Variation in time between heartbeats. Higher = more adaptable nervous system.', normalLow: 20, normalHigh: 80, context: 'HRV varies by age and fitness. Personal baseline matters more than population norms.' },
        resting_heart_rate: { label: 'Resting HR', desc: 'Heart rate at rest, typically measured during sleep.', normalLow: 40, normalHigh: 70, context: 'Lower = better fitness. Sudden increase may signal illness, stress, poor recovery.' },
        oxygen_saturation: { label: 'SpO₂', desc: 'Blood oxygen saturation. Pulse-oximetry-derived.', normalLow: 95, normalHigh: 100, context: 'Normal 95–100%. Below 95% may indicate respiratory issues. Altitude affects readings.' },
        respiratory_rate: { label: 'Respiratory rate', desc: 'Breaths per minute, typically measured during sleep.', normalLow: 12, normalHigh: 20, context: 'Normal 12–20/min at rest. Elevated rates can indicate stress, illness, or poor fitness.' },
      } as Record<string, any>}
      {#each panelData as signal}
        {@const meta = signalMeta[signal.metric] || { label: signal.metric, desc: '', normalLow: 0, normalHigh: 100, context: '' }}
        {@const inRange = signal.current >= meta.normalLow && signal.current <= meta.normalHigh}
        {@const range = meta.normalHigh - meta.normalLow}
        {@const ext = range * 0.2}
        {@const total = range + ext * 2}
        {@const bandStart = (ext / total) * 100}
        {@const bandWidth = (range / total) * 100}
        {@const markerPos = Math.min(100, Math.max(0, ((signal.current - (meta.normalLow - ext)) / total) * 100))}
        <div class="p-rule">{meta.label}</div>
        <div class="p-row">
          <div class="p-hero p-hero-inline">
            <span class="p-num">{Math.round(signal.current)}</span>
            <span class="p-num-lbl">{signal.unit}</span>
            <span class="p-trend">{signal.trend === 'up' ? '↑' : signal.trend === 'down' ? '↓' : '→'} 7d avg {Math.round(signal.average7d)}</span>
          </div>
          <span class="p-rangebar">
            <span class="p-rangeband" style="left:{bandStart}%; width:{bandWidth}%;"></span>
            <span class="p-rangemarker" class:bad={!inRange} style="left:{markerPos}%;"></span>
          </span>
          <div class="p-rangeaxis">
            <span>{meta.normalLow}</span>
            <span>normal range</span>
            <span>{meta.normalHigh}</span>
          </div>
          <p class="p-desc">{meta.desc}</p>
          <p class="p-desc p-desc-meta">{meta.context}</p>
        </div>
      {/each}

    {:else if panelType === 'stats' && panelData}
      <p class="p-recom">Summary of your last 7 days from Strava and Whoop.</p>

      {#if panelData.weekly}
        <div class="p-rule">Weekly</div>
        {#each [
          { label: 'Activities',  value: panelData.weekly.activities, unit: '' },
          { label: 'Distance',    value: (panelData.weekly.totalDistance / 1000).toFixed(1), unit: 'km' },
          { label: 'Duration',    value: Math.round(panelData.weekly.totalDuration / 60), unit: 'min' },
          { label: 'Elevation',   value: Math.round(panelData.weekly.totalElevation), unit: 'm' },
          { label: 'Avg recovery', value: panelData.weekly.avgRecovery, unit: '%' },
          { label: 'Avg sleep',    value: panelData.weekly.avgSleep, unit: '%' },
        ] as stat}
          <div class="p-line">
            <span class="p-line-k">{stat.label}</span>
            <span class="p-line-v">{stat.value} {stat.unit}</span>
          </div>
        {/each}
      {/if}

      {#if panelData.personalRecords?.length}
        <div class="p-rule">Personal records</div>
        {#each panelData.personalRecords as pr}
          <div class="p-line">
            <span class="p-line-k">{pr.label} <span class="p-line-meta">· {pr.date}</span></span>
            <span class="p-line-v" style="color: var(--accent);">{pr.value} {pr.unit}</span>
          </div>
        {/each}
      {/if}
    {/if}
  </div>
</SlidePanel>

<style>
  .hp { background: var(--bg); }
  .hp-wrap {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 1.5rem 2rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .rows { display: flex; flex-direction: column; }

  .hp-footer {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    justify-content: space-between;
    align-items: center;
    padding: 1.25rem 0 0.5rem;
    margin-top: 0.5rem;
    border-top: 1px solid var(--card-border);
  }
  .hp-sync { display: flex; flex-wrap: wrap; gap: 0.75rem; font-family: var(--font-mono); font-size: 9px; color: var(--text-ghost); }
  .hp-sync-row.stale { color: var(--accent); }
  .hp-links { display: flex; gap: 1rem; }
  .hp-link {
    font-family: var(--font-mono); font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.12em; color: var(--accent); text-decoration: none;
  }
  .hp-link:hover { color: var(--accent-hover); text-decoration: underline; }

  /* ========================================================
     Slide-over panel content — flush, definition-list style.
     SlidePanel provides 20px padding around .hp-panel.
  ======================================================== */
  .hp-panel { display: flex; flex-direction: column; gap: 0; }

  .hp-loading {
    font-family: var(--font-mono); font-size: 11px;
    color: var(--text-ghost); padding: 2rem 0; text-align: center;
  }

  .p-hero {
    display: flex; align-items: baseline; gap: 0.6rem;
    padding: 0.4rem 0 0.6rem;
  }
  .p-hero-inline { padding: 0.2rem 0; flex-wrap: wrap; }
  .p-num {
    font-family: var(--font-display); font-size: 40px; font-weight: 200;
    line-height: 1; color: var(--text-primary); letter-spacing: -0.02em;
  }
  .p-num-lbl {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted);
  }
  .p-trend {
    margin-left: auto;
    font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost);
  }

  .p-recom {
    margin: 0 0 0.75rem;
    font-size: 12px; line-height: 1.55; color: var(--text-secondary);
  }

  .p-rule {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--accent);
    padding: 0.6rem 0 0.4rem;
    margin-top: 0.5rem;
    border-top: 1px solid var(--card-border);
  }
  .p-rule:first-child { border-top: 0; margin-top: 0; padding-top: 0; }

  .p-row {
    display: flex; flex-direction: column; gap: 4px;
    padding: 0.45rem 0;
    border-bottom: 1px dotted var(--card-border);
  }
  .p-row:last-child { border-bottom: 0; }
  .p-row-line {
    display: flex; justify-content: space-between; align-items: baseline;
    gap: 0.5rem;
  }
  .p-row-key {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: capitalize; letter-spacing: 0.05em;
    color: var(--text-muted);
  }
  .p-row-val {
    font-family: var(--font-mono); font-size: 12px;
    color: var(--text-secondary);
  }
  .p-row-val.good { color: var(--accent); }
  .p-bar { display: block; height: 2px; background: var(--card-border); }
  .p-bar-fill { display: block; height: 2px; background: var(--text-ghost); }
  .p-bar-fill.good { background: var(--accent); }
  .p-desc {
    margin: 4px 0 0;
    font-size: 11px; line-height: 1.5; color: var(--text-ghost);
  }
  .p-desc-meta { color: var(--text-whisper); }

  .p-rangebar {
    display: block; position: relative;
    height: 2px; background: var(--card-border);
    margin-top: 4px;
  }
  .p-rangeband {
    position: absolute; top: 0; height: 2px;
    background: var(--accent); opacity: 0.3;
  }
  .p-rangemarker {
    position: absolute; top: -2px;
    width: 1px; height: 6px;
    background: var(--text-primary);
    transform: translateX(-0.5px);
  }
  .p-rangemarker.bad { background: var(--status-error); }
  .p-rangeaxis {
    display: flex; justify-content: space-between;
    margin-top: 4px;
    font-family: var(--font-mono); font-size: 9px; color: var(--text-ghost);
  }

  .p-line {
    display: flex; justify-content: space-between; align-items: baseline;
    gap: 0.5rem;
    padding: 0.35rem 0;
    border-bottom: 1px dotted var(--card-border);
    font-family: var(--font-mono);
  }
  .p-line:last-child { border-bottom: 0; }
  .p-line-k { font-size: 11px; color: var(--text-muted); }
  .p-line-v { font-size: 12px; color: var(--text-primary); }
  .p-line-meta { color: var(--text-ghost); font-size: 10px; }

  @media (max-width: 640px) {
    .hp-wrap { padding: 0 1rem 2rem; gap: 1rem; }
    .p-num { font-size: 32px; }
  }
</style>
