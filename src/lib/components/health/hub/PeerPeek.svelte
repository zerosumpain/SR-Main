<script lang="ts">
  // The one hover card for the activity header.
  //
  // It answers the question every figure in that dark strip begs and none of
  // them can answer alone: is that a lot? The frame is the same-sport cohort
  // from the ninety days ending on this outing's own day, and the card shows
  // where in it this outing landed.
  //
  // ONE CARD FOR THE WHOLE HEADER, mounted once by the page — twelve cells
  // would otherwise be twelve idle popovers. It shares `metricPeek` with the
  // hub's own card for the same reason: one floating layer open at a time is an
  // invariant, not a coincidence.
  //
  // ON PAPER, ALWAYS, even though every cell that opens it sits on ink. The
  // site's other floating layers — the hub dropdown, ActivityStrip, MetricPeek
  // — are all paper, because a layer that changed register depending on what
  // was underneath would read as two different components.
  import PeerPlot from './PeerPlot.svelte';
  import { metricPeek, peekPlacement } from '$lib/health/metric-peek.svelte';
  import {
    ordinal,
    peerMetrics,
    peerReading,
    typePlural,
    type PeerSet,
  } from '$lib/health/activity-peers';

  interface Props {
    peers: PeerSet | null;
    paceSport: boolean;
    /** Opens the drill for a metric. Absent hides the affordance. */
    onopen?: (key: string) => void;
  }

  let { peers, paceSport, onopen }: Props = $props();

  const WIDTH = 340;

  const anchor = $derived(metricPeek.current);
  const metrics = $derived(peerMetrics(paceSport));
  const metric = $derived(anchor ? (metrics[anchor.metricId] ?? null) : null);
  const reading = $derived(metric ? peerReading(peers, metric) : null);

  // Measured once the card exists; until then `placePopover` uses its estimate.
  // A plain `let` would not re-place the card when the height lands, so this one
  // IS state — unlike the controller's timers, which nothing reactive reads.
  let cardEl: HTMLDivElement | null = $state(null);
  let measured = $state(0);

  $effect(() => {
    void anchor?.metricId;
    if (!cardEl) return;
    const h = cardEl.getBoundingClientRect().height;
    if (h && Math.abs(h - measured) > 1) measured = h;
  });

  const placement = $derived(
    anchor ? peekPlacement(anchor.rect, measured || 240) : null,
  );

  /** `2026-08-17` → `17 Aug`. The year is the one on the header above it. */
  function shortDay(day: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? '');
    if (!m) return day ?? '—';
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${+m[3]} ${months[+m[2] - 1]}`;
  }

  function onkeydown(e: KeyboardEvent) {
    if (metricPeek.current && e.key === 'Escape') metricPeek.close();
  }

  /**
   * A scroll dismisses the card — the same rule `MetricPeek` follows.
   *
   * The anchor rect is captured in viewport coordinates when the card OPENS, so
   * the moment the page moves the card is pointing at whatever scrolled into
   * that spot. A wheel scroll moves no pointer, so no `mouseout` fires and
   * nothing else would take it down.
   */
  function onscroll() {
    if (metricPeek.current) metricPeek.close();
  }
</script>

<svelte:window {onkeydown} {onscroll} />

{#if anchor && metric && reading && placement}
  <!-- Not a dialog: it describes the thing under the pointer, and trapping
       focus in it would make a hover card a modal. `role="tooltip"` with the
       pointer handlers is what lets the pointer travel into it. -->
  <div
    bind:this={cardEl}
    class="pk"
    role="tooltip"
    style="left: {placement.left}px; top: {placement.top}px; width: {WIDTH}px; max-height: {placement.maxHeight}px;"
    onmouseenter={() => metricPeek.keepOpen()}
    onmouseleave={() => metricPeek.release()}
  >
    <div class="pk-head">
      <p class="pk-name">{metric.label}</p>
      <p class="pk-window">{reading.n}&nbsp;{typePlural(peers!.activityType)}</p>
    </div>

    <div class="pk-figure">
      <p class="pk-value">
        {reading.value == null ? '—' : metric.format(reading.value)}
      </p>
      {#if reading.percentile != null}
        <p class="pk-pct">{ordinal(Math.round(reading.percentile))}<span>pctile</span></p>
      {/if}
    </div>

    <p class="pk-phrase">{reading.phrase}</p>

    <div class="pk-plot">
      <PeerPlot {reading} />
    </div>

    <div class="pk-foot">
      <span class="pk-cite">{peers!.days} days to {shortDay(peers!.to)}</span>
      {#if onopen}
        <button type="button" class="pk-open" onclick={() => onopen?.(metric.key)}>
          Open ↗
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .pk {
    position: fixed;
    z-index: 220;
    overflow-y: auto;
    background: var(--bg);
    border: 1px solid var(--line-strong);
    padding: 14px 16px 12px;
    box-sizing: border-box;
    /* The one shadow on this page — a floating layer over an editorial document
       has to read as ABOVE it, and a hairline alone does not do that on a cream
       ground it shares a value with. */
    box-shadow: 0 8px 28px rgba(26, 16, 8, 0.18);
  }

  .pk-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 10px;
  }
  .pk-name,
  .pk-window {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    margin: 0;
  }
  .pk-name {
    color: var(--text-primary);
  }
  .pk-window {
    color: var(--text-ghost);
    white-space: nowrap;
  }

  .pk-figure {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .pk-value {
    font-family: var(--font-display);
    font-size: 28px;
    line-height: 0.95;
    letter-spacing: -0.02em;
    color: var(--text-primary);
    margin: 0;
  }
  .pk-pct {
    font-family: var(--font-display);
    font-size: 22px;
    line-height: 0.95;
    letter-spacing: -0.02em;
    color: var(--accent);
    margin: 0;
    white-space: nowrap;
  }
  .pk-pct span {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin-left: 4px;
  }

  .pk-phrase {
    font-size: var(--fs-label);
    line-height: 1.45;
    color: var(--text-secondary);
    margin: 8px 0 0;
    text-wrap: pretty;
  }

  .pk-plot {
    margin-top: 14px;
  }

  .pk-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--divider);
  }
  .pk-cite {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  .pk-open {
    background: none;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    padding: 5px 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-primary);
    cursor: pointer;
    margin-left: auto;
  }
  .pk-open:hover,
  .pk-open:focus-visible {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
