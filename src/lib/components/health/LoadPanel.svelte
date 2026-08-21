<script lang="ts">
  // Everything that answers "are you doing too much, or not enough".
  //
  // The hub used to answer it three times: an acute:chronic figure in its own
  // signals row, a second ACWR row inside the nested dashboard, and a whole
  // TrainingLoad card block underneath with a third treatment of the same
  // ratio plus monotony and the intensity mix. One chapter, one answer.
  import Bars, { type Bar } from '$lib/components/trails/Bars.svelte';
  import ZoneBar from '$lib/components/trails/ZoneBar.svelte';
  import EvidenceChip from '$lib/components/health/EvidenceChip.svelte';
  import { zoneEdges } from '$lib/health/analytics/hr-zones';
  import type { ACWRZone } from '$lib/health/analytics/acwr';
  import type { MonotonyResult } from '$lib/health/analytics/monotony';
  import type { MetricResult } from '$lib/health/analytics/types';
  import { activityLabel, formatDistance, formatDuration } from '$lib/trails/format';
  import type { TrailsDashboard } from '$lib/trails/physio-service';
  import { usable } from '$lib/health/ledes';

  let {
    dashboard,
    monotony,
    onevidence,
  }: {
    dashboard: TrailsDashboard | null;
    monotony: MetricResult<MonotonyResult> | null;
    onevidence?: (id: string) => void;
  } = $props();

  const d = $derived(dashboard);

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function shortDay(day: string): string {
    const dt = new Date(Date.parse(day + 'T00:00:00Z'));
    return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
  }

  const loadBars = $derived.by((): Bar[] =>
    (d?.load.days ?? []).slice(-42).map((day) => ({
      key: day.date,
      tick: shortDay(day.date),
      value: day.load,
      readout: day.load > 0 ? `${day.load} TRIMP` : 'rest day',
      readoutSub: shortDay(day.date),
    })),
  );

  const weekBars = $derived.by((): Bar[] =>
    (d?.weeks ?? []).map((w) => ({
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
    })),
  );

  type Tone = 'good' | 'warn' | 'bad';
  const ZONE_LABELS: Record<ACWRZone, { label: string; tone: Tone }> = {
    detraining: { label: 'DETRAINING', tone: 'warn' },
    undertraining: { label: 'UNDERTRAINING', tone: 'warn' },
    optimal: { label: 'OPTIMAL', tone: 'good' },
    caution: { label: 'CAUTION', tone: 'warn' },
    danger: { label: 'DANGER', tone: 'bad' },
  };

  const POLARISED_VERDICT: Record<string, string> = {
    polarised: 'polarised — the 80/20 shape the endurance literature favours',
    pyramid: 'pyramidal — mostly easy with a moderate middle; a sound base shape',
    'junk-middle':
      'moderate-heavy — most time in the middle zones, which Seiler’s work suggests limits return per hour',
    'insufficient-volume': 'not enough zone time to call a shape yet',
  };

  const MONOTONY_PROSE: Record<string, string> = {
    low: 'varied — hard days and easy days look different from each other',
    moderate: 'somewhat samey — the days are starting to resemble one another',
    high: 'monotonous — every day looks like every other, which Foster’s work links to illness and staleness',
  };

  // getMonotony() can NEVER report insufficient: the service zero-fills seven
  // calendar days before computing, so sufficiency is always 'ok' even against
  // an empty database. The mean and the standard deviation are the real guard.
  const showMonotony = $derived(
    usable(monotony) && (monotony?.value.mean ?? 0) > 0 && (monotony?.value.sd ?? 0) > 0,
  );
</script>

