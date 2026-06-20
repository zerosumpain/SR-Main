<script lang="ts">
  import { goto } from '$app/navigation';
  import { app } from '../lib/appState.svelte';
  import { standardById, identifierById, RELATIONSHIPS } from '../lib/knowledge';
  import { fieldsFromStandard, designFromStandard, canIngest } from '../lib/ingest';

  const base = '/projects/data-standard-designer';
  const std = $derived(app.exploreStandardId ? standardById(app.exploreStandardId) : undefined);
  let toast = $state('');

  // Related standards: explicit connectsTo + any crosswalk edge touching this id.
  const related = $derived.by(() => {
    if (!std) return [] as { id: string; name: string; nature: string }[];
    const map = new Map<string, { id: string; name: string; nature: string }>();
    for (const c of std.connectsTo || []) { const s = standardById(c); if (s) map.set(c, { id: c, name: s.name, nature: 'connects to' }); }
    for (const e of RELATIONSHIPS) {
      if (e.from === std.id) { const s = standardById(e.to); if (s && !map.has(e.to)) map.set(e.to, { id: e.to, name: s.name, nature: e.nature.replace(/-/g, ' ') }); }
      if (e.to === std.id) { const s = standardById(e.from); if (s && !map.has(e.from)) map.set(e.from, { id: e.from, name: s.name, nature: e.nature.replace(/-/g, ' ') }); }
    }
    return [...map.values()];
  });

  function close() { app.closeStandard(); toast = ''; }
  function addFields() {
    if (!std) return;
    const n = app.ingestFields(fieldsFromStandard(std));
    toast = n ? `Added ${n} field${n === 1 ? '' : 's'} to your schema.` : 'Those fields are already in your schema.';
  }
  function startFrom() {
    if (!std) return;
    if (app.fields.length && !confirm('Replace your current design with one based on this standard?')) return;
    app.loadDesign(designFromStandard(std));
    close();
    goto(`${base}/schema`);
  }
  function goToSchema() { close(); goto(`${base}/schema`); }
</script>

