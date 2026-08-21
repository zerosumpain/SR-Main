<script lang="ts">
  // The work: what you actually did, and whether it was too much of it.
  //
  // Same three-part grammar as every other chapter — stat row, chart grid,
  // note — rather than the bespoke ACWR block it used to carry. That block was
  // a third tile treatment on a page that already had two.
  import Bars, { type Bar } from '$lib/components/trails/Bars.svelte';
  import ZoneBar from '$lib/components/trails/ZoneBar.svelte';
  import EvidenceChip from '$lib/components/health/EvidenceChip.svelte';
  import StatRow, { type Stat } from '$lib/components/health/StatRow.svelte';
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

  const ZONE_TONE: Record<ACWRZone, Stat['tone']> = {
    detraining: 'warn',
    undertraining: 'warn',
    optimal: 'good',
    caution: 'warn',
    danger: 'bad',
  };
  const ZONE_LABEL: Record<ACWRZone, string> = {
    detraining: 'detraining',
    undertraining: 'under the building band',
    optimal: 'in the building band',
    caution: 'above it — watch',
    danger: 'where injuries come from',
  };

  const MONOTONY_PROSE: Record<string, string> = {
    low: 'varied — hard and easy days look different',
    moderate: 'starting to look samey',
    high: 'every day looks like every other',
  };

  const stats = $derived.by((): Stat[] => {
    if (!d) return [];
    const out: Stat[] = [];

    const t = d.load.trimpAcwr;
    if (t) {
      out.push(
        t.sufficiency === 'insufficient'
          ? {
              label: 'Workout load ratio',
              value: '—',
              sub: `${d.load.days.length} of the 14 days it needs`,
              tone: 'neutral',
              evidence: 'acwr',
            }
          : {
              label: 'Workout load ratio',
              value: t.value.ratio.toFixed(2),
              unit: '×',
              sub:
                ZONE_LABEL[t.value.zone] +
                (t.sufficiency === 'partial' ? ' · under 28 days of history' : ''),
              tone: ZONE_TONE[t.value.zone],
              evidence: 'acwr',
            },
      );
    }

    const s = d.load.strainAcwr;
    if (s && s.sufficiency !== 'insufficient') {
      out.push({
        label: 'Whole-day ratio',
        value: s.value.ratio.toFixed(2),
        unit: '×',
        sub: 'Whoop strain — counts the days you did not call training',
        tone: ZONE_TONE[s.value.zone],
      });
    }

    // getMonotony() can NEVER report insufficient: it zero-fills seven calendar
    // days before computing, so sufficiency is always 'ok' even against an
    // empty database. The mean and the standard deviation are the real guard.
    if (usable(monotony) && (monotony?.value.mean ?? 0) > 0 && (monotony?.value.sd ?? 0) > 0) {
      out.push({
        label: 'Sameness',
        value: monotony!.value.monotony.toFixed(1),
        sub: MONOTONY_PROSE[monotony!.value.band] ?? monotony!.value.band,
        tone:
          monotony!.value.band === 'high' ? 'bad' : monotony!.value.band === 'moderate' ? 'warn' : 'good',
        evidence: 'monotony',
      });
    }

    const thisWeek = d.weeks.at(-1);
    if (thisWeek) {
      const before = d.weeks.slice(0, -1);
      const typical = before.length ? before.reduce((n, w) => n + w.totalS, 0) / before.length : 0;
      out.push({
        label: 'This week',
        value: (thisWeek.totalS / 3600).toFixed(1),
        unit: 'h',
        sub:
          typical > 0
            ? `${Math.round(((thisWeek.totalS - typical) / typical) * 100)}% against a typical week`
            : 'first week on record',
      });
    }

    if (d.zones28?.polarised && d.zones28.polarised.sufficiency !== 'insufficient') {
      const p = d.zones28.polarised.value;
      out.push({
        label: 'Intensity mix',
        value: `${Math.round(p.easyPct)}/${Math.round(p.midPct)}/${Math.round(p.hardPct)}`,
        sub: 'easy / moderate / hard, last 28 days',
        tone: p.verdict === 'junk-middle' ? 'warn' : 'good',
        evidence: 'polarised',
      });
    }

    return out;
  });

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

  const POLARISED_VERDICT: Record<string, string> = {
    polarised: 'polarised — the 80/20 shape the endurance literature favours',
    pyramid: 'pyramidal — mostly easy with a moderate middle; a sound base shape',
    'junk-middle':
      'moderate-heavy — most time in the middle zones, which Seiler’s work suggests limits return per hour',
    'insufficient-volume': 'not enough zone time to call a shape yet',
  };
</script>

{#if d}
  <StatRow {stats} {onevidence} />

  <div class="h-chartgrid">
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
        <span class="h-stat-label">Where the time went — last 28 days</span>
        <span class="zones-meta">
          HRmax {d.profile.hrMax} ({d.profile.hrMaxSource})
          <EvidenceChip id="hr-zones" onopen={onevidence} />
        </span>
      </div>
      <ZoneBar zones={d.zones28.zones} edges={zoneEdges(d.profile.hrMax)} />
      {#if d.zones28.polarised && d.zones28.polarised.sufficiency !== 'insufficient'}
        <p class="h-note">{POLARISED_VERDICT[d.zones28.polarised.value.verdict]}.</p>
      {/if}
    </div>
  {/if}
{/if}

<style>
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
</style>
