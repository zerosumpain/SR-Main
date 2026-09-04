<script lang="ts">
  import RawConfigEditor from './shared/RawConfigEditor.svelte';
  import type { NodeDefinition } from '$lib/workflows/types';
  import NodeMemoryBlock from './shared/NodeMemoryBlock.svelte';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import StoreKeyPicker from './shared/StoreKeyPicker.svelte';
  import UpstreamFieldPicker from './shared/UpstreamFieldPicker.svelte';

  let {
    config,
    onChange,
    definition,
    workflowId,
    upstreamFields = [],
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
    workflowId?: string;
    upstreamFields?: string[];
  } = $props();

  const itemsPath = $derived(String(config.itemsPath ?? ''));
  const idPath = $derived(String(config.idPath ?? ''));
  const storeKey = $derived(String(config.storeKey ?? 'seen_ids'));
  const recordMode = $derived(
    config.recordMode === 'downstream-success' ? 'downstream-success' : 'immediate',
  );

  async function fetchKeys(): Promise<Array<{ key: string; meta?: string }>> {
    if (!workflowId) return [];
    const res = await fetch(`/api/workflows/${workflowId}/data-store`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    return (body.keys ?? []) as Array<{ key: string; meta?: string }>;
  }

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }
  void definition;
</script>

<div class="dd">
  <p class="dd-lead">
    Filters the incoming array against a remembered set of ids, so only <strong>new</strong> items
    flow on. Place it between a fetch/search node and your summarise/send nodes.
  </p>

  <!-- Items array -->
  <section class="dd-sec">
    <header class="dd-sec-hdr"><span class="sr-label-tight">Items array</span></header>
    <UpstreamFieldPicker
      label="Items path"
      value={itemsPath}
      {upstreamFields}
      placeholder="auto-detect first array (e.g. results)"
      allowCustom={true}
      onChange={(v) => set('itemsPath', v)}
    />
    <p class="dd-hint">Dot-path to the array. Empty = auto-detect the first array in the input.</p>
  </section>

  <!-- Id path -->
  <section class="dd-sec">
    <header class="dd-sec-hdr"><span class="sr-label-tight">Unique id (per item)</span></header>
    <input
      type="text"
      class="dd-text"
      value={idPath}
      placeholder="url"
      oninput={(e) => set('idPath', (e.currentTarget as HTMLInputElement).value)}
    />
    <p class="dd-hint">
      Dot-path <em>within each item</em> (e.g. <code>url</code> or <code>id</code>). Empty tries
      <code>url</code> then <code>id</code>. Items with no id always pass through as new.
    </p>
  </section>

  <!-- Store key -->
  <section class="dd-sec">
    <header class="dd-sec-hdr"><span class="sr-label-tight">Seen-set key</span></header>
    <StoreKeyPicker
      value={storeKey}
      mode="set"
      fetcher={fetchKeys}
      onChange={(v) => set('storeKey', v)}
      placeholder="seen_ids"
    />
    <p class="dd-hint">data-store key holding the remembered ids (default <code>seen_ids</code>).</p>
  </section>

  <!-- What's actually remembered right now, and a way to wipe it -->
  <NodeMemoryBlock
    {workflowId}
    keys={[storeKey]}
    label="Remembered ids"
    hint="Clearing the seen set makes every item look new again on the next run."
  />

  <!-- Max remembered -->
  <section class="dd-sec">
    <header class="dd-sec-hdr"><span class="sr-label-tight">Max remembered</span></header>
    <input
      type="number"
      class="dd-text"
      value={String(config.maxRemembered ?? '')}
      placeholder="500"
      oninput={(e) => set('maxRemembered', (e.currentTarget as HTMLInputElement).value)}
    />
    <p class="dd-hint">Rolling window — keep only the most recent N ids (default 500).</p>
  </section>

  <!-- Record mode -->
  <section class="dd-sec">
    <header class="dd-sec-hdr"><span class="sr-label-tight">When to remember</span></header>
    <select
      class="dd-select"
      value={recordMode}
      onchange={(e) => set('recordMode', (e.currentTarget as HTMLSelectElement).value)}
    >
      <option value="immediate">Immediately (as items pass through)</option>
      <option value="downstream-success">Only after the run succeeds</option>
    </select>
    <p class="dd-hint">
      {#if recordMode === 'downstream-success'}
        Ids are recorded only once the whole run completes with no errors — a failed send will
        retry these items next run.
      {:else}
        Ids are recorded as soon as they pass the filter.
      {/if}
    </p>
  </section>

  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <RawConfigEditor {config} {onChange} />
</div>

<style>
  .dd { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }
  .dd-lead { margin: 0; font-size: var(--fs-label); color: var(--text-muted); line-height: 1.5; }
  .dd-lead strong { color: var(--text-primary); }

  .dd-sec { display: flex; flex-direction: column; gap: 8px; }
  .dd-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }

  .dd-text, .dd-select {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    box-sizing: border-box;
    outline: none;
  }
  .dd-text:focus, .dd-select:focus { border-color: var(--text-muted); }

  .dd-hint { font-size: var(--fs-label); color: var(--text-ghost); margin: 0; line-height: 1.4; }
  .dd-hint code { font-size: var(--fs-label); color: var(--text-muted); }

  .dd-code {
    width: 100%;
    padding: 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-code); font-size: var(--fs-label);
    box-sizing: border-box;
    outline: none;
    resize: vertical;
  }
  .dd-code:focus { border-color: var(--text-muted); }
</style>
