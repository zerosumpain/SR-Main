<script lang="ts">
  // 04 — READING THE TABLE. Four columns whose rules are decisions already
  // made in the code, printed beside the table that applies them.
  //
  // A column whose rules are invisible is a column you will misread: EF is
  // blank on a ride on purpose, a zero in SEGS is an exclusion and not an
  // absence, and a struck-through type is a correction rather than bad data.
  //
  // The EF card carries a PROPOSED REFINEMENT, marked as one. It is page copy
  // and nothing more — sorting by EF still sorts the single mixed column, and
  // this build deliberately does not change that (spec decision 4).
  import SectionHead from './SectionHead.svelte';

  interface Props {
    /** The corpus the ranks were computed over — all of it, never the page. */
    corpusCount: number;
  }

  let { corpusCount }: Props = $props();

  const counted = $derived(corpusCount.toLocaleString('en-GB'));
</script>

<section class="rt">
  <div class="rt-inner">
    <SectionHead
      kicker="04 / Reading the table"
      title={['Four columns that', "lie if you don't ask"]}
      strap="Every one of these is a decision already made in the code. They belong on the page, because a column whose rules are invisible is a column you'll misread."
      strapCh={38}
    />

    <div class="rt-grid">
      <div class="rt-card">
        <p class="rt-label">Type · the correction is visible</p>
        <p class="rt-body">
          A corrected row shows <span class="rt-mono">RIDE</span> with
          <span class="rt-mono struck">WALK</span> struck through: the watch logged it wrong and
          the owner fixed it. Every filter, group-by and total reads the corrected type, so a chip
          can't disagree with the row it filtered — but the source value stays, because a silent
          correction is indistinguishable from bad data.
        </p>
      </div>

      <div class="rt-card">
        <p class="rt-label">EF · blank on wheels by design</p>
        <p class="rt-body">
          Metres per minute per beat, computed only for pace sports. A ride's EF sits near 4
          against a run's 1, so one mixed column would sort into a list of bike rides.
          <span class="rt-proposed">Proposed refinement:</span> the same objection applies inside
          the column — a hike reads 0.39 and a run 1.06, so the sort is really a sport sort. Worth
          splitting by sport, or normalising against each sport's own median.
        </p>
      </div>

      <div class="rt-card">
        <p class="rt-label">Segs · why a row reads zero</p>
        <p class="rt-body">
          Distinct known segments the outing crossed. A row reads zero when the outing is excluded
          from matching entirely — an indoor run has no trace to match, and letting it in would put
          a gym PB on a hillside leaderboard.
        </p>
      </div>

      <div class="rt-card">
        <p class="rt-label">Excellence · four scopes, one per row</p>
        <p class="rt-body">
          Ranks are computed over all {counted} outings, not the page — a "3rd fastest" that only
          considered the rows shown would change every time a filter moved. Each row shows its lead
          highlight only; there are around five per outing.
        </p>
        <div class="rt-scopes">
          <span class="exc-badge scope-activity">Activity</span>
          <span class="exc-badge scope-segment">Segment</span>
          <span class="exc-badge scope-environment">Environment</span>
          <span class="exc-badge scope-rhythm">Rhythm</span>
        </div>
      </div>
    </div>
  </div>
</section>

<style>
  .rt {
    padding: clamp(36px, 4.4vw, 64px) clamp(20px, 3vw, 44px);
    background: var(--bg-section);
    border-top: 2px solid rgba(26, 16, 8, 0.12);
  }
  .rt-inner {
    max-width: 1500px;
    margin: 0 auto;
  }

  /* Every card carries its own 1px border with a real gap. The gap:1px +
     container-background trick paints unfilled auto-fit tracks as blocks. */
  .rt-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 16px;
  }
  .rt-card {
    border: 1px solid var(--card-border);
    border-radius: 0;
    background: var(--bg);
    padding: 22px;
  }

  .rt-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 14px;
  }
  .rt-body {
    font-size: var(--fs-nav);
    line-height: 1.55;
    color: var(--text-secondary);
    text-wrap: pretty;
    margin: 0;
  }
  .rt-mono {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }
  .rt-mono.struck {
    text-decoration: line-through;
    color: var(--text-muted);
  }
  .rt-proposed {
    color: var(--accent);
  }

  .rt-scopes {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    margin-top: 14px;
  }

  /* The same four badges the EXCELLENCE column draws, at rest. Kept in step
     with .exc-badge in ActivityLedger.svelte — scope is the only thing that
     decides how loud a highlight is allowed to be. */
  .exc-badge {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 3px 7px;
    border-radius: 0;
    white-space: nowrap;
  }
  .exc-badge.scope-activity {
    font-weight: 700;
    background: var(--accent);
    color: var(--bg);
  }
  .exc-badge.scope-segment,
  .exc-badge.scope-environment {
    border: 1px solid var(--accent-tint-50);
    color: var(--accent);
  }
  .exc-badge.scope-rhythm {
    border: 1px solid var(--good-line);
    color: var(--good);
  }
</style>
