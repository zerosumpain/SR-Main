<script lang="ts">
  // NowcastMock — what we know today vs what an admin-data nowcast would show:
  // the quarterly LFS (wide CIs, published ~6 weeks late) against a hypothetical
  // monthly RTI/UC/ILR-fed nowcast. ILLUSTRATIVE series; the contrast is the point.
  import { app } from '../lib/appState.svelte';

  const eli = $derived(app.narrative === 'eli5');

  // 24 illustrative months of a rising NEET rate (~12.5 → 13.6)
  const MONTHS = 24;
  const nowcast = Array.from({ length: MONTHS }, (_, i) =>
    12.5 + 1.1 * (i / (MONTHS - 1)) + 0.18 * Math.sin(i * 1.7) + 0.08 * Math.sin(i * 0.6));
  // LFS: quarterly observations of the same path, ±0.9pp CI, published 2 months late
  const lfs = [2, 5, 8, 11, 14, 17, 20, 23].map((m) => ({ m, v: nowcast[m] + (m % 3 === 2 ? 0.35 : -0.25), ci: 0.9, pub: Math.min(MONTHS - 1, m + 2) }));

  const X0 = 56, X1 = 716, Y0 = 18, Y1 = 198;
  const yMin = 10.5, yMaxV = 15.5;
  const x = (m: number) => X0 + (m / (MONTHS - 1)) * (X1 - X0);
  const y = (v: number) => Y1 - ((v - yMin) / (yMaxV - yMin)) * (Y1 - Y0);
  const ncPath = nowcast.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const ncBand = nowcast.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v + 0.2).toFixed(1)}`).join(' ')
    + ' ' + [...nowcast].reverse().map((v, j) => `L ${x(MONTHS - 1 - j).toFixed(1)} ${y(v - 0.2).toFixed(1)}`).join(' ') + ' Z';
</script>

<div class="nm">
  <div class="nm-scroll">
  <svg viewBox="0 0 760 250" role="img" aria-label="Quarterly survey measurement of NEET versus a hypothetical monthly admin-data nowcast">
    {#each [11, 12, 13, 14, 15] as g}
      <line x1={X0} x2={X1} y1={y(g)} y2={y(g)} class="grid" />
      <text x={X0 - 8} y={y(g) + 3} class="ax-y">{g}%</text>
    {/each}
    {#each [0, 6, 12, 18, 23] as m}
      <text x={x(m)} y={Y1 + 16} class="ax-x">{m === 23 ? 'now' : `m${m}`}</text>
    {/each}

    <path d={ncBand} class="nc-band" />
    <path d={ncPath} class="nc-line" />

    {#each lfs as p (p.m)}
      <line x1={x(p.m)} x2={x(p.m)} y1={y(p.v - p.ci)} y2={y(p.v + p.ci)} class="lfs-ci" />
      <circle cx={x(p.m)} cy={y(p.v)} r="5" class="lfs-pt" />
      <!-- publication lag arrow -->
      <line x1={x(p.m)} x2={x(p.pub) - 3} y1={y(p.v)} y2={y(p.v)} class="lag" marker-end="url(#lagarrow)" />
    {/each}

    <defs>
      <marker id="lagarrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M0,0 L10,5 L0,10 z" fill="rgba(154,123,31,0.7)" />
      </marker>
    </defs>

    <text x={X1 - 6} y={y(nowcast[MONTHS - 1]) - 10} class="cl nc" text-anchor="end">{eli ? 'what the tax & benefits data could show, monthly' : 'admin nowcast (RTI · UC · ILR) — monthly, ±0.2pp'}</text>
    <text x={x(2) + 10} y={y(lfs[0].v) + 22} class="cl lfs">{eli ? 'what we actually get: a wobbly survey, late' : 'LFS: quarterly, ±0.9pp, published ~6 weeks late →'}</text>
    <text x={(X0 + X1) / 2} y={Y1 + 33} class="ax-title">→ months (illustrative)</text>
  </svg>
  </div>
  <p class="nm-note">
    <b>{eli ? 'Pretend numbers, real contrast.' : 'Illustrative series — the contrast is the exhibit.'}</b>
    {eli
      ? 'The dots with whiskers are how England measures its million NEETs today: a survey, every three months, give-or-take nearly a percentage point, arriving six weeks late. The smooth line is what the government’s own tax, benefits and college records could show every month. The IFS has already demonstrated the method works.'
      : 'The whiskered dots are the actual measurement regime: a quarterly survey with ~±0.9pp intervals and a publication lag (arrows), carrying ONS volatility warnings since 2023. The line is a monthly nowcast assembled from data the state already holds — HMRC RTI payroll, Universal Credit, ILR enrolment. The IFS has shown admin data tracks NEET better than the survey; the linkage exists in LEO at research cadence. Operationalising it is opportunity-ladder rung 7 — aggregate-only, so the cheapest governance bill on the ladder.'}
  </p>
</div>

<style>
  .nm { background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.1); border-radius: 12px; padding: 12px 14px; }
  /* keep label text legible on phones: scroll sideways rather than shrink */
  .nm-scroll { overflow-x: auto; }
  .nm svg { display: block; width: 100%; min-width: 560px; height: auto; }
  .grid { stroke: rgba(28,22,17,0.09); stroke-width: 1; }
  .ax-x, .ax-y { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; fill: rgba(28,22,17,0.5); }
  .ax-x { text-anchor: middle; } .ax-y { text-anchor: end; }
  .ax-title { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.04em; fill: rgba(28,22,17,0.5); text-anchor: middle; text-transform: uppercase; }
  .nc-band { fill: rgba(47,125,79,0.12); stroke: none; }
  .nc-line { fill: none; stroke: #2f7d4f; stroke-width: 2.2; }
  .lfs-pt { fill: #9a7b1f; stroke: var(--paper, #f1ead6); stroke-width: 2; }
  .lfs-ci { stroke: rgba(154,123,31,0.55); stroke-width: 2; }
  .lag { stroke: rgba(154,123,31,0.5); stroke-width: 1.1; stroke-dasharray: 2 3; }
  .cl { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; font-weight: 600; }
  .cl.nc { fill: #2f7d4f; } .cl.lfs { fill: #9a7b1f; }
  .nm-note { margin: 8px 0 0; font-size: 12px; line-height: 1.55; color: rgba(28,22,17,0.65); }
  .nm-note b { color: var(--ink, #1c1611); }
</style>
