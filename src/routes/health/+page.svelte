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
  {:else if panelData}
    <pre class="hp-json">{JSON.stringify(panelData, null, 2)}</pre>
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
  .hp-json { white-space: pre-wrap; font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); }
</style>
