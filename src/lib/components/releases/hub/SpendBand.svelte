<script lang="ts">
  // C (owner) — WHAT IT COST. The Claude Code spend behind the record above:
  // how much, where it went, and what it bought.
  //
  // Owner-only by construction: the loader builds `spend` inside its owner
  // branch, so the public payload has no such member to render.
  //
  // Colour jobs, following the dataviz method:
  //  - shipped vs not-shipped is IDENTITY over two series → the site's validated
  //    pair, `--accent` (shipped) and `--accent-ink` (no released PR), with a
  //    legend, a 2px surface gap between stacked fills, and text in text tokens;
  //  - every other bar is MAGNITUDE in one dimension → one hue, direct labels;
  //  - the hour-of-week grid is SEQUENTIAL → one hue stepped light to dark.
  // Weekly and cumulative are different scales, so they are two views of one
  // panel, never two axes on one.
  import SectionHead from '$lib/components/shell/SectionHead.svelte';
  import FeatureLedger from './FeatureLedger.svelte';
  import { chartHref, weekDates, type ChartFilters } from '$lib/releases/chart-links';
  import { usd, type SpendBand, type SpendWeek } from '$lib/releases/spend';

  interface Props {
    spend: SpendBand;
    filters: ChartFilters;
    kicker: string;
  }

  let { spend, filters, kicker }: Props = $props();
  let view = $state<'weekly' | 'cumulative'>('weekly');
  let hover = $state<SpendWeek | null>(null);

  const t = $derived(spend.totals);
  const weeks = $derived(spend.weeks.slice(-40));
  const peak = $derived(Math.max(1, ...weeks.map((w) => w.linked + w.unlinked)));
  const cumPeak = $derived(Math.max(1, ...weeks.map((w) => w.cumulative)));
  const readout = $derived(hover ?? weeks[weeks.length - 1] ?? null);

  function share(n: number, of: number): string {
    return of > 0 ? `${Math.round((n / of) * 100)}%` : '—';
  }

  function weekLabel(week: string): string {
    const [year, w] = week.split('-');
    return `${w} '${year.slice(2)}`;
  }

  function weekHref(week: string): string {
    const range = weekDates(week);
    const active = filters.from === range.from && filters.to === range.to;
    return chartHref(filters, active ? { from: '', to: '' } : range).replace('#release-log', '#spend');
  }

  const tiles = $derived([
    {
      label: 'Estimated spend',
      value: usd(t.costUsd),
      note: `${t.sessions.toLocaleString('en-GB')} sessions${t.partialSessions ? ` · ${t.partialSessions} partial` : ''}`,
    },
    { label: 'Became releases', value: usd(t.linkedUsd), note: `${share(t.linkedUsd, t.costUsd)} via ${t.prs} released PRs` },
    { label: 'Per released PR', value: t.prs ? usd(t.linkedUsd / t.prs) : '—', note: t.releases ? `${usd(t.linkedUsd / t.releases)} per release` : 'no linked releases' },
    { label: 'Per 1k lines', value: t.churn ? usd((t.linkedUsd / t.churn) * 1000) : '—', note: `${Math.round(t.churn / 1000).toLocaleString('en-GB')}k lines changed` },
    { label: 'Typical session', value: usd(t.medianSessionUsd), note: `median · 90th pct ${usd(t.p90SessionUsd)}` },
    {
      label: 'Subagents',
      value: t.subagentMeasuredSessions ? usd(t.subagentUsd) : '—',
      note: t.subagentMeasuredSessions ? `in ${t.subagentMeasuredSessions} sessions that record them` : 'recorded from parser v5',
    },
    { label: 'Follow-up fixes', value: t.reworkShare === null ? '—' : `${Math.round(t.reworkShare * 100)}%`, note: 'of stage cost after a first result' },
    { label: 'Cache reads', value: t.cacheReadShare === null ? '—' : `${Math.round(t.cacheReadShare * 100)}%`, note: `of input · ~${usd(t.cacheSavingsUsd)} avoided` },
  ]);

  // ——— breakdowns: top entries, the rest folded into "Other" ———————————
  function top(slices: { key: string; costUsd: number }[], n: number) {
    if (slices.length <= n) return slices;
    const rest = slices.slice(n - 1).reduce((sum, s) => sum + s.costUsd, 0);
    return [...slices.slice(0, n - 1), { key: `Other (${slices.length - n + 1})`, costUsd: rest }];
  }
  const breakdowns = $derived([
    { name: 'By project', rows: top(spend.byProject, 8) },
    { name: 'By model', rows: top(spend.byModel, 6) },
    { name: 'By stage', rows: spend.byStage },
  ]);

  // ——— hour-of-week: five sequential steps of one hue ——————————————————
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const heatMax = $derived(Math.max(0, ...spend.heat.flat()));
  function step(v: number): number {
    if (v <= 0 || heatMax <= 0) return 0;
    return Math.min(5, Math.ceil((v / heatMax) * 5));
  }
