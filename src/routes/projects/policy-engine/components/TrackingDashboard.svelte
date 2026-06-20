<script lang="ts">
  import type { TrackedIndicator, TrackStatus, FreshnessState } from '../lib/tracking/types';

  let { tracked }: { tracked: TrackedIndicator[] } = $props();

  const STATUS: Record<TrackStatus, { c: string; label: string }> = {
    'on-track': { c: '#2f7d4f', label: 'on track' },
    'off-track': { c: '#b4455e', label: 'off track' },
    'no-data': { c: '#a99', label: '—' },
  };
  const FRESH: Record<FreshnessState, { c: string; hollow: boolean; label: string }> = {
    fresh: { c: '#2f7d4f', hollow: false, label: 'fresh' },
    due: { c: '#9a7b1f', hollow: false, label: 'update due' },
    stale: { c: '#b4455e', hollow: false, label: 'stale' },
    snapshot: { c: '#9a8f7a', hollow: true, label: 'fallback' },
    'no-data': { c: '#c9bfa8', hollow: true, label: 'not yet tracked' },
  };

  function fmt(v: number | null, unit: string): string {
    if (v == null) return '—';
    if (unit === '£' || unit === 'intl $') return (unit === '£' ? '£' : '$') + Math.round(v).toLocaleString('en-GB');
    if (unit === 'pupils') return Math.round(v).toLocaleString('en-GB');
    const dp = Math.abs(v) >= 100 ? 0 : 1;
    return v.toFixed(dp) + (unit === '%' ? '%' : '');
  }
  function fmtDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // tracked (have an observation) first, off-track surfaced; then projection-only / not-yet-tracked
  const rows = $derived(
    [...tracked].sort((a, b) => {
      const av = a.observedValue != null ? 0 : 1;
      const bv = b.observedValue != null ? 0 : 1;
      if (av !== bv) return av - bv;
      const off = (s: TrackedIndicator) => (s.statusVsPolicy === 'off-track' ? 0 : 1);
      return off(a) - off(b);
    }),
  );

  const liveCount = $derived(tracked.filter((t) => t.observedValue != null && t.live).length);
  const onTrackPolicy = $derived(tracked.filter((t) => t.statusVsPolicy === 'on-track').length);
  const offTrackPolicy = $derived(tracked.filter((t) => t.statusVsPolicy === 'off-track').length);
  const lastRefreshed = $derived(
    tracked.map((t) => t.fetchedAt).filter(Boolean).sort().at(-1) ?? null,
  );
</script>

