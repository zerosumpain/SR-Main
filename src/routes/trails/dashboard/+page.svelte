<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import DateLineChart from '$lib/components/trails/DateLineChart.svelte';
  import Bars, { type Bar } from '$lib/components/trails/Bars.svelte';
  import ZoneBar from '$lib/components/trails/ZoneBar.svelte';
  import EvidenceChip from '$lib/components/health/EvidenceChip.svelte';
  import MethodologyDrawer from '$lib/components/health/v2/MethodologyDrawer.svelte';
  import { zoneEdges } from '$lib/health/analytics/hr-zones';
  import { formatDuration, formatDistance, activityLabel, isPaceSport } from '$lib/trails/format';

  let { data } = $props();

  const d = $derived(data.dashboard);

  // --- Methodology drawer -------------------------------------------------
  let drawerOpen = $state(false);
  let drawerFocus = $state<string | null>(null);
  function openEvidence(id: string) {
    drawerFocus = id;
    drawerOpen = true;
  }

  // --- Signal tiles -------------------------------------------------------
  type Tone = 'good' | 'warn' | 'bad' | 'neutral';
  interface Tile {
    label: string;
    value: string;
    unit: string;
    sub: string;
    tone: Tone;
    evidence: string;
  }

  function delta(latest: number | null, baseline: number | null, downIsGood: boolean) {
    if (latest == null || baseline == null) return null;
    const diff = Math.round((latest - baseline) * 10) / 10;
    const good = downIsGood ? diff <= 0 : diff >= 0;
    return { diff, good };
  }

  const tiles = $derived.by((): Tile[] => {
    if (!d) return [];
    const out: Tile[] = [];

    const vo2 = d.vo2.result;
    if (vo2 && vo2.sufficiency !== 'insufficient') {
      const s = vo2.value.trendSlopePerMonth;
      out.push({
        label: 'VO₂max',
        value: vo2.value.current.toFixed(1),
        unit: 'ml/kg/min',
        sub: `${vo2.value.band.toUpperCase()} · P${Math.round(vo2.value.percentile)} · ${s >= 0 ? '+' : ''}${s.toFixed(2)}/mo`,
        tone: vo2.value.band === 'poor' ? 'bad' : vo2.value.band === 'fair' ? 'warn' : 'good',
        evidence: 'vo2max',
      });
    }

    if (d.rhr?.latest7 != null) {
      const dl = delta(d.rhr.latest7, d.rhr.baseline28, true);
      out.push({
        label: 'Resting HR',
        value: String(Math.round(d.rhr.latest7)),
        unit: 'bpm · 7d',
        sub: dl ? `${dl.diff > 0 ? '+' : ''}${dl.diff} vs 28d` : '—',
        tone: dl ? (dl.good ? 'good' : dl.diff >= 3 ? 'warn' : 'neutral') : 'neutral',
        evidence: 'autonomic-balance',
      });
    }

    if (d.hrv?.latest7 != null) {
      const dl = delta(d.hrv.latest7, d.hrv.baseline28, false);
      out.push({
        label: 'HRV (RMSSD)',
        value: String(Math.round(d.hrv.latest7)),
        unit: 'ms · 7d',
        sub: dl ? `${dl.diff > 0 ? '+' : ''}${dl.diff} vs 28d` : '—',
        tone: dl ? (dl.good ? 'good' : dl.diff <= -5 ? 'warn' : 'neutral') : 'neutral',
        evidence: 'autonomic-balance',
      });
    }

    const lastRecovery = d.recovery.at(-1);
    if (lastRecovery) {
      const v = Math.round(lastRecovery.value);
      out.push({
        label: 'Recovery',
        value: String(v),
        unit: '% · Whoop',
        sub: v >= 67 ? 'green band' : v >= 34 ? 'amber band' : 'red band',
        tone: v >= 67 ? 'good' : v >= 34 ? 'warn' : 'bad',
        evidence: 'recovery-debt',
      });
    }
    return out;
  });

  // --- Per-workout progressions -------------------------------------------
  const efPoints = $derived(
    (d?.workouts ?? [])
      .filter((w) => w.ef != null && isPaceSport(w.activityType))
      .map((w) => ({ date: w.day, value: w.ef! })),
  );
  const hrrPoints = $derived(
    (d?.workouts ?? [])
      .filter((w) => w.hrr60 != null)
      .map((w) => ({ date: w.day, value: w.hrr60! })),
  );

  // --- Load ---------------------------------------------------------------
  const DAY_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function shortDay(day: string): string {
    const dt = new Date(Date.parse(day + 'T00:00:00Z'));
    return `${dt.getUTCDate()} ${DAY_MONTHS[dt.getUTCMonth()]}`;
  }

  const loadBars = $derived.by((): Bar[] => {
    const days = d?.load.days ?? [];
    return days.slice(-42).map((day) => ({
      key: day.date,
      tick: shortDay(day.date),
      value: day.load,
      readout: day.load > 0 ? `${day.load} TRIMP` : 'rest day',
      readoutSub: shortDay(day.date),
    }));
  });

  const weekBars = $derived.by((): Bar[] => {
    return (d?.weeks ?? []).map((w) => ({
      key: w.weekStart,
      tick: shortDay(w.weekStart),
      value: w.totalS,
      readout: w.totalS
        ? `${formatDuration(w.totalS)}${w.totalDistanceM ? ` · ${formatDistance(w.totalDistanceM)}` : ''}`
        : 'no workouts',
      readoutSub: `wk ${shortDay(w.weekStart)} · ${
        Object.entries(w.byType)
          .sort((a, b) => b[1] - a[1])
          .map(([t, s]) => `${activityLabel(t)} ${formatDuration(s)}`)
          .join(' · ') || '—'
      }`,
    }));
  });

  const ZONE_LABELS: Record<string, { label: string; tone: Tone }> = {
    detraining: { label: 'DETRAINING', tone: 'warn' },
    undertraining: { label: 'UNDERTRAINING', tone: 'warn' },
    optimal: { label: 'OPTIMAL', tone: 'good' },
    caution: { label: 'CAUTION', tone: 'warn' },
    danger: { label: 'DANGER', tone: 'bad' },
  };

  const POLARISED_VERDICT: Record<string, string> = {
    polarised: 'polarised — the 80/20 shape the endurance literature favours',
    pyramid: 'pyramidal — mostly easy with a moderate middle; a sound base shape',
    'junk-middle': 'moderate-heavy — most time in the middle zones, which Seiler’s work suggests limits return per hour',
    'insufficient-volume': 'not enough zone time to call a shape yet',
  };
