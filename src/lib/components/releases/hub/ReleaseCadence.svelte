<script lang="ts">
  // B — CADENCE. Two marks on paper: how often the site deploys, and what those
  // deploys carry.
  //
  // Both series are COUNTS on one axis — deploys and capabilities are the same
  // unit, so they share a scale and neither gets a second y-axis. Grouped
  // columns rather than stacked: a capability is not a part of a deploy, it is
  // a different tally of the same week, and stacking would read as a total that
  // means nothing.
  //
  // The pair is `--accent` / `--accent-ink`, the site's validated chart pair
  // (ΔE 14.4 protan, 27.3 normal against the cream ground). Petrol is a PAPER
  // counter-accent and has no role on an ink band, which is why this section is
  // the one that stays light. A legend is present because there are two series
  // — identity is never colour alone.
  //
  // The kind mix beside it is a magnitude comparison inside ONE dimension, so
  // it takes one hue and direct labels, not six categorical ones.
  import SectionHead from '$lib/components/shell/SectionHead.svelte';
  import { KIND_LABEL, type ReleaseItemKind } from '$lib/releases/types';
  import type { CadenceWeek } from '$lib/releases/console';

  interface Props {
    kicker: string;
    cadence: CadenceWeek[];
    kindMix: { kind: string; count: number }[];
    /** Names the lower series — the public and owner counts mean different things. */
    shippedLabel: string;
    strap: string;
  }

  let { kicker, cadence, kindMix, shippedLabel, strap }: Props = $props();
  let view = $state<'activity' | 'churn'>('activity');

  const peak = $derived(Math.max(1, ...cadence.flatMap((w) => [w.deploys, w.shipped])));
  const churnPeak = $derived(Math.max(1, ...cadence.flatMap((w) => [w.insertions, w.deletions])));
  const added = $derived(cadence.reduce((total, week) => total + week.insertions, 0));
  const removed = $derived(cadence.reduce((total, week) => total + week.deletions, 0));
  const kindMax = $derived(Math.max(1, ...kindMix.map((k) => k.count)));

  const busiest = $derived(
    cadence.reduce<CadenceWeek | null>((best, w) => (!best || w.deploys > best.deploys ? w : best), null),
  );

  /** `2026-W36` → `W36 '26`, which is what fits under a 9px-wide column. The
   *  apostrophe rather than a middle dot: the busiest-week caption puts a label
   *  inside a sentence that already has dot separators. */
  function weekLabel(week: string): string {
    const [year, w] = week.split('-');
    return `${w} '${year.slice(2)}`;
  }

  function fmt(n: number): string {
    return n.toLocaleString('en-GB');
  }
</script>