<div class="track">
  <div class="head">
    <div>
      <h3>Model vs reality — tracked against live official data</h3>
      <p class="sub">
        Each row pairs the model's projection with what official statistics actually report, refreshed automatically by scheduled
        jkai workflows as new data is released. "On track" means reality is at least as good as the model expected for that year.
      </p>
    </div>
    <div class="chips">
      <span class="chip"><b>{liveCount}</b> live indicators</span>
      <span class="chip ok"><b>{onTrackPolicy}</b> on track vs policy</span>
      <span class="chip bad"><b>{offTrackPolicy}</b> off track vs policy</span>
      {#if lastRefreshed}<span class="chip ts">data refreshed {fmtDate(lastRefreshed)}</span>{/if}
    </div>
  </div>

  <div class="legend">
    <span>Status:</span>
    <i class="dot" style="background:{STATUS['on-track'].c}"></i> on track
    <i class="dot" style="background:{STATUS['off-track'].c}"></i> off track
    <span class="sep">·</span>
    <span>Freshness:</span>
    <i class="dot" style="background:{FRESH.fresh.c}"></i> fresh
    <i class="dot" style="background:{FRESH.due.c}"></i> due
    <i class="dot" style="background:{FRESH.stale.c}"></i> stale
    <i class="dot hollow" style="border-color:{FRESH.snapshot.c}"></i> fallback / not yet tracked
  </div>

  <div class="scroll">
    <table>
      <thead>
        <tr>
          <th class="l">Indicator</th>
          <th>Observed</th>
          <th>Proj. (status quo)</th>
          <th>Proj. (announced policy)</th>
          <th>vs&nbsp;status&nbsp;quo</th>
          <th>vs&nbsp;policy</th>
          <th class="l">Data last updated</th>
          <th class="l">Source</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.key)}
          <tr class:dim={r.observedValue == null}>
            <td class="l">
              <span class="ind">{r.label}</span>
              {#if r.caveat}<span class="info" title={r.caveat}>ⓘ</span>{/if}
            </td>
            <td class="num">
              {fmt(r.observedValue, r.unit)}
              {#if r.refPeriodLabel && r.observedValue != null}<span class="per">{r.refPeriodLabel}</span>{/if}
            </td>
            <td class="num soft">{fmt(r.projectedBaseline, r.unit)}</td>
            <td class="num soft">{fmt(r.projectedPolicy, r.unit)}</td>
            <td class="st"><i class="dot" style="background:{STATUS[r.statusVsBaseline].c}" title={STATUS[r.statusVsBaseline].label}></i></td>
            <td class="st"><i class="dot" style="background:{STATUS[r.statusVsPolicy].c}" title={STATUS[r.statusVsPolicy].label}></i></td>
            <td class="l upd">
              <i class="dot {FRESH[r.freshness].hollow ? 'hollow' : ''}" style={FRESH[r.freshness].hollow ? `border-color:${FRESH[r.freshness].c}` : `background:${FRESH[r.freshness].c}`}></i>
              <span title={r.fetchedAt ? `polled ${fmtDate(r.fetchedAt)}` : FRESH[r.freshness].label}>
                {r.releaseDate ? fmtDate(r.releaseDate) : FRESH[r.freshness].label}
              </span>
            </td>
            <td class="l">
              <a href={r.source.url} target="_blank" rel="noopener" class="src" title={r.source.name}>{r.source.publisher} ↗</a>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <p class="foot">
    Drift is shown against <b>both</b> the status-quo (do-nothing) and announced-policy projections. The latest annual figures land at
    the model's 2025 calibration year, where the two paths have not yet diverged; the comparison grows as each new release arrives.
    Indicators with no machine-readable source (EPI "months" gaps, IFS funding, DWP poverty, school-workforce FTE) show the projection only,
    flagged "not yet tracked", and are refreshed manually.
  </p>
</div>

<style>
  .track { margin: 1.5rem 0 2rem; font-family: var(--font-body, 'DM Sans', system-ui, sans-serif); }
  .head { display: flex; gap: 1.2rem; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; }
  .head h3 { font-family: var(--font-display, 'Archivo Black', sans-serif); font-size: 1.05rem; margin: 0 0 0.35rem; color: var(--ink); }
  .sub { margin: 0; font-size: 0.82rem; line-height: 1.45; color: var(--ink-soft, rgba(28,22,17,0.66)); max-width: 46ch; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .chip { font-family: var(--font-mono, 'JetBrains Mono', monospace); font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.03em;
    padding: 0.28rem 0.5rem; border: 1px solid var(--line, rgba(28,22,17,0.16)); border-radius: var(--radius-sharp); color: var(--ink-soft, rgba(28,22,17,0.7)); white-space: nowrap; }
  .chip b { color: var(--ink); font-weight: 700; }
  .chip.ok { border-color: var(--success-border); }
  .chip.bad { border-color: rgba(180,69,94,0.4); }
  .chip.ts { background: rgba(28,22,17,0.04); }

  .legend { display: flex; align-items: center; flex-wrap: wrap; gap: 0.35rem; margin: 0.9rem 0 0.5rem;
    font-family: var(--font-mono, 'JetBrains Mono', monospace); font-size: 0.66rem; color: var(--ink-soft, rgba(28,22,17,0.6)); }
  .legend .sep { opacity: 0.4; margin: 0 0.2rem; }

  .scroll { overflow-x: auto; border: 1px solid var(--line, rgba(28,22,17,0.14)); border-radius: var(--radius-round); background: var(--card-bg, rgba(255,255,255,0.4)); }
  table { width: 100%; border-collapse: collapse; font-size: 0.8rem; min-width: 760px; }
  thead th { font-family: var(--font-mono, 'JetBrains Mono', monospace); font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.04em;
    font-weight: 600; color: var(--ink-soft, rgba(28,22,17,0.55)); text-align: center; padding: 0.55rem 0.5rem; border-bottom: 1.5px solid var(--line, rgba(28,22,17,0.18)); white-space: nowrap; }
  thead th.l { text-align: left; }
  tbody td { padding: 0.5rem 0.5rem; border-bottom: 1px solid var(--line, rgba(28,22,17,0.08)); text-align: center; vertical-align: middle; color: var(--ink); }
  tbody td.l { text-align: left; }
  tbody tr:hover { background: rgba(28,22,17,0.025); }
  tr.dim td { color: var(--ink-soft, rgba(28,22,17,0.5)); }
  .ind { font-weight: 500; }
  .info { margin-left: 0.3rem; cursor: help; color: var(--ink-soft, rgba(28,22,17,0.4)); font-size: 0.75rem; }
  .num { font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
  .num.soft { font-weight: 400; color: var(--ink-soft, rgba(28,22,17,0.6)); }
  .per { display: block; font-family: var(--font-mono, 'JetBrains Mono', monospace); font-size: 0.58rem; color: var(--ink-soft, rgba(28,22,17,0.45)); font-weight: 400; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: var(--radius-pill); vertical-align: middle; }
  .dot.hollow { background: transparent !important; border: 1.5px solid currentColor; }
  .st .dot { width: 11px; height: 11px; }
  .upd { white-space: nowrap; }
  .upd .dot { margin-right: 0.4rem; }
  .upd span { font-size: 0.74rem; }
  .src { font-family: var(--font-mono, 'JetBrains Mono', monospace); font-size: 0.66rem; color: var(--accent, #c4570a); text-decoration: none; white-space: nowrap; }
  .src:hover { text-decoration: underline; }
  .foot { margin: 0.8rem 0 0; font-size: 0.74rem; line-height: 1.5; color: var(--ink-soft, rgba(28,22,17,0.55)); max-width: 80ch; }
</style>
