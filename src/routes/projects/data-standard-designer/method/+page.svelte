<script lang="ts">
  import { CATALOG, IDENTIFIERS, METHODS } from '../lib/knowledge';
  const base = '/projects/data-standard-designer';

  const VALUE = [
    { k: 'Joinable data', d: 'Reuse the identifiers and codelists government already runs — UPN, NHS Number, UPRN, GSS codes — instead of minting your own. That\'s what lets your data link to other data without fragile matching.' },
    { k: 'Know it\'s good before you publish', d: 'Every edit re-scores the design live for interoperability, assurance and adoption, with the reasons spelled out — so you fix the weak spots before anyone has to use it.' },
    { k: 'Publication-grade outputs', d: 'Export the standard as JSON Schema, Frictionless, CSVW and DCAT-AP, plus a human spec and an evidence pack citing exactly which standards each decision drew on.' },
    { k: 'Grounded, not guessed', d: `Nothing is invented. Every recommendation traces to a catalogue of ${CATALOG.length} real standards, ${IDENTIFIERS.length} identifiers and ${METHODS.length} design methods.` },
  ];

  const HOW = [
    { n: '1', t: 'Brief → heuristics', d: 'Your purpose, domain, providers and processing fire grounded heuristics — e.g. "children across services → anchor on NHS Number and the CP-IS event pattern".' },
    { n: '2', t: 'Catalogue → recommendations', d: 'Those heuristics select identifiers, standards, a serialization, a collection method and a cadence from the catalogue.' },
    { n: '3', t: 'Schema → live scoring', d: 'Your fields are scored for interoperability, assurance and adoption against the same evidence, and crosswalked to every standard they touch.' },
    { n: '4', t: 'Export → publication', d: 'The design renders to JSON Schema, Frictionless, CSVW, DCAT-AP and a publication-grade spec, plus a rationale pack.' },
  ];

  const METHOD_CATS = ['interoperability', 'schema-design', 'metadata', 'assurance', 'legal', 'governance', 'adoption'];
</script>

