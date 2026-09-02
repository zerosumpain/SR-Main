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
  // 2026-09-02: the anonymous /health is now the SAME document, one section
  // shorter. It used to be a separate eight-chapter page, and the gap had
  // stopped being a privacy decision and started being a maintenance one — the
  // public page was two redesigns behind.
  //
  // What the anonymous reader does not get, and why it is decided HERE as well
  // as in the loader:
  //
  //  * G, Routes & plan, is not rendered. Its four route cards are FIXED
  //    editorial copy naming real corridors near where he lives, so a null
  //    `coach` would have hidden the proposal and left the geography.
  //  * F keeps its four count tiles and loses the gettable board and the chain
  //    tile, which are the only things in this component that name ground.
  //  * the header nav is empty. Every link on it goes to an owner-gated child.
  //
  // The loader has already stripped the data behind all three — `{#if owner}`
  // in a template still ships the bytes — so this is the second belt, and it is
  // the one that covers the copy the components carry themselves.
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
  import MethodologyDrawer from '$lib/components/health/v2/MethodologyDrawer.svelte';
  import { fmtAgo } from '$lib/components/health/v2/utils';
  import type { HealthAudience, OwnerHealthData, PublicHealthData } from './types';

  interface Props {
    data: OwnerHealthData | PublicHealthData;
    audience?: HealthAudience;
  }

  let { data, audience = 'owner' }: Props = $props();

  const owner = $derived(audience === 'owner');

  /**
   * Section letters, after G is dropped. The letters are the document's spine —
   * the shell's kicker and footer both quote the range — so they close up
   * rather than leaving a hole where the routes section was.
   */
  const experimentsLetter = $derived(owner ? 'H' : 'G');
  const verdictLetter = $derived(owner ? 'I' : 'H');

  /** The public page's only interactive thing below the fold. */
  let methodOpen = $state(false);

  /** Twelve hours without a reading and "live" is a claim, not a fact. */
  const stale = $derived(data.syncedAgoSeconds > 12 * 3600);

  const dashboardUpdated = $derived(
    new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZone: 'Europe/London',
      timeZoneName: 'short',
    }).format(new Date(data.dashboardUpdatedAt)),
  );

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

{#snippet methodButton()}
  <button type="button" class="hd-method" onclick={() => (methodOpen = true)}>
    How these numbers are computed
  </button>
{/snippet}

<HealthShell
  path="/health"
  footerAction={owner ? undefined : methodButton}
  kicker={owner
    ? 'Full read · 8 signal families · sections A–I'
    : 'Public read · 8 signal families · sections A–H'}
  nav={owner
    ? [
        { href: '/health/activities', label: 'Activities' },
        { href: '/health/segments', label: 'Segments' },
        { href: '/health/plan', label: 'Plan' },
        { href: '/health/routes', label: 'Routes' },
        { href: '/health/record', label: 'Record' },
      ]
    : []}
  live={stale || seriesIsMock ? null : 'Whoop · Apple · Strava'}
  {meta}
  footer={owner
    ? [
        'strangeramblings.com/health · full read · sections A–I',
        'Whoop · Apple Health · Strava · OSM/Overpass · openrouteservice',
        'Advisory only · not medical advice',
        `Dashboard updated ${dashboardUpdated}`,
      ]
    : [
        'strangeramblings.com/health · public read · sections A–H',
        'Whoop · Apple Health · Strava',
        'Advisory only · not medical advice · routes and locations withheld',
        `Dashboard updated ${dashboardUpdated}`,
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
    {audience}
    segmentForms={data.segmentForms}
    totals={data.segments ? data.segments.totals : null}
    chains={data.chains}
  />

  <!-- G is owner-only, and it is the section this whole split exists for: the
       four route cards are hardcoded editorial naming real trail corridors near
       home, so they are markup, not data, and nothing the loader withholds can
       reach them. -->
  {#if owner}
    <RoutesPlan coach={data.coach} />
  {/if}

  <ExperimentsSection experiments={data.experiments} letter={experimentsLetter} />

  <VerdictSection verdict={data.verdict} letter={verdictLetter} />

</HealthShell>

<!-- The one thing carried over from the retired public document. Nine sections
     of derived figures earn a page that says how each one is derived. -->
{#if !owner}
  <MethodologyDrawer open={methodOpen} focusId={null} onclose={() => (methodOpen = false)} />
{/if}

<style>
  /* The one loud thing on this page, and deliberately: it is the difference
     between a dashboard and a mock-up. Same warn tokens and same copy as the
     anonymous landing's banner, so the two states read identically wherever
     the reader meets them. */
  .hd-method {
    background: none;
    border: 1px solid var(--line-strong);
    padding: 9px 16px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-primary);
    cursor: pointer;
    border-radius: 0;
  }
  .hd-method:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

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
