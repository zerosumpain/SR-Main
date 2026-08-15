<script lang="ts">
  // The honest core of both pages: the same machinery that powers a good feedback loop powers
  // real harm. The Wisconsin DEWS false-alarm gap + the 2020 England A-level fiasco, paired with
  // the governance guardrails that turn "screen out" into "screen in". Self-contained.
  import { app } from '../lib/appState.svelte';
  import { DEWS_BARS, GUARDRAILS } from '../lib/monitoring';
  const eli = $derived(app.narrative === 'eli5');
  // chart geometry — relative false-alarm rate (percentage points above the White-student baseline)
  const BX0 = 150, BX1 = 470, rowH = 34, top = 18;
  const maxRel = 50;
  const bw = (v: number) => (v / maxRel) * (BX1 - BX0);
</script>

<div class="eth">
  <div class="eth-grid">
    <!-- left: how it goes wrong -->
    <section class="eth-col wrong">
      <h3 class="eth-h"><span class="eth-dot bad"></span>{eli ? 'How it goes wrong' : 'The cautionary evidence'}</h3>
      <p class="eth-lead">
        {#if eli}
          Wisconsin’s drop-out predictor is wrong about <b>3 times in 4</b> when it says a child won’t graduate — and far more wrong about Black and Hispanic students, because it literally used race as an input. It didn’t even improve graduation.
        {:else}
          Wisconsin’s <b>DEWS</b> is wrong about <b>74%</b> of the time when it predicts a student will <i>not</i> graduate — a false-alarm rate accepted by design, but distributed unequally because the model used race and free-lunch status as inputs. A Berkeley analysis found no effect on graduation; the state knew it was unfair from 2021.
        {/if}
      </p>
      <div class="chart">
        <svg viewBox="0 0 490 {top + DEWS_BARS.length * rowH + 26}" role="img" aria-label="Wisconsin DEWS false-alarm rate by student group, relative to White students">
          <text x={BX0} y={12} class="ax">false-alarm rate, vs White students →</text>
          {#each DEWS_BARS as b, i (b.group)}
            {@const y = top + i * rowH + rowH / 2}
            <text x={BX0 - 12} y={y + 4} class="rn" text-anchor="end">{b.group}</text>
            <line x1={BX0} x2={BX0} y1={y - 12} y2={y + 12} class="base" />
            {#if b.rel === 0}
              <rect x={BX0} y={y - 9} width="4" height="18" rx="2" fill="rgba(28,22,17,0.4)" />
              <text x={BX0 + 12} y={y + 4} class="rv">baseline</text>
            {:else}
              <rect x={BX0} y={y - 11} width={bw(b.rel)} height="22" rx="3" fill="#b1455e" opacity={0.55 + i * 0.18} />
              <text x={BX0 + bw(b.rel) + 8} y={y + 4} class="rv hot">+{b.rel}pp</text>
            {/if}
          {/each}
        </svg>
      </div>
      <p class="eth-note">
        {#if eli}
          England has its own scar: in <b>2020</b> an exam algorithm marked tens of thousands of pupils down — poorer schools hardest — until a public outcry forced a U-turn.
        {:else}
          England’s domestic parallel: the <b>2020 A-level algorithm</b> downgraded ~36% of grades below teacher predictions (~3% by two grades), hitting high-achievers in disadvantaged schools hardest, before a full U-turn and the regulator’s resignation.
        {/if}
      </p>
    </section>

    <!-- right: guardrails -->
    <section class="eth-col right">
      <h3 class="eth-h"><span class="eth-dot good"></span>{eli ? 'How to do it safely' : 'The guardrails'}</h3>
      <ul class="grd">
        {#each GUARDRAILS as g (g.do)}
          <li><span class="grd-do">{g.do}</span><span class="grd-why">{g.why}</span></li>
        {/each}
      </ul>
    </section>
  </div>
  <p class="eth-bottom">
    {#if eli}
      The golden rule, agreed by experts everywhere: use these systems to <b>“screen kids in”</b> for help — never to label them, punish them or quietly write them off. The flag is a question for a teacher, not a verdict on a child.
    {:else}
      The defensible framing — endorsed by NCES, Cedefop and UNICEF — is <b>“screen in, not out”</b>: prediction targets support, never punishment or withholding. A flag means “a school is failing this child”, fed to human judgement, never a verdict delivered to the child. It is the same line this simulator draws: a model is a tool for asking better questions of humans.
    {/if}
  </p>
</div>

<style>
  .eth-grid { display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 14px; }
  .eth-col { border: 1px solid rgba(28,22,17,0.12); border-radius: var(--radius-sharp); padding: 13px 15px; }
  .eth-col.wrong { background: var(--error-bg); border-color: var(--error-border); }
  .eth-col.right { background: var(--success-bg); border-color: var(--success-border); }
  .eth-h { display: flex; align-items: center; gap: 8px; font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-body-sm); margin: 0 0 8px; color: var(--ink); }
  .eth-dot { width: 9px; height: 9px; border-radius: var(--radius-pill); }
  .eth-dot.bad { background: var(--error); } .eth-dot.good { background: var(--success); }
  .eth-lead { margin: 0 0 8px; font-size: var(--fs-label); line-height: 1.5; color: rgba(28,22,17,0.78); }
  .eth-lead b { color: var(--ink); }
  .chart { background: rgba(255,255,255,0.5); border: 1px solid rgba(28,22,17,0.08); border-radius: var(--radius-sharp); padding: 6px 8px; }
  .chart svg { display: block; width: 100%; height: auto; }
  .ax { font-family: var(--font-mono); font-size: var(--fs-label-xs); fill: rgba(28,22,17,0.45); text-anchor: start; }
  .rn { font-family: var(--font-body); font-size: var(--fs-label-xs); fill: rgba(28,22,17,0.82); }
  .base { stroke: rgba(28,22,17,0.3); stroke-width: 1.2; }
  .rv { font-family: var(--font-mono); font-size: var(--fs-label-xs); fill: rgba(28,22,17,0.5); }
  .rv.hot { fill: #b1455e; font-weight: 600; }
  .eth-note { margin: 9px 0 0; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.7); padding-left: 10px; border-left: 2px solid var(--error-border); }
  .eth-note b { color: #8a2d3a; }
  .grd { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
  .grd li { display: flex; flex-direction: column; gap: 1px; padding-left: 16px; position: relative; }
  .grd li::before { content: '✓'; position: absolute; left: 0; top: 0; color: var(--success); font-weight: 700; font-size: var(--fs-label-xs); }
  .grd-do { font-family: var(--font-body); font-weight: 600; font-size: var(--fs-label); color: var(--ink); }
  .grd-why { font-size: var(--fs-label-xs); line-height: 1.4; color: rgba(28,22,17,0.66); }
  .eth-bottom { margin: 13px 0 0; padding: 11px 14px; border-radius: var(--radius-sharp); font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.8);
    background: rgba(28,22,17,0.04); border: 1px solid rgba(28,22,17,0.12); }
  .eth-bottom b { color: var(--ink); }
  @media (max-width: 760px) { .eth-grid { grid-template-columns: 1fr; } }
</style>