</script>

<svelte:head>
  <title>Dashboard — Trails</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<PageHeader title="Strange Ramblings" />

<main class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">Health · Trails</div>
      <h1>Dashboard</h1>
      <p class="sub">
        Physiological progression from the workouts Apple Health sends, with Whoop recovery
        alongside. Every number links to how it is computed and the research behind it.
      </p>
    </div>
    <nav class="hdr-nav">
      <a href="/trails">All trails</a>
      <a href="/trails/plan">Plan</a>
      <a href="/trails/routes">Routes</a>
      <a href="/health">Health</a>
    </nav>
  </header>

  {#if data.error}
    <div class="nm-sec nm-sec-error">
      <span class="sr-label-tight error">{data.error}</span>
    </div>
  {:else if d}
    {#if tiles.length > 0}
      <section class="nm-sec">
        <div class="nm-sec-hd">
          <span class="sr-label-tight">Signals</span>
          <span class="nm-sec-meta">7-day state vs 28-day baseline</span>
        </div>
        <div class="tile-grid">
          {#each tiles as t (t.label)}
            <div class="tile">
              <span class="tile-value" class:good={t.tone === 'good'} class:warn={t.tone === 'warn'} class:bad={t.tone === 'bad'}>
                {t.value}
                <span class="tile-unit">{t.unit}</span>
              </span>
              <span class="sr-label-tight">{t.label}</span>
              <span class="tile-sub">{t.sub}</span>
              <EvidenceChip id={t.evidence} onopen={openEvidence} />
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Progression</span>
        <span class="nm-sec-meta">daily readings · 7-day line · dashed 28-day baseline</span>
      </div>
      <div class="chart-grid">
        <DateLineChart
          points={d.vo2.series}
          label="VO₂max — Apple estimate"
          unitSuffix=" ml/kg/min"
          dp={1}
          colour="var(--accent)"
        />
        {#if d.rhr}
          <DateLineChart
            points={d.rhr.daily}
            rolling={d.rhr.rolling7}
            baseline={d.rhr.baseline28}
            label="Resting HR — Whoop"
            unitSuffix=" bpm"
            colour="var(--accent-ink)"
          />
        {/if}
        {#if d.hrv}
          <DateLineChart
            points={d.hrv.daily}
            rolling={d.hrv.rolling7}
            baseline={d.hrv.baseline28}
            label="HRV — Whoop RMSSD"
            unitSuffix=" ms"
            colour="var(--accent-ink)"
          />
        {/if}
        {#if d.hrvSdnn && d.hrvSdnn.daily.length >= 2}
          <DateLineChart
            points={d.hrvSdnn.daily}
            rolling={d.hrvSdnn.rolling7}
            baseline={d.hrvSdnn.baseline28}
            label="HRV — Apple SDNN (different measure, not comparable)"
            unitSuffix=" ms"
            colour="var(--text-secondary)"
          />
        {/if}
        <DateLineChart
          points={efPoints}
          label="Efficiency factor — runs & walks"
          unitSuffix=" m/min/bpm"
          dp={2}
          colour="var(--accent)"
        />
        <DateLineChart
          points={hrrPoints}
          label="HRR60 — 1-min recovery per workout"
          unitSuffix=" bpm"
          colour="var(--accent)"
          zeroBaseline
        />
      </div>
      <p class="note">
        Rising VO₂max, falling resting HR, rising HRV, rising efficiency factor and a bigger
        HRR60 drop all point the same way — aerobic fitness improving. Read trends, not single
        days.
      </p>
    </section>

    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Training load</span>
        <span class="nm-sec-meta">TRIMP — HR-weighted minutes <EvidenceChip id="trimp" onopen={openEvidence} /></span>
      </div>

      <div class="acwr-row">
        {#if d.load.trimpAcwr}
          {@const a = d.load.trimpAcwr}
          <div class="acwr">
            <span class="sr-label-tight">Workout ACWR</span>
            {#if a.sufficiency === 'insufficient'}
              <span class="acwr-value muted">building history</span>
              <span class="acwr-note">{d.load.days.length} of 14 days banked — the ratio needs two weeks of load</span>
            {:else}
              {@const z = ZONE_LABELS[a.value.zone]}
              <span class="acwr-value">{a.value.ratio.toFixed(2)}</span>
              <span class="tag" class:good={z.tone === 'good'} class:warn={z.tone === 'warn'} class:bad={z.tone === 'bad'}>{z.label}</span>
              {#if a.sufficiency === 'partial'}
                <span class="acwr-note">early — under 28 days of history</span>
              {/if}
            {/if}
            <EvidenceChip id="acwr" onopen={openEvidence} />
          </div>
        {/if}
        {#if d.load.strainAcwr && d.load.strainAcwr.sufficiency !== 'insufficient'}
          {@const a = d.load.strainAcwr}
          {@const z = ZONE_LABELS[a.value.zone]}
          <div class="acwr">
            <span class="sr-label-tight">Whoop strain ACWR</span>
            <span class="acwr-value">{a.value.ratio.toFixed(2)}</span>
            <span class="tag" class:good={z.tone === 'good'} class:warn={z.tone === 'warn'} class:bad={z.tone === 'bad'}>{z.label}</span>
            <span class="acwr-note">wrist-measured, covers non-trail days</span>
          </div>
        {/if}
      </div>

      <Bars bars={loadBars} label="Daily load — last 6 weeks" formatY={(v) => String(Math.round(v))} />
    </section>

    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Weekly volume</span>
        <span class="nm-sec-meta">last 12 weeks</span>
      </div>
      <Bars bars={weekBars} label="Hours per week" formatY={(v) => `${(v / 3600).toFixed(v >= 36000 ? 0 : 1)}h`} />
    </section>

    {#if d.zones28}
      <section class="nm-sec">
        <div class="nm-sec-hd">
          <span class="sr-label-tight">Time in zones — last 28 days</span>
          <span class="nm-sec-meta">
            HRmax {d.profile.hrMax} ({d.profile.hrMaxSource}) <EvidenceChip id="hr-zones" onopen={openEvidence} />
          </span>
        </div>
        <ZoneBar zones={d.zones28.zones} edges={zoneEdges(d.profile.hrMax)} />
        {#if d.zones28.polarised && d.zones28.polarised.sufficiency !== 'insufficient'}
          {@const p = d.zones28.polarised.value}
          <p class="note">
            {Math.round(p.easyPct)}% easy · {Math.round(p.midPct)}% moderate ·
            {Math.round(p.hardPct)}% hard — {POLARISED_VERDICT[p.verdict]}.
            <EvidenceChip id="polarised" onopen={openEvidence} />
          </p>
        {/if}
      </section>
    {/if}

    <section class="nm-sec methods">
      <button type="button" class="methods-link" onclick={() => openEvidence('trimp')}>
        How these numbers are computed — sources &amp; caveats
      </button>
    </section>
  {/if}
</main>

<MethodologyDrawer
  open={drawerOpen}
  focusId={drawerFocus}
  onclose={() => (drawerOpen = false)}
/>

<style>
  .wrap {
    max-width: 1100px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
  }

  .page-hdr {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 1.5rem;
    margin-bottom: 1.75rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid var(--text-primary);
  }
  .kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--accent);
    margin-bottom: 0.35rem;
  }
  .page-hdr h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 2.2rem;
    font-weight: 900;
    line-height: 1.05;
  }
  .sub {
    margin: 0.6rem 0 0;
    font-size: 0.95rem;
    line-height: 1.5;
    color: var(--text-secondary);
    max-width: 64ch;
  }
  .hdr-nav {
    display: flex;
    gap: 1rem;
    flex-shrink: 0;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .hdr-nav a {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent);
    text-decoration: none;
  }
  .hdr-nav a:hover {
    text-decoration: underline;
  }

  .tile-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1rem 1.25rem;
  }
  @media (max-width: 700px) {
    .tile-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .tile {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.2rem;
    min-width: 0;
  }

  .tile-value {
    font-family: var(--font-mono);
    font-size: var(--fs-num-md);
    color: var(--text-primary);
    line-height: 1.1;
  }
  .tile-value.good {
    color: var(--success);
  }
  .tile-value.warn {
    color: var(--warn);
  }
  .tile-value.bad {
    color: var(--error);
  }

  .tile-unit {
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    margin-left: 0.15rem;
  }

  .tile-sub {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }

  .chart-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem 1.5rem;
  }
  @media (max-width: 860px) {
    .chart-grid {
      grid-template-columns: 1fr;
    }
  }

  .note {
    margin: 0.9rem 0 0;
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-secondary);
    max-width: 72ch;
  }

  .acwr-row {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem 2.5rem;
    margin-bottom: 1.1rem;
  }

  .acwr {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }

  .acwr-value {
    font-family: var(--font-mono);
    font-size: var(--fs-num-md);
    color: var(--text-primary);
    line-height: 1.1;
  }
  .acwr-value.muted {
    color: var(--text-muted);
    font-size: var(--fs-body);
  }

  .acwr-note {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    max-width: 32ch;
  }

  .tag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    padding: 0.15rem 0.5rem;
    border: 1px solid var(--line-strong);
    color: var(--text-secondary);
  }
  .tag.good {
    border-color: var(--success);
    color: var(--success);
  }
  .tag.warn {
    border-color: var(--warn);
    color: var(--warn);
  }
  .tag.bad {
    border-color: var(--error);
    color: var(--error);
  }

  .methods {
    align-items: flex-start;
  }

  .methods-link {
    background: none;
    border: none;
    padding: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
    cursor: pointer;
  }
  .methods-link:hover {
    text-decoration: underline;
  }

  .error {
    color: var(--error);
  }
</style>
