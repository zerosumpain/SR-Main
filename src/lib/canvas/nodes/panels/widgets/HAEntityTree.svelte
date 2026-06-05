<script lang="ts">
  // Tree-hierarchy entity selector for the Home Assistant node: Area → Domain →
  // Entity, replacing the old flat dropdown. Single-select v1 (writes the
  // node's scalar entityId). Reads the area-aware registry from
  // /api/workflows/homeassistant/entities (populated by the registry sync), with
  // a ↻ that triggers a real re-sync, a substring search that auto-expands
  // matches, and a template/custom escape hatch so {{input.x}} ids still work.
  // Degrades to Domain → Entity when no entity carries an area.
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';

  type HAEntity = {
    entity_id: string;
    domain?: string;
    friendly_name?: string;
    area_id?: string | null;
    area_name?: string | null;
    state?: string;
  };

  let { value, onChange }: { value: string; onChange: (v: string) => void } = $props();

  let entities = $state<HAEntity[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let syncing = $state(false);
  let query = $state('');
  const expanded = new SvelteSet<string>();

  const TEMPLATE_HINT = '{{input.field}}';
  const MANUAL_PLACEHOLDER = 'light.kitchen or {{input.entity_id}}';

  async function load() {
    loading = true;
    error = null;
    try {
      const res = await fetch('/api/workflows/homeassistant/entities');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      entities = Array.isArray(body?.entities) ? (body.entities as HAEntity[]) : [];
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }
  onMount(load);

  async function resync() {
    syncing = true;
    error = null;
    try {
      const res = await fetch('/api/workflows/homeassistant/sync', { method: 'POST' });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      syncing = false;
    }
  }

  function domainOf(e: HAEntity): string {
    return e.domain || e.entity_id.split('.')[0] || 'other';
  }
  function matches(e: HAEntity, q: string): boolean {
    const s = q.toLowerCase();
    return (
      e.entity_id.toLowerCase().includes(s) ||
      (e.friendly_name || '').toLowerCase().includes(s) ||
      (e.area_name || '').toLowerCase().includes(s) ||
      domainOf(e).includes(s)
    );
  }

  const filtered = $derived(query.trim() ? entities.filter((e) => matches(e, query)) : entities);
  const hasAreas = $derived(filtered.some((e) => e.area_id));

  const tree = $derived.by(() => {
    const byArea = new Map<string, { name: string; ents: HAEntity[] }>();
    for (const e of filtered) {
      const key = !hasAreas ? 'area:__all__' : e.area_id ? `area:${e.area_id}` : 'area:__unassigned__';
      const name = !hasAreas ? 'All entities' : e.area_name || e.area_id || 'Unassigned';
      if (!byArea.has(key)) byArea.set(key, { name, ents: [] });
      byArea.get(key)!.ents.push(e);
    }
    const areas = [...byArea.entries()].map(([key, { name, ents }]) => {
      const byDom = new Map<string, HAEntity[]>();
      for (const e of ents) {
        const d = domainOf(e);
        if (!byDom.has(d)) byDom.set(d, []);
        byDom.get(d)!.push(e);
      }
      const domains = [...byDom.entries()]
        .map(([domain, es]) => ({
          domain,
          entities: es.sort((a, b) =>
            (a.friendly_name || a.entity_id).localeCompare(b.friendly_name || b.entity_id),
          ),
        }))
        .sort((a, b) => a.domain.localeCompare(b.domain));
      return { key, name, count: ents.length, domains };
    });
    return areas.sort((a, b) => {
      if (a.key === 'area:__unassigned__') return 1;
      if (b.key === 'area:__unassigned__') return -1;
      return a.name.localeCompare(b.name);
    });
  });

  // When searching, everything is open so matches are visible.
  function open(key: string): boolean {
    return query.trim() ? true : expanded.has(key);
  }
  function toggle(key: string) {
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
  }
</script>

<div class="hat">
  <div class="hat-bar">
    <input
      class="hat-search"
      type="text"
      placeholder="Search entities, rooms, domains…"
      bind:value={query}
      spellcheck="false"
    />
    <button type="button" class="hat-refresh" onclick={resync} disabled={syncing} title="Re-sync from Home Assistant">
      {syncing ? '…' : '↻'}
    </button>
  </div>

  {#if loading}
    <p class="hat-msg">Loading entities…</p>
  {:else if error}
    <p class="hat-msg hat-err">⚠ {error}</p>
  {:else if entities.length === 0}
    <p class="hat-msg">No entities synced yet. Configure the HA URL + token, then click ↻ to sync.</p>
  {:else}
    <div class="hat-tree" role="tree">
      {#each tree as area (area.key)}
        <button type="button" class="hat-row hat-area" onclick={() => toggle(area.key)}>
          <span class="hat-caret">{open(area.key) ? '▾' : '▸'}</span>
          <span class="hat-name">{area.name}</span>
          <span class="hat-count">{area.count}</span>
        </button>
        {#if open(area.key)}
          {#each area.domains as dom (dom.domain)}
            {@const dkey = `${area.key}|${dom.domain}`}
            <button type="button" class="hat-row hat-domain" onclick={() => toggle(dkey)}>
              <span class="hat-caret">{open(dkey) ? '▾' : '▸'}</span>
              <span class="hat-name">{dom.domain}</span>
              <span class="hat-count">{dom.entities.length}</span>
            </button>
            {#if open(dkey)}
              {#each dom.entities as e (e.entity_id)}
                <button
                  type="button"
                  class="hat-row hat-leaf"
                  class:hat-selected={value === e.entity_id}
                  onclick={() => onChange(e.entity_id)}
                  title={e.entity_id}
                >
                  <span class="hat-dot" class:on={value === e.entity_id}></span>
                  <span class="hat-leaf-name">{e.friendly_name || e.entity_id}</span>
                  <span class="hat-eid">{e.entity_id}</span>
                  {#if e.state}<span class="hat-state" title="value at last sync">{e.state}</span>{/if}
                </button>
              {/each}
            {/if}
          {/each}
        {/if}
      {/each}
    </div>
  {/if}

  <details class="hat-adv" open={Boolean(value) && (value.includes('{{') || !entities.some((e) => e.entity_id === value))}>
    <summary>Template / type an entity id</summary>
    <input
      class="hat-manual"
      type="text"
      placeholder={MANUAL_PLACEHOLDER}
      value={value}
      oninput={(e) => onChange((e.currentTarget as HTMLInputElement).value)}
      spellcheck="false"
    />
    <span class="hat-hint">Overrides the tree selection. Supports <code>{TEMPLATE_HINT}</code> templates (resolved at run time).</span>
  </details>
</div>

<style>
  .hat { display: flex; flex-direction: column; gap: 8px; }
  .hat-bar { display: flex; gap: 6px; }
  .hat-search {
    flex: 1; min-width: 0;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    outline: none;
  }
  .hat-search:focus { border-color: var(--text-muted); }
  .hat-refresh {
    flex: 0 0 auto;
    width: 30px;
    background: var(--bg);
    color: var(--text-muted);
    border: 1px solid var(--card-border);
    cursor: pointer;
    font-size: 13px;
  }
  .hat-refresh:hover:not(:disabled) { color: var(--text-primary); border-color: var(--text-muted); }
  .hat-refresh:disabled { opacity: 0.5; cursor: default; }

  .hat-msg { margin: 0; padding: 8px; font-size: 12px; color: var(--text-ghost); }
  .hat-err { color: var(--status-error, #c0392b); }

  .hat-tree {
    max-height: 320px;
    overflow-y: auto;
    border: 1px solid var(--card-border);
    background: var(--bg);
  }
  .hat-row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 4px 8px;
    background: transparent;
    border: none;
    border-bottom: 1px solid color-mix(in srgb, var(--card-border) 50%, transparent);
    text-align: left;
    cursor: pointer;
    color: var(--text-primary);
    font: inherit;
    font-size: 12px;
  }
  .hat-row:hover { background: color-mix(in srgb, var(--accent) 6%, transparent); }
  .hat-caret { color: var(--text-muted); width: 10px; flex: 0 0 auto; font-size: 10px; }
  .hat-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hat-count {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
  }
  .hat-area .hat-name { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
  .hat-domain { padding-left: 22px; }
  .hat-domain .hat-name { color: var(--text-secondary, var(--text-muted)); }
  .hat-leaf { padding-left: 38px; }
  .hat-leaf-name { flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hat-eid {
    flex: 1; min-width: 0;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .hat-state {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
    max-width: 90px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .hat-dot {
    flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%;
    border: 1px solid var(--text-muted);
  }
  .hat-dot.on { background: var(--accent); border-color: var(--accent); }
  .hat-selected { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .hat-selected:hover { background: color-mix(in srgb, var(--accent) 16%, transparent); }

  .hat-adv { border-top: 1px dashed var(--card-border); padding-top: 6px; }
  .hat-adv summary {
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .hat-manual {
    width: 100%;
    margin-top: 6px;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono);
    font-size: 11px;
    box-sizing: border-box;
    outline: none;
  }
  .hat-manual:focus { border-color: var(--text-muted); }
  .hat-hint { display: block; margin-top: 4px; font-size: 11px; color: var(--text-ghost); }
  .hat-hint code { font-size: 11px; color: var(--text-muted); }
</style>
