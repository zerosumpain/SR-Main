<!-- src/lib/canvas/intelligence/desk/FloatingFilters.svelte -->
<!--
  View-locked floating filter box, pinned top-left over the desk viewport.
  MUST be mounted as a SIBLING of the transformed .desk-world (a direct child
  of .desk-world-wrap), NOT inside it — otherwise it would pan/scale with the
  world. Mirrors how the minimap/zoom chrome are anchored.

  Holds the artefact-type filters (moved out of LeftFeed) + a placeholder
  GroupDim selector slot (wired in M9).
-->
<script lang="ts">
  import type { GroupDim } from './grouping';

  type FilterKey = 'source' | 'fact' | 'entity' | 'counterfactual';

  let {
    filters,
    counts,
    onfilter,
    groupBy = 'similarity',
    ongroupby = (_d: GroupDim) => {},
    autoArrange = true,
    onautoarrange = (_v: boolean) => {},
    onarrangenow = () => {},
    search = '',
    onsearch = (_q: string) => {},
  }: {
    filters: { source: boolean; fact: boolean; entity: boolean; counterfactual: boolean };
    counts: { sources: number; facts: number; entities: number; counterfactuals: number };
    onfilter: (key: FilterKey, value: boolean) => void;
    groupBy?: GroupDim;
    ongroupby?: (dim: GroupDim) => void;
    autoArrange?: boolean;
    onautoarrange?: (value: boolean) => void;
    onarrangenow?: () => void;
    search?: string;
    onsearch?: (query: string) => void;
  } = $props();

  const filterDefs: { key: FilterKey; label: string; swatch: string; countKey: keyof typeof counts }[] = [
    { key: 'source', label: 'Sources', swatch: 'src', countKey: 'sources' },
    { key: 'fact', label: 'Facts', swatch: 'fact', countKey: 'facts' },
    { key: 'entity', label: 'Entities', swatch: 'ent', countKey: 'entities' },
    { key: 'counterfactual', label: 'Challenges', swatch: 'chal', countKey: 'counterfactuals' },
  ];

  const GROUP_DIMS: { value: GroupDim; label: string; hint: string }[] = [
    { value: 'similarity', label: 'Similarity', hint: 'Piles of semantically-related facts' },
    { value: 'cluster', label: 'Cluster', hint: 'Synthesis topic clusters' },
    { value: 'theme', label: 'Theme', hint: 'By artefact kind (sites / facts / people…)' },
    { value: 'entityType', label: 'Entity type', hint: 'Group entities by their type' },
    { value: 'sentiment', label: 'Sentiment', hint: 'By relationship sentiment' },
    { value: 'cooccurrence', label: 'Co-occurrence', hint: 'Entities & facts sharing a fact' },
  ];

  function onDimChange(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value as GroupDim;
    ongroupby(v);
  }
</script>

