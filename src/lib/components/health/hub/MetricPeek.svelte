<script lang="ts">
  // The one hover card for the whole hub.
  //
  // It answers the three questions a figure on this page cannot answer for
  // itself without becoming a paragraph: what IS this, what would move it, and
  // where does today's number sit on its own ladder.
  //
  // ON PAPER, ALWAYS. It floats over an alternating dark/light document, and
  // the site's other floating layers — the hub dropdown, ActivityStrip — are
  // all paper for the same reason: a layer that changed register depending on
  // what was underneath would read as two different components. So it sets its
  // own colours and never inherits the band's.
  //
  // NOTHING HERE IS A SECOND OPINION. The value comes from the same reading the
  // tile printed, and an UNREADABLE metric shows the sentence saying what it
  // needs rather than a band drawn round a zero struct.
  import { metricPeek, peekPlacement, PEEK_WIDTH } from '$lib/health/metric-peek.svelte';
  import {
    bandFor,
    metricDescriptor,
    methodologyFor,
    type MetricBand,
  } from '$lib/health/metric-registry';
  import type { MetricReading } from '$lib/health/metric-readings';

  interface Props {
    readings: Record<string, MetricReading>;
    /** Opens the full drill for a metric. Absent hides the "open" affordance. */
    onopen?: (id: string) => void;
  }

  let { readings, onopen }: Props = $props();

  const anchor = $derived(metricPeek.current);
  const descriptor = $derived(anchor ? metricDescriptor(anchor.metricId) : null);
  const reading = $derived(anchor ? (readings[anchor.metricId] ?? null) : null);

  const value = $derived(reading?.readable ? reading.value : null);
  const band = $derived(descriptor ? bandFor(descriptor, value) : null);
  const method = $derived(descriptor ? methodologyFor(descriptor) : null);

  // Measured after the card exists; until then `placePopover` uses its own
  // estimate. A plain `let` would not re-place the card when the height lands,
  // so this one IS state — unlike the timers in the controller, which nothing
  // reactive reads.
  let cardEl: HTMLDivElement | null = $state(null);
  let measured = $state(0);

  $effect(() => {
    // Re-measure whenever the card's subject changes.
    void anchor?.metricId;
    if (!cardEl) return;
    const h = cardEl.getBoundingClientRect().height;
    if (h && Math.abs(h - measured) > 1) measured = h;
  });

  const placement = $derived(anchor ? peekPlacement(anchor.rect, measured || 260) : null);

  function formatted(v: number, dp: number): string {
    return dp === 0 ? String(Math.round(v)) : v.toFixed(dp);
  }

  /** The ladder edge as a reader would say it: "0.8–1.3", "under 40", "55+". */
  function bandRange(b: MetricBand): string {
    if (b.from == null && b.to == null) return '';
    if (b.from == null) return `under ${b.to}`;
    if (b.to == null) return `${b.from}+`;
    return `${b.from}–${b.to}`;
  }

  function onkeydown(e: KeyboardEvent) {
    if (metricPeek.current && e.key === 'Escape') metricPeek.close();
  }
</script>

<svelte:window {onkeydown} />

