<script lang="ts">
  // The drill: one figure, opened out.
  //
  // Three panes, and each exists because the hub could not answer that question
  // without becoming a longer document:
  //
  //   OVER TIME     the series behind the number, against its own baseline
  //   HOW           the formula and the citation, from METHODOLOGY
  //   WHAT IF       the real analytic, re-run in the browser over a load series
  //                 with one session added
  //
  // The chart is `TraceChart` — the component the activity detail page already
  // draws its heart-rate and elevation traces with. Drawing a new one here would
  // put a second chart language on the same site for no reason, and the brief
  // for this work was explicit that the existing charts' look does not change.
  //
  // The shell copies `MethodologyDrawer`: backdrop, panel, Escape, click-out.
  // That component is this page's established way of opening a layer, and a
  // second, differently-behaved drawer would be a worse answer than a shared one.
  import TraceChart from './TraceChart.svelte';
  import {
    bandFor,
    metricDescriptor,
    methodologyFor,
    relatedMetrics,
  } from '$lib/health/metric-registry';
  import type { MetricReading } from '$lib/health/metric-readings';
  import { SESSION_PRESETS, sessionLoad, simulate } from '$lib/health/what-if';
  import type { LoadDay } from '$lib/health/analytics/acwr';

  interface Props {
    /** The metric to open, or null for closed. */
    metricId: string | null;
    readings: Record<string, MetricReading>;
    /** Daily TRIMP — what the what-if pane simulates over. */
    loadDays: LoadDay[];
    onclose: () => void;
    /** Switch the drill to another metric without closing it. */
    onopen: (id: string) => void;
  }

  let { metricId, readings, loadDays, onclose, onopen }: Props = $props();

  const descriptor = $derived(metricId ? metricDescriptor(metricId) : null);
  const reading = $derived(metricId ? (readings[metricId] ?? null) : null);
  const method = $derived(descriptor ? methodologyFor(descriptor) : null);
  const related = $derived(metricId ? relatedMetrics(metricId) : []);

  const value = $derived(reading?.readable ? reading.value : null);
  const band = $derived(descriptor ? bandFor(descriptor, value) : null);

  /**
   * The series as TraceChart wants it: `[x, y]` with x ascending. The x axis is
   * the INDEX rather than a parsed date — the points are already in order and
   * evenly spaced in the reader's mind ("thirty days"), and parsing dates to
   * epoch here would draw the gaps a missing sync leaves as literal horizontal
   * space, which reads as a flat stretch rather than as an absence.
   */
  const points = $derived(
    (reading?.series ?? []).map((p, i) => [i, p.value] as [number, number]),
  );

  const xLabels = $derived.by((): string[] => {
    const s = reading?.series ?? [];
    if (s.length < 2) return [];
    const mid = s[Math.floor(s.length / 2)];
    return [short(s[0].date), short(mid.date), short(s[s.length - 1].date)];
  });

  function short(date: string): string {
    const d = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return date;
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
      .format(d);
  }

  function fmt(v: number | null | undefined, dp: number): string {
    if (v == null || !Number.isFinite(v)) return '—';
    return dp === 0 ? String(Math.round(v)) : v.toFixed(dp);
  }

  /**
   * Decimals for the CHART's y axis, which is not the metric's own.
   *
   * A series is often on a different scale from the figure above it — ACWR is a
   * ratio printed to two places, but the series behind it is daily training
   * load running 0–101. Formatting that axis with the metric's `dp` gave
   * "101.20", which is wider than the 42 user units TraceChart's padded viewBox
   * leaves for a label, so the leading digit was clipped off by the viewport and
   * the axis read "l01.20". The precision therefore comes from the series' own
   * span, not from the descriptor.
   */
  const seriesDp = $derived.by((): number => {
    const values = (reading?.series ?? []).map((p) => p.value);
    if (!values.length) return descriptor?.dp ?? 0;
    const span = Math.max(...values) - Math.min(...values);
    const scale = Math.max(Math.abs(Math.max(...values)), span);
    if (scale >= 20) return 0;
    if (scale >= 2) return 1;
    return 2;
  });

  // ——— the what-if ————————————————————————————————————————————————
  //
  // Offered only where it is honest: `simulate` runs the REAL `computeACWR` and
  // `computeMonotony`, and returns null when the baseline is not readable. So
  // the pane appears when there is something true to show and not otherwise.
  let presetId = $state(SESSION_PRESETS[2].id);
  const preset = $derived(SESSION_PRESETS.find((p) => p.id === presetId) ?? SESSION_PRESETS[2]);
  const sim = $derived(simulate(loadDays, preset));
  /**
   * The two metrics the simulation actually MOVES, and no others.
   *
   * `family === 'load'` was the first cut and it was too wide: it put a WHAT IF
   * pane under Week Volume that then reported ACWR and monotony. Both do move
   * when a session is added, but a reader who opened "week volume" and is shown
   * two other instruments has been answered a question they did not ask. The
   * pane is offered where `simulate` speaks about the metric on screen.
   */
  const SIMULATED = ['acwr', 'monotony'];
  const showWhatIf = $derived(sim != null && SIMULATED.includes(descriptor?.id ?? ''));

  function onkeydown(e: KeyboardEvent) {
    if (metricId && e.key === 'Escape') onclose();
  }

  /** Signed, with the arrow the metric's own direction earns. */
  function delta(before: number, after: number, dp: number, higherIsBetter: boolean) {
    const diff = after - before;
    const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
    const better = diff === 0 ? null : higherIsBetter === diff > 0;
    return { text: `${sign}${Math.abs(diff).toFixed(dp)}`, better };
  }