</script>

<section class="d" id="spend">
  <div class="d-inner">
    <SectionHead
      {kicker}
      title={['What the work', 'cost']}
      strap="Estimated at API list prices from each Claude Code transcript, subagents included where recorded. Shipped spend is the share whose pull requests reached a release; the rest is review, operations, exploration and unshipped work."
    />

    <div class="tiles">
      {#each tiles as tile (tile.label)}
        <div class="tile">
          <span class="tile-label">{tile.label}</span>
          <span class="tile-value">{tile.value}</span>
          <span class="tile-note">{tile.note}</span>
        </div>
      {/each}
    </div>

    {#if spend.insights.length}
      <ul class="insights" aria-label="Insights">
        {#each spend.insights as line, i (i)}
          <li>{line}</li>
        {/each}
      </ul>
    {/if}

    <div class="grid">
      <figure class="panel wide">
        <figcaption class="panel-hd">
          <span class="panel-name">Spend by week · {weeks.length} week{weeks.length === 1 ? '' : 's'}</span>
          <span class="view" aria-label="Chart view">
            <button type="button" aria-pressed={view === 'weekly'} onclick={() => (view = 'weekly')}>Weekly</button>
            <button type="button" aria-pressed={view === 'cumulative'} onclick={() => (view = 'cumulative')}>Cumulative</button>
          </span>
        </figcaption>

        <div class="legend">
          {#if view === 'weekly'}
            <span class="key"><span class="swatch shipped"></span>Became releases</span>
            <span class="key"><span class="swatch other"></span>No released PR</span>
          {:else}
            <span class="key"><span class="swatch shipped"></span>Running total</span>
          {/if}
          {#if readout}
            <span class="readout" aria-live="polite">
              {weekLabel(readout.week)} ·
              {#if view === 'weekly'}
                {usd(readout.linked + readout.unlinked)} · shipped {usd(readout.linked)} · other {usd(readout.unlinked)}
              {:else}
                {usd(readout.cumulative)} to date
              {/if}
            </span>
          {/if}
        </div>

        {#if weeks.length === 0}
          <p class="empty">No sessions in this window.</p>
        {:else}
          <div class="plot">
            <span class="peak">{usd(view === 'weekly' ? peak : cumPeak)}</span>
            {#if view === 'cumulative'}
              <svg class="cum" viewBox="0 0 {weeks.length} 100" preserveAspectRatio="none" aria-hidden="true">
                <path
                  class="cum-area"
                  d="M0 100 {weeks.map((w, i) => `L${i} ${100 - (w.cumulative / cumPeak) * 100} L${i + 1} ${100 - (w.cumulative / cumPeak) * 100}`).join(' ')} L{weeks.length} 100 Z"
                />
                <path
                  class="cum-line"
                  vector-effect="non-scaling-stroke"
                  d="M0 100 {weeks.map((w, i) => `L${i} ${100 - (w.cumulative / cumPeak) * 100} L${i + 1} ${100 - (w.cumulative / cumPeak) * 100}`).join(' ')}"
                />
              </svg>
            {/if}
            <div class="cols" class:overlay={view === 'cumulative'} role="list" onpointerleave={() => (hover = null)}>
              {#each weeks as w (w.week)}
                <a
                  class="col"
                  role="listitem"
                  href={weekHref(w.week)}
                  aria-current={filters.from === weekDates(w.week).from && filters.to === weekDates(w.week).to ? 'true' : undefined}
                  aria-label="{w.week}: {usd(w.linked + w.unlinked)}, of which {usd(w.linked)} became releases. Filter to this week."
                  onpointerenter={() => (hover = w)}
                  onfocus={() => (hover = w)}
                  onblur={() => (hover = null)}
                >
                  {#if view === 'weekly'}
                    <span class="seg other" style="height: {(w.unlinked / peak) * 100}%"></span>
                    <span class="seg shipped" style="height: {(w.linked / peak) * 100}%"></span>
                  {/if}
                </a>
              {/each}
            </div>
            <div class="axis">
              <span>{weekLabel(weeks[0].week)}</span>
              <span class="axis-note">Select a week to filter this page</span>
              <span>{weekLabel(weeks[weeks.length - 1].week)}</span>
            </div>
          </div>
        {/if}
      </figure>

      <figure class="panel">
        <figcaption class="panel-hd">
          <span class="panel-name">When it runs</span>
          <span class="panel-meta">session starts · UK time</span>
        </figcaption>
        <div class="heat" role="table" aria-label="Spend by day of week and hour">
          {#each spend.heat as row, d (d)}
            <div class="heat-row" role="row">
              <span class="heat-day" role="rowheader">{DAYS[d]}</span>
              {#each row as v, h (h)}
                <span
                  class="cell"
                  role="cell"
                  data-step={step(v)}
                  title="{DAYS[d]} {String(h).padStart(2, '0')}:00 · {usd(v)}"
                  aria-label="{DAYS[d]} {h}:00, {usd(v)}"
                ></span>
              {/each}
            </div>
          {/each}
          <div class="heat-axis" aria-hidden="true">
            <span></span><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
          </div>
        </div>
        <div class="heat-legend" aria-hidden="true">
          <span>Less</span>
          {#each [1, 2, 3, 4, 5] as s (s)}<span class="cell" data-step={s}></span>{/each}
          <span>More · peak {usd(heatMax)}</span>
        </div>
      </figure>

      {#each breakdowns as b (b.name)}
        {@const max = Math.max(1, ...b.rows.map((r) => r.costUsd))}
        <figure class="panel">
          <figcaption class="panel-hd">
            <span class="panel-name">{b.name}</span>
            <span class="panel-meta">estimated $</span>
          </figcaption>
          {#if b.rows.length === 0}
            <p class="empty">Nothing recorded.</p>
          {:else}
            <div class="rows">
              {#each b.rows as r (r.key)}
                <div class="row">
                  <span class="row-lbl" title={r.key}>{r.key}</span>
                  <span class="track"><span class="fill" style="width: {(r.costUsd / max) * 100}%"></span></span>
                  <span class="row-val">{usd(r.costUsd)}</span>
                </div>
              {/each}
            </div>
          {/if}
        </figure>
      {/each}
    </div>

    <FeatureLedger areas={spend.areas} sessions={spend.sessions} />
  </div>
</section>

<style>
  .d { background: var(--bg); color: var(--text-primary); padding: clamp(28px, 3vw, 46px) clamp(20px, 3vw, 44px); }
  .d-inner { max-width: 1400px; margin: 0 auto; border-top: 1px solid var(--line-strong); padding-top: clamp(20px, 2.5vw, 34px); }
  .d :global(.hd) { margin-bottom: 20px; }

  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); border: 1px solid var(--line-strong); margin-bottom: 14px; }
  .tile { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border-right: 1px solid var(--line-hair); border-bottom: 1px solid var(--line-hair); min-width: 0; }
  .tile-label, .tile-note, .panel-name, .panel-meta, .key, .readout, .axis, .peak, .row-lbl, .row-val, .heat-day, .heat-axis, .heat-legend {
    font-family: var(--font-mono); font-size: var(--fs-label-xs); font-variant-numeric: tabular-nums;
  }
  .tile-label { text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); }
  .tile-value { font-family: var(--font-display, var(--font-body)); font-weight: 800; font-size: clamp(1.4rem, 2.2vw, 1.9rem); line-height: 1.1; font-variant-numeric: tabular-nums; }
  .tile-note { color: var(--text-ghost); }

  .insights { list-style: none; margin: 0 0 16px; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 0 24px; }
  .insights li { font-size: var(--fs-body-sm); line-height: 1.5; color: var(--text-secondary); padding: 8px 0 8px 14px; border-top: 1px solid var(--line-hair); position: relative; }
  .insights li::before { content: ''; position: absolute; left: 0; top: 15px; width: 6px; height: 6px; background: var(--accent); }

  .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
  @media (max-width: 1100px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 700px) { .grid { grid-template-columns: minmax(0, 1fr); } }
  .panel { border: 1px solid var(--line-strong); padding: 15px 17px; margin: 0; min-width: 0; }
  .panel.wide { grid-column: span 2; }
  @media (max-width: 1100px) { .panel.wide { grid-column: 1 / -1; } }
  .panel-hd { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin-bottom: 8px; }
  .panel-name { text-transform: uppercase; letter-spacing: 0.15em; font-weight: 500; }
  .panel-meta { text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-ghost); }

  .view { display: flex; border: 1px solid var(--line-strong); }
  .view button { border: 0; background: transparent; color: var(--text-muted); font: var(--fs-label-xs) var(--font-mono); padding: 5px 9px; cursor: pointer; }
  .view button + button { border-left: 1px solid var(--line-strong); }
  .view button[aria-pressed='true'] { background: var(--text-primary); color: var(--bg); }
  .view button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .legend { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; }
  .key { display: inline-flex; align-items: center; gap: 7px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); }
  .swatch { width: 10px; height: 10px; }
  .swatch.shipped { background: var(--accent); }
  .swatch.other { background: var(--accent-ink); }
  .readout { margin-left: auto; color: var(--text-secondary); }

  .plot { position: relative; padding-left: 46px; }
  .peak { position: absolute; left: 0; top: 0; color: var(--text-ghost); }
  .cum { position: absolute; left: 46px; right: 0; top: 0; height: 160px; width: calc(100% - 46px); }
  .cum-area { fill: var(--accent-tint-14); }
  .cum-line { fill: none; stroke: var(--accent); stroke-width: 2; }
  .cols { position: relative; display: flex; align-items: stretch; gap: 3px; height: 160px; border-bottom: 1px solid var(--line-strong); }
  .col { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: flex-end; gap: 2px; text-decoration: none; }
  .col:hover { background: var(--accent-tint-14); }
  .cols.overlay .col:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
  .col[aria-current='true'] { background: var(--accent-tint-25); }
  .col:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .seg { display: block; width: 100%; }
  .seg.shipped { background: var(--accent); }
  .seg.other { background: var(--accent-ink); }
  .seg[style*='height: 0%'] { display: none; }
  .axis { display: flex; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin-top: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-ghost); }
  .axis-note { color: var(--text-muted); }

  .heat { display: flex; flex-direction: column; gap: 2px; }
  .heat-row, .heat-axis { display: grid; grid-template-columns: 2.4rem repeat(24, minmax(0, 1fr)); gap: 2px; align-items: center; }
  .heat-axis { grid-template-columns: 2.4rem repeat(5, 1fr); color: var(--text-ghost); margin-top: 4px; }
  .heat-day { color: var(--text-muted); }
  .cell { display: block; aspect-ratio: 1; min-height: 8px; background: var(--line-hair); }
  .cell[data-step='1'] { background: color-mix(in srgb, var(--accent) 22%, var(--bg)); }
  .cell[data-step='2'] { background: color-mix(in srgb, var(--accent) 42%, var(--bg)); }
  .cell[data-step='3'] { background: color-mix(in srgb, var(--accent) 62%, var(--bg)); }
  .cell[data-step='4'] { background: color-mix(in srgb, var(--accent) 82%, var(--bg)); }
  .cell[data-step='5'] { background: var(--accent); }
  .heat-legend { display: flex; align-items: center; gap: 4px; margin-top: 10px; color: var(--text-ghost); }
  .heat-legend .cell { width: 12px; min-height: 12px; }

  .rows { display: flex; flex-direction: column; gap: 7px; }
  .row { display: grid; grid-template-columns: minmax(0, 9.5rem) 1fr 3.6rem; gap: 10px; align-items: center; }
  .row-lbl { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .track { height: 10px; background: var(--accent-tint-14); }
  .fill { display: block; height: 100%; background: var(--accent); }
  .row-val { text-align: right; color: var(--text-primary); }
  .empty { color: var(--text-muted); font-size: var(--fs-label); margin: 0; }
</style>
