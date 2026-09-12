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
  //
  // EVERY FIGURE IS A NUMBER WITH NO FRAME, which is what the cohort cards fix:
  // a cell whose metric the ninety-day cohort can place becomes a BUTTON that
  // opens the card on hover and the drill on click. The markup barely moves —
  // the cell carries one attribute, `data-peer="distance"`, and the grid spreads
  // the delegated handlers it already needed no listeners for. Twelve cells with
  // four listeners each would be forty-eight listeners for one floating card.
  //
  // A button restored to the div it replaced: `display:block; width:100%;
  // text-align:left; font:inherit; color:inherit; border-radius:0`. The look
  // does not move; only the semantics do.
  import type { ActivityDetail } from '$lib/trails/activities-service';
  import type { ActivityPhysio } from '$lib/trails/physio-service';
  import { activityLabel, isPaceSport } from '$lib/trails/format';
  import { fullLocalDate, heroStats } from '$lib/health/activity-detail';
  import { metricPeek, metricPeekHandlers } from '$lib/health/metric-peek.svelte';
  import { peerMetrics, peerReading, type PeerSet } from '$lib/health/activity-peers';

  interface Props {
    activity: ActivityDetail;
    physio: ActivityPhysio | null;
    /** The ninety-day cohort. Null means the header renders as it always did. */
    peers?: PeerSet | null;
    /** Opens the drill. Absent leaves the cells inert. */
    onopen?: (key: string) => void;
  }

  let { activity, physio, peers = null, onopen }: Props = $props();

  const stats = $derived(heroStats(activity, physio));
  const dateLine = $derived(
    fullLocalDate(activity.startDateLocal, activity.startDate, activity.timezone),
  );

  const paceSport = $derived(isPaceSport(activity.activityType));
  const metrics = $derived(peerMetrics(paceSport));

  /**
   * Which cells can be opened.
   *
   * A cell opts in only when the cohort actually has a reading for it —
   * `peerReading` returns null when not one outing in the window carries the
   * metric — so a button never opens an empty card.
   */
  const openable = $derived.by(() => {
    const set = new Set<string>();
    if (!peers || !onopen) return set;
    for (const cell of stats) {
      const metric = metrics[cell.key];
      if (metric && peerReading(peers, metric)) set.add(cell.key);
    }
    return set;
  });

  const handlers = $derived(metricPeekHandlers('data-peer'));
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

    <div class="ah-cells" {...handlers}>
      {#each stats as cell (cell.key)}
        {#if openable.has(cell.key)}
          <button
            type="button"
            class="ah-cell open"
            data-peer={cell.key}
            onclick={() => {
              // The click focused the cell, which pinned the hover card. Leaving
              // it open would park a tooltip behind the modal and still be there
              // when the modal closes.
              metricPeek.close();
              onopen?.(cell.key);
            }}
          >
            <p class="ah-value" class:lit={cell.lit}>
              {cell.value}{#if cell.unit}<span class="ah-unit">{cell.unit}</span>{/if}
            </p>
            <p class="ah-label">{cell.label}<span class="ah-mark" aria-hidden="true">↗</span></p>
          </button>
        {:else}
          <div class="ah-cell">
            <p class="ah-value" class:lit={cell.lit}>
              {cell.value}{#if cell.unit}<span class="ah-unit">{cell.unit}</span>{/if}
            </p>
            <p class="ah-label">{cell.label}</p>
          </div>
        {/if}
      {/each}
    </div>

    {#if openable.size}
      <p class="ah-hint">
        Hover a lit figure for its ninety-day cohort · click to open the distribution
      </p>
    {/if}
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

  /* The button, restored to the div it replaced. */
  .ah-cell.open {
    display: block;
    width: 100%;
    text-align: left;
    font: inherit;
    color: inherit;
    border: none;
    cursor: pointer;
    transition: outline-color 0.16s ease-out;
  }
  .ah-cell.open:hover,
  .ah-cell.open:focus-visible {
    outline: 1px solid var(--accent-on-dark);
  }
  .ah-cell.open:hover .ah-label,
  .ah-cell.open:focus-visible .ah-label {
    color: var(--accent-on-dark);
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
    transition: color 0.16s ease-out;
  }

  /* The affordance: one ghosted mark that says the cell goes somewhere, rather
     than a second colour or a border the grid's hairlines would fight. */
  .ah-mark {
    margin-left: 6px;
    color: rgba(237, 228, 212, 0.3);
  }
  .ah-cell.open:hover .ah-mark,
  .ah-cell.open:focus-visible .ah-mark {
    color: var(--accent-on-dark);
  }

  .ah-hint {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.45);
    margin: 16px 0 0;
  }
</style>
