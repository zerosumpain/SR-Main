<script lang="ts">
  import { PARAMS, PARAM_NOTES } from '../lib/params';
  import { CAPABILITY_AREAS } from '../lib/capabilities';
  import { POSTURE_AXES } from '../lib/postures';
  import { MATURITY_DIMENSIONS } from '../lib/maturity';
  import { PRESSURES } from '../lib/pressures';
  import { SOURCES } from '../lib/sources';
</script>

<svelte:head><title>How it works — Keystone</title></svelte:head>

<div class="pe-route">
  <span class="pe-eyebrow">Reference · How it works</span>
  <h1 class="pe-h1">How the engine scores a strategy</h1>
  <p class="pe-lede intro">Keystone is a <b>rubric, not a forecast</b>. It does not predict outcomes; it scores the internal logic of a strategy against the pressures, the frameworks and the law. Every number is deterministic and traceable. Here is exactly how it works — nothing is a black box.</p>

  <h2 class="pe-h2">1 · From levers to capability strength</h2>
  <p class="pe-prose">Each capability area's effective strength runs 0–1. It starts from that area's <b>share of the finite effort</b> you allocate, through a concave-saturating curve (so piling everything into one area gives diminishing returns), then it is tilted by your <b>posture</b> choices — a multiplier bounded to [{PARAMS.MULT_MIN}, {PARAMS.MULT_MAX}] so no stance can zero-out a funded capability or rescue a starved one.</p>
  <pre class="formula">cap[area] = clamp( base[area] × postureMult[area] , 0, 1 )
base[area] = 1 − exp( −{PARAMS.CAP_K} × share[area] × {CAPABILITY_AREAS.length} )   // even split → ~0.59
postureMult[area] = clamp( 1 + Σ postureValue × affectWeight , {PARAMS.MULT_MIN}, {PARAMS.MULT_MAX} )</pre>

  <h2 class="pe-h2">2 · From capability to coverage</h2>
  <p class="pe-prose">Each of the {PRESSURES.length} pressures <b>demands</b> certain capabilities. Its coverage is the mean effective strength of those capabilities. The headline is the <b>severity-weighted</b> mean across all pressures; the same is computed per origin (cross-government / DfE policy / partners). The workbench shows the working for every pressure.</p>

  <h2 class="pe-h2">3 · Maturity progress</h2>
  <p class="pe-prose">For each of the {MATURITY_DIMENSIONS.length} maturity dimensions, progress is the mean strength of the capabilities that drive it. The projected level is <code>current + (target − current) × progress</code> — with a penalty when an ambitious target is not backed by investment ({PARAM_NOTES.MATURITY_GAP_PENALTY}).</p>

  <h2 class="pe-h2">4 · Tensions, law & focus</h2>
  <p class="pe-prose">A set of rules flags <b>tensions</b> — incoherent, under-resourced or legally risky combinations (e.g. open-by-default without the trust foundations; expanding sharing faster than governance; AI ambition ahead of data quality). The engine also surfaces the <b>legislation</b> your posture implicates, and a <b>recommended focus</b>: the pressures with the highest <code>severity × (1 − coverage)</code> and the maturity gaps least backed by investment.</p>

  <h2 class="pe-h2">The coefficients</h2>
  <div class="coeffs">
    {#each Object.entries(PARAM_NOTES) as [k, note]}
      <div class="coeff"><code>{k}</code><span class="cf-v">{(PARAMS as any)[k]}</span><span class="cf-n">{note}</span></div>
    {/each}
  </div>

  <h2 class="pe-h2">What it is — and isn't</h2>
  <ul class="caveats">
    <li><b>It is</b> a structured way to test the coherence and coverage of a data strategy against a research-grounded map of pressures, frameworks and law.</li>
    <li><b>It is not</b> a prediction of outcomes, a budget model, or an official DfE position. The weights are reasoned, documented estimates, not measured elasticities.</li>
    <li>The pressures, frameworks and legal registry are grounded in the published sources below and verified through an automated research pass.</li>
  </ul>

  <h2 class="pe-h2">Sources ({SOURCES.length})</h2>
  <ul class="sources">
    {#each SOURCES as s}<li><a href={s.url} target="_blank" rel="noopener">{s.org} ↗</a> — {s.what}</li>{/each}
  </ul>
</div>

<style>
  .intro { max-width: 76ch; }
  .formula { background: rgba(28,22,17,0.05); border: 1px solid rgba(28,22,17,0.1); border-radius: 8px; padding: 12px 14px; font-family: 'JetBrains Mono', monospace; font-size: 11.5px; line-height: 1.6; color: rgba(28,22,17,0.8); overflow-x: auto; white-space: pre; }
  .pe-prose { max-width: 80ch; }
  .pe-prose code { background: rgba(28,22,17,0.06); padding: 1px 4px; border-radius: 3px; font-family: 'JetBrains Mono', monospace; font-size: 0.9em; }
  .coeffs { display: grid; gap: 8px; }
  .coeff { display: grid; grid-template-columns: 160px 48px 1fr; gap: 10px; align-items: baseline; }
  .coeff code { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #8a2d3a; }
  .cf-v { font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 600; color: var(--ink); }
  .cf-n { font-size: 12px; line-height: 1.45; color: rgba(28,22,17,0.66); }
  .caveats { max-width: 80ch; padding-left: 18px; }
  .caveats li { font-size: 13.5px; line-height: 1.55; color: rgba(28,22,17,0.74); margin-bottom: 6px; }
  .sources { columns: 2; column-gap: 28px; padding-left: 18px; }
  .sources li { font-size: 12px; line-height: 1.4; color: rgba(28,22,17,0.7); margin-bottom: 4px; break-inside: avoid; }
  .sources a { color: #2f6f97; text-decoration: none; border-bottom: 1px dashed currentColor; }
  @media (max-width: 700px) { .coeff { grid-template-columns: 1fr; } .sources { columns: 1; } }
</style>