{#if anchor && descriptor && placement}
  <!-- Not a dialog: it is a description of the thing under the pointer, and
       trapping focus in it would make a hover card a modal. `role="tooltip"`
       with the pointer handlers is what lets the pointer travel into it. -->
  <div
    bind:this={cardEl}
    class="mp"
    role="tooltip"
    style="left: {placement.left}px; top: {placement.top}px; width: {PEEK_WIDTH}px; max-height: {placement.maxHeight}px;"
    onmouseenter={() => metricPeek.keepOpen()}
    onmouseleave={() => metricPeek.release()}
  >
    <div class="mp-head">
      <p class="mp-name">{descriptor.label}</p>
      <p class="mp-window">{descriptor.window}</p>
    </div>

    {#if reading?.readable && value != null}
      <p class="mp-value">
        {formatted(value, descriptor.dp)}{#if descriptor.unit}<span class="mp-unit"
            >{descriptor.unit}</span
          >{/if}
      </p>
      {#if band}
        <p class="mp-band tone-{band.tone}">{band.label}</p>
      {/if}
      {#if reading.baseline != null && reading.baselineLabel}
        <p class="mp-baseline">
          Against {formatted(reading.baseline, descriptor.dp)} — {reading.baselineLabel}
        </p>
      {/if}
    {:else}
      <!-- The zero-struct guard, made visible. An insufficient analytic hands
           back a confident struct of noughts; printing it here as a band would
           be the page's worst failure mode in its smallest component. -->
      <p class="mp-value mp-empty">—</p>
      <p class="mp-needs">{reading?.needs ?? 'No reading yet.'}</p>
    {/if}

    <p class="mp-what">{descriptor.what}</p>
    <p class="mp-moves"><span class="mp-moves-label">Moves it</span> {descriptor.moves}</p>

    {#if descriptor.bands.length}
      <div class="mp-ladder">
        {#each descriptor.bands as b (b.label)}
          <div class="mp-rung" class:on={band === b}>
            <span class="mp-rung-range">{bandRange(b)}</span>
            <span class="mp-rung-label tone-{b.tone}">{b.label}</span>
          </div>
        {/each}
      </div>
    {/if}

    <div class="mp-foot">
      {#if method}
        <span class="mp-cite">{method.cite}</span>
      {/if}
      {#if onopen}
        <button type="button" class="mp-open" onclick={() => onopen?.(descriptor.id)}>
          Open the drill →
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .mp {
    position: fixed;
    z-index: 220;
    overflow-y: auto;
    background: var(--bg);
    border: 1px solid var(--line-strong);
    padding: 14px 16px 12px;
    box-sizing: border-box;
    /* The one shadow on this page. A floating layer over an editorial document
       needs to read as ABOVE it, and a hairline alone does not do that on a
       cream ground it shares a value with. */
    box-shadow: 0 8px 28px rgba(26, 16, 8, 0.18);
  }

  .mp-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
  }
  .mp-name,
  .mp-window {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    margin: 0;
  }
  .mp-name {
    color: var(--text-primary);
  }
  .mp-window {
    color: var(--text-ghost);
    white-space: nowrap;
  }

  .mp-value {
    font-family: var(--font-display);
    font-size: 30px;
    line-height: 0.95;
    letter-spacing: -0.02em;
    color: var(--text-primary);
    margin: 0;
  }
  .mp-value.mp-empty {
    color: var(--text-ghost);
  }
  .mp-unit {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin-left: 3px;
  }

  .mp-band {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin: 6px 0 0;
  }
  .mp-needs,
  .mp-baseline {
    font-size: var(--fs-label);
    line-height: 1.45;
    color: var(--text-muted);
    margin: 6px 0 0;
  }

  .mp-what {
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-secondary);
    margin: 12px 0 0;
    text-wrap: pretty;
  }
  .mp-moves {
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-muted);
    margin: 8px 0 0;
    text-wrap: pretty;
  }
  .mp-moves-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin-right: 4px;
  }

  .mp-ladder {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-top: 12px;
    background: var(--divider);
    border: 1px solid var(--divider);
  }
  .mp-rung {
    display: flex;
    align-items: baseline;
    gap: 8px;
    background: var(--bg);
    padding: 5px 8px;
  }
  /* The band today's value is actually in. A tint rather than a fill, so the
     ladder still reads as a scale and not as five buttons. */
  .mp-rung.on {
    background: var(--accent-tint-08);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .mp-rung-range {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    color: var(--text-ghost);
    min-width: 62px;
    flex: 0 0 auto;
  }
  .mp-rung-label {
    font-size: var(--fs-label);
    line-height: 1.35;
    color: var(--text-muted);
  }

  .mp-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--divider);
  }
  .mp-cite {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  .mp-open {
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
  .mp-open:hover,
  .mp-open:focus-visible {
    border-color: var(--accent);
    color: var(--accent);
  }

  /* The three tones, on PAPER — this layer never sits on the ink band even when
     the figure that opened it does. `--accent-ink` is the counter-accent and
     carries "neutral" here so that plain and good are separable without pairing
     --accent with --good, which fails colourblind separation. */
  .tone-good {
    color: var(--good);
  }
  .tone-plain {
    color: var(--accent-ink);
  }
  .tone-warn {
    color: var(--accent);
  }
</style>
