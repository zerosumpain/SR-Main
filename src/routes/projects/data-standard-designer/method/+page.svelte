<script lang="ts">
  import StandardCard from '../components/StandardCard.svelte';
  import { CATALOG, IDENTIFIERS, METHODS } from '../lib/knowledge';
  import type { Sector } from '../lib/types';

  const SECTORS: { v: Sector | 'all'; l: string }[] = [
    { v: 'all', l: 'All' },
    { v: 'education', l: 'Education' },
    { v: 'childrens-social-care', l: "Children's social care" },
    { v: 'child-protection', l: 'Child protection' },
    { v: 'health', l: 'Health & care' },
    { v: 'local-gov', l: 'Local gov' },
    { v: 'cross-gov', l: 'Cross-gov' },
    { v: 'metadata', l: 'Metadata & publishing' },
  ];
  let filter = $state<Sector | 'all'>('all');
  let q = $state('');
  const shown = $derived(
    CATALOG.filter((s) => (filter === 'all' || s.sector === filter) && (!q || `${s.name} ${s.owner} ${s.dataCovered || ''}`.toLowerCase().includes(q.toLowerCase()))),
  );

  const METHOD_CATS = ['interoperability', 'schema-design', 'metadata', 'assurance', 'legal', 'governance', 'adoption'];
</script>

<div class="dsd-route">
  <span class="dsd-eyebrow">Method &amp; sources</span>
  <h1 class="dsd-h1" style="font-size:clamp(26px,4vw,40px)">How it's grounded.</h1>
  <p class="dsd-lede">The engine doesn't invent recommendations — it reasons over a catalog of real UK and international government data standards, the identifiers that connect them, and a body of standard-design method. Everything it suggests traces back to a source.</p>

  <div class="how">
    <div class="how-step"><b>1 · Brief → heuristics</b><p>Your purpose, domain, providers and processing fire a set of grounded heuristics — e.g. "children across services → anchor on NHS Number and the CP-IS event pattern".</p></div>
    <div class="how-step"><b>2 · Catalog → recommendations</b><p>Those heuristics select identifiers, standards, a serialization, a collection method and a cadence from the catalog below.</p></div>
    <div class="how-step"><b>3 · Schema → live scoring</b><p>Your fields are scored for interoperability, assurance and adoption against the same evidence, and crosswalked to every standard they touch.</p></div>
    <div class="how-step"><b>4 · Export → publication</b><p>The design is rendered to JSON Schema, Frictionless, CSVW, DCAT-AP and a publication-grade spec, plus a rationale pack citing the standards used.</p></div>
  </div>

  <h2 class="dsd-h2">Standards catalog <span class="muted-n">({CATALOG.length})</span></h2>
  <p class="dsd-prose" style="margin-bottom:12px">Click any standard to explore it in full — its identifiers, data items, the standards it connects to, and its sources — and <b>ingest it into your design</b>: add its fields to your schema, or start a new standard from it.</p>
  <div class="filters">
    {#each SECTORS as s}<button class="dsd-chip" class:on={filter === s.v} onclick={() => (filter = s.v)}>{s.l}</button>{/each}
    <input class="dsd-input search" bind:value={q} placeholder="Search standards…" />
  </div>
  <div class="cat-grid">
    {#each shown as s}<StandardCard std={s} />{/each}
    {#if !shown.length}<p class="empty">No standards match.</p>{/if}
  </div>

  <h2 class="dsd-h2">Identifiers <span class="muted-n">({IDENTIFIERS.length})</span></h2>
  <p class="dsd-prose">Reusing an identifier a provider already holds is the single biggest interoperability and adoption win. These are the ones the engine knows about — with the caveats that matter.</p>
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

  <h2 class="dsd-h2">Design methods <span class="muted-n">({METHODS.length})</span></h2>
  <p class="dsd-prose">The principles the scoring and recommendations encode — drawn from the Open Standards Principles, W3C Data on the Web Best Practices, ISO/IEC 11179, the Government Data Quality Framework and the ICO Data Sharing Code.</p>
  {#each METHOD_CATS as cat}
    {@const ms = METHODS.filter((m) => m.category === cat)}
    {#if ms.length}
      <h3 class="dsd-h3">{cat.replace('-', ' ')}</h3>
      <div class="m-grid">
        {#each ms as m}
          <div class="mcard"><b>{m.title}</b><p>{m.summary}</p>{#if m.source}<span class="msrc">{m.source}</span>{/if}</div>
        {/each}
      </div>
    {/if}
  {/each}

  <div class="prov">
    <h3 class="dsd-h3">Provenance</h3>
    <p class="dsd-prose">The catalog was assembled from primary sources (DfE, NHS England, ONS, GeoPlace, W3C and the standards bodies) and a structured research pass across education, children's social care, child protection, health, local and central government, and international metadata/publishing standards. It is decision-support: confirm any specific clause against the source before adoption, and run your standard through your own information-governance and Open Standards Board processes.</p>
  </div>
</div>

<style>
  .how { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin: 22px 0 6px; }
  .how-step { border: 1.5px solid var(--card-border); border-radius: var(--radius-round); padding: 14px; background: var(--card-bg); }
  .how-step b { font-size: 13px; color: var(--accent); }
  .how-step p { font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); margin: 6px 0 0; }

  .muted-n { font-family: var(--font-mono); font-size: 13px; color: var(--text-ghost); font-weight: 400; }
  .filters { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; margin-bottom: 14px; }
  .search { width: auto; flex: 1; min-width: 180px; max-width: 280px; margin-left: auto; }
  .cat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 12px; }
  .empty { color: var(--text-muted); font-style: italic; }

  .id-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
  .idr { border: 1.5px solid var(--card-border); border-radius: var(--radius-round); padding: 13px; background: var(--surface-elevated); }
  .idr-h { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .idr-h b { font-size: 13.5px; color: var(--text-primary); }
  .idr-scope { font-size: 12px; color: var(--text-secondary); display: block; margin: 5px 0; }
  .idr-meta { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--text-muted); }
  .idr-caveat { font-size: 11px; color: var(--warn); background: var(--warn-bg); padding: 6px 8px; border-radius: var(--radius-sharp); margin: 8px 0 4px; line-height: 1.4; }
  .idr a { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; color: var(--accent); }

  .m-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
  .mcard { border: 1.5px solid var(--card-border); border-radius: var(--radius-round); padding: 12px 14px; background: var(--card-bg); }
  .mcard b { font-size: 13.5px; color: var(--text-primary); }
  .mcard p { font-size: 12px; line-height: 1.5; color: var(--text-secondary); margin: 5px 0 0; }
  .msrc { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent); display: block; margin-top: 6px; }

  .prov { margin-top: 26px; border-top: 1px solid var(--divider); padding-top: 14px; }
</style>
