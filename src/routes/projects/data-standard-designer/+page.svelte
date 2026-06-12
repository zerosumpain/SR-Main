<script lang="ts">
  import { app } from './lib/appState.svelte';
  import { PRESETS } from './lib/presets';
  import { CATALOG, IDENTIFIERS, METHODS, RELATIONSHIPS } from './lib/knowledge';
  const base = '/projects/data-standard-designer';

  const STEPS = [
    { n: '01', t: 'Brief', d: 'Capture why the data exists, who provides and consumes it, and what it will be processed for — in plain language.' },
    { n: '02', t: 'Schema', d: 'The engine proposes fields, identifiers and metadata from existing standards. Play with them and watch the impact.' },
    { n: '03', t: 'Interoperability', d: 'See exactly which standards your design connects to, and how — the crosswalk that makes data flow.' },
    { n: '04', t: 'Impact', d: 'Stakeholder burden, data availability across public and private sector, assurance and the adoption case.' },
    { n: '05', t: 'Publish', d: 'Download the standard in machine and human formats, plus the evidence pack for why you settled on it.' },
  ];
  function go(id: string) {
    const p = PRESETS.find((x) => x.id === id);
    if (p) app.loadDesign(p.build());
    location.href = `${base}/brief`;
  }
</script>

<section class="hero">
  <div class="dsd-route">
    <span class="dsd-eyebrow">Field tool · interoperable-by-design</span>
    <h1 class="dsd-h1">Design a data<br />standard worth<br />adopting.</h1>
    <p class="dsd-lede">
      A workbench for technical teams to design and publish a dataset standard — grounded in the data
      standards government already runs. It captures what the data is <em>for</em>, proposes a schema from
      established standards, shows the impact on every stakeholder, and exports a publication-grade standard
      with the evidence behind it. Built for high <b>interoperability</b>, high <b>assurance</b>, and real <b>adoption</b>.
    </p>

    <div class="dsd-cta-row">
      <a class="dsd-btn primary" href={`${base}/brief`}>Start a brief →</a>
      <a class="dsd-btn" href={`${base}/method`}>How it's grounded</a>
      {#if app.mounted && app.fields.length}
        <span class="resume">Resuming <b>{app.brief.name || 'your draft'}</b> · score {app.overall}/100 · <a href={`${base}/schema`}>continue →</a></span>
      {/if}
    </div>

    <div class="grounded">
      <span><b>{CATALOG.length}</b> standards</span>
      <span><b>{IDENTIFIERS.length}</b> identifiers</span>
      <span><b>{RELATIONSHIPS.length}</b> crosswalk links</span>
      <span><b>{METHODS.length}</b> design methods</span>
    </div>
  </div>
</section>

<div class="dsd-route">
  <div class="modes">
    <div class="mode-card">
      <span class="dsd-pill">For business analysts</span>
      <h3>Start from the why</h3>
      <p>Plain-language capture of purpose, providers, consumers and processing. The engine does the
        standards heavy-lifting and explains every recommendation in business terms. No schema knowledge needed.</p>
    </div>
    <div class="mode-card">
      <span class="dsd-pill">For data architects</span>
      <h3>Down to the field</h3>
      <p>Field-level control of types, identifiers, codelists, constraints and serialization. Live crosswalk,
        conformance and the full set of machine-readable exports — JSON Schema, Frictionless, CSVW, DCAT-AP.</p>
    </div>
  </div>

  <h2 class="dsd-h2">The flow</h2>
  <div class="steps">
    {#each STEPS as s}
      <div class="step">
        <span class="sn">{s.n}</span>
        <div><b>{s.t}</b><p>{s.d}</p></div>
      </div>
    {/each}
  </div>

  <h2 class="dsd-h2">Also in the toolkit</h2>
  <div class="extras">
    <a class="extra" href={`${base}/brief`}>
      <span class="ex-ic">✦</span><b>Describe it in plain English</b>
      <p>Type what the dataset is for and let AI draft a first-pass brief and schema — then edit freely. Revise it the same way.</p>
    </a>
    <a class="extra" href={`${base}/validate`}>
      <span class="ex-ic">🧪</span><b>Test with synthetic data</b>
      <p>Generate up to 10,000 conforming rows — valid-format identifiers, real codelist values — to trial the standard before any real data exists.</p>
    </a>
    <a class="extra" href={`${base}/portal`}>
      <span class="ex-ic">↻</span><b>Emerging-standards registry</b>
      <p>A daily, index-driven sweep of newly published government data standards, with search, filters and visible source-coverage health.</p>
    </a>
    <a class="extra" href={`${base}/legal`}>
      <span class="ex-ic">⚖</span><b>Legal-basis registry</b>
      <p>A cross-government hierarchy of the legal bases for sharing data — data-protection basis, the specific statutory power/gateway, and governance — down to the section.</p>
    </a>
  </div>

  <h2 class="dsd-h2">Start from a worked example</h2>
  <p class="dsd-prose">Each example is a real DfE-relevant scenario, pre-loaded with a brief and a starter schema. Open one and reshape it — or start blank from the <b>Examples</b> menu.</p>
  <div class="presets">
    {#each PRESETS as p}
      <button class="preset" onclick={() => go(p.id)}>
        <span class="dsd-pill muted">{p.domainLabel}</span>
        <b>{p.label}</b>
        <p>{p.summary}</p>
        <span class="open">Open →</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .hero { border-bottom: 2px solid var(--text-primary); background: linear-gradient(180deg, var(--accent-tint-04), transparent 70%); padding: 18px 0 34px; }
  .hero em { font-style: italic; color: var(--text-primary); }
  .resume { font-size: 12px; color: var(--text-muted); }
  .resume a { color: var(--accent); }
  .grounded { display: flex; gap: 20px; flex-wrap: wrap; margin-top: 26px; font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); }
  .grounded b { font-family: var(--font-display); font-size: 20px; color: var(--accent); margin-right: 4px; vertical-align: -2px; }

  .modes { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 26px 0 8px; }
  .mode-card { border: 1.5px solid var(--card-border); border-radius: var(--radius-round); padding: 18px; background: var(--card-bg); }
  .mode-card h3 { font-size: 17px; font-weight: 700; margin: 10px 0 6px; color: var(--text-primary); }
  .mode-card p { font-size: 13.5px; line-height: 1.55; color: var(--text-secondary); margin: 0; }

  .steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
  .step { display: flex; gap: 12px; padding: 14px; border: 1.5px solid var(--card-border); border-radius: var(--radius-round); }
  .sn { font-family: var(--font-display); font-size: 22px; color: var(--accent); line-height: 1; }
  .step b { font-size: 14px; color: var(--text-primary); }
  .step p { font-size: 12px; line-height: 1.45; color: var(--text-muted); margin: 4px 0 0; }

  .presets { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 14px; margin: 14px 0 10px; }
  .preset { text-align: left; border: 1.5px solid var(--card-border); border-radius: var(--radius-round); padding: 16px; background: var(--surface-elevated); cursor: pointer; display: flex; flex-direction: column; gap: 8px; transition: border-color 0.15s, transform 0.15s; }
  .preset:hover { border-color: var(--accent); transform: translateY(-2px); }
  .preset b { font-size: 16px; color: var(--text-primary); }
  .preset p { font-size: 13px; line-height: 1.5; color: var(--text-secondary); margin: 0; flex: 1; }
  .preset .open { font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent); }

  .extras { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; }
  .extra { border: 1.5px solid var(--card-border); border-radius: var(--radius-round); padding: 15px; background: var(--surface-elevated); transition: border-color 0.15s, transform 0.15s; }
  .extra:hover { border-color: var(--accent); transform: translateY(-2px); }
  .ex-ic { font-size: 20px; color: var(--accent); display: block; }
  .extra b { display: block; font-size: 14.5px; color: var(--text-primary); margin: 8px 0 5px; }
  .extra p { font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); margin: 0; }

  @media (max-width: 700px) { .modes { grid-template-columns: 1fr; } }
</style>
