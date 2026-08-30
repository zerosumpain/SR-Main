<script lang="ts">
  // /health — one document, eight chapters, read top to bottom.
  //
  // It was two dashboards bolted together: a health page and a trails page,
  // each with its own signals grid, its own answer to "am I overreaching", and
  // resting heart rate quoted in four places with four different windows. The
  // structure now is a QUESTION per chapter, and every number appears exactly
  // once, in the chapter whose question it answers:
  //
  //   01 Today            how are you, and what should you do about it
  //   02 The last 30 days what has been happening
  //   03 The direction    which way is it going
  //   04 The load         are you doing too much, or not enough
  //   05 Recovery         are you getting it back
  //   06 The ground       where have you been
  //   07 Correlations     what moves what
  //   08 Field notes      the ones that earned a name
  //
  // Chapters open with a LEDE — a plain sentence derived from the same numbers
  // the charts below it draw ($lib/health/ledes, pure and tested). The charts
  // are the trails register throughout: daily dots, a seven-day line, a dashed
  // baseline, the same shape every time.
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Narrative from '$lib/components/health/v2/Narrative.svelte';
  import PulseGrid from '$lib/components/health/v2/PulseGrid.svelte';
  import Fitness from '$lib/components/health/v2/Fitness.svelte';
  import EpicActivities from '$lib/components/health/v2/EpicActivities.svelte';
  import MethodologyDrawer from '$lib/components/health/v2/MethodologyDrawer.svelte';
  import HealthDashboard from '$lib/components/health/hub/HealthDashboard.svelte';
  import ChapterLede from '$lib/components/health/ChapterLede.svelte';
  import ReadinessBreakdown from '$lib/components/health/ReadinessBreakdown.svelte';
  import StatRow, { type Stat } from '$lib/components/health/StatRow.svelte';
  import BodyTrend from '$lib/components/health/BodyTrend.svelte';
  import { fmtAgo } from '$lib/components/health/v2/utils';
  import { usable, todayLede, windowLede, directionLede } from '$lib/health/ledes';

  let { data } = $props();

  // Two audiences, two payloads, decided server-side — the anonymous one is
  // never SENT the ground data, so there is nothing here to hide.
  const owner = $derived(data.mode === 'owner' ? data : null);

  let evidenceOpen = $state(false);
  let evidenceFocus = $state<string | null>(null);
  function openEvidence(id: string) {
    evidenceFocus = id;
    evidenceOpen = true;
  }

  const stale = $derived(data.syncedAgoSeconds > 12 * 3600);
  const hasSeries = $derived((data.series?.length ?? 0) > 0);

  // ——— what each chapter has to show for itself ————————————————
  const showRings = $derived(!!data.rings && (data.rings.moveKcal > 0 || data.rings.exerciseMin > 0));
  const showCoach = $derived(!!owner?.coach);
  const showNarrative = $derived(!!data.narrative);
  const showDirection = $derived(
    !!owner?.dashboard || (!owner && hasSeries) || usable(data.vo2max),
  );
  const showLoad = $derived(!!owner?.dashboard);
  const showRecovery = $derived(
    !!owner && (usable(owner.recoveryDebt) || usable(owner.autonomic) || usable(owner.sleepRegularity) || usable(owner.circadian)),
  );
  const showGround = $derived((owner?.outings?.length ?? 0) > 0);
  const showCorrelations = $derived((owner?.correlations?.length ?? 0) > 0);
  const showFeatured = $derived((data.featuredActivities?.length ?? 0) > 0);
  const showFitness = $derived(
    usable(data.vo2max) ||
      (!!data.stats?.weekly &&
        (data.stats.weekly.activities > 0 || (data.stats.personalRecords?.length ?? 0) > 0)),
  );

  // Chapter numbers are DERIVED from what actually rendered. Hard-coded ones
  // printed 01, 02, 05, 06, 09 on a thin-data day, and printed 01 twice once
  // the hero claimed it too.
  const order = $derived.by(() => {
    // "Today" and "the last thirty days" used to be two chapters and repeated
    // each other — the hero's four deltas against the week-in-numbers block,
    // the hero's strap against the narrative paragraph. One chapter now: where
    // the body is, and how it got there.
    const keys: string[] = ['today'];
    if (showCoach) keys.push('session');
    if (showDirection) keys.push('direction');
    if (showLoad) keys.push('load');
    if (showRecovery) keys.push('recovery');
    if (showGround) keys.push('ground');
    if (showCorrelations) keys.push('correlations');
    if (showFeatured) keys.push('featured');
    return keys;
  });
  const num = $derived((key: string) => {
    const i = order.indexOf(key);
    return i < 0 ? '' : String(i + 1).padStart(2, '0');
  });

  // Today's figures. ONE row — the hero used to carry four deltas and the
  // week-in-numbers block below it carried five overlapping ones, which is
  // most of why the top of the page felt like two documents.
  //
  // The three activity rings are stats here rather than a dial. A pie of three
  // concentric arcs took a third of the chapter's width to say what three
  // numbers say, and left a column of white space beside it.
  const todayStats = $derived.by((): Stat[] => {
    const t = data.today;
    if (!t) return [];
    const d = data.todayDeltas;
    const out: Stat[] = [];

    if (t.rec > 0) {
      out.push({
        label: 'Recovery',
        value: String(Math.round(t.rec)),
        unit: '%',
        sub: d ? `${d.recDelta > 0 ? '+' : ''}${Math.round(d.recDelta)} on the 7-day mean` : '',
        tone: t.rec >= 67 ? 'good' : t.rec >= 34 ? 'warn' : 'bad',
      });
    }
    if (t.hrv > 0) {
      out.push({
        label: 'HRV',
        value: String(Math.round(t.hrv)),
        unit: 'ms',
        sub: d && d.hrvDeltaPct !== 0 ? `${d.hrvDeltaPct > 0 ? '+' : ''}${d.hrvDeltaPct}% overnight` : 'level overnight',
      });
    }
    if (t.rhr > 0 && data.rhrBaseline > 0) {
      const diff = Math.round(t.rhr - data.rhrBaseline);
      out.push({
        label: 'Resting HR',
        value: String(Math.round(t.rhr)),
        unit: 'bpm',
        sub: diff === 0 ? 'on baseline' : `${Math.abs(diff)} ${diff < 0 ? 'under' : 'over'} a ${Math.round(data.rhrBaseline)} baseline`,
        tone: diff <= 0 ? 'good' : diff >= 3 ? 'warn' : 'neutral',
      });
    }
    if (t.slept > 0) {
      out.push({ label: 'Sleep', value: t.slept.toFixed(1), unit: 'h', sub: 'last night' });
    }

    const r = data.rings;
    if (r && r.moveKcal > 0) {
      out.push({
        label: 'Move',
        value: String(Math.round(r.moveKcal)),
        unit: `of ${r.moveTarget} kcal`,
        sub: 'derived from Whoop, not Apple',
      });
    }
    if (r && r.exerciseMin > 0) {
      out.push({
        label: 'Exercise',
        value: String(Math.round(r.exerciseMin)),
        unit: `of ${r.exerciseTarget} min`,
        sub: 'zone 2 and above',
      });
    }
    return out;
  });

  // ——— the ledes ————————————————————————————————————————————————
  const todayText = $derived(
    data.today
      ? todayLede({
          recovery: data.today.rec,
          hrv: data.today.hrv,
          rhr: data.today.rhr,
          slept: data.today.slept,
          rhrBaseline: data.rhrBaseline,
          deltas: data.todayDeltas,
          readinessLabel: data.readiness?.label ?? null,
          syncedAgoSeconds: data.syncedAgoSeconds,
        })
      : '',
  );

  const windowText = $derived(
    hasSeries
      ? windowLede({
          days: data.series.map((d) => ({
            recovery: d.rec,
            slept: d.slept,
            strain: d.strain,
            steps: d.steps,
          })),
          // NOT `series.filter(d => d.strain > 0)`. Missing days in HealthDay are
          // CARRIED FORWARD from the day before for strain, so nearly every day
          // has one and that count read "30 sessions in 30 days". The owner has
          // the real workouts; an anonymous visitor is not sent them, and a
          // count of zero drops the clause rather than inventing it.
          workouts: owner?.dashboard
            ? new Set(
                owner.dashboard.workouts
                  .filter((w) => w.day >= (data.series[0]?.date ?? ''))
                  .map((w) => w.id),
              ).size
            : 0,
        })
      : '',
  );

  const directionText = $derived(
    directionLede({
      vo2: data.vo2max,
      rhr: owner?.dashboard?.rhr ?? null,
      hrv: owner?.dashboard?.hrv ?? null,
      ef: owner?.dashboard?.efficiency.ef ?? null,
    }),
  );
