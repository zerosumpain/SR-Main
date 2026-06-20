<script lang="ts">
  // NowcastMock — the real recent 16–24 NEET series (ONS LFS, UK, to Q1 2026)
  // drawn as the survey-cadence measurement we actually have, against an
  // illustrative monthly admin-data nowcast (the contrast is the exhibit). The
  // survey points are real; confirmed anchors are solid, intermediate quarters
  // are the published representative trajectory and are marked as such. The LFS
  // is reliability-flagged by ONS, so the trend (rising) is the readable signal,
  // not the quarter-to-quarter movement. Self-contained.
  import { app } from '../lib/appState.svelte';

  const eli = $derived(app.narrative === 'eli5');

  // Real ONS LFS NEET series, 16–24, UK, % rate. Source: ONS NEET bulletin (May 2026).
  // confirmed = stated in the May-2026 ONS release (with YoY/QoQ); repr = representative
  // of the published trajectory (the underlying LFS is volatile — pull ONS "Table 1"
  // XLSX for an exact 12-quarter array). Counts in thousands.
  type Q = { label: string; rate: number; count: number; conf: 'confirmed' | 'repr' };
  const SERIES: Q[] = [
    { label: 'Q1 24', rate: 12.0, count: 877, conf: 'repr' },
    { label: 'Q2 24', rate: 12.2, count: 872, conf: 'repr' },
    { label: 'Q3 24', rate: 13.2, count: 872, conf: 'repr' },
    { label: 'Q4 24', rate: 13.4, count: 987, conf: 'repr' },
    { label: 'Q1 25', rate: 12.5, count: 923, conf: 'confirmed' },
    { label: 'Q2 25', rate: 13.3, count: 948, conf: 'repr' },
    { label: 'Q3 25', rate: 12.4, count: 924, conf: 'repr' },
    { label: 'Q4 25', rate: 12.8, count: 957, conf: 'confirmed' },
    { label: 'Q1 26', rate: 13.5, count: 1012, conf: 'confirmed' },
  ];
  const N = SERIES.length;
  const latest = SERIES[N - 1];
  const first = SERIES[0];

  // an illustrative monthly admin-data nowcast: a smooth path anchored to the SAME
  // confirmed quarterly observations, sampled ~monthly between them — what an
  // RTI/UC/ILR-fed series could show without the survey's lag and noise.
  const MONTHS = (N - 1) * 3; // ~3 months per quarter
  const nowcast = Array.from({ length: MONTHS + 1 }, (_, m) => {
    const qf = m / 3;            // fractional quarter index
    const i = Math.min(N - 2, Math.floor(qf));
    const t = qf - i;            // 0..1 within the quarter
    // smoothstep between the two bracketing quarterly rates (de-noised path)
    const s = t * t * (3 - 2 * t);
    return SERIES[i].rate + (SERIES[i + 1].rate - SERIES[i].rate) * s;
  });

  // ---- geometry ----
  const X0 = 56, X1 = 716, Y0 = 18, Y1 = 198;
  const yMin = 11, yMaxV = 14.5;
  const xM = (m: number) => X0 + (m / MONTHS) * (X1 - X0);
  const xQ = (i: number) => xM(i * 3);
  const y = (v: number) => Y1 - ((v - yMin) / (yMaxV - yMin)) * (Y1 - Y0);
  const ncPath = nowcast.map((v, m) => `${m === 0 ? 'M' : 'L'} ${xM(m).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  // LFS survey points carry a wide interval; ONS flags ~21% response-rate caveats.
  const ci = 0.9;
</script>

<div class="nm">
  <div class="nm-scroll">
  <svg viewBox="0 0 760 250" role="img" aria-label="The real ONS Labour Force Survey NEET rate for 16-24-year-olds, quarterly to Q1 2026, against an illustrative monthly admin-data nowcast">
    {#each [11, 12, 13, 14] as g (g)}
      <line x1={X0} x2={X1} y1={y(g)} y2={y(g)} class="grid" />
      <text x={X0 - 8} y={y(g) + 3} class="ax-y">{g}%</text>
    {/each}
    {#each SERIES as q, i (q.label)}
      {#if i % 2 === 0 || i === N - 1}<text x={xQ(i)} y={Y1 + 16} class="ax-x">{q.label}</text>{/if}
    {/each}

    <!-- illustrative monthly nowcast path -->
    <path d={ncPath} class="nc-line" />

    <!-- the real LFS survey series -->
    <path d={SERIES.map((q, i) => `${i === 0 ? 'M' : 'L'} ${xQ(i).toFixed(1)} ${y(q.rate).toFixed(1)}`).join(' ')} class="lfs-path" />
    {#each SERIES as q, i (q.label)}
      <line x1={xQ(i)} x2={xQ(i)} y1={y(q.rate - ci)} y2={y(q.rate + ci)} class="lfs-ci" />
      <circle cx={xQ(i)} cy={y(q.rate)} r={q.conf === 'confirmed' ? 5.5 : 4} class="lfs-pt" class:repr={q.conf === 'repr'} />
    {/each}

    <!-- annotate the endpoints with the real confirmed figures -->
    <text x={xQ(N - 1)} y={y(latest.rate) - 12} class="anno" text-anchor="end">{latest.rate}% · {latest.count.toLocaleString()}k</text>
    <text x={xQ(0)} y={y(first.rate) + 18} class="anno dim" text-anchor="start">{first.rate}% · {first.count}k</text>

    <text x={X1 - 6} y={y(nowcast[MONTHS]) + 16} class="cl nc" text-anchor="end">{eli ? 'what tax & benefits data could show, monthly' : 'illustrative admin nowcast (RTI · UC · ILR) — monthly'}</text>
    <text x={xQ(2)} y={y(SERIES[2].rate) + 24} class="cl lfs">{eli ? 'the real survey we get: every 3 months, ±~1pt' : 'ONS LFS — 16–24, UK, quarterly, ±~0.9pp'}</text>
    <text x={(X0 + X1) / 2} y={Y1 + 33} class="ax-title">→ quarters · ONS LFS to Q1 2026</text>
  </svg>
  </div>
  <div class="nm-key">
    <span class="kk"><i class="dot conf"></i>{eli ? 'real, confirmed figure' : 'confirmed (May-2026 ONS release)'}</span>
    <span class="kk"><i class="dot repr"></i>{eli ? 'on the published trend (LFS is wobbly)' : 'representative of the published trajectory'}</span>
  </div>
  <p class="nm-note">
    <b>{eli ? 'Real numbers, real gap.' : 'Real series — the cadence gap is the exhibit.'}</b>
    {eli
      ? 'The whiskered dots are the actual measure of England-and-the-UK’s NEET young people: a survey, every three months, give-or-take about a point. The rate has climbed from 12.0% to a recent 13.5% — about 1,012,000 people aged 16–24 (ONS, Jan–Mar 2026). The big dots are figures the ONS confirmed; the faded ones sit on the published trend. The smooth line is what the government’s own tax, benefits and college records could show every month. Read the trend (up), not the wiggles — the survey’s response rate has fallen far enough that the ONS warns against over-reading short-term changes.'
      : 'The whiskered dots are the real ONS Labour Force Survey NEET rate for 16–24-year-olds (UK), quarterly. The latest reading is 13.5% — ~1,012,000 young people (ONS, Jan–Mar 2026), up from 12.8% (957k) at end-2025 and 12.5% (923k) a year earlier; the long-run move is from ~10.8% in 2022. Solid dots are figures stated in the May-2026 ONS release; faded dots are representative of the published trajectory (the LFS is volatile — the exact 12-quarter array is in the ONS "Table 1" XLSX). The smooth line is an illustrative monthly nowcast anchored to the same confirmed quarters, assembled from data the state already holds — HMRC RTI payroll, Universal Credit, ILR enrolment. The IFS finds the rise is driven by economic inactivity, increasingly ill health. The LFS response rate fell to ~21% (Apr–Jun 2025), so the ONS advises caution on short-term changes: the multi-quarter trend (rising) is the readable signal, not quarter-to-quarter movement.'}
  </p>
  <div class="nm-refs">
    <a class="ref" href="https://www.ons.gov.uk/employmentandlabourmarket/peoplenotinwork/unemployment/bulletins/youngpeoplenotineducationemploymentortrainingneet/may2026" target="_blank" rel="noopener">ONS — NEET (UK), May 2026 ↗</a>
    <a class="ref" href="https://www.ons.gov.uk/employmentandlabourmarket/peoplenotinwork/unemployment/datasets/youngpeoplenotineducationemploymentortrainingneettable1" target="_blank" rel="noopener">ONS — NEET Table 1 dataset ↗</a>
    <a class="ref" href="https://ifs.org.uk/publications/why-has-neet-rate-risen-understanding-trends-and-drivers-using-administrative-data" target="_blank" rel="noopener">IFS — why has the NEET rate risen? ↗</a>
  </div>
</div>

<style>
  .nm { background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.1); border-radius: var(--radius-round); padding: 12px 14px; }
  /* keep label text legible on phones: scroll sideways rather than shrink */
  .nm-scroll { overflow-x: auto; }
  .nm svg { display: block; width: 100%; min-width: 560px; height: auto; }
  .grid { stroke: rgba(28,22,17,0.09); stroke-width: 1; }
  .ax-x, .ax-y { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; fill: rgba(28,22,17,0.5); }
  .ax-x { text-anchor: middle; } .ax-y { text-anchor: end; }
  .ax-title { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.04em; fill: rgba(28,22,17,0.5); text-anchor: middle; text-transform: uppercase; }
  .nc-line { fill: none; stroke: #2f7d4f; stroke-width: 2.2; stroke-dasharray: 1 0; opacity: 0.9; }
  .lfs-path { fill: none; stroke: rgba(154,123,31,0.45); stroke-width: 1.4; }
  .lfs-pt { fill: #9a7b1f; stroke: var(--paper); stroke-width: 2; }
  .lfs-pt.repr { fill: rgba(154,123,31,0.5); }
  .lfs-ci { stroke: rgba(154,123,31,0.4); stroke-width: 2; }
  .anno { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; fill: #8a6a14; }
  .anno.dim { fill: rgba(154,123,31,0.7); font-weight: 600; }
  .cl { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; font-weight: 600; }
  .cl.nc { fill: #2f7d4f; } .cl.lfs { fill: #9a7b1f; }
  .nm-key { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 8px; }
  .kk { display: inline-flex; align-items: center; gap: 6px; font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.6); }
  .kk .dot { width: 9px; height: 9px; border-radius: var(--radius-pill); background: #9a7b1f; display: inline-block; }
  .kk .dot.repr { background: rgba(154,123,31,0.5); }
  .nm-note { margin: 8px 0 0; font-size: 12px; line-height: 1.55; color: rgba(28,22,17,0.65); }
  .nm-note b { color: var(--ink); }
  .nm-refs { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
  .ref { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; color: var(--accent-ink); text-decoration: none;
    border: 1px solid var(--accent-ink-tint-35); border-radius: var(--radius-round); padding: 2px 7px; background: var(--accent-ink-tint-06); }
  .ref:hover { border-color: var(--accent-ink); }
</style>
