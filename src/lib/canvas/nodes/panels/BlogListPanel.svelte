<script lang="ts">
  import RawConfigEditor from './shared/RawConfigEditor.svelte';
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';

  // Editor for the `blog-list` node.
  //
  // The current executor (src/lib/workflows/nodes/blog-ops.ts) calls
  // `executeSiteTool('site_blog_list', {})` with no arguments, so the
  // values below are stored on the node config for forward compatibility
  // / future-proofing — the underlying site tool already accepts a
  // status filter, and we keep the unknown keys via spread so newer
  // executors can pick them up without losing config.

  let {
    config,
    onChange,
    definition,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
  } = $props();

  const status = $derived(String(config.status ?? 'all'));
  const limit = $derived(
    typeof config.limit === 'number'
      ? config.limit
      : Number(config.limit ?? 50),
  );
  const order = $derived(String(config.order ?? 'newest'));

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }
  // Reference `definition` for typings only.
  void definition;
</script>

<div class="bo">
  <!-- Filter -->
  <section class="bo-sec">
    <header class="bo-sec-hdr"><span class="sr-label-tight">Filter</span></header>
    <label class="bo-field">
      <span class="bo-label">Status</span>
      <select
        value={status}
        onchange={(e) => set('status', (e.currentTarget as HTMLSelectElement).value)}
      >
        <option value="all">All</option>
        <option value="published">Published only</option>
        <option value="draft">Drafts only</option>
      </select>
      <span class="bo-hint">Filter posts by publish state.</span>
    </label>
  </section>

  <!-- Results -->
  <section class="bo-sec">
    <header class="bo-sec-hdr"><span class="sr-label-tight">Results</span></header>
    <div class="bo-row">
      <label class="bo-field bo-field-half">
        <span class="bo-label">Max results</span>
        <input
          type="number"
          min="1"
          max="50"
          step="1"
          value={limit}
          oninput={(e) => {
            const n = Number((e.currentTarget as HTMLInputElement).value) || 0;
            set('limit', Math.max(1, Math.min(50, n)));
          }}
        />
        <span class="bo-hint">Hard-capped at 50 by the site tool.</span>
      </label>
      <label class="bo-field bo-field-half">
        <span class="bo-label">Order</span>
        <select
          value={order}
          onchange={(e) => set('order', (e.currentTarget as HTMLSelectElement).value)}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </label>
    </div>
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <RawConfigEditor {config} {onChange} />
</div>

<style>
  .bo { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }
  .bo-sec { display: flex; flex-direction: column; gap: 8px; }
  .bo-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .bo-row { display: flex; gap: 10px; align-items: flex-end; }
  .bo-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .bo-field-half { flex: 1; }
  .bo-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .bo-hint { font-size: var(--fs-label); color: var(--text-ghost); }

  input[type='number'], select, textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='number']:focus, select:focus, textarea:focus { border-color: var(--text-muted); }

  .bo-code {
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
  .bo-code:focus { border-color: var(--text-muted); }
</style>