</script>

<svelte:window {onkeydown} />

{#if metricId && descriptor}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="md-backdrop" onclick={onclose}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="md-panel"
      role="dialog"
      aria-modal="true"
      aria-label="{descriptor.label} — detail"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="md-head">
        <div>
          <p class="md-kicker">{descriptor.window} · {descriptor.family}</p>
          <h2 class="md-title">{descriptor.label}</h2>
        </div>
        <button type="button" class="md-close" onclick={onclose}>Close ✕</button>
      </div>

      <div class="md-figure">
        <p class="md-value">
          {#if reading?.readable && value != null}
            {fmt(value, descriptor.dp)}{#if descriptor.unit}<span class="md-unit"
                >{descriptor.unit}</span
              >{/if}
          {:else}
            <span class="md-empty">—</span>
          {/if}
        </p>
        <div class="md-figure-side">
          {#if band}
            <p class="md-band tone-{band.tone}">{band.label}</p>
          {/if}
          {#if reading?.readable && reading.baseline != null && reading.baselineLabel}
            <p class="md-baseline">
              {reading.baselineLabel}: {fmt(reading.baseline, descriptor.dp)}
            </p>
          {:else if !reading?.readable}
            <p class="md-baseline">{reading?.needs ?? 'No reading yet.'}</p>
          {/if}
        </div>
      </div>

      <p class="md-what">{descriptor.what}</p>
      <p class="md-moves"><span class="md-label">Moves it</span> {descriptor.moves}</p>

      <!-- OVER TIME -->
      <section class="md-sec">
        <p class="md-sec-head">Over time <span class="md-sec-meta">{reading?.seriesLabel}</span></p>
        {#if points.length >= 2}
          <TraceChart
            {points}
            colour="var(--accent)"
            gridlines={3}
            {xLabels}
            average={reading?.baseline ?? null}
            averageLabel={reading?.baselineLabel ?? null}
            yFormat={(v) => fmt(v, seriesDp)}
            label="{descriptor.label} over {reading?.seriesLabel}"
          />
        {:else}
          <!-- A series of one is not a series. Saying so beats drawing a line
               between a point and itself, which is what the old code would do. -->
          <p class="md-none">
            Nothing to plot yet — this needs at least two readings, and the window
            has {points.length === 1 ? 'one' : 'none'}.
          </p>
        {/if}
      </section>

      <!-- WHAT IF -->
      {#if showWhatIf && sim}
        <section class="md-sec">
          <p class="md-sec-head">
            What if <span class="md-sec-meta">a session on {short(sim.day)}</span>
          </p>
          <div class="md-presets">
            {#each SESSION_PRESETS as p (p.id)}
              <button
                type="button"
                class="md-preset"
                class:on={p.id === presetId}
                onclick={() => (presetId = p.id)}
              >
                {p.label}
              </button>
            {/each}
          </div>
          <p class="md-preset-note">
            {preset.note}
            {#if sessionLoad(preset) > 0}
              <span class="md-preset-load">
                {preset.minutes} min × {preset.intensity} = {sessionLoad(preset)} load
              </span>
            {/if}
          </p>

          <div class="md-sim">
            {#if sim.acwr}
              {@const d = delta(sim.acwr.before.ratio, sim.acwr.after.ratio, 2, true)}
              <div class="md-sim-row">
                <span class="md-sim-name">ACWR</span>
                <span class="md-sim-before">{sim.acwr.before.ratio.toFixed(2)}</span>
                <span class="md-sim-arrow">→</span>
                <span class="md-sim-after">{sim.acwr.after.ratio.toFixed(2)}</span>
                <span class="md-sim-delta" class:better={d.better === true} class:worse={d.better === false}>
                  {d.text}
                </span>
                <span class="md-sim-zone">{sim.acwr.after.zone}</span>
              </div>
            {/if}
            {#if sim.monotony}
              {@const d = delta(sim.monotony.before.monotony, sim.monotony.after.monotony, 1, false)}
              <div class="md-sim-row">
                <span class="md-sim-name">Monotony</span>
                <span class="md-sim-before">{sim.monotony.before.monotony.toFixed(1)}</span>
                <span class="md-sim-arrow">→</span>
                <span class="md-sim-after">{sim.monotony.after.monotony.toFixed(1)}</span>
                <span class="md-sim-delta" class:better={d.better === true} class:worse={d.better === false}>
                  {d.text}
                </span>
                <span class="md-sim-zone">{sim.monotony.after.band}</span>
              </div>
            {/if}
          </div>

          <!-- The honesty note, and it is load-bearing. `preferredACWR` falls
               back to the WHOOP-STRAIN ratio whenever the TRIMP one is thin, so
               the headline on the deck may be a different instrument from the
               one simulated here. Both numbers above come from this series, so
               the CHANGE is real either way — but the before may not match the
               panel, and a reader must be told that rather than left to
               discover it. -->
          <p class="md-sim-note">
            Both figures are recomputed here from the daily training-load series with
            that session added — the same functions the page ran, one input changed.
            The panel’s own ACWR may be the Whoop-strain fallback, which is a different
            instrument, so read the change rather than matching the before.
          </p>
        </section>
      {/if}

      <!-- HOW -->
      {#if method}
        <section class="md-sec">
          <p class="md-sec-head">
            How it is computed <span class="md-sec-meta">{method.cite}</span>
          </p>
          <dl class="md-method">
            <dt>Formula</dt>
            <dd>{method.formula}</dd>
            <dt>Source</dt>
            <dd>{method.sourceData}</dd>
            <dt>Caveats</dt>
            <dd>{method.caveats}</dd>
            <dt>Reference</dt>
            <dd class="md-ref">{method.reference}</dd>
          </dl>
        </section>
      {/if}

      {#if related.length}
        <section class="md-sec">
          <p class="md-sec-head">Read next</p>
          <div class="md-related">
            {#each related as r (r.id)}
              <button type="button" class="md-rel" onclick={() => onopen(r.id)}>{r.label}</button>
            {/each}
          </div>
        </section>
      {/if}
    </div>
  </div>
{/if}

<style>
  .md-backdrop {
    position: fixed;
    inset: 0;
    z-index: 240;
    background: rgba(26, 16, 8, 0.55);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 5vh 20px;
    animation: md-fade 140ms ease;
  }
  @keyframes md-fade {
    from {
      opacity: 0;
    }
  }
  .md-panel {
    width: 100%;
    max-width: 720px;
    max-height: 88vh;
    overflow: auto;
    background: var(--bg);
    border: 2px solid var(--line-strong);
    padding: 22px 24px 26px;
    box-sizing: border-box;
  }
  .md-panel:focus {
    outline: none;
  }

  .md-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
    border-bottom: 1px solid var(--line-strong);
    padding-bottom: 12px;
  }
  .md-kicker,
  .md-sec-meta,
  .md-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0;
  }
  .md-title {
    font-family: var(--font-display);
    font-size: 26px;
    line-height: 1.05;
    letter-spacing: -0.01em;
    text-transform: uppercase;
    color: var(--text-primary);
    margin: 4px 0 0;
  }
  .md-close {
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
  .md-close:hover,
  .md-close:focus-visible {
    border-color: var(--accent);
    color: var(--accent);
  }

  .md-figure {
    display: flex;
    align-items: baseline;
    gap: 18px;
    flex-wrap: wrap;
    margin-top: 16px;
  }
  .md-value {
    font-family: var(--font-display);
    font-size: 44px;
    line-height: 0.9;
    letter-spacing: -0.02em;
    color: var(--text-primary);
    margin: 0;
  }
  .md-empty {
    color: var(--text-ghost);
  }
  .md-unit {
    font-family: var(--font-mono);
    font-size: var(--fs-body-sm);
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin-left: 4px;
  }
  .md-figure-side {
    min-width: 0;
  }
  .md-band {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    margin: 0;
  }
  .md-baseline {
    font-size: var(--fs-label);
    color: var(--text-muted);
    margin: 4px 0 0;
  }

  .md-what {
    font-size: var(--fs-nav);
    line-height: 1.5;
    color: var(--text-secondary);
    margin: 16px 0 0;
    text-wrap: pretty;
  }
  .md-moves {
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-muted);
    margin: 8px 0 0;
    text-wrap: pretty;
  }

  .md-sec {
    margin-top: 24px;
    padding-top: 14px;
    border-top: 1px solid var(--divider);
  }
  .md-sec-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-primary);
    margin: 0 0 12px;
  }
  .md-none {
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-muted);
    margin: 0;
  }

  .md-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .md-preset {
    background: none;
    border: 1px solid var(--card-border);
    border-radius: 0;
    padding: 6px 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
    cursor: pointer;
  }
  .md-preset:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .md-preset.on {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--bg);
  }
  .md-preset-note {
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-muted);
    margin: 10px 0 0;
    text-wrap: pretty;
  }
  .md-preset-load {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin-left: 6px;
    white-space: nowrap;
  }

  .md-sim {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-top: 12px;
    background: var(--card-border);
    border: 1px solid var(--card-border);
  }
  .md-sim-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 62px 20px 62px 62px minmax(0, 1fr);
    align-items: baseline;
    gap: 8px;
    background: var(--bg);
    padding: 10px 12px;
  }
  .md-sim-name {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .md-sim-before,
  .md-sim-after,
  .md-sim-delta {
    font-family: var(--font-mono);
    font-size: var(--fs-body-sm);
    text-align: right;
  }
  .md-sim-before {
    color: var(--text-ghost);
  }
  .md-sim-after {
    color: var(--text-primary);
  }
  .md-sim-arrow {
    color: var(--text-ghost);
    text-align: center;
  }
  /* Direction, not magnitude: half these metrics are better going down, so the
     tone comes from the descriptor rather than the sign. */
  .md-sim-delta.better {
    color: var(--good);
  }
  .md-sim-delta.worse {
    color: var(--accent);
  }
  .md-sim-zone {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
    text-align: right;
  }
  .md-sim-note {
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-muted);
    margin: 10px 0 0;
    max-width: 66ch;
    text-wrap: pretty;
  }

  .md-method {
    display: grid;
    grid-template-columns: 88px minmax(0, 1fr);
    gap: 6px 14px;
    margin: 0;
  }
  .md-method dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  .md-method dd {
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-secondary);
    margin: 0;
    text-wrap: pretty;
  }
  .md-method dd.md-ref {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    word-break: break-word;
  }

  .md-related {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .md-rel {
    background: none;
    border: 1px solid var(--card-border);
    border-radius: 0;
    padding: 6px 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
    cursor: pointer;
  }
  .md-rel:hover,
  .md-rel:focus-visible {
    border-color: var(--accent);
    color: var(--accent);
  }

  .tone-good {
    color: var(--good);
  }
  .tone-plain {
    color: var(--accent-ink);
  }
  .tone-warn {
    color: var(--accent);
  }

  @media (max-width: 620px) {
    .md-sim-row {
      grid-template-columns: minmax(0, 1fr) 54px 16px 54px 54px;
    }
    .md-sim-zone {
      display: none;
    }
  }
</style>
