<script lang="ts">
  // The owner's /health/segments/[id] — seven sections read top to bottom.
  //
  //   01  Identity     the name, the descriptor, five figures
  //   02  Ground       the trace, the profile, the gradient bands
  //   03  Form         direction, gap, staleness, gettable — and every effort
  //   04  Board        ranked four ways, ties sharing a rank
  //   05  Record       when the PB last moved, and the weather it moved in
  //   06  Comparable   what else looks like this, and what else costs the same
  //   07  Attempt      what would actually take it
  //
  // SECTIONS 04–07 ARE CONDITIONAL and each collapses whole. Ground covered
  // twice has no form read, no record shape and no attempt worth printing, and
  // a fixed seven-section layout would render those as frames full of em
  // dashes. The two that always exist are the identity and the ground.
  //
  // Nothing here re-derives what the loader decided: `form`, `bests`,
  // `conditions`, the similar-segment lists and the gradient bands all arrive
  // computed. What happens in this file is layout.
  import HealthShell from './HealthShell.svelte';
  import SectionHead from './SectionHead.svelte';
  import SegmentIdentity from './SegmentIdentity.svelte';
  import SegmentGround from './SegmentGround.svelte';
  import SegmentFormSection from './SegmentFormSection.svelte';
  import SegmentBoard from './SegmentBoard.svelte';
  import SegmentRecord from './SegmentRecord.svelte';
  import {
    attempt,
    climbMetric,
    comparableVerb,
    efficiencyDeltaPct,
    efficiencyMetric,
    matchedSpan,
    profileGeometry,
  } from '$lib/health/segment-detail';
  import type { SegmentDetail, SimilarSegments } from '$lib/trails/segments-service';
  import type { GradientBands } from '$lib/trails/segments/gradient-bands';

  interface Props {
    segment: SegmentDetail;
    similar: SimilarSegments;
    gradientBands: GradientBands | null;
  }

  let { segment, similar, gradientBands }: Props = $props();

  // ONE clock for the page. Staleness, the flat stretch and "13d ago" all read
  // it, and three of them calling `Date.now()` separately is how a page ends up
  // disagreeing with itself across a midnight boundary.
  const nowS = Math.floor(Date.now() / 1000);

  const profile = $derived(profileGeometry(segment.coordinates));
  const plan = $derived(attempt(segment, profile, nowS));
  const span = $derived(matchedSpan(segment.efforts));

  const refEf = $derived(segment.bests.efficiencyFactor);
  const hasSimilar = $derived(similar.byClimb.length > 0 || similar.byEfficiency.length > 0);
</script>

<HealthShell
  path="/health/segments"
  maxWidth={1400}
  nav={[
    { href: '/health/segments', label: '← All segments' },
    { href: '/health', label: 'Dashboard', muted: true },
    { href: '/health/activities', label: 'Activities', muted: true },
  ]}
  live="Segment #{segment.id}"
  meta={[
    `${segment.effortCount} effort${segment.effortCount === 1 ? '' : 's'}${span ? ` · matched ${span}` : ''}`,
  ]}
  footer={[
    `strangeramblings.com/health/segments/${segment.id}`,
    'Owner-gated · a GPS trace starts at the front door',
    'Advisory only · not medical advice',
  ]}
