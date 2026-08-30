<script lang="ts">
  // 01 — HEADER. The dark deck an outing opens on: what it was, when it was,
  // and the twelve figures that describe it.
  //
  // THE CELL COUNT VARIES. Eight cells are always drawn; TRIMP, efficiency,
  // HRR60 and METs only appear when the physiology produced them, so the grid
  // holds between eight and twelve. That rules out the design's literal
  // construction — `gap: 1px` over a container painted in the border colour —
  // because an auto-fit track with no cell in it paints as a visible block, and
  // with a varying count there is always such a track at some width.
  //
  // The hairlines are OUTLINES instead. An outline is drawn outside the border
  // box and takes no layout space, so with `gap: 1px` two neighbours' outlines
  // land in the same one-pixel channel and read as a single hairline, the outer
  // frame comes free off the edge cells, and an empty track draws nothing at
  // all. Same picture, no phantom blocks.
  import type { ActivityDetail } from '$lib/trails/activities-service';
  import type { ActivityPhysio } from '$lib/trails/physio-service';
  import { activityLabel } from '$lib/trails/format';
  import { fullLocalDate, heroStats } from '$lib/health/activity-detail';

  interface Props {
    activity: ActivityDetail;
    physio: ActivityPhysio | null;
  }

  let { activity, physio }: Props = $props();

  const stats = $derived(heroStats(activity, physio));
  const dateLine = $derived(
    fullLocalDate(activity.startDateLocal, activity.startDate, activity.timezone),
  );
</script>

<section class="ah">
  <div class="ah-inner">
    <p class="ah-kicker">
      Health · {activityLabel(activity.activityType)}
      {#if activity.typeOverride}<span class="ah-flag"
          >· corrected from {activityLabel(activity.sourceType)}</span
        >{/if}
      {#if activity.excludedFromSegments}<span class="ah-flag out"
          >· out of segment analysis</span
        >{/if}
    </p>

    <h1 class="ah-title">{activity.name}</h1>
    <p class="ah-date">{dateLine}</p>

    <div class="ah-cells">
      {#each stats as cell (cell.key)}
        <div class="ah-cell">
          <p class="ah-value" class:lit={cell.lit}>
            {cell.value}{#if cell.unit}<span class="ah-unit">{cell.unit}</span>{/if}
          </p>
          <p class="ah-label">{cell.label}</p>
        </div>
      {/each}
    </div>
  </div>
</section>

<style>
  .ah {
    background: var(--text-primary);
    color: var(--bg);
    padding: clamp(30px, 3.6vw, 52px) clamp(20px, 3vw, 44px);
  }
  .ah-inner {
    max-width: 1300px;
    margin: 0 auto;
  }

  .ah-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent-on-dark);
    margin: 0 0 16px;
  }
  .ah-flag {
    color: rgba(237, 228, 212, 0.55);
    margin-left: 6px;
  }
  .ah-flag.out {
    color: var(--bg);
  }

  .ah-title {
    font-family: var(--font-display);
    font-size: clamp(34px, 5.4vw, 76px);
    line-height: 0.9;
    letter-spacing: -0.02em;
    text-transform: uppercase;
    text-wrap: balance;
    overflow-wrap: anywhere;
    margin: 0 0 16px;
  }

  .ah-date {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.06em;
    color: rgba(237, 228, 212, 0.75);
    margin: 0 0 30px;
  }

  .ah-cells {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 1px;
    /* 1px of room for the edge cells' outlines, which draw outside the box. */
    padding: 1px;
  }

  .ah-cell {
    /* See the header comment: outlines, not a container background. */
    outline: 1px solid rgba(237, 228, 212, 0.16);
    outline-offset: 0;
    border-radius: 0;
    background: var(--text-primary);
    padding: 16px 18px;
    min-width: 0;
  }

  .ah-value {
    font-family: var(--font-display);
    font-size: 26px;
    line-height: 0.95;
    letter-spacing: -0.02em;
    margin: 0 0 8px;
    overflow-wrap: anywhere;
  }
  .ah-value.lit {
    color: var(--accent-on-dark);
  }
  .ah-unit {
    font-size: var(--fs-label);
    color: rgba(237, 228, 212, 0.45);
  }

  .ah-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.55);
    margin: 0;
  }
</style>
