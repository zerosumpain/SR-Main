<script lang="ts">
  import { app } from './lib/appState.svelte';
  import { PRESETS } from './lib/presets';
  import { CATALOG, IDENTIFIERS, METHODS, RELATIONSHIPS } from './lib/knowledge';
  const base = '/projects/data-standard-designer';

  const STEPS = [
    { n: '01', t: 'Brief', d: 'Capture why the data exists, who provides and consumes it, what it is processed for, and the legal basis — in plain language.' },
    { n: '02', t: 'Schema', d: 'The engine proposes fields, identifiers, codelists and metadata from existing standards. Play with them and watch the impact.' },
    { n: '03', t: 'Review', d: 'The crosswalk to existing standards, plus stakeholder impact, data availability, assurance and the adoption case — scored live.' },
    { n: '04', t: 'Publish', d: 'Download the standard in machine and human formats, plus the evidence pack for why you settled on it.' },
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

  <p class="tools-line">
    In the <b>Tools</b> menu: <a href={`${base}/portal`}>↻ Registry — find existing standards</a> · <a class="tool-link" href={`${base}/validate`}><svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.5h4M9 2.5v5l-4 7.5a1.6 1.6 0 0 0 1.4 2.4h7.2a1.6 1.6 0 0 0 1.4-2.4l-4-7.5v-5" /><line x1="6.6" y1="12.5" x2="13.4" y2="12.5" /></svg> Test data</a> · <a href={`${base}/legal`}>⚖ Legal basis</a>. See also <a href={`${base}/method`}>About &amp; method</a>. You can also describe a dataset in plain English on the Brief step and let AI draft a first pass.
  </p>

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
  .resume { font-size: var(--fs-label-xs); color: var(--text-muted); }
  .resume a { color: var(--accent); }
  .grounded { display: flex; gap: 20px; flex-wrap: wrap; margin-top: 26px; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); }
  .grounded b { font-family: var(--font-display); font-size: 20px; color: var(--accent); margin-right: 4px; vertical-align: -2px; }

  .modes { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 26px 0 8px; }
  .mode-card { border: 1.5px solid var(--card-border); border-radius: var(--radius-sharp); padding: 18px; background: var(--card-bg); }
  .mode-card h3 { font-size: 17px; font-weight: 700; margin: 10px 0 6px; color: var(--text-primary); }
  .mode-card p { font-size: var(--fs-label); line-height: 1.55; color: var(--text-secondary); margin: 0; }

  .steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
  .step { display: flex; gap: 12px; padding: 14px; border: 1.5px solid var(--card-border); border-radius: var(--radius-sharp); }
  .sn { font-family: var(--font-display); font-size: 22px; color: var(--accent); line-height: 1; }
  .step b { font-size: var(--fs-nav); color: var(--text-primary); }
  .step p { font-size: var(--fs-label-xs); line-height: 1.45; color: var(--text-muted); margin: 4px 0 0; }

  .presets { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 14px; margin: 14px 0 10px; }
  .preset { text-align: left; border: 1.5px solid var(--card-border); border-radius: var(--radius-sharp); padding: 16px; background: var(--surface-elevated); cursor: pointer; display: flex; flex-direction: column; gap: 8px; transition: border-color 0.15s, transform 0.15s; }
  .preset:hover { border-color: var(--accent); transform: translateY(-2px); }
  .preset b { font-size: var(--fs-body); color: var(--text-primary); }
  .preset p { font-size: var(--fs-label); line-height: 1.5; color: var(--text-secondary); margin: 0; flex: 1; }
  .preset .open { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent); }

  .tools-line { font-size: var(--fs-label); line-height: 1.7; color: var(--text-secondary); max-width: 80ch; margin: 4px 0 8px; }
  .tools-line a { color: var(--accent); white-space: nowrap; }
  .tools-line a.tool-link { display: inline-flex; align-items: center; gap: 4px; }
  .tools-line a.tool-link svg { vertical-align: middle; }
  .tools-line a:hover { border-bottom: 1px solid currentColor; }

  @media (max-width: 700px) { .modes { grid-template-columns: 1fr; } }
</style>