</script>

<svelte:head>
  <title>Health — Strange Ramblings</title>
  <meta
    name="description"
    content="Live health dashboard — readiness, thirty days of body signals, cardio fitness, training load and sleep."
  />
  <meta property="og:title" content="Health — Strange Ramblings" />
  <meta
    property="og:description"
    content="Live health dashboard — readiness, thirty days of body signals, cardio fitness, training load and sleep."
  />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://strangeramblings.com/health" />
  {#if owner}
    <meta name="robots" content="noindex" />
  {/if}
</svelte:head>

<!-- Two audiences, two documents. The owner gets the nine-section hub; the
     anonymous branch below is the public landing page and is UNCHANGED. -->
{#if owner}
<HealthDashboard data={owner} />
{:else}
<div class="h-root">
  <PageHeader title="HEALTH">
    {#snippet meta()}
      <span class="h-sync-meta" class:stale>
        <span class="h-pulse-dot" class:stale aria-hidden="true"></span>
        {stale ? 'Stale' : 'Live'} · synced {fmtAgo(data.syncedAgoSeconds)} ago
      </span>
    {/snippet}
  </PageHeader>

  {#if data.provenance?.seriesIsMock}
    <p class="h-provenance">
      Sample data — no readings have synced into this window yet. Nothing below is a measurement.
    </p>
  {/if}

  <!-- ─── 01 · Today, and the thirty days behind it ────────────── -->
  <section class="h-chapter">
    <div class="h-chapter-inner">
      <div class="h-chapter-head">
        <div>
          <p class="h-chapter-num">{num('today')} / TODAY</p>
          <h2 class="h-chapter-title">WHERE THE BODY IS</h2>
        </div>
        <p class="h-chapter-strap">And the thirty days that got it here.</p>
      </div>
      <ChapterLede text={todayText} />

      {#if data.readiness}
        <ReadinessBreakdown
          score={data.readiness.score}
          label={data.readiness.label}
          recommendation={data.readiness.recommendation}
          factors={data.readiness.factors}
          onevidence={openEvidence}
        />
      {/if}

      <div class="h-sub">
        <StatRow stats={todayStats} onevidence={openEvidence} />
      </div>

      {#if data.narrative}
        <div class="h-sub">
          <Narrative narrative={data.narrative} />
        </div>
      {/if}

      {#if hasSeries}
        <div class="h-sub">
          <div class="h-sub-hd">
            <h3 class="h-sub-title">Every day, every measure</h3>
            <p class="h-sub-meta">{windowText}</p>
          </div>
          <PulseGrid series={data.series} />
          {#if data.annotations?.length}
            <div class="h-annot-grid">
              {#each data.annotations as annot, i (i)}
                <div class="h-annot">
                  <p class="h-annot-when">{annot.when}</p>
                  <!-- Built server-side from numeric fields in computeAnnotations. -->
                  <p class="h-annot-text">{@html annot.text}</p>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </section>

  <!-- ─── 03 · The direction of travel ────────────────────────────── -->
  {#if showDirection}
    <section class="h-chapter">
      <div class="h-chapter-inner">
        <div class="h-chapter-head">
          <div>
            <p class="h-chapter-num">{num('direction')} / THE BODY</p>
            <h2 class="h-chapter-title">WHICH WAY IS IT GOING?</h2>
          </div>
          <p class="h-chapter-strap">A day is weather. These are the lines underneath it.</p>
        </div>
        <ChapterLede text={directionText} />

        {#if hasSeries}
          <BodyTrend series={data.series} />
        {/if}

        {#if showFitness}
          <div class="h-sub">
            <div class="h-sub-hd">
              <h3 class="h-sub-title">The long game</h3>
              <p class="h-sub-meta">Cardio fitness against the population, and the all-time bests</p>
            </div>
            <Fitness vo2max={data.vo2max} stats={data.stats} onevidence={openEvidence} />
          </div>
        {/if}
      </div>
    </section>
  {/if}

  <!-- ─── 08 · Field notes ────────────────────────────────────────── -->
  {#if showFeatured}
    <section class="h-chapter tinted">
      <div class="h-chapter-inner">
        <div class="h-chapter-head">
          <div>
            <p class="h-chapter-num">{num('featured')} / FIELD NOTES</p>
            <h2 class="h-chapter-title">THE ONES THAT EARNED A NAME</h2>
          </div>
          <p class="h-chapter-strap">
            Chosen by hand. Everything else stays private.
          </p>
        </div>
        <EpicActivities activities={data.featuredActivities} />
      </div>
    </section>
  {/if}

  <footer class="h-footer">
    <p class="h-footer-mark">STRANGE RAMBLINGS · /HEALTH</p>
    <div class="h-footer-right">
      <button type="button" class="h-method-btn" onclick={() => openEvidence('')}>
        How these numbers are computed
      </button>
      <p class="h-disclaimer">Not medical advice · Whoop, Apple Health, Strava</p>
    </div>
  </footer>
</div>

<MethodologyDrawer
  open={evidenceOpen}
  focusId={evidenceFocus}
  onclose={() => (evidenceOpen = false)}
/>
{/if}

<style>
  /* The design system's only sanctioned shadow is the live dot's --accent-glow.
     Leaflet brings its own on every map control, popup and attribution box, and
     they are the one thing on this page that reads as raised. */
  .h-root :global(.leaflet-control),
  .h-root :global(.leaflet-bar),
  .h-root :global(.leaflet-popup-content-wrapper),
  .h-root :global(.leaflet-popup-tip),
  .h-root :global(.leaflet-control-attribution) {
    box-shadow: none;
  }

  .h-root {
    min-height: 100vh;
    background: var(--bg);
    color: var(--text-primary);
    font-family: var(--font-body);
    position: relative;
    overflow-x: hidden;
  }

  .h-provenance {
    margin: 0;
    padding: 10px 32px;
    background: var(--warn-bg);
    border-bottom: 1px solid var(--warn-border);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--warn);
  }

  /* A chapter, not a section: the numbered rule at the top and the generous
     foot are what make the page read as one document with parts rather than a
     stack of independent panels. */
  .h-chapter {
    padding: 64px 32px 72px;
    border-bottom: 1px solid var(--line-hair);
  }
  .h-chapter.tinted {
    background: var(--surface-sunken);
  }
  .h-chapter-inner {
    max-width: 1480px;
    margin: 0 auto;
  }
  .h-chapter-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 24px;
    gap: 24px;
    flex-wrap: wrap;
  }
  .h-chapter-title {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 44px;
    text-transform: uppercase;
    letter-spacing: -0.02em;
    line-height: 0.95;
    margin: 0;
    color: var(--text-primary);
  }
  .h-chapter-num {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.18em;
    color: var(--accent);
    margin: 0 0 10px 0;
    text-transform: uppercase;
  }
  .h-chapter-strap {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0;
    max-width: 340px;
    text-align: right;
  }
  .h-after-hero {
    margin-top: 28px;
  }

  /* A block WITHIN a chapter. One step down in the hierarchy — a heading in the
     body face, not the display face — so it reads as part of the argument
     rather than as another dashboard starting. */
  .h-sub {
    margin-top: 44px;
  }
  .h-sub-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 20px;
    flex-wrap: wrap;
    margin-bottom: 18px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--line-hair);
  }
  .h-sub-title {
    font-family: var(--font-body);
    font-weight: 500;
    font-size: var(--fs-body-lg);
    letter-spacing: 0;
    text-transform: none;
    margin: 0;
    color: var(--text-primary);
  }
  .h-sub-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    color: var(--text-ghost);
    margin: 0;
    text-align: right;
  }

  .h-annot-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    margin-top: 20px;
  }
  @media (max-width: 900px) {
    .h-annot-grid {
      grid-template-columns: 1fr;
    }
  }
  .h-annot {
    border-left: 3px solid var(--accent);
    padding: 8px 14px;
    background: var(--accent-tint-04);
  }
  .h-annot-when {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 4px 0;
  }
  .h-annot-text {
    font-size: var(--fs-nav);
    line-height: 1.5;
    margin: 0;
    color: var(--text-primary);
  }
  .h-annot-text :global(em) {
    font-style: italic;
    color: var(--text-secondary);
  }

  .h-footer {
    padding: 40px 32px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 20px;
  }
  .h-footer-mark {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: var(--fs-nav);
    text-transform: uppercase;
    letter-spacing: -0.02em;
    color: var(--text-ghost);
    margin: 0;
  }
  .h-footer-right {
    display: flex;
    align-items: center;
    gap: 18px;
    flex-wrap: wrap;
  }
  .h-method-btn {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
    background: transparent;
    border: 1px solid var(--line-strong);
    padding: 6px 14px;
    cursor: pointer;
    transition:
      color 0.18s,
      border-color 0.18s;
  }
  .h-method-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
  .h-disclaimer {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0;
  }

  .h-sync-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
  }
  .h-sync-meta.stale {
    color: var(--warn);
  }
  .h-pulse-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: var(--accent-glow);
    animation: sr-pulse 1.5s ease-in-out infinite;
    display: inline-block;
    margin-right: 8px;
  }
  .h-pulse-dot.stale {
    background: var(--warn);
    box-shadow: none;
    animation: none;
  }
  @keyframes sr-pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.5;
      transform: scale(1.25);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .h-pulse-dot {
      animation: none;
    }
  }

  @media (max-width: 720px) {
    .h-chapter {
      padding: 40px 16px 44px;
    }
    .h-chapter-title {
      font-size: 30px;
    }
    .h-chapter-strap {
      text-align: left;
    }
    .h-sub {
      margin-top: 32px;
    }
    .h-sub-meta {
      text-align: left;
    }
    .h-footer {
      padding: 28px 16px;
    }
    .h-provenance {
      padding-left: 16px;
      padding-right: 16px;
    }
  }
</style>
