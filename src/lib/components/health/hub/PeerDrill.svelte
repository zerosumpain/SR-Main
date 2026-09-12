<script lang="ts">
  // One header figure, opened out against its cohort.
  //
  // The same distribution the hover card draws, at a size where every outing in
  // it is a target: hovering names the one under the pointer, clicking opens it.
  // That is the whole point of the modal — a hover card cannot be clicked into
  // without disappearing, and "which run was that dot" is the question a
  // distribution always provokes.
  //
  // The shell copies `MetricDrill`: backdrop, panel, Escape, click-out. That
  // component is this hub's established way of opening a layer, and a second,
  // differently-behaved one would be a worse answer than a shared shape.
  import { goto } from '$app/navigation';
  import PeerPlot from './PeerPlot.svelte';
  import {
    ordinal,
    peerMetrics,
    peerReading,
    typePlural,
    type PeerPoint,
    type PeerSet,
  } from '$lib/health/activity-peers';

  interface Props {
    /** The metric to open, or null for closed. */
    metricKey: string | null;
    peers: PeerSet | null;
    paceSport: boolean;
    onclose: () => void;
    /** Switch the drill to another metric without closing it. */
    onopen: (key: string) => void;
  }

  let { metricKey, peers, paceSport, onclose, onopen }: Props = $props();

  const metrics = $derived(peerMetrics(paceSport));
  const metric = $derived(metricKey ? (metrics[metricKey] ?? null) : null);
  const reading = $derived(metric ? peerReading(peers, metric) : null);

  /**
   * The other metrics this cohort can actually place, so the reader can walk
   * the header without closing the modal between each figure.
   *
   * Only ones with a reading: offering a chip that opens an empty panel is the
   * same failure as a tile printing a band round a zero struct.
   */
  const siblings = $derived.by(() => {
    if (!peers) return [];
    return Object.values(metrics)
      .filter((m) => m.key !== metricKey && peerReading(peers, m) != null)
      .map((m) => ({ key: m.key, label: m.label }));
  });

  /** The outing under the pointer, named beneath the plot before it is opened. */
  let hovered = $state<PeerPoint | null>(null);

  // A new subject means the old readout described a point on a chart that is no
  // longer on screen.
  $effect(() => {
    void metricKey;
    hovered = null;
  });

  function pick(point: PeerPoint) {
    if (point.subject) {
      // Already here. Closing is the honest response to "go to this one".
      onclose();
      return;
    }
    onclose();
    goto(`/health/activities/${encodeURIComponent(point.id)}`);
  }

  function onkeydown(e: KeyboardEvent) {
    if (metricKey && e.key === 'Escape') onclose();
  }

  /** `2026-08-17` → `17 Aug 2026`. */
  function fullDay(day: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? '');
    if (!m) return day ?? '—';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${+m[3]} ${months[+m[2] - 1]} ${m[1]}`;
  }
</script>

<svelte:window {onkeydown} />

{#if metricKey && metric && reading && peers}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="pd-backdrop" onclick={onclose}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="pd-panel"
      role="dialog"
      aria-modal="true"
      aria-label="{metric.label} against the last {peers.days} days"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="pd-head">
        <div>
          <p class="pd-kicker">
            {peers.days} days · {reading.n}
            {typePlural(peers.activityType)}
          </p>
          <h2 class="pd-title">{metric.label}</h2>
        </div>
        <button type="button" class="pd-close" onclick={onclose}>Close ✕</button>
      </div>

      <div class="pd-figure">
        <p class="pd-value">{reading.value == null ? '—' : metric.format(reading.value)}</p>
        <div class="pd-figure-side">
          {#if reading.percentile != null}
            <p class="pd-pct">{ordinal(Math.round(reading.percentile))} percentile</p>
          {/if}
          <p class="pd-phrase">{reading.phrase}</p>
        </div>
      </div>

      <div class="pd-plot">
        <PeerPlot
          {reading}
          interactive
          radius={4.6}
          onpick={pick}
          onhover={(p) => (hovered = p)}
        />
      </div>

      <!-- The readout keeps its height whether or not anything is under the
           pointer: a strip that appeared and vanished would shunt the plot up
           and down the panel as the pointer crossed it. -->
      <div class="pd-readout" class:on={!!hovered}>
        {#if hovered}
          <span class="pd-ro-name">{hovered.name}</span>
          <span class="pd-ro-day">{fullDay(hovered.day)}</span>
          <span class="pd-ro-value">{metric.format(hovered.value)}</span>
          <span class="pd-ro-go">{hovered.subject ? 'this outing' : 'click to open ↗'}</span>
        {:else}
          <span class="pd-ro-hint">
            Every dot is one {typePlural(peers.activityType).replace(/s$/, '')} — hover to name it,
            click to open it.
          </span>
        {/if}
      </div>

      {#if reading.median != null}
        <p class="pd-note">
          Middle of the {reading.n}: {metric.format(reading.median)}.
          {#if reading.domain.beyondHi || reading.domain.beyondLo}
            The axis is cut short of the extremes so a handful of them cannot flatten the rest;
            the {reading.domain.beyondHi + reading.domain.beyondLo} outside it are drawn as
            chevrons pinned to the edge, and every one of them still counts in the percentile.
          {/if}
          The window is the {peers.days} days ending on this outing's own day, not on today, so an
          older outing is placed among the {typePlural(peers.activityType)} it was actually done
          beside.
        </p>
      {/if}

      {#if siblings.length}
        <section class="pd-sec">
          <p class="pd-sec-head">The rest of the header</p>
          <div class="pd-chips">
            {#each siblings as s (s.key)}
              <button type="button" class="pd-chip" onclick={() => onopen(s.key)}>{s.label}</button>
            {/each}
          </div>
        </section>
      {/if}
    </div>
  </div>
{/if}

<style>
  .pd-backdrop {
    position: fixed;
    inset: 0;
    z-index: 240;
    background: rgba(26, 16, 8, 0.55);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 5vh 20px;
    animation: pd-fade 140ms ease;
  }
  @keyframes pd-fade {
    from {
      opacity: 0;
    }
  }
  .pd-panel {
    width: 100%;
    max-width: 760px;
    max-height: 88vh;
    overflow: auto;
    /* Opaque, never a tint: --card-bg is 7% ink and would show the page through
       the panel. */
    background: var(--bg);
    border: 2px solid var(--line-strong);
    padding: 22px 24px 26px;
    box-sizing: border-box;
  }
  .pd-panel:focus {
    outline: none;
  }

  .pd-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
    border-bottom: 1px solid var(--line-strong);
    padding-bottom: 12px;
  }
  .pd-kicker,
  .pd-sec-head {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0;
  }
  .pd-title {
    font-family: var(--font-display);
    font-size: 26px;
    line-height: 1.05;
    letter-spacing: -0.01em;
    text-transform: uppercase;
    color: var(--text-primary);
    margin: 4px 0 0;
  }
  .pd-close {
    background: none;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    padding: 6px 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-primary);
    cursor: pointer;
    flex: 0 0 auto;
  }
  .pd-close:hover,
  .pd-close:focus-visible {
    border-color: var(--accent);
    color: var(--accent);
  }

  .pd-figure {
    display: flex;
    align-items: baseline;
    gap: 20px;
    flex-wrap: wrap;
    margin-top: 16px;
  }
  .pd-value {
    font-family: var(--font-display);
    font-size: 44px;
    line-height: 0.9;
    letter-spacing: -0.02em;
    color: var(--text-primary);
    margin: 0;
  }
  .pd-figure-side {
    min-width: 0;
  }
  .pd-pct {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0;
  }
  .pd-phrase {
    font-size: var(--fs-body-sm);
    line-height: 1.45;
    color: var(--text-secondary);
    margin: 5px 0 0;
    text-wrap: pretty;
  }

  .pd-plot {
    margin-top: 24px;
  }

  .pd-readout {
    display: flex;
    align-items: baseline;
    gap: 14px;
    flex-wrap: wrap;
    min-height: 22px;
    margin-top: 14px;
    padding: 8px 10px;
    border: 1px solid var(--divider);
    background: var(--bg-section);
  }
  .pd-readout.on {
    border-color: var(--accent-tint-35);
  }
  .pd-ro-name {
    font-size: var(--fs-label);
    font-weight: 500;
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }
  .pd-ro-day,
  .pd-ro-value,
  .pd-ro-go,
  .pd-ro-hint {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .pd-ro-value {
    color: var(--text-primary);
  }
  .pd-ro-go {
    color: var(--accent);
    margin-left: auto;
  }

  .pd-note {
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-muted);
    max-width: 80ch;
    text-wrap: pretty;
    margin: 16px 0 0;
  }

  .pd-sec {
    margin-top: 22px;
    padding-top: 14px;
    border-top: 1px solid var(--divider);
  }
  .pd-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }
  .pd-chip {
    background: none;
    border: 1px solid var(--card-border);
    border-radius: 0;
    padding: 5px 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
    cursor: pointer;
  }
  .pd-chip:hover,
  .pd-chip:focus-visible {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