{#if d}
  <div class="acwr-row">
    {#if d.load.trimpAcwr}
      {@const a = d.load.trimpAcwr}
      <div class="acwr">
        <span class="sr-label-tight">Workout load ratio</span>
        {#if a.sufficiency === 'insufficient'}
          <span class="acwr-value muted">building history</span>
          <span class="acwr-note">
            {d.load.days.length} of 14 days banked — the ratio needs two weeks of load
          </span>
        {:else}
          {@const z = ZONE_LABELS[a.value.zone]}
          <span class="acwr-value">{a.value.ratio.toFixed(2)}</span>
          <span
            class="tag"
            class:good={z.tone === 'good'}
            class:warn={z.tone === 'warn'}
            class:bad={z.tone === 'bad'}>{z.label}</span
          >
          <span class="acwr-note">
            HR-weighted minutes from the workouts themselves{a.sufficiency === 'partial'
              ? ' · early — under 28 days of history'
              : ''}
          </span>
        {/if}
        <EvidenceChip id="acwr" onopen={onevidence} />
      </div>
    {/if}

    {#if d.load.strainAcwr && d.load.strainAcwr.sufficiency !== 'insufficient'}
      {@const a = d.load.strainAcwr}
      {@const z = ZONE_LABELS[a.value.zone]}
      <div class="acwr">
        <span class="sr-label-tight">Whole-day load ratio</span>
        <span class="acwr-value">{a.value.ratio.toFixed(2)}</span>
        <span
          class="tag"
          class:good={z.tone === 'good'}
          class:warn={z.tone === 'warn'}
          class:bad={z.tone === 'bad'}>{z.label}</span
        >
        <span class="acwr-note">
          Whoop strain — wrist-measured, so it counts the days you did not call training{a.sufficiency ===
          'partial'
            ? ' · early'
            : ''}
        </span>
      </div>
    {/if}

    {#if showMonotony && monotony}
      <div class="acwr">
        <span class="sr-label-tight">Sameness</span>
        <span class="acwr-value">{monotony.value.monotony.toFixed(1)}</span>
        <span
          class="tag"
          class:good={monotony.value.band === 'low'}
          class:warn={monotony.value.band === 'moderate'}
          class:bad={monotony.value.band === 'high'}>{monotony.value.band.toUpperCase()}</span
        >
        <span class="acwr-note">{MONOTONY_PROSE[monotony.value.band] ?? ''}</span>
        <EvidenceChip id="monotony" onopen={onevidence} />
      </div>
    {/if}
  </div>

  <div class="bars">
    <Bars bars={loadBars} label="Daily load — last 6 weeks" formatY={(v) => String(Math.round(v))} />
    <Bars
      bars={weekBars}
      label="Hours a week — last 12 weeks"
      formatY={(v) => `${(v / 3600).toFixed(v >= 36000 ? 0 : 1)}h`}
    />
  </div>

  {#if d.zones28}
    <div class="zones">
      <div class="zones-hd">
        <span class="sr-label-tight">Where the time went — last 28 days</span>
        <span class="zones-meta">
          HRmax {d.profile.hrMax} ({d.profile.hrMaxSource})
          <EvidenceChip id="hr-zones" onopen={onevidence} />
        </span>
      </div>
      <ZoneBar zones={d.zones28.zones} edges={zoneEdges(d.profile.hrMax)} />
      {#if d.zones28.polarised && d.zones28.polarised.sufficiency !== 'insufficient'}
        {@const p = d.zones28.polarised.value}
        <p class="note">
          {Math.round(p.easyPct)}% easy · {Math.round(p.midPct)}% moderate · {Math.round(p.hardPct)}%
          hard — {POLARISED_VERDICT[p.verdict]}.
          <EvidenceChip id="polarised" onopen={onevidence} />
        </p>
      {/if}
    </div>
  {/if}
{/if}

<style>
  .acwr-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
    gap: 1.25rem 1.75rem;
    margin-bottom: 1.75rem;
  }

  .acwr {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
    min-width: 0;
  }

  .acwr-value {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: var(--fs-num-lg);
    letter-spacing: -0.02em;
    line-height: 1;
    color: var(--text-primary);
  }
  .acwr-value.muted {
    font-family: var(--font-mono);
    font-size: var(--fs-body);
    font-weight: 400;
    color: var(--text-muted);
    letter-spacing: 0.05em;
  }

  .tag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    padding: 2px 8px;
    border: 1px solid var(--line-strong);
    color: var(--text-secondary);
  }
  .tag.good {
    color: var(--success);
    border-color: var(--success-border);
    background: var(--success-bg);
  }
  .tag.warn {
    color: var(--warn);
    border-color: var(--warn-border);
    background: var(--warn-bg);
  }
  .tag.bad {
    color: var(--error);
    border-color: var(--error-border);
    background: var(--error-bg);
  }

  .acwr-note {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    color: var(--text-muted);
    max-width: 40ch;
  }

  .bars {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr));
    gap: 1.5rem 1.75rem;
  }
  @media (max-width: 720px) {
    .bars {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .zones {
    margin-top: 1.75rem;
  }
  .zones-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 0.6rem;
  }
  .zones-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    color: var(--text-ghost);
  }

  .note {
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-muted);
    margin: 0.9rem 0 0 0;
    max-width: 68ch;
  }
</style>
