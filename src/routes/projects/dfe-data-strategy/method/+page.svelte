<script lang="ts">
  import { PARAMS, PARAM_NOTES } from '../lib/params';
  import { CAPABILITY_AREAS } from '../lib/capabilities';
  import { POSTURE_AXES } from '../lib/postures';
  import { MATURITY_DIMENSIONS } from '../lib/maturity';
  import { PRESSURES } from '../lib/pressures';
  import { SOURCES } from '../lib/sources';
  import { COMMITMENTS, DOCUMENTS } from '../lib/commitments';
  import { COMPARATORS } from '../lib/comparators';
  import { GLOSSARY } from '../lib/glossary';
  import Reveal from '../components/Reveal.svelte';

  const FEATURE_SCORES: { f: string; s: number; v: string }[] = [
    { f: 'Commitments explorer (4 lenses + drawer)', s: 95, v: 'built' },
    { f: 'WYSIWYG strategy author (guided sections, starters)', s: 93, v: 'built' },
    { f: 'Deterministic coverage sweep (statutory gaps first)', s: 92, v: 'built' },
    { f: 'LLM deep review vs best-practice rubric', s: 88, v: 'built' },
    { f: 'Coverage matrix (commitments × sections)', s: 86, v: 'built' },
    { f: 'Completeness heuristics (six checks)', s: 84, v: 'built' },
    { f: 'Delivery roadmap seeded from statutory deadlines', s: 77, v: 'built' },
    { f: 'Comparator library (other departments’ strategies)', s: 77, v: 'built' },
    { f: 'Measures picker (33 real the department series)', s: 76, v: 'built' },
    { f: 'RAG + Ask-the-model over the ledger', s: 74, v: 'built' },
    { f: 'Risk register seeded from gaps + tensions', s: 72, v: 'built' },
    { f: 'Journey restructure (Understand → Write → Track)', s: 71, v: 'built' },
    { f: 'Stakeholder consultation tracker', s: 65, v: 'built' },
    { f: 'Publish preview + md/docx/json export & import', s: 63, v: 'built' },
    { f: 'Intel watches on ledger programmes', s: 63, v: 'built' },
    { f: 'Version snapshots + restore', s: 62, v: 'built' },
    { f: 'Live commitment-status auto-ingestion', s: 57, v: 'deferred — no authoritative source; watches cover it honestly' },
    { f: 'Glossary + hover tooltips', s: 52, v: 'built' },
    { f: 'LLM auto-drafting whole sections', s: 40, v: 'rejected — the machine checks, the human writes' },
    { f: 'Multi-user collaboration', s: 35, v: 'deferred — no team auth model; .json hand-off instead' },
    { f: 'Localisation / other departments', s: 27, v: 'under threshold' },
  ];
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
  <p class="pe-prose">Each of the {PRESSURES.length} pressures <b>demands</b> certain capabilities. Its coverage is the mean effective strength of those capabilities. The headline is the <b>severity-weighted</b> mean across all pressures; the same is computed per origin (cross-government / the department policy / partners). The workbench shows the working for every pressure.</p>

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

  <h2 class="pe-h2">5 · The commitments ledger</h2>
  <p class="pe-prose">
    The <a href="/projects/dfe-data-strategy/commitments">ledger's</a> {COMMITMENTS.length} commitments across {DOCUMENTS.length} documents were synthesized on <b>2 July 2026</b> by a nine-agent research sweep of the 2024–26 white-paper landscape — schools, SEND &amp; AP, early years &amp; social care, post-16 &amp; skills, curriculum &amp; assessment, cross-government digital, the department's own data programmes, cross-departmental interfaces, and data-strategy best practice — checked against primary sources (gov.uk, legislation.gov.uk, parliament.uk), then merged, de-duplicated and spot-verified before freeze. Every commitment carries: a short verbatim quote, source URLs, a status on the bindingness scale (statutory duty → consulting), the department's role, the new data flows it creates, and a one-line reading of <i>what it demands of the strategy</i>. Each also carries a <b>research confidence</b> level — where the sweep could not verify a claim against a primary source, it says so rather than asserting it.
  </p>
  <p class="pe-prose">
    The ledger powers more than its own page: it grounds the <a href="/projects/dfe-data-strategy/author">Author's</a> coverage sweep and deep review, seeds the roadmap and risk register, extends the Ask-the-model corpus, and sets the named intelligence watches — a daily GOV.UK sweep whose finds surface as "newly arrived intelligence" inside the section they bear on (legislation on the <a href="/projects/dfe-data-strategy/legislation">legal page</a>, programmes on the <a href="/projects/dfe-data-strategy/commitments">ledger</a>), with an on-demand scan in the navigation bar.
  </p>

  <h2 class="pe-h2">6 · The Author's verification suite</h2>
  <p class="pe-prose">
    The <a href="/projects/dfe-data-strategy/author">Author</a> checks a draft three ways, cheapest first. The <b>coverage sweep</b> is deterministic: each commitment carries curated match terms; two distinct terms found at word boundaries = <i>addressed</i>, one = <i>touched</i>, none = <i>missing</i> — statutory gaps ranked first. The <b>completeness checks</b> are six transparent heuristics per section (substance, timeframes, ownership, measurability, evidence, plain English) — each states exactly what it looked for, so a false positive is easy to dismiss. The <b>deep review</b> sends the draft (as markdown) to the model with a rubric distilled from {COMPARATORS.length} comparator departmental strategies, the documented failure modes of real strategies, the must-answer commitments, and your declared workbench posture — and returns scored verdicts, contradictions and the top three fixes. Nothing is auto-written: <b>the machine checks; the human writes</b>.
  </p>

  <h2 class="pe-h2">7 · Feature scoring (the gap analysis)</h2>
  <p class="pe-prose">This upgrade followed a scored gap analysis — <code>0.40·impact + 0.25·differentiation + 0.20·feasibility + 0.15·fit</code>, build everything over 30 unless folding it into another feature was more honest. The scores:</p>
  <div class="ftable">
    {#each FEATURE_SCORES as row}
      <div class="frow" class:out={!row.v.startsWith('built')}>
        <span class="f-n">{row.s}</span>
        <span class="f-f">{row.f}</span>
        <span class="f-v">{row.v}</span>
      </div>
    {/each}
  </div>

  <Reveal label="Jargon buster — {GLOSSARY.length} terms this field swims in">
    <dl class="gloss">
      {#each GLOSSARY as g}
        <div><dt>{g.term}</dt><dd>{g.def}</dd></div>
      {/each}
    </dl>
  </Reveal>

  <h2 class="pe-h2">What it is — and isn't</h2>
  <ul class="caveats">
    <li><b>It is</b> a structured way to test the coherence and coverage of a data strategy against a research-grounded map of pressures, frameworks and law.</li>
    <li><b>It is not</b> a prediction of outcomes, a budget model, or an official the department position. The weights are reasoned, documented estimates, not measured elasticities.</li>
    <li>The pressures, frameworks and legal registry are grounded in the published sources below and verified through an automated research pass.</li>
  </ul>

  <h2 class="pe-h2" id="sources">Sources ({SOURCES.length})</h2>
  <ul class="sources">
    {#each SOURCES as s}<li><a href={s.url} target="_blank" rel="noopener">{s.org} ↗</a> — {s.what}</li>{/each}
  </ul>
</div>

<style>
  .intro { max-width: 76ch; }
  h2[id] { scroll-margin-top: 130px; }
  .formula { background: rgba(28,22,17,0.05); border: 1px solid rgba(28,22,17,0.1); border-radius: var(--radius-round); padding: 12px 14px; font-family: 'JetBrains Mono', monospace; font-size: 11.5px; line-height: 1.6; color: rgba(28,22,17,0.8); overflow-x: auto; white-space: pre; }
  .pe-prose { max-width: 80ch; }
  .pe-prose code { background: rgba(28,22,17,0.06); padding: 1px 4px; border-radius: var(--radius-sharp); font-family: 'JetBrains Mono', monospace; font-size: 0.9em; }
  .coeffs { display: grid; gap: 8px; }
  .coeff { display: grid; grid-template-columns: 160px 48px 1fr; gap: 10px; align-items: baseline; }
  .coeff code { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #8a2d3a; }
  .cf-v { font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 600; color: var(--ink); }
  .cf-n { font-size: 12px; line-height: 1.45; color: rgba(28,22,17,0.66); }
  .caveats { max-width: 80ch; padding-left: 18px; }
  .caveats li { font-size: 13.5px; line-height: 1.55; color: rgba(28,22,17,0.74); margin-bottom: 6px; }
  .ftable { display: flex; flex-direction: column; gap: 4px; max-width: 86ch; }
  .frow { display: grid; grid-template-columns: 40px 1fr auto; gap: 12px; align-items: baseline; padding: 5px 10px; border: 1px solid rgba(28,22,17,0.1); border-radius: var(--radius-round); background: rgba(255,255,255,0.4); }
  .frow.out { opacity: 0.6; }
  .f-n { font-family: 'Fraunces', serif; font-size: 15px; font-weight: 600; color: var(--accent-ink); text-align: right; }
  .f-f { font-size: 12.5px; color: var(--ink); }
  .f-v { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: rgba(28,22,17,0.55); max-width: 300px; text-align: right; }
  .gloss { margin: 4px 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px 22px; }
  .gloss div { break-inside: avoid; }
  .gloss dt { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600; color: var(--accent-ink); }
  .gloss dd { margin: 2px 0 0; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.7); }
  .sources { columns: 2; column-gap: 28px; padding-left: 18px; }
  .sources li { font-size: 12px; line-height: 1.4; color: rgba(28,22,17,0.7); margin-bottom: 4px; break-inside: avoid; }
  .sources a { color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; }
  @media (max-width: 700px) { .coeff { grid-template-columns: 1fr; } .sources { columns: 1; } }
</style>