>
  <SegmentIdentity {segment} {nowS} />

  <SegmentGround {segment} bands={gradientBands} />

  <SegmentFormSection {segment} {nowS} />

  <SegmentBoard {segment} />

  <SegmentRecord {segment} {nowS} />

  {#if hasSimilar}
    <section class="sc">
      <div class="sc-inner">
        <SectionHead
          kicker="06 / Comparable ground"
          title={['What else', `${comparableVerb(segment.terrain)} like this`]}
          strap="Two ways to put this stretch beside the others. Looks the same is nearest in gradient and length. Costs the same is nearest in efficiency, whatever it looks like on the map."
        />

        <div class="sc-cards">
          {#if similar.byClimb.length}
            <div class="sc-card">
              <p class="sc-card-label">
                Looks the same <span class="sc-card-sub">· gradient &amp; length</span>
              </p>
              <div class="sc-rows">
                {#each similar.byClimb as entry, i (entry.row.id)}
                  {@const delta = efficiencyDeltaPct(entry.row.bests.efficiencyFactor, refEf)}
                  <a
                    class="sc-row"
                    class:last={i === similar.byClimb.length - 1}
                    href="/health/segments/{entry.row.id}"
                  >
                    <span class="sc-name"
                      >{#each entry.row.name.split('.') as part, k (k)}{#if k > 0}<span
                            class="sc-dot">.</span
                          >{/if}{part}{/each}</span
                    >
                    <span class="sc-metric">
                      {climbMetric(entry.row)}{#if delta != null}{' '}<span
                          class="sc-delta"
                          class:worse={delta < 0}
                          >{delta > 0 ? '+' : '−'}{Math.abs(delta).toFixed(1)}%</span
                        >{/if}
                    </span>
                  </a>
                {/each}
              </div>
              <!-- The delta clause only exists when there IS a delta: outside
                   the pace sports every efficiency on the row is null, and a
                   sentence pointing at a figure that is not there is worse than
                   a shorter sentence. -->
              <p class="sc-note">
                If your efficiency here beats your efficiency there, that is fitness on this ground —
                not the hill being kinder.{#if refEf != null}{' '}The last figure is each segment's
                  best efficiency against this one's {refEf.toFixed(2)}.{/if}
              </p>
            </div>
          {/if}

          {#if similar.byEfficiency.length}
            <div class="sc-card">
              <p class="sc-card-label">
                Costs the same <span class="sc-card-sub">· best efficiency</span>
              </p>
              <div class="sc-rows">
                {#each similar.byEfficiency as entry, i (entry.row.id)}
                  {@const delta = efficiencyDeltaPct(entry.row.bests.efficiencyFactor, refEf)}
                  <a
                    class="sc-row"
                    class:last={i === similar.byEfficiency.length - 1}
                    href="/health/segments/{entry.row.id}"
                  >
                    <span class="sc-name"
                      >{#each entry.row.name.split('.') as part, k (k)}{#if k > 0}<span
                            class="sc-dot">.</span
                          >{/if}{part}{/each}</span
                    >
                    <span class="sc-metric">
                      {efficiencyMetric(entry.row)}{#if delta != null}{' '}<span
                          class="sc-delta"
                          class:worse={delta < 0}
                          >{delta > 0 ? '+' : '−'}{Math.abs(delta).toFixed(1)}%</span
                        >{/if}
                    </span>
                  </a>
                {/each}
              </div>
              <p class="sc-note">
                Ground you cover at a similar cost per beat. Same citation as the whole-workout
                number, so a segment's efficiency and an activity's are comparable — and both are
                pace-sport only.
              </p>
            </div>
          {/if}
        </div>
      </div>
    </section>
  {/if}

  {#if plan}
    <section class="sa">
      <div class="sa-inner">
        <div class="sa-left">
          <p class="sa-kicker">07 / What would take it</p>
          <h2 class="sa-title">
            {#each plan.headline as line, i (i)}{#if i > 0}<br />{/if}{line}{/each}
          </h2>
          <p class="sa-lede">{plan.lede}</p>
        </div>
        <div class="sa-card">
          <p class="sa-card-label">The attempt</p>
          <div class="sa-rows">
            {#each plan.rows as row (row.label)}
              <div class="sa-row">
                <p class="sa-row-label">{row.label}</p>
                <p class="sa-row-text">{row.text}</p>
              </div>
            {/each}
          </div>
        </div>
      </div>
    </section>
  {/if}
</HealthShell>

<style>
  /* ——— 06 comparable ground ——— */

  .sc {
    padding: clamp(40px, 5vw, 68px) clamp(20px, 3vw, 44px);
    border-bottom: 2px solid var(--line);
  }
  .sc-inner {
    max-width: 1400px;
    margin: 0 auto;
  }

  .sc-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: clamp(18px, 2.2vw, 28px);
  }
  .sc-card {
    border: 1px solid var(--card-border);
    border-radius: 0;
    padding: clamp(18px, 2.2vw, 26px);
    min-width: 0;
  }
  .sc-card-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    margin: 0 0 18px;
  }
  .sc-card-sub {
    color: var(--text-ghost);
  }

  .sc-rows {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  /* THE METRIC SPAN MUST BE ALLOWED ITS OWN LINE. It is `white-space: nowrap`,
     so between roughly 700 and 1050px — where the two cards are still side by
     side but neither is wide — a non-wrapping row overflows the card. The wrap
     drops the metric under the name instead. */
  .sc-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    flex-wrap: wrap;
    column-gap: 14px;
    row-gap: 6px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--line);
    color: var(--text-primary);
    text-decoration: none;
    transition: color 0.2s ease-out;
  }
  .sc-row.last {
    padding-bottom: 0;
    border-bottom: none;
  }
  .sc-row:hover {
    color: var(--accent);
  }

  .sc-name {
    font-family: var(--font-brand);
    font-size: var(--fs-body-sm);
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
    min-width: 0;
  }
  .sc-dot {
    color: var(--accent);
  }
  .sc-metric {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    white-space: nowrap;
  }
  .sc-delta {
    color: var(--good);
  }
  .sc-delta.worse {
    color: var(--accent);
  }

  .sc-note {
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-muted);
    text-wrap: pretty;
    margin: 18px 0 0;
  }

  /* ——— 07 what would take it ——— */

  .sa {
    padding: clamp(40px, 5vw, 68px) clamp(20px, 3vw, 44px);
    background: var(--bg-section);
  }
  .sa-inner {
    max-width: 1400px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: clamp(28px, 3.5vw, 60px);
    align-items: start;
  }
  @media (max-width: 860px) {
    .sa-inner {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .sa-left {
    min-width: 0;
  }

  .sa-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-secondary);
    margin: 0 0 18px;
  }
  .sa-title {
    font-family: var(--font-display);
    font-size: clamp(28px, 4vw, 54px);
    line-height: 0.92;
    letter-spacing: -0.02em;
    text-transform: uppercase;
    margin: 0 0 22px;
    overflow-wrap: anywhere;
  }
  .sa-lede {
    font-size: var(--fs-body);
    line-height: 1.6;
    color: var(--text-secondary);
    max-width: 54ch;
    text-wrap: pretty;
    margin: 0;
  }

  .sa-card {
    border: 2px solid var(--accent-tint-35);
    border-radius: 0;
    background: var(--accent-tint-08);
    padding: clamp(22px, 2.6vw, 32px);
    min-width: 0;
  }
  .sa-card-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 16px;
  }
  .sa-rows {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .sa-row {
    display: flex;
    align-items: baseline;
    gap: 14px;
  }
  .sa-row-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
    width: 74px;
    flex-shrink: 0;
    margin: 0;
  }
  .sa-row-text {
    font-size: var(--fs-body-sm);
    line-height: 1.5;
    color: var(--text-secondary);
    text-wrap: pretty;
    margin: 0;
    min-width: 0;
  }
  @media (max-width: 520px) {
    .sa-row {
      flex-direction: column;
      gap: 6px;
    }
    .sa-row-label {
      width: auto;
    }
  }
</style>
