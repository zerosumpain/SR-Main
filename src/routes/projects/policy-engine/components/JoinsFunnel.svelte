<script lang="ts">
  // JoinsFunnel — ILLUSTRATIVE, NOT ENGINE-COUPLED. A coverage slider over the hand-offs
  // between the services that hold pieces of a child's picture: at a given "join coverage"
  // probability, what share of children's signal survives every hand-off, and how many are
  // "caught" vs "missed" across a synthetic at-risk cohort. The cohort anchor is the
  // Children's Commissioner estimate (~829k "invisible" of ~2.3m living with a family-risk
  // factor, 2018-19) — dated, contested, methodology-dependent — and the number of hand-offs
  // is the agencies-per-child assumption (~4-8, no published mean). Every figure is a labelled
  // modelling assumption; this does NOT read the policy engine. Self-contained, Svelte 5 runes.
  import { app } from '../lib/appState.svelte';
  import { ILLUSTRATIVE_PARAMS } from '../lib/jigsawIntel';
  import ConfidenceBadge from './ConfidenceBadge.svelte';

  const eli = $derived(app.narrative === 'eli5');

  // ---- controls (illustrative) ----
  let coverage = $state(70);   // per-hand-off join coverage, %
  let handoffs = $state(5);    // number of hand-offs between holders (≈ agencies-per-child − 1)

  const HMIN = ILLUSTRATIVE_PARAMS.agenciesPerChild.low - 1;   // 3
  const HMAX = ILLUSTRATIVE_PARAMS.agenciesPerChild.high - 1;  // 7

  // ---- the cohort anchor (illustrative, contested) ----
  const COHORT = ILLUSTRATIVE_PARAMS.cohort.familyRisk; // ~2.3m children with a family-risk factor

  // Survival of a child's signal through every hand-off = p^handoffs (independent-joins assumption).
  const p = $derived(coverage / 100);
  const survival = $derived(Math.pow(p, handoffs));
  const caught = $derived(Math.round(COHORT * survival));
  const missed = $derived(COHORT - caught);
  const missedPct = $derived((1 - survival) * 100);

  const fmt = (v: number) => v.toLocaleString('en-GB');
  const fmtM = (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}m` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`;

  // ---- funnel geometry: one bar per hand-off, narrowing as signal is lost ----
  const W = 560, H = 220, X0 = 14, X1 = 546, Y0 = 14, BARH = 30, GAP = 8;
  const stages = $derived.by(() => {
    const out: { i: number; surviving: number; frac: number; y: number }[] = [];
    for (let i = 0; i <= handoffs; i++) {
      const frac = Math.pow(p, i);
      out.push({ i, surviving: Math.round(COHORT * frac), frac, y: Y0 + i * (BARH + GAP) });
    }
    return out;
  });
  const svgH = $derived(Y0 + (handoffs + 1) * (BARH + GAP) + 6);
  const barW = (frac: number) => (X1 - X0) * frac;
</script>

