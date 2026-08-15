<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { CATALOG, standardById } from '../lib/knowledge';
  import type { ProviderSector, Ownership } from '../lib/types';

  const PROVIDER_SECTORS: ProviderSector[] = ['schools', 'multi-academy-trusts', 'local-authorities', 'nhs-health', 'early-years', 'further-education', 'higher-education', 'police', 'housing', 'private-providers', 'voluntary-sector', 'central-gov', 'other'];
  const OWNERSHIPS: Ownership[] = ['public', 'private', 'voluntary', 'mixed'];

  // Which providers have their advanced detail open. Default: collapsed.
  let openDetail = $state<Set<string>>(new Set());
  function toggleDetail(id: string) {
    const next = new Set(openDetail);
    next.has(id) ? next.delete(id) : next.add(id);
    openDetail = next;
  }

  function addStandard(pid: string, sid: string) {
    if (!sid) return;
    const p = app.brief.providers.find((x) => x.id === pid);
    if (p && !p.existingStandards.includes(sid)) app.updateProvider(pid, { existingStandards: [...p.existingStandards, sid] });
  }
  function removeStandard(pid: string, sid: string) {
    const p = app.brief.providers.find((x) => x.id === pid);
    if (p) app.updateProvider(pid, { existingStandards: p.existingStandards.filter((s) => s !== sid) });
  }
</script>

<div class="prov-list">
  {#each app.brief.providers as p (p.id)}
    <div class="entity">
      <div class="ent-row">
        <input class="dsd-input" value={p.label} oninput={(e) => app.updateProvider(p.id, { label: (e.target as HTMLInputElement).value })} placeholder="Provider name / class (e.g. Maintained schools)" />
        <select class="dsd-select sector" value={p.sector} onchange={(e) => app.updateProvider(p.id, { sector: (e.target as HTMLSelectElement).value as ProviderSector })}>
          {#each PROVIDER_SECTORS as s}<option value={s}>{s}</option>{/each}
        </select>
        <button class="ic-del" onclick={() => app.removeProvider(p.id)} title="Remove provider">✕</button>
      </div>

      <button class="detail-toggle" onclick={() => toggleDetail(p.id)} aria-expanded={openDetail.has(p.id)}>
        <span class="caret">{openDetail.has(p.id) ? '▾' : '▸'}</span> add detail
        {#if !openDetail.has(p.id) && (p.existingStandards.length || p.systemsHeld)}
          <span class="detail-sum">{p.existingStandards.length ? `${p.existingStandards.length} standard${p.existingStandards.length === 1 ? '' : 's'}` : ''}{p.existingStandards.length && p.systemsHeld ? ' · ' : ''}{p.systemsHeld ? p.systemsHeld.slice(0, 28) : ''}</span>
        {/if}
      </button>

      {#if openDetail.has(p.id)}
        <div class="ent-detail">
          <div class="ent-grid">
            <select class="dsd-select" value={p.ownership} onchange={(e) => app.updateProvider(p.id, { ownership: (e.target as HTMLSelectElement).value as Ownership })}>
              {#each OWNERSHIPS as o}<option value={o}>{o} sector</option>{/each}
            </select>
            <select class="dsd-select" value={p.burdenSensitivity} onchange={(e) => app.updateProvider(p.id, { burdenSensitivity: (e.target as HTMLSelectElement).value as 'low' | 'medium' | 'high' })}>
              <option value="low">low burden-sensitivity</option><option value="medium">medium burden-sensitivity</option><option value="high">high burden-sensitivity</option>
            </select>
          </div>
          <input class="dsd-input" value={p.systemsHeld} oninput={(e) => app.updateProvider(p.id, { systemsHeld: (e.target as HTMLInputElement).value })} placeholder="Systems they keep it in (e.g. SIMS / Arbor MIS)" />
          <div class="std-pills">
            {#each p.existingStandards as sid}
              <span class="std-pill">{standardById(sid)?.name || sid}<button onclick={() => removeStandard(p.id, sid)}>✕</button></span>
            {/each}
            <select class="add-std" onchange={(e) => { addStandard(p.id, (e.target as HTMLSelectElement).value); (e.target as HTMLSelectElement).value = ''; }}>
              <option value="">＋ existing standard they hold…</option>
              {#each CATALOG as s}<option value={s.id}>{s.name}</option>{/each}
            </select>
          </div>
        </div>
      {/if}
    </div>
  {/each}
  {#if !app.brief.providers.length}<p class="empty">No providers yet — add the organisations that will supply this data.</p>{/if}
</div>

<style>
  .prov-list { display: flex; flex-direction: column; gap: 9px; }
  .entity { border: 1.5px solid var(--card-border); border-radius: var(--radius-sharp); padding: 10px; display: flex; flex-direction: column; gap: 8px; background: var(--surface-elevated); }
  .ent-row { display: flex; gap: 6px; }
  .ent-row .dsd-input { flex: 1; }
  .sector { width: auto; max-width: 190px; font-size: var(--fs-label-xs); }
  .ic-del { background: none; border: 1px solid var(--card-border); border-radius: var(--radius-sharp); color: var(--text-muted); cursor: pointer; padding: 0 9px; }
  .ic-del:hover { color: var(--error); border-color: var(--error); }
  .detail-toggle { align-self: flex-start; background: none; border: none; cursor: pointer; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); display: inline-flex; align-items: center; gap: 6px; padding: 0; }
  .detail-toggle:hover { color: var(--accent); }
  .detail-toggle .caret { font-size: var(--fs-label-xs); }
  .detail-sum { text-transform: none; letter-spacing: 0; color: var(--text-ghost); }
  .ent-detail { display: flex; flex-direction: column; gap: 8px; border-top: 1px dashed var(--divider); padding-top: 8px; }
  .ent-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 7px; }
  .std-pills { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .std-pill { font-family: var(--font-mono); font-size: var(--fs-label-xs); background: var(--accent-tint-08); color: var(--accent); padding: 3px 4px 3px 8px; border-radius: var(--radius-sharp); display: inline-flex; align-items: center; gap: 5px; }
  .std-pill button { background: none; border: none; color: var(--accent); cursor: pointer; padding: 0; font-size: var(--fs-label-xs); }
  .add-std { font-family: var(--font-mono); font-size: var(--fs-label-xs); padding: 4px 6px; border: 1px dashed var(--card-border); border-radius: var(--radius-sharp); background: transparent; color: var(--text-muted); max-width: 260px; }
  .empty { font-size: var(--fs-label-xs); color: var(--text-muted); font-style: italic; margin: 0; }
</style>
