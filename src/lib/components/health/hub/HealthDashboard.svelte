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
  live={stale ? null : 'Whoop · Apple · Strava'}
  {meta}
  footer={[
    'strangeramblings.com/health · full read · sections A–I',
    'Whoop · Apple Health · Strava · OSM/Overpass · openrouteservice',
    'Advisory only · not medical advice',
  ]}
>
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
