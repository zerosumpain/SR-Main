<script lang="ts">
  // RegionsPanel — the geographic breakdown ("Regions" tab). A bespoke-SVG tile cartogram of
  // the 9 ONS English regions + a ranked bar list, a metric selector, the coastal cross-cut, and
  // a per-region detail card. Everything responds live to the levers — especially place_investment
  // and the two 2026 area missions (Mission North East, Mission Coastal). Self-contained.

  import type { YearResult } from '../lib/types';
  import { regionalise, regionalSnapshot, type RegionSnapshot, REGIONS_BY_CODE } from '../lib/regions';
  import { baselineLevers } from '../lib/levers';
  import type { LeverState } from '../lib/types';
  import { fmtNum } from '../lib/format';

  interface Props {
    sim: YearResult[]; baseSim: YearResult[]; levers: LeverState; horizon: number;
    selected: string; onSelect: (code: string) => void;
  }
  let { sim, baseSim, levers, horizon, selected, onSelect }: Props = $props();

  const row = (s: YearResult[], yr: number) => s.find((y) => y.year === yr) ?? s[s.length - 1];
  const ys = $derived(horizon - sim[0].year);
  const natRow = $derived(row(sim, horizon));
  const natBaseRow = $derived(row(baseSim, horizon));
  const snap = $derived<RegionSnapshot[]>(regionalSnapshot(natRow, natBaseRow, levers, baselineLevers(), ys));
  const byCode = $derived(Object.fromEntries(snap.map((r) => [r.code, r])) as Record<string, RegionSnapshot>);
  const coastRow = $derived(row(regionalise(sim, 'COAST', levers), horizon));
  const coastBase = $derived(row(regionalise(baseSim, 'COAST', baselineLevers()), horizon));

  const METRICS = [
    { key: 'gapKS4', label: 'Disadvantage gap', unit: 'mo', goodIfUp: false, dp: 1 },
    { key: 'attainment8', label: 'Attainment 8', unit: '', goodIfUp: true, dp: 1 },
    { key: 'grade5EM', label: 'Grade 5+ E&M', unit: '%', goodIfUp: true, dp: 1 },
    { key: 'persistentAbsence', label: 'Persistent absence', unit: '%', goodIfUp: false, dp: 1 },
    { key: 'neet', label: 'NEET 16–24', unit: '%', goodIfUp: false, dp: 1 },
  ] as const;
  let metric = $state<(typeof METRICS)[number]['key']>('gapKS4');
  const M = $derived(METRICS.find((m) => m.key === metric)!);
  const natVal = $derived((natRow as any)[metric] as number);

  const val = (r: RegionSnapshot) => (r as any)[metric] as number;
  const spread = $derived(Math.max(0.001, ...snap.map((r) => Math.abs(val(r) - natVal))));
  function goodness(r: RegionSnapshot): number { // +1 best … -1 worst, vs national
    const d = (val(r) - natVal) / spread; return M.goodIfUp ? d : -d;
  }

  // diverging colour: teal (good) ↔ paper (≈national) ↔ terracotta (bad)
  const TEAL = [63, 125, 110], TERRA = [154, 59, 46], MID = [231, 222, 204];
  function colour(g: number): string {
    const t = Math.max(-1, Math.min(1, g)); const tgt = t >= 0 ? TEAL : TERRA; const k = Math.abs(t) * 0.9;
    const c = [0, 1, 2].map((i) => Math.round(MID[i] + (tgt[i] - MID[i]) * k));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  const ink = (g: number) => (Math.abs(g) > 0.55 ? '#fff' : '#1c1611');

  // tile cartogram: rough geographic grid (col,row)
  const POS: Record<string, [number, number]> = {
    NE: [2, 0], NW: [1, 1], YH: [2, 1], WM: [1, 2], EM: [2, 2], EE: [3, 2], SW: [0, 3], SE: [1, 3], LDN: [2, 3],
  };
  const CW = 94, CH = 72, GAP = 8, PAD = 6;
  const W = PAD * 2 + 4 * CW + 3 * GAP, H = PAD * 2 + 4 * CH + 3 * GAP;
  const tx = (c: number) => PAD + c * (CW + GAP);
  const tyy = (r: number) => PAD + r * (CH + GAP);

  const ranked = $derived([...snap].sort((a, b) => (M.goodIfUp ? val(b) - val(a) : val(a) - val(b))));
  const barMax = $derived(Math.max(...snap.map((r) => val(r)), natVal) * 1.04);

  const detail = $derived(selected !== 'all' && selected !== 'COAST' ? byCode[selected] : null);
  const missionNe = $derived((levers.mission_ne ?? 0) > 0);
  const missionCoast = $derived((levers.mission_coastal ?? 0) > 0);
  function missionTag(code: string): string | null {
    if (code === 'NE' && missionNe) return 'Mission North East';
    if ((REGIONS_BY_CODE[code]?.coastal ?? 0) >= 0.3 && missionCoast) return 'Mission Coastal';
    return null;
  }
</script>

<div class="reg">
  <div class="head">
    <div>
      <h3>Outcomes by region · {horizon}</h3>
      <p class="sub">The national model decomposed onto the 9 English regions. Place-based levers — <b>place-based investment</b> and the
        2026 <b>Mission North East</b> &amp; <b>Mission Coastal</b> — close the worst regions’ penalties. Click a region to filter the whole page to it.</p>
    </div>
    <div class="msel" role="group" aria-label="Metric">
      {#each METRICS as m}
        <button class:active={metric === m.key} onclick={() => (metric = m.key)}>{m.label}</button>
      {/each}
    </div>
  </div>

  <div class="grid2">
    <!-- tile cartogram -->
    <div class="mapwrap">
      <svg viewBox="0 0 {W} {H}" width="100%" role="img" aria-label="England regions tile map coloured by {M.label}">
        {#each snap as r (r.code)}
          {@const p = POS[r.code]}
          {@const g = goodness(r)}
          <g class="tile" class:sel={selected === r.code} role="button" tabindex="0"
             onclick={() => onSelect(selected === r.code ? 'all' : r.code)}
             onkeydown={(e) => { if (e.key === 'Enter') onSelect(selected === r.code ? 'all' : r.code); }}>
            <rect x={tx(p[0])} y={tyy(p[1])} width={CW} height={CH} rx="7" fill={colour(g)}
                  stroke={selected === r.code ? '#1c1611' : 'rgba(28,22,17,0.18)'} stroke-width={selected === r.code ? 2 : 1} />
            <text x={tx(p[0]) + 8} y={tyy(p[1]) + 16} class="t-code" fill={ink(g)}>{r.code}</text>
            {#if r.coastal >= 0.3}<text x={tx(p[0]) + CW - 8} y={tyy(p[1]) + 16} class="t-coast" fill={ink(g)} text-anchor="end">≈</text>{/if}
            <text x={tx(p[0]) + 8} y={tyy(p[1]) + 44} class="t-val" fill={ink(g)}>{fmtNum(val(r), M.dp)}<tspan class="t-unit">{M.unit}</tspan></text>
            {#if missionTag(r.code)}<text x={tx(p[0]) + 8} y={tyy(p[1]) + 60} class="t-mission" fill={ink(g)}>★ mission</text>{/if}
          </g>
        {/each}
      </svg>
      <div class="legend">
        <span><i style="background:{colour(1)}"></i>better than England</span>
        <span><i style="background:{colour(0)}"></i>≈ England ({fmtNum(natVal, M.dp)}{M.unit})</span>
        <span><i style="background:{colour(-1)}"></i>worse</span>
        <span class="lg-coast">≈ = coastal</span>
      </div>
    </div>

    <!-- ranked bars -->
    <div class="bars">
      {#each ranked as r (r.code)}
        {@const g = goodness(r)}
        <button class="bar-row" class:sel={selected === r.code} onclick={() => onSelect(selected === r.code ? 'all' : r.code)}>
          <span class="b-name">{r.name}</span>
          <span class="b-track">
            {#if metric === 'gapKS4' && r.gapBase - r.gapKS4 > 0.05}
              <span class="b-ghost" style="width:{(r.gapBase / barMax) * 100}%"></span>
            {/if}
            <span class="b-fill" style="width:{(val(r) / barMax) * 100}%; background:{colour(g)}"></span>
            <span class="b-natline" style="left:{(natVal / barMax) * 100}%"></span>
          </span>
          <span class="b-val">{fmtNum(val(r), M.dp)}{M.unit}</span>
        </button>
      {/each}
      <div class="bars-foot">
        <span class="bf-nat">▏ England {fmtNum(natVal, M.dp)}{M.unit}</span>
        {#if metric === 'gapKS4'}<span class="bf-ghost">▏ faint = gap without place-based policy</span>{/if}
      </div>
    </div>
  </div>

  <!-- detail / coastal cross-cut -->
  <div class="cards">
    {#if detail}
      {@const tag = missionTag(detail.code)}
      <div class="card detail">
        <div class="c-head"><span class="c-name">{detail.name}</span>{#if tag}<span class="c-tag">★ {tag}</span>{/if}</div>
        <div class="c-metrics">
          <span><b>{fmtNum(detail.gapKS4, 1)}</b><small>gap (mo)</small></span>
          <span><b>{fmtNum(detail.attainment8, 1)}</b><small>A8</small></span>
          <span><b>{fmtNum(detail.grade5EM, 1)}%</b><small>grade 5+</small></span>
          <span><b>{fmtNum(detail.persistentAbsence, 1)}%</b><small>PA</small></span>
          <span><b>{fmtNum(detail.neet, 1)}%</b><small>NEET</small></span>
          <span><b>{(detail.closure * 100).toFixed(0)}%</b><small>penalty closed</small></span>
        </div>
        {#if detail.gapBase - detail.gapKS4 > 0.05}
          <p class="c-close">Place-based policy closes <b>{fmtNum(detail.gapBase - detail.gapKS4, 1)} months</b> of {detail.name}’s gap by {horizon} ({fmtNum(detail.gapBase, 1)}→{fmtNum(detail.gapKS4, 1)}mo).</p>
        {/if}
        <p class="c-note">{detail.note}</p>
      </div>
    {:else}
      <div class="card hint">Click a region tile or bar to see its detail — and to filter the whole page to that region.</div>
    {/if}

    <!-- coastal cross-cut (overlaps regions; targeted by Mission Coastal) -->
    <button class="card coast" class:sel={selected === 'COAST'} onclick={() => onSelect(selected === 'COAST' ? 'all' : 'COAST')}>
      <div class="c-head"><span class="c-name">≈ Coastal cross-cut</span>{#if missionCoast}<span class="c-tag">★ Mission Coastal</span>{/if}</div>
      <div class="c-metrics">
        <span><b>{fmtNum(coastRow.gapKS4, 1)}</b><small>gap (mo)</small></span>
        <span><b>{fmtNum(coastRow.attainment8, 1)}</b><small>A8</small></span>
        <span><b>{fmtNum(coastRow.grade5EM, 1)}%</b><small>grade 5+</small></span>
        <span><b>{fmtNum(coastRow.neet, 1)}%</b><small>NEET</small></span>
      </div>
      {#if coastBase.gapKS4 - coastRow.gapKS4 > 0.05}
        <p class="c-close">Mission Coastal + place-based investment close <b>{fmtNum(coastBase.gapKS4 - coastRow.gapKS4, 1)} months</b> of the coastal penalty.</p>
      {/if}
      <p class="c-note">Seaside communities across every region (Hastings, Scarborough, Blackpool, the South West coast). A cross-cut, not a region — its weakness is hidden when merged with wealthier inland averages.</p>
    </button>
  </div>

  <p class="foot">
    Regional baselines: DfE EES Key-Stage-4 2023/24 (per-region Attainment 8, validated to the national 46.1 on DfE pupil weights) +
    EPI Annual Report 2025 regional gaps; persistent absence DfE 2023/24 (London 17.9% vs North East 22.1%). Mission North East &amp;
    Mission Coastal are real programmes (Schools White Paper, Feb 2026; launch Sept 2026) but <b>no budget is published</b> and
    place-based attainment evidence is weak — the modelled penalty-closure is deliberately small, slow and capped, and the 9 regions
    always weight back to the national figure.
  </p>
</div>

<style>
  .reg { display: flex; flex-direction: column; gap: 14px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; flex-wrap: wrap; }
  h3 { font-family: 'Fraunces', serif; font-weight: 600; font-size: 16px; margin: 0 0 3px; color: #1c1611; }
  .sub { margin: 0; font-size: 11.5px; line-height: 1.45; color: rgba(28,22,17,0.65); max-width: 70ch; }
  .sub b { color: #1c1611; }
  .msel { display: inline-flex; flex-wrap: wrap; gap: 3px; background: rgba(28,22,17,0.06); padding: 3px; border-radius: 8px; }
  .msel button { background: transparent; border: none; color: var(--ink, #1c1611); padding: 5px 9px; border-radius: 5px;
    font-family: 'JetBrains Mono', monospace; font-size: 10px; cursor: pointer; white-space: nowrap; }
  .msel button.active { background: #1c1611; color: #f1ead6; }

  .grid2 { display: grid; grid-template-columns: minmax(300px, 440px) minmax(280px, 1fr); gap: 22px; align-items: start; }
  @media (max-width: 760px) { .grid2 { grid-template-columns: 1fr; } }

  .mapwrap { display: flex; flex-direction: column; gap: 6px; }
  svg { display: block; width: 100%; height: auto; }
  .tile { cursor: pointer; }
  .tile:hover rect { stroke: #1c1611; stroke-width: 1.6; }
  .t-code { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; }
  .t-coast { font-family: 'JetBrains Mono', monospace; font-size: 13px; opacity: 0.7; }
  .t-val { font-family: 'Fraunces', serif; font-weight: 600; font-size: 21px; }
  .t-unit { font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 500; }
  .t-mission { font-family: 'JetBrains Mono', monospace; font-size: 8px; letter-spacing: 0.03em; }
  .legend { display: flex; flex-wrap: wrap; gap: 4px 12px; font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.6); }
  .legend i { display: inline-block; width: 11px; height: 9px; border-radius: 2px; vertical-align: middle; margin-right: 4px; border: 1px solid rgba(28,22,17,0.15); }
  .lg-coast { color: rgba(28,22,17,0.5); }

  .bars { display: flex; flex-direction: column; gap: 4px; }
  .bar-row { display: grid; grid-template-columns: 96px 1fr 52px; align-items: center; gap: 8px; background: none; border: none;
    padding: 3px 4px; border-radius: 5px; cursor: pointer; text-align: left; }
  .bar-row:hover { background: rgba(28,22,17,0.05); }
  .bar-row.sel { background: rgba(28,22,17,0.09); }
  .b-name { font-size: 10.5px; color: rgba(28,22,17,0.8); line-height: 1.15; }
  .b-track { position: relative; height: 16px; background: rgba(28,22,17,0.06); border-radius: 3px; }
  .b-ghost { position: absolute; left: 0; top: 0; bottom: 0; background: rgba(28,22,17,0.16); border-radius: 3px; }
  .b-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; }
  .b-natline { position: absolute; top: -2px; bottom: -2px; width: 2px; background: #1c1611; }
  .b-val { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; font-weight: 600; color: #1c1611; text-align: right; }
  .bars-foot { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 3px; font-family: 'JetBrains Mono', monospace; font-size: 8.5px; color: rgba(28,22,17,0.5); }

  .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 720px) { .cards { grid-template-columns: 1fr; } }
  .card { border: 1px solid rgba(28,22,17,0.14); border-radius: 8px; padding: 10px 12px; background: rgba(255,255,255,0.4); text-align: left; }
  .card.coast { cursor: pointer; border-color: rgba(74,124,124,0.35); background: rgba(74,124,124,0.06); }
  .card.coast.sel, .card.detail { border-left: 3px solid #1c1611; }
  .card.coast.sel { border-color: #4a7c7c; }
  .card.hint { display: flex; align-items: center; font-size: 11.5px; color: rgba(28,22,17,0.55); }
  .c-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
  .c-name { font-family: 'Fraunces', serif; font-weight: 600; font-size: 14px; color: #1c1611; }
  .c-tag { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: #9a3b2e; background: rgba(154,59,46,0.1); padding: 2px 6px; border-radius: 4px; }
  .c-metrics { display: flex; flex-wrap: wrap; gap: 8px 14px; }
  .c-metrics span { display: flex; flex-direction: column; }
  .c-metrics b { font-family: 'Fraunces', serif; font-weight: 600; font-size: 17px; color: #1c1611; line-height: 1; }
  .c-metrics small { font-family: 'JetBrains Mono', monospace; font-size: 8px; text-transform: uppercase; letter-spacing: 0.04em; color: rgba(28,22,17,0.5); }
  .c-close { margin: 7px 0 0; font-size: 11px; line-height: 1.4; color: #2f7d4f; }
  .c-close b { color: #276b43; }
  .c-note { margin: 6px 0 0; font-size: 10.5px; line-height: 1.45; color: rgba(28,22,17,0.6); }
  .foot { margin: 0; font-size: 10px; line-height: 1.5; color: rgba(28,22,17,0.52); }
  .foot b { color: rgba(28,22,17,0.75); }
</style>