<div class="jf">
  <div class="jf-flag">
    <span class="jf-flag-lab">ILLUSTRATIVE · NOT ENGINE-COUPLED</span>
    <ConfidenceBadge level="contested" note="Cohort anchor is a dated (pre-2020), contested estimate; the per-hand-off coverage and hand-off count are modelling assumptions, not measured rates." small />
  </div>

  <div class="jf-ctl">
    <div class="ctl">
      <span class="ctl-lab">{eli ? 'How often a hand-over works' : 'Join coverage per hand-off'}</span>
      <input type="range" min="20" max="100" step="1" bind:value={coverage}
        aria-label="Join coverage per hand-off, percent" style="--c:#2f7d4f" />
      <span class="ctl-val">{coverage}%</span>
    </div>
    <div class="ctl">
      <span class="ctl-lab">{eli ? 'How many hand-overs' : 'Hand-offs between holders'}</span>
      <input type="range" min={HMIN} max={HMAX} step="1" bind:value={handoffs}
        aria-label="Number of hand-offs between holders" style="--c:#2f6f97" />
      <span class="ctl-val">{handoffs}</span>
    </div>
  </div>

  <div class="jf-cards">
    <div class="card caught">
      <span class="cv">{fmtM(caught)}</span>
      <span class="cl">{eli ? 'children whose signal makes it through every hand-over' : 'children whose signal survives all hand-offs'}</span>
    </div>
    <div class="card missed">
      <span class="cv">{fmtM(missed)}</span>
      <span class="cl">{eli ? 'children whose signal is lost somewhere along the way' : 'children whose signal is lost at some hand-off'}</span>
      <span class="cb">{missedPct.toFixed(0)}% {eli ? 'of the at-risk group' : 'of the at-risk cohort'}</span>
    </div>
  </div>

  <div class="jf-chart">
    <svg viewBox="0 0 {W} {svgH}" role="img"
      aria-label="Funnel: the share of the at-risk cohort whose signal survives each successive hand-off">
      {#each stages as s (s.i)}
        <rect x={X0} y={s.y} width={Math.max(barW(s.frac), 2)} height={BARH} rx="4"
          class="bar" class:first={s.i === 0} class:last={s.i === handoffs} />
        <rect x={X0} y={s.y} width={X1 - X0} height={BARH} rx="4" class="bar-ghost" />
        <text x={X0 + 8} y={s.y + BARH / 2 + 4} class="bar-t">
          {s.i === 0 ? (eli ? 'all at-risk children' : 'at-risk cohort') : `after hand-off ${s.i}`}
        </text>
        <text x={X1 - 6} y={s.y + BARH / 2 + 4} class="bar-n" text-anchor="end">{fmtM(s.surviving)}</text>
      {/each}
    </svg>
  </div>

  <div class="jf-assume">
    <span class="as-lab">{eli ? 'What this toy assumes' : 'Assumptions (each labelled, none measured)'}</span>
    <ul>
      {#if eli}
        <li><b>The cohort</b> is the Children’s Commissioner’s estimate of ~2.3m children living with a family-background risk — an old (pre-2020) estimate that experts dispute.</li>
        <li><b>The hand-overs</b> stand in for the ~4–8 services that hold a piece of one child. Nobody publishes the real average.</li>
        <li><b>The maths</b> assumes each hand-over works independently, so the chance of a child’s signal getting all the way through is the coverage multiplied by itself once per hand-over. Real systems are messier.</li>
      {:else}
        <li><b>Cohort anchor:</b> ~{fmt(COHORT)} children living with a family-background risk factor (Children’s Commissioner, <i>Childhood Vulnerability in England</i>, 2018–19) — dated and methodology-dependent; the ~829k “invisible” sub-figure is the same source.</li>
        <li><b>Hand-off count:</b> derived from the agencies-per-child assumption (~{ILLUSTRATIVE_PARAMS.agenciesPerChild.low}–{ILLUSTRATIVE_PARAMS.agenciesPerChild.high}); no authoritative national mean exists.</li>
        <li><b>Survival model:</b> independent-joins, so signal survival = (coverage)<sup>hand-offs</sup>. This is a deliberately simple order-of-magnitude device, not a behavioural model of the system.</li>
        <li><b>It does not read the policy engine</b> and produces no engine outcome — it is a standalone illustration of compounding loss across hand-offs.</li>
      {/if}
    </ul>
    <div class="as-refs">
      <a class="rc" href="https://www.childrenscommissioner.gov.uk/resource/childhood-vulnerability-in-england-2019/" target="_blank" rel="noopener">Children’s Commissioner — Childhood Vulnerability ↗</a>
    </div>
  </div>
</div>

<style>
  .jf { display: flex; flex-direction: column; gap: 13px; }
  .jf-flag { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  .jf-flag-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 700; letter-spacing: 0.08em;
    color: var(--accent-ink); background: var(--accent-ink-tint-12); border: 1px solid var(--accent-ink-tint-35); border-radius: var(--radius-round); padding: 2px 7px; }

  .jf-ctl { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px;
    padding: 12px 14px; border: 1px solid rgba(28,22,17,0.14); border-radius: var(--radius-round); background: rgba(255,255,255,0.42); }
  .ctl { display: flex; align-items: center; gap: 9px; }
  .ctl-lab { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.05em;
    color: rgba(28,22,17,0.6); flex: 1 1 auto; }
  .ctl input { flex: 1 1 90px; min-width: 90px; accent-color: var(--c); }
  .ctl-val { font-family: 'Fraunces', serif; font-weight: 600; font-size: 19px; color: var(--ink); min-width: 44px; text-align: right; }

  .jf-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
  .card { display: flex; flex-direction: column; gap: 3px; padding: 11px 13px; border: 1px solid rgba(28,22,17,0.14); border-radius: var(--radius-round); background: rgba(255,255,255,0.42); }
  .card.caught { border-left: 3px solid var(--success); }
  .card.missed { border-left: 3px solid var(--error); background: var(--error-bg); }
  .cv { font-family: 'Fraunces', serif; font-weight: 600; font-size: 28px; line-height: 1; color: var(--ink); }
  .card.caught .cv { color: var(--success); } .card.missed .cv { color: #8a2d3a; }
  .cl { font-size: 11px; line-height: 1.35; color: rgba(28,22,17,0.66); }
  .cb { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: #8a2d3a; }

  .jf-chart { background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.1); border-radius: var(--radius-round); padding: 10px 12px; overflow-x: auto; }
  .jf-chart svg { display: block; width: 100%; min-width: 460px; height: auto; }
  .bar-ghost { fill: none; stroke: rgba(28,22,17,0.1); stroke-width: 1; }
  .bar { fill: rgba(47,111,151,0.55); transition: width 0.25s ease; }
  .bar.first { fill: rgba(47,125,79,0.55); }
  .bar.last { fill: rgba(177,69,94,0.5); }
  .bar-t { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; fill: rgba(28,22,17,0.7); }
  .bar-n { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; fill: rgba(28,22,17,0.8); }

  .jf-assume { border: 1px solid var(--accent-ink-tint-35); border-radius: var(--radius-round); background: var(--accent-ink-tint-06); padding: 11px 14px; }
  .as-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.07em; text-transform: uppercase;
    color: var(--accent-ink); font-weight: 600; margin-bottom: 7px; }
  .jf-assume ul { margin: 0; padding-left: 17px; display: flex; flex-direction: column; gap: 5px; }
  .jf-assume li { font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.74); }
  .jf-assume b { color: var(--ink); }
  .as-refs { margin-top: 8px; }
  .rc { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; color: var(--accent-ink); text-decoration: none;
    border: 1px solid var(--accent-ink-tint-35); border-radius: var(--radius-round); padding: 2px 7px; background: var(--accent-ink-tint-06); }
</style>
