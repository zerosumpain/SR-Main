<script lang="ts">
  import { onMount } from 'svelte';
  import BasicConfigRenderer from './BasicConfigRenderer.svelte';
  import type { BasicConfigField } from '$lib/workflows/types';

  let {
    fields,
    config,
    variables = [],
    showAdvanced = false,
    onConfigChange,
  }: {
    fields: BasicConfigField[];
    config: Record<string, unknown>;
    variables: { path: string; type: string; description?: string }[];
    showAdvanced: boolean;
    onConfigChange: (config: Record<string, unknown>) => void;
  } = $props();

  type Tab = 'connection' | 'entities' | 'operation';
  let activeTab: Tab = $state('operation');

  // Connection state
  let haUrl: string = $state('http://localhost:8123');
  let haToken: string = $state('');
  let hasToken: boolean = $state(false);
  let lastSynced: string | null = $state(null);
  let entityCount: number = $state(0);
  let connectionTested: boolean | null = $state(null);
  let testError: string = $state('');
  let syncing = $state(false);
  let saving = $state(false);

  // Entity browser state
  let entities: any[] = $state([]);
  let searchQuery: string = $state('');
  let domainFilter: string = $state('');
  let entitiesLoaded = $state(false);

  const domainIcons: Record<string, string> = {
    light: '💡', switch: '🔌', sensor: '🌡️', binary_sensor: '🔘', climate: '🌡️',
    media_player: '📺', camera: '📷', cover: '🪟', fan: '🌀', lock: '🔒',
    device_tracker: '📍', person: '👤', automation: '⚙️', scene: '🎭', script: '📜',
    sun: '☀️',
  };

  let filteredEntities = $derived.by(() => {
    let result = entities;
    if (domainFilter) result = result.filter((e: any) => e.domain === domainFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((e: any) =>
        e.friendly_name?.toLowerCase().includes(q) || e.entity_id.toLowerCase().includes(q),
      );
    }
    return result;
  });

  let domains = $derived.by(() => {
    const d = new Set(entities.map((e: any) => e.domain));
    return Array.from(d).sort();
  });

  let groupedByArea = $derived.by(() => {
    const groups = new Map<string, any[]>();
    for (const e of filteredEntities) {
      const area = e.area_name || 'Ungrouped';
      const list = groups.get(area) || [];
      list.push(e);
      groups.set(area, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === 'Ungrouped') return 1;
      if (b === 'Ungrouped') return -1;
      return a.localeCompare(b);
    });
  });

  async function loadConfig() {
    try {
      const res = await fetch('/api/workflows/homeassistant/config');
      if (!res.ok) return;
      const data = await res.json();
      haUrl = data.url || 'http://localhost:8123';
      hasToken = data.hasToken;
      lastSynced = data.lastSynced;
      entityCount = data.entityCount;
    } catch {}
  }

  async function saveConfig() {
    saving = true;
    try {
      const body: Record<string, string> = { url: haUrl };
      if (haToken) body.token = haToken;
      await fetch('/api/workflows/homeassistant/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      hasToken = true;
      haToken = '';
      connectionTested = null;
    } finally {
      saving = false;
    }
  }

  async function testConnection() {
    connectionTested = null;
    testError = '';
    try {
      const res = await fetch('/api/workflows/homeassistant/test', { method: 'POST' });
      const data = await res.json();
      connectionTested = data.connected;
      if (!data.connected) testError = data.error || 'Connection failed';
    } catch {
      connectionTested = false;
      testError = 'Request failed';
    }
  }

  async function syncEntities() {
    syncing = true;
    try {
      const res = await fetch('/api/workflows/homeassistant/sync', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        entityCount = data.entityCount;
        lastSynced = new Date().toISOString();
        await loadEntities();
      }
    } finally {
      syncing = false;
    }
  }

  async function loadEntities() {
    try {
      const res = await fetch('/api/workflows/homeassistant/entities');
      if (!res.ok) return;
      const data = await res.json();
      entities = data.entities || [];
      entitiesLoaded = true;
    } catch {}
  }

  function selectEntity(entityId: string) {
    const domain = entityId.split('.')[0];
    onConfigChange({ ...config, entityId, domain });
    activeTab = 'operation';
  }

  onMount(() => {
    loadConfig();
  });

  $effect(() => {
    if (activeTab === 'entities' && !entitiesLoaded) {
      loadEntities();
    }
  });
</script>

<!-- Tabs -->
<div class="flex border-b -mx-5 -mt-1 mb-4" style="border-color: var(--card-border);">
  <button
    onclick={() => { activeTab = 'connection'; }}
    class="px-4 py-2.5 text-xs font-medium transition-colors"
    style="color: {activeTab === 'connection' ? 'var(--accent)' : 'var(--text-ghost)'}; border-bottom: 2px solid {activeTab === 'connection' ? 'var(--accent)' : 'transparent'};"
  >Connection</button>
  <button
    onclick={() => { activeTab = 'entities'; }}
    class="px-4 py-2.5 text-xs font-medium transition-colors"
    style="color: {activeTab === 'entities' ? 'var(--accent)' : 'var(--text-ghost)'}; border-bottom: 2px solid {activeTab === 'entities' ? 'var(--accent)' : 'transparent'};"
  >Entities ({entityCount})</button>
  <button
    onclick={() => { activeTab = 'operation'; }}
    class="px-4 py-2.5 text-xs font-medium transition-colors"
    style="color: {activeTab === 'operation' ? 'var(--accent)' : 'var(--text-ghost)'}; border-bottom: 2px solid {activeTab === 'operation' ? 'var(--accent)' : 'transparent'};"
  >Operation</button>
</div>

<!-- Connection Tab -->
{#if activeTab === 'connection'}
  <div class="space-y-3">
    <div>
      <label class="text-[11px] uppercase tracking-wider mb-1 block" style="color: var(--text-ghost); font-family: var(--font-mono);">HA URL</label>
      <input type="text" bind:value={haUrl} class="w-full px-2 py-1.5 rounded text-xs border" style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);" />
    </div>

    <div>
      <label class="text-[11px] uppercase tracking-wider mb-1 block" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Access Token {#if hasToken}<span style="color: #22c55e;">(configured)</span>{/if}
      </label>
      <input type="password" bind:value={haToken} placeholder={hasToken ? '••••••••' : 'Long-lived access token'} class="w-full px-2 py-1.5 rounded text-xs border" style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);" />
    </div>

    <div class="flex gap-2">
      <button onclick={saveConfig} disabled={saving} class="flex-1 px-3 py-2 rounded text-xs font-medium" style="background: var(--accent); color: white; opacity: {saving ? 0.7 : 1};">
        {saving ? 'Saving...' : 'Save'}
      </button>
      <button onclick={testConnection} class="flex-1 px-3 py-2 rounded text-xs border" style="border-color: var(--card-border); color: var(--text-primary);">
        Test Connection
      </button>
    </div>

    {#if connectionTested !== null}
      <div class="flex items-center gap-2 px-3 py-2 rounded text-xs" style="background: var(--card-bg); color: {connectionTested ? '#22c55e' : '#ef4444'};">
        {connectionTested ? '✓ Connected' : `✗ ${testError}`}
      </div>
    {/if}

    <div class="flex items-center justify-between px-3 py-2 rounded text-xs" style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-ghost);">
      <span>{entityCount} entities</span>
      <span>{lastSynced ? `Synced ${new Date(lastSynced).toLocaleTimeString()}` : 'Not synced'}</span>
    </div>

    <button onclick={syncEntities} disabled={syncing} class="w-full px-3 py-2 rounded text-xs border" style="border-color: var(--card-border); color: var(--text-primary); opacity: {syncing ? 0.7 : 1};">
      {syncing ? 'Syncing...' : 'Refresh Entities'}
    </button>
  </div>

<!-- Entity Browser Tab -->
{:else if activeTab === 'entities'}
  <div class="space-y-3">
    <input
      type="text"
      bind:value={searchQuery}
      placeholder="Search entities..."
      class="w-full px-2 py-1.5 rounded text-xs border"
      style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary);"
    />

    <div class="flex flex-wrap gap-1">
      <button
        onclick={() => { domainFilter = ''; }}
        class="px-2 py-0.5 rounded text-[10px]"
        style="background: {domainFilter === '' ? 'var(--accent)' : 'var(--card-bg)'}; color: {domainFilter === '' ? 'white' : 'var(--text-ghost)'}; border: 1px solid var(--card-border);"
      >All</button>
      {#each domains as domain}
        <button
          onclick={() => { domainFilter = domain; }}
          class="px-2 py-0.5 rounded text-[10px]"
          style="background: {domainFilter === domain ? 'var(--accent)' : 'var(--card-bg)'}; color: {domainFilter === domain ? 'white' : 'var(--text-ghost)'}; border: 1px solid var(--card-border);"
        >{domainIcons[domain] || '•'} {domain}</button>
      {/each}
    </div>

    <div class="max-h-64 overflow-y-auto space-y-2">
      {#each groupedByArea as [area, areaEntities]}
        <div>
          <div class="text-[10px] uppercase tracking-wider px-1 py-0.5 mb-1" style="color: var(--text-ghost); font-family: var(--font-mono);">{area}</div>
          {#each areaEntities as entity}
            <button
              onclick={() => selectEntity(entity.entity_id)}
              class="w-full text-left px-2 py-1.5 rounded text-xs mb-0.5 border transition-colors hover:border-[var(--accent)]"
              style="background: var(--card-bg); border-color: {config.entityId === entity.entity_id ? 'var(--accent)' : 'var(--card-border)'}; color: var(--text-primary);"
            >
              <span>{domainIcons[entity.domain] || '•'} {entity.friendly_name}</span>
              <span class="float-right" style="color: var(--text-ghost); font-family: var(--font-mono); font-size: 10px;">{entity.state}</span>
              <div class="text-[10px] mt-0.5" style="color: var(--text-ghost); font-family: var(--font-mono);">{entity.entity_id}</div>
            </button>
          {/each}
        </div>
      {/each}

      {#if filteredEntities.length === 0}
        <p class="text-xs text-center py-4" style="color: var(--text-ghost);">
          {entitiesLoaded ? 'No entities match filter' : 'Loading entities...'}
        </p>
      {/if}
    </div>
  </div>

<!-- Operation Tab -->
{:else if activeTab === 'operation'}
  <BasicConfigRenderer
    {fields}
    {config}
    {variables}
    {showAdvanced}
    {onConfigChange}
  />
{/if}