<section class="b">
  <div class="b-inner">
    <SectionHead {kicker} title={['How often,', 'and how much']} {strap} />

    <div class="b-grid">
      <figure class="b-panel wide">
        <figcaption class="b-panel-hd">
          <span class="b-panel-name">Weekly record · latest {cadence.length} week{cadence.length === 1 ? '' : 's'} in view</span>
          <span class="b-view" aria-label="Chart view">
            <button type="button" aria-pressed={view === 'activity'} onclick={() => (view = 'activity')}>Activity</button>
            <button type="button" aria-pressed={view === 'churn'} onclick={() => (view = 'churn')}>Code change</button>
          </span>
        </figcaption>

        <div class="b-legend">
          {#if view === 'activity'}
            <span class="b-key"><span class="b-swatch deploys"></span>Deploys</span>
            <span class="b-key"><span class="b-swatch shipped"></span>{shippedLabel}</span>
          {:else}
            <span class="b-key"><span class="b-swatch added"></span>Lines added</span>
            <span class="b-key"><span class="b-swatch removed"></span>Lines removed</span>
            <span class="b-legend-total">+{fmt(added)} / −{fmt(removed)} lines in view</span>
          {/if}
        </div>

        {#if cadence.length === 0}
          <p class="b-empty">No releases recorded.</p>
        {:else if view === 'activity'}
          <div class="b-plot" style="--peak: {peak}">
            <span class="b-peak">{peak}</span>
            <div class="b-cols">
              {#each cadence as w (w.week)}
                <div
                  class="b-col"
                  title="{w.week}: {w.deploys} deploy{w.deploys === 1 ? '' : 's'}, {w.shipped} {shippedLabel.toLowerCase()}"
                >
                  <span class="b-bar deploys" style="height: {(w.deploys / peak) * 100}%"></span>
                  <span class="b-bar shipped" style="height: {(w.shipped / peak) * 100}%"></span>
                </div>
              {/each}
            </div>
            <div class="b-axis">
              <span>{weekLabel(cadence[0].week)}</span>
              {#if busiest}
                <span class="b-note">
                  Busiest week {weekLabel(busiest.week)} · {busiest.deploys} deploys
                </span>
              {/if}
              <span>{weekLabel(cadence[cadence.length - 1].week)}</span>
            </div>
          </div>
        {:else}
          <div class="b-plot churn-plot">
            <div class="churn-scale" aria-hidden="true">
              <span>+{fmt(churnPeak)}</span><span>0</span><span>−{fmt(churnPeak)}</span>
            </div>
            <div class="churn-cols">
              {#each cadence as w (w.week)}
                <div
                  class="churn-col"
                  role="img"
                  aria-label="{w.week}: {fmt(w.insertions)} lines added, {fmt(w.deletions)} lines removed"
                  title="{w.week}: +{fmt(w.insertions)} / −{fmt(w.deletions)} lines"
                >
                  <span class="churn-up" style="height: {(w.insertions / churnPeak) * 50}%"></span>
                  <span class="churn-down" style="height: {(w.deletions / churnPeak) * 50}%"></span>
                </div>
              {/each}
            </div>
            <div class="b-axis">
              <span>{weekLabel(cadence[0].week)}</span>
              <span class="b-note">Weekly lines changed · zero at centre</span>
              <span>{weekLabel(cadence[cadence.length - 1].week)}</span>
            </div>
          </div>
        {/if}
      </figure>

      <figure class="b-panel">
        <figcaption class="b-panel-hd">
          <span class="b-panel-name">What ships</span>
          <span class="b-panel-meta">by kind</span>
        </figcaption>

        {#if kindMix.length === 0}
          <p class="b-empty">Nothing summarised yet.</p>
        {:else}
          <div class="b-rows">
            {#each kindMix as k (k.kind)}
              <div class="b-row">
                <span class="b-row-lbl">{KIND_LABEL[k.kind as ReleaseItemKind] ?? k.kind}</span>
                <span class="b-track">
                  <span class="b-fill" style="width: {(k.count / kindMax) * 100}%"></span>
                </span>
                <span class="b-row-val">{k.count}</span>
              </div>
            {/each}
          </div>
        {/if}
      </figure>
    </div>
  </div>
</section>

<style>
  .b {
    background: var(--bg);
    color: var(--text-primary);
    padding: clamp(28px, 3vw, 46px) clamp(20px, 3vw, 44px);
  }
  .b-inner {
    max-width: 1400px;
    margin: 0 auto;
  }
  .b :global(.hd) { margin-bottom: 20px; }

  .b-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 12px;
  }
  .b-panel {
    border: 1px solid var(--line-strong);
    padding: 15px 17px;
    margin: 0;
    min-width: 0;
  }
  /* The cadence mark needs the run; the kind mix is happy in a third of it. */
  .b-panel.wide {
    grid-column: span 2;
  }
  @media (max-width: 900px) {
    .b-panel.wide {
      grid-column: span 1;
    }
  }

  .b-panel-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 14px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .b-panel-name,
  .b-panel-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
  }
  .b-panel-name {
    font-weight: 500;
    letter-spacing: 0.15em;
    color: var(--text-primary);
  }
  .b-panel-meta {
    letter-spacing: 0.1em;
    color: var(--text-ghost);
  }

  .b-legend {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .b-view { display: flex; border: 1px solid var(--line-strong); }
  .b-view button { border: 0; background: transparent; color: var(--text-muted); font: var(--fs-label-xs) var(--font-mono); padding: 5px 9px; cursor: pointer; }
  .b-view button + button { border-left: 1px solid var(--line-strong); }
  .b-view button[aria-pressed='true'] { background: var(--text-primary); color: var(--bg); }
  .b-view button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .b-legend-total { font: var(--fs-label-xs) var(--font-mono); color: var(--text-muted); margin-left: auto; }
  .b-key {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .b-swatch {
    width: 10px;
    height: 10px;
  }
  .b-swatch.deploys {
    background: var(--accent);
  }
  .b-swatch.shipped {
    background: var(--accent-ink);
  }
  .b-swatch.added { background: var(--accent); }
  .b-swatch.removed { background: var(--accent-ink); }

  .b-plot {
    position: relative;
    padding-left: 34px;
  }
  .b-peak {
    position: absolute;
    left: 0;
    top: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    font-variant-numeric: tabular-nums;
  }
  .b-cols {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 142px;
    border-bottom: 1px solid var(--line-strong);
  }
  .b-col {
    display: flex;
    align-items: flex-end;
    /* The 2px surface gap that keeps two adjacent fills from reading as one. */
    gap: 2px;
    flex: 1;
    min-width: 0;
    height: 100%;
  }
  .b-bar {
    flex: 1;
    min-width: 0;
    /* A week with nothing in it still gets a hairline, so a gap reads as zero
       rather than as a column that failed to render. */
    min-height: 1px;
    border-radius: 0;
  }
  .b-bar.deploys {
    background: var(--accent);
  }
  .b-bar.shipped {
    background: var(--accent-ink);
  }
  .churn-plot { padding-left: 70px; }
  .churn-scale { position: absolute; left: 0; top: 0; height: 142px; display: flex; flex-direction: column; justify-content: space-between; align-items: flex-start; color: var(--text-ghost); font: var(--fs-label-xs) var(--font-mono); font-variant-numeric: tabular-nums; }
  .churn-cols { display: flex; height: 142px; border-bottom: 1px solid var(--line-hair); background: linear-gradient(to bottom, transparent calc(50% - 0.5px), var(--line-strong) 50%, transparent calc(50% + 0.5px)); }
  .churn-col { position: relative; flex: 1; min-width: 0; height: 100%; }
  .churn-up, .churn-down { position: absolute; left: 18%; width: 64%; }
  .churn-up { bottom: 50%; background: var(--accent); }
  .churn-down { top: 50%; background: var(--accent-ink); }

  .b-axis {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 14px;
    flex-wrap: wrap;
    margin-top: 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  .b-note {
    color: var(--text-muted);
  }

  .b-rows {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .b-row {
    display: grid;
    grid-template-columns: 8.5rem 1fr 3rem;
    align-items: center;
    gap: 12px;
  }
  .b-row-lbl {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .b-track {
    height: 10px;
    background: var(--accent-tint-14);
  }
  .b-fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .b-row-val {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .b-empty {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    color: var(--text-muted);
    margin: 0;
  }
</style>