<div class="floating-filters" role="group" aria-label="Desk filters">
  <section class="ff-sec ff-search-sec">
    <h3>SEARCH</h3>
    <div class="ff-search-wrap">
      <input
        type="search"
        class="ff-search"
        placeholder="Filter cards…"
        aria-label="Search cards by title or description"
        value={search}
        oninput={(e) => onsearch((e.currentTarget as HTMLInputElement).value)}
      />
      {#if search.trim().length > 0 && search.trim().length < 3}
        <span class="ff-search-hint">type {3 - search.trim().length} more…</span>
      {/if}
    </div>
  </section>

  <section class="ff-sec">
    <h3>FILTERS</h3>
    <div class="ff-filters">
      {#each filterDefs as f (f.key)}
        <label class="ff-row" class:off={!filters[f.key]}>
          <input
            type="checkbox"
            checked={filters[f.key]}
            onchange={(e) => onfilter(f.key, (e.currentTarget as HTMLInputElement).checked)}
          />
          <span class="ff-swatch ff-swatch-{f.swatch}"></span>
          <span class="ff-label">{f.label}</span>
          <span class="ff-count">{counts[f.countKey]}</span>
        </label>
      {/each}
    </div>
  </section>

  <!-- GroupDim selector (M9): controlled; parent owns groupBy state. -->
  <div class="ff-group" role="group" aria-label="Group by">
    <span class="ff-group-label">GROUP BY</span>
    <select
      class="ff-select"
      aria-label="Group artefacts by dimension"
      value={groupBy}
      onchange={onDimChange}
    >
      {#each GROUP_DIMS as d (d.value)}
        <option value={d.value} title={d.hint}>{d.label}</option>
      {/each}
    </select>
  </div>

  <!-- Auto-arrange: continuous reflow toggle + one-shot tidy. -->
  <div class="ff-group" role="group" aria-label="Arrange">
    <span class="ff-group-label">ARRANGE</span>
    <label class="ff-arrange-row" class:off={!autoArrange}>
      <input
        type="checkbox"
        checked={autoArrange}
        onchange={(e) => onautoarrange((e.currentTarget as HTMLInputElement).checked)}
      />
      <span class="ff-label">Auto-arrange</span>
    </label>
    <button
      type="button"
      class="ff-arrange-btn"
      disabled={autoArrange}
      title={autoArrange
        ? 'Auto-arrange is on — the desk tidies itself as research streams in'
        : 'Snap every card into its pile now'}
      onclick={onarrangenow}
    >
      Arrange now
    </button>
    <span class="ff-arrange-hint">
      {autoArrange ? 'Tidies live as research streams in.' : 'Frozen — drag freely; tap to tidy.'}
    </span>
  </div>
</div>

<style>
  .floating-filters {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 6;
    width: 200px;
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    user-select: none;
  }
  .ff-sec h3 {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0 0 8px;
  }
  .ff-search-sec { border-bottom: 1px solid var(--divider); padding-bottom: 10px; }
  .ff-search-wrap { display: flex; flex-direction: column; gap: 3px; }
  .ff-search {
    font-family: var(--font-mono);
    font-size: var(--fs-body);
    padding: 5px 8px;
    width: 100%;
    box-sizing: border-box;
    background: var(--surface-elevated);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    border-radius: 0;
    outline: none;
  }
  .ff-search:focus { border-color: var(--accent); }
  .ff-search::placeholder { color: var(--text-ghost); }
  .ff-search-hint { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .ff-filters { display: flex; flex-direction: column; gap: 6px; }
  .ff-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
    cursor: pointer;
  }
  .ff-row.off { color: var(--text-ghost); }
  .ff-swatch { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }
  .ff-swatch-src { background: var(--surface-elevated); border: 1px solid var(--card-border); }
  .ff-swatch-fact { background: var(--accent-tint-25); border: 1px solid var(--accent); }
  .ff-swatch-ent { background: var(--text-primary); }
  .ff-swatch-chal { background: var(--error-bg); border: 1px solid var(--error); }
  .ff-label { flex: 1; }
  .ff-count {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }

  .ff-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--divider);
  }
  .ff-group-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    color: var(--text-muted, rgba(26, 16, 8, 0.55));
  }
  .ff-select {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.02em;
    padding: 5px 8px;
    background: var(--surface-elevated);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    cursor: pointer;
  }
  .ff-select:hover,
  .ff-select:focus-visible {
    border-color: var(--accent);
    color: var(--accent);
    outline: none;
  }

  .ff-arrange-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
    cursor: pointer;
  }
  .ff-arrange-row.off { color: var(--text-ghost); }
  .ff-arrange-btn {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.02em;
    padding: 5px 8px;
    background: var(--surface-elevated);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    cursor: pointer;
    text-align: left;
  }
  .ff-arrange-btn:hover:not(:disabled),
  .ff-arrange-btn:focus-visible:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
    outline: none;
  }
  .ff-arrange-btn:disabled {
    opacity: 0.45;
    cursor: default;
    box-shadow: none;
  }
  .ff-arrange-hint {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.3;
    color: var(--text-ghost);
  }
</style>