<div class="dsd-route narrow">
  <span class="dsd-eyebrow">About this tool</span>
  <h1 class="dsd-h1" style="font-size:clamp(28px,5vw,46px)">Design a standard worth adopting.</h1>
  <p class="dsd-lede">The Data Standard Designer is a workbench for technical teams to design and publish a dataset standard — grounded in the data standards UK and international government already runs. Here's what it gives you, and how it works.</p>

  <div class="value">
    {#each VALUE as v}
      <div class="vcard"><b>{v.k}</b><p>{v.d}</p></div>
    {/each}
  </div>

  <div class="cta">
    <a class="dsd-btn primary" href={`${base}/brief`}>Start a brief →</a>
    <a class="dsd-btn" href={`${base}/portal`}>Find existing standards</a>
  </div>

  <h2 class="dsd-h2">How it works</h2>
  <div class="how">
    {#each HOW as h}
      <div class="how-step"><span class="hn">{h.n}</span><div><b>{h.t}</b><p>{h.d}</p></div></div>
    {/each}
  </div>

  <h2 class="dsd-h2">What it's built on</h2>
  <p class="dsd-prose">The grounding behind every recommendation. Browse the full standards catalogue in the <a href={`${base}/portal`}>Registry</a>.</p>

  <details class="ref">
    <summary>Identifiers <span class="rn">({IDENTIFIERS.length})</span></summary>
    <p class="dsd-prose" style="font-size: var(--fs-label)">Reusing an identifier a provider already holds is the single biggest interoperability and adoption win — with the caveats that matter.</p>
    <div class="id-list">
      {#each IDENTIFIERS as id}
        <div class="idr">
          <div class="idr-h"><b>{id.name}</b><span class="dsd-pill muted">{id.sectors[0]}</span></div>
          <span class="idr-scope">{id.scope}</span>
          <div class="idr-meta"><span>Format: {id.format}</span><span>Held by: {id.heldBy}</span></div>
          {#if id.caveat}<p class="idr-caveat">⚠ {id.caveat}</p>{/if}
          {#if id.url}<a href={id.url} target="_blank" rel="noopener">Source ↗</a>{/if}
        </div>
      {/each}
    </div>
  </details>

  <details class="ref">
    <summary>Design methods <span class="rn">({METHODS.length})</span></summary>
    <p class="dsd-prose" style="font-size: var(--fs-label)">The principles the scoring and recommendations encode — drawn from the Open Standards Principles, W3C Data on the Web Best Practices, ISO/IEC 11179, the Government Data Quality Framework and the ICO Data Sharing Code.</p>
    {#each METHOD_CATS as cat}
      {@const ms = METHODS.filter((m) => m.category === cat)}
      {#if ms.length}
        <h3 class="dsd-h3">{cat.replace('-', ' ')}</h3>
        <div class="m-grid">
          {#each ms as m}<div class="mcard"><b>{m.title}</b><p>{m.summary}</p>{#if m.source}<span class="msrc">{m.source}</span>{/if}</div>{/each}
        </div>
      {/if}
    {/each}
  </details>

  <details class="ref">
    <summary>Provenance &amp; disclaimer</summary>
    <p class="dsd-prose" style="font-size: var(--fs-label)">The catalogue was assembled from primary sources (DfE, NHS England, ONS, GeoPlace, W3C and the standards bodies) and a structured research pass across education, children's social care, child protection, health, local and central government, and international metadata/publishing standards. It is decision-support: confirm any specific clause against the source before adoption, and run your standard through your own information-governance and Open Standards Board processes.</p>
  </details>
</div>

<style>
  .value { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 24px 0 8px; }
  .vcard { border: 1.5px solid var(--card-border); border-radius: var(--radius-sharp); padding: 18px; background: var(--card-bg); }
  .vcard b { font-size: var(--fs-body); color: var(--text-primary); display: block; margin-bottom: 7px; }
  .vcard p { font-size: var(--fs-label); line-height: 1.55; color: var(--text-secondary); margin: 0; }
  .cta { display: flex; gap: 10px; flex-wrap: wrap; margin: 16px 0 8px; }

  .how { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
  .how-step { display: flex; gap: 12px; border: 1.5px solid var(--card-border); border-radius: var(--radius-sharp); padding: 14px; background: var(--surface-elevated); }
  .hn { font-family: var(--font-display); font-size: 22px; color: var(--accent); line-height: 1; }
  .how-step b { font-size: var(--fs-label); color: var(--text-primary); }
  .how-step p { font-size: var(--fs-label); line-height: 1.5; color: var(--text-secondary); margin: 5px 0 0; }

  .ref { border: 1.5px solid var(--card-border); border-radius: var(--radius-sharp); padding: 4px 16px; margin: 10px 0; background: var(--card-bg); }
  .ref summary { cursor: pointer; font-weight: 700; font-size: var(--fs-nav); color: var(--text-primary); padding: 10px 0; }
  .ref summary::marker { color: var(--accent); }
  .rn { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); font-weight: 400; }

  .id-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; margin: 10px 0; }
  .idr { border: 1.5px solid var(--card-border); border-radius: var(--radius-sharp); padding: 13px; background: var(--surface-elevated); }
  .idr-h { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .idr-h b { font-size: var(--fs-label); color: var(--text-primary); }
  .idr-scope { font-size: var(--fs-label-xs); color: var(--text-secondary); display: block; margin: 5px 0; }
  .idr-meta { display: flex; flex-direction: column; gap: 2px; font-size: var(--fs-label-xs); color: var(--text-muted); }
  .idr-caveat { font-size: var(--fs-label-xs); color: var(--warn); background: var(--warn-bg); padding: 6px 8px; border-radius: var(--radius-sharp); margin: 8px 0 4px; line-height: 1.4; }
  .idr a { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; color: var(--accent); }

  .m-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; margin-bottom: 10px; }
  .mcard { border: 1.5px solid var(--card-border); border-radius: var(--radius-sharp); padding: 12px 14px; background: var(--surface-elevated); }
  .mcard b { font-size: var(--fs-label); color: var(--text-primary); }
  .mcard p { font-size: var(--fs-label-xs); line-height: 1.5; color: var(--text-secondary); margin: 5px 0 0; }
  .msrc { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent); display: block; margin-top: 6px; }

  @media (max-width: 640px) { .value { grid-template-columns: 1fr; } }
</style>
