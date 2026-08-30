<script lang="ts">
  // The owner's /health — nine sections, A to I, read top to bottom.
  //
  //   A  State of play      where the body is this morning
  //   B  Instrument deck    eight analytics, each with the window it needs
  //   C  Forecast           where the lines go if nothing changes
  //   D  Ranked moves       five options, and what each one costs
  //   E  Tripwires          the numbers worth being told about
  //   F  Segments           which records are actually gettable
  //   G  Routes & plan      what to go and do
  //   H  Experiments        change one thing, measure it
  //   I  Verdict            the whole page in two lines
  //
  // Alternating dark instrument decks and paper editorial: A/B, E and H sit on
  // #1a1008, everything between them on paper. That rhythm is the structure —
  // measurement is dark, argument is light.
  //
  // The anonymous /health is a different document entirely and never reaches
  // this component; the split is made in the loader, so an anonymous visitor is
  // not sent the data and then shown a smaller view of it.
  import HealthShell from './HealthShell.svelte';
  import StateOfPlay from './StateOfPlay.svelte';
  import InstrumentDeck from './InstrumentDeck.svelte';
  import ForecastSection from './ForecastSection.svelte';
  import RankedMoves from './RankedMoves.svelte';
  import TripwireTable from './TripwireTable.svelte';
  import SegmentsSection from './SegmentsSection.svelte';
  import RoutesPlan from './RoutesPlan.svelte';
  import ExperimentsSection from './ExperimentsSection.svelte';
  import VerdictSection from './VerdictSection.svelte';
  import { fmtAgo } from '$lib/components/health/v2/utils';
  import type { OwnerHealthData } from './types';

  interface Props {
    data: OwnerHealthData;
  }

  let { data }: Props = $props();

  /** Twelve hours without a reading and "live" is a claim, not a fact. */
  const stale = $derived(data.syncedAgoSeconds > 12 * 3600);

  // With no real day in the 30-day window, `getHealthSeries30d` substitutes a
  // deterministic MOCK series — and the workouts and rings with it — so the page
  // still renders through a cold start or a sync outage. It is plausible and
  // indistinguishable from real data by eye. The anonymous landing has said so
  // since it shipped; this branch did not, so an owner in exactly that state was
  // shown fabricated numbers laid out as measurements, under a header claiming a
  // live sync. Nothing below the banner is a reading when this is set.
  const seriesIsMock = $derived(data.provenance?.seriesIsMock === true);

  const meta = $derived.by((): string[] => {
    const out: string[] = [];
    if (data.segments) {
      out.push(`${data.segments.totals.segments} segments · ${data.segments.totals.efforts} efforts`);
    }
    out.push(stale ? `stale · last sync ${fmtAgo(data.syncedAgoSeconds)} ago` : `synced ${fmtAgo(data.syncedAgoSeconds)} ago`);
    return out;
  });
</script>

<HealthShell
  path="/health"
  kicker="Full read · 8 signal families · sections A–I"
  nav={[
    { href: '/health/activities', label: 'Activities' },
    { href: '/health/segments', label: 'Segments' },
    { href: '/health/plan', label: 'Plan' },
    { href: '/health/routes', label: 'Routes' },
    { href: '/health/record', label: 'Record' },
  ]}
  live={stale || seriesIsMock ? null : 'Whoop · Apple · Strava'}
  {meta}
  footer={[
    'strangeramblings.com/health · full read · sections A–I',
    'Whoop · Apple Health · Strava · OSM/Overpass · openrouteservice',
    'Advisory only · not medical advice',
  ]}
>
  {#if seriesIsMock}
    <p class="hd-provenance">
      Sample data — no readings have synced into this window yet. Nothing below is a measurement.
    </p>
  {/if}

  <StateOfPlay
    today={data.today}
    series={data.series}
    rhrBaseline={data.rhrBaseline}
    todayDeltas={data.todayDeltas}
    syncedAgoSeconds={data.syncedAgoSeconds}
    readiness={data.readiness}
    dashboard={data.dashboard}
    vo2max={data.vo2max}
    acwr={data.acwr}
    volume={data.volume}
  />

  <InstrumentDeck
    acwr={data.acwr}
    monotony={data.monotony}
    polarised={data.polarised}
    sleepRegularity={data.sleepRegularity}
    circadian={data.circadian}
    autonomic={data.autonomic}
    recoveryDebt={data.recoveryDebt}
    efficiency={data.dashboard?.efficiency.bkm ?? null}
    loadDays={data.dashboard?.load.days ?? []}
  />

  <ForecastSection forecast={data.forecast} />

  <RankedMoves moves={data.moves} />

  <TripwireTable tripwires={data.tripwires} />

  <SegmentsSection
    segmentForms={data.segmentForms}
    totals={data.segments ? data.segments.totals : null}
    chains={data.chains}
  />

  <RoutesPlan coach={data.coach} />

  <ExperimentsSection experiments={data.experiments} />

  <VerdictSection verdict={data.verdict} />
</HealthShell>

<style>
  /* The one loud thing on this page, and deliberately: it is the difference
     between a dashboard and a mock-up. Same warn tokens and same copy as the
     anonymous landing's banner, so the two states read identically wherever
     the reader meets them. */
  .hd-provenance {
    margin: 0;
    padding: 12px clamp(20px, 3vw, 44px);
    background: var(--warn-bg);
    border-bottom: 1px solid var(--warn-border);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--warn);
  }
</style>
