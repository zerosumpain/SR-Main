<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import ScoreBar from '../components/ScoreBar.svelte';
  import StandardCard from '../components/StandardCard.svelte';
  import ReviewTabs from '../components/ReviewTabs.svelte';
  const base = '/projects/data-standard-designer';

  // group crosswalk edges by the standard they connect to
  const grouped = $derived.by(() => {
    const m = new Map<string, { name: string; edges: typeof app.crosswalkEdges }>();
    for (const e of app.crosswalkEdges) {
      if (!m.has(e.standardId)) m.set(e.standardId, { name: e.standardName, edges: [] });
      m.get(e.standardId)!.edges.push(e);
    }
    return [...m.values()].sort((a, b) => b.edges.length - a.edges.length);
  });
</script>

<div class="dsd-route">
  <ReviewTabs />
  <h1 class="dsd-h1" style="font-size:clamp(26px,4vw,40px)">What it connects to.</h1>
  <p class="dsd-prose">Interoperability isn't a slogan — it's whether your data can be joined to other data. This is the live crosswalk: every place your schema touches an existing standard, and the identifier or data item that makes the join possible.</p>

  {#if app.mode === 'analyst'}
    <div class="dsd-note"><span class="tag">Analyst view</span>A "crosswalk" is a map between your standard and others. The more your fields reuse known identifiers (like NHS Number or UPRN) and established data items, the more your data can be linked to other datasets without fragile matching — which is the whole point.</div>
  {/if}

  <div class="top">
    <div class="score-wrap"><ScoreBar score={app.interop} label="Interoperability score" expanded /></div>
    <div class="stat-cards">
      <div class="stat"><span class="n">{new Set(app.crosswalkEdges.map((e) => e.standardId)).size}</span><span class="l">standards connected</span></div>
      <div class="stat"><span class="n">{app.fields.filter((f) => f.identifier).length}</span><span class="l">identifiers reused</span></div>
      <div class="stat"><span class="n">{app.fields.filter((f) => f.sourceStandard).length}</span><span class="l">fields from standards</span></div>
    </div>
  </div>

  <h2 class="dsd-h2">Crosswalk — your fields to existing standards</h2>
  {#if grouped.length}
    <div class="xwalk">
      {#each grouped as g}
        <div class="xw-std">
          <div class="xw-head"><b>{g.name}</b><span class="dsd-pill ok">{g.edges.length} link{g.edges.length === 1 ? '' : 's'}</span></div>
          <ul>
            {#each g.edges as e}
              <li><span class="fld">{e.fieldName}</span><span class="arrow">→</span><span class="via">{e.nature.replace(/-/g, ' ')} · via {e.via}</span></li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
  {:else}
    <p class="empty">No crosswalk yet. Reuse an identifier or pull a field from the library on the <a href={`${base}/schema`}>Schema</a> step, and connections will appear here.</p>
  {/if}

  <h2 class="dsd-h2">Standards to align with</h2>
  <p class="dsd-prose">Given the brief, these are the standards the engine recommends designing toward — reuse their identifiers, codelists and data items rather than reinventing.</p>
  <div class="std-grid">
    {#each app.rec.standards as s}<StandardCard std={s} />{/each}
  </div>

  <h2 class="dsd-h2">Identifiers in play</h2>
  <div class="id-grid">
    {#each app.rec.identifiers as id}
      {@const used = app.fields.some((f) => f.identifier === id.id)}
      <div class="id-card" class:used>
        <div class="id-head"><b>{id.name.replace(/\s*\(.*\)/, '')}</b>{#if used}<span class="dsd-pill ok">in use</span>{:else}<span class="dsd-pill muted">available</span>{/if}</div>
        <span class="id-scope">{id.scope}</span>
        <div class="id-meta"><span class="iml">Held by</span> {id.heldBy}</div>
        {#if id.caveat}<p class="id-caveat">⚠ {id.caveat}</p>{/if}
      </div>
    {/each}
  </div>

  <div class="dsd-cta-row"><a class="dsd-btn primary" href={`${base}/impact`}>Impact &amp; assurance →</a><a class="dsd-btn" href={`${base}/publish`}>Skip to publish</a></div>
</div>

<style>
  .top { display: grid; grid-template-columns: minmax(0, 1.4fr) 1fr; gap: 18px; align-items: start; margin: 18px 0 8px; }
  .stat-cards { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
  .stat { border: 1.5px solid var(--card-border); border-radius: var(--radius-round); padding: 12px; text-align: center; background: var(--card-bg); }
  .stat .n { font-family: var(--font-display); font-size: 30px; color: var(--accent); display: block; line-height: 1; }
  .stat .l { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }

  .xwalk { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
  .xw-std { border: 1.5px solid var(--card-border); border-radius: var(--radius-round); padding: 12px 14px; background: var(--surface-elevated); }
  .xw-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
  .xw-head b { font-size: 13.5px; color: var(--text-primary); }
  .xw-std ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
  .xw-std li { display: flex; gap: 7px; align-items: baseline; font-size: 12px; }
  .fld { color: var(--text-primary); font-weight: 600; }
  .arrow { color: var(--accent); }
  .via { color: var(--text-muted); font-size: 11px; }

  .empty { font-size: 13px; color: var(--text-muted); font-style: italic; }
  .empty a { color: var(--accent); }
  .std-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
  .id-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
  .id-card { border: 1.5px solid var(--card-border); border-radius: var(--radius-round); padding: 12px 14px; background: var(--card-bg); }
  .id-card.used { border-color: var(--success-border); }
  .id-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .id-head b { font-size: 13.5px; color: var(--text-primary); }
  .id-scope { font-size: 12px; color: var(--text-secondary); display: block; margin: 4px 0; }
  .id-meta { font-size: 11.5px; color: var(--text-muted); }
  .iml { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-ghost); }
  .id-caveat { font-size: 11px; color: var(--warn); background: var(--warn-bg); padding: 5px 8px; border-radius: var(--radius-sharp); margin: 7px 0 0; line-height: 1.4; }

  @media (max-width: 800px) { .top { grid-template-columns: 1fr; } }
</style>