{#if std}
  <button class="scrim" aria-label="Close" onclick={close}></button>
  <aside class="drawer" role="dialog" aria-label={std.name}>
    <header class="dh">
      <div>
        <span class="dsd-pill muted">{std.sector}</span>
        <h2>{std.name}</h2>
        <span class="owner">{std.owner}</span>
      </div>
      <button class="x" onclick={close} aria-label="Close">✕</button>
    </header>

    <div class="db">
      <p class="desc">{std.description}</p>
      {#if std.dataCovered}<div class="kv"><span class="k">Data covered</span><span>{std.dataCovered}</span></div>{/if}

      {#if std.identifiers?.length}
        <h3>Identifiers</h3>
        {#each std.identifiers as id}{@const idef = identifierById(id)}{#if idef}
          <div class="idr"><b>{idef.name}</b><span>{idef.scope}</span>{#if idef.caveat}<span class="cav">⚠ {idef.caveat}</span>{/if}</div>
        {/if}{/each}
      {/if}

      {#if std.keyFields?.length}
        <h3>Key data items</h3>
        <div class="chips">{#each std.keyFields as kf}<span class="chip">{kf}</span>{/each}</div>
      {/if}

      <div class="facts">
        {#if std.formats?.length}<div class="kv"><span class="k">Formats</span><span>{std.formats.join(' · ').toUpperCase()}</span></div>{/if}
        {#if std.cadence}<div class="kv"><span class="k">Cadence</span><span>{std.cadence}</span></div>{/if}
        {#if std.collectionMethod}<div class="kv"><span class="k">Collection</span><span>{std.collectionMethod}</span></div>{/if}
        {#if std.frequency}<div class="kv"><span class="k">Frequency</span><span>{std.frequency}</span></div>{/if}
        {#if std.publishing}<div class="kv"><span class="k">Publishing</span><span>{std.publishing}</span></div>{/if}
      </div>

      {#if std.interoperability}<div class="note"><span class="nl">Interoperability</span>{std.interoperability}</div>{/if}
      {#if std.assurance}<div class="note"><span class="nl">Assurance</span>{std.assurance}</div>{/if}

      {#if related.length}
        <h3>Connects to</h3>
        <div class="rel">{#each related as r}<button class="rel-chip" onclick={() => app.openStandard(r.id)}>{r.name}<span class="rn">{r.nature}</span></button>{/each}</div>
      {/if}

      {#if std.urls?.length}
        <h3>Sources</h3>
        {#each std.urls as u}<a class="src" href={u} target="_blank" rel="noopener">{u} ↗</a>{/each}
      {/if}
    </div>

    <footer class="df">
      {#if toast}<p class="toast">✓ {toast} <a href={`${base}/schema`} onclick={goToSchema}>go to schema →</a></p>{/if}
      {#if canIngest(std)}
        <div class="acts">
          <button class="dsd-btn primary sm" onclick={addFields}>＋ Add its fields to my schema</button>
          <button class="dsd-btn sm" onclick={startFrom}>Start a design from this</button>
        </div>
      {:else}
        <p class="no-ingest">This is a framework/metadata standard — explore it for guidance; it has no record-level fields to ingest.</p>
      {/if}
    </footer>
  </aside>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 150; background: rgba(26,16,8,0.4); border: none; cursor: pointer; }
  .drawer { position: fixed; z-index: 151; top: 0; right: 0; height: 100vh; width: min(520px, 96vw); background: var(--surface-elevated); border-left: 2px solid var(--text-primary); display: flex; flex-direction: column; }
  .dh { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 18px 12px; border-bottom: 1px solid var(--divider); }
  .dh h2 { font-family: var(--font-body); font-weight: 700; font-size: 19px; line-height: 1.2; margin: 8px 0 3px; color: var(--text-primary); }
  .owner { font-family: var(--font-mono); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
  .x { background: none; border: none; font-size: 16px; color: var(--text-muted); cursor: pointer; }
  .x:hover { color: var(--text-primary); }
  .db { flex: 1; overflow-y: auto; padding: 14px 18px; }
  .db h3 { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--accent); margin: 18px 0 8px; }
  .desc { font-size: 14px; line-height: 1.6; color: var(--text-secondary); margin: 0 0 10px; }
  .kv { display: flex; gap: 8px; font-size: 12.5px; margin: 4px 0; color: var(--text-secondary); }
  .kv .k { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-ghost); flex-shrink: 0; width: 84px; padding-top: 2px; }
  .facts { margin: 8px 0; }
  .idr { border: 1px solid var(--card-border); border-radius: var(--radius-round); padding: 9px 11px; margin-bottom: 6px; background: var(--card-bg); }
  .idr b { font-size: 13px; color: var(--text-primary); display: block; }
  .idr span { font-size: 11.5px; color: var(--text-muted); display: block; }
  .idr .cav { color: var(--warn); margin-top: 3px; }
  .chips, .rel { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { font-size: 11.5px; padding: 3px 9px; border-radius: var(--radius-pill); background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-secondary); }
  .note { border-left: 3px solid var(--card-border); padding: 6px 11px; margin: 8px 0; font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }
  .nl { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-ghost); display: block; margin-bottom: 2px; }
  .rel-chip { text-align: left; font-size: 12px; padding: 6px 10px; border: 1px solid var(--card-border); border-radius: var(--radius-round); background: var(--surface-elevated); color: var(--text-primary); cursor: pointer; display: inline-flex; flex-direction: column; }
  .rel-chip:hover { border-color: var(--accent); }
  .rel-chip .rn { font-family: var(--font-mono); font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-ghost); }
  .src { display: block; font-family: var(--font-mono); font-size: 10.5px; color: var(--accent); word-break: break-all; margin-bottom: 3px; }
  .df { padding: 12px 18px 16px; border-top: 1px solid var(--divider); background: var(--card-bg); }
  .acts { display: flex; gap: 8px; flex-wrap: wrap; }
  .toast { font-size: 12.5px; color: var(--success); margin: 0 0 10px; }
  .toast a { color: var(--accent); }
  .no-ingest { font-size: 12px; color: var(--text-muted); margin: 0; line-height: 1.5; }
</style>
