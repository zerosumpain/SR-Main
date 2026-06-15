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
  type FilterKey = 'source' | 'fact' | 'entity' | 'counterfactual';

  let {
    filters,
    counts,
    onfilter,
  }: {
    filters: { source: boolean; fact: boolean; entity: boolean; counterfactual: boolean };
    counts: { sources: number; facts: number; entities: number; counterfactuals: number };
    onfilter: (key: FilterKey, value: boolean) => void;
  } = $props();

  const filterDefs: { key: FilterKey; label: string; swatch: string; countKey: keyof typeof counts }[] = [
    { key: 'source', label: 'Sources', swatch: 'src', countKey: 'sources' },
    { key: 'fact', label: 'Facts', swatch: 'fact', countKey: 'facts' },
    { key: 'entity', label: 'Entities', swatch: 'ent', countKey: 'entities' },
    { key: 'counterfactual', label: 'Challenges', swatch: 'chal', countKey: 'counterfactuals' },
  ];
</script>

<div class="floating-filters" role="group" aria-label="Desk filters">
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

  <!-- GroupDim selector placeholder — wired in M9. Kept disabled so the
       layout/position is locked in now and the wiring is a drop-in later. -->
  <section class="ff-sec ff-groupby">
    <h3>GROUP BY</h3>
    <select class="ff-select" disabled aria-label="Group by dimension (coming soon)">
      <option>Similarity</option>
    </select>
    <span class="ff-soon">soon</span>
  </section>
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
    box-shadow: 3px 4px 0 rgba(26, 16, 8, 0.1);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    user-select: none;
  }
  .ff-sec h3 {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0 0 8px;
  }
  .ff-filters { display: flex; flex-direction: column; gap: 6px; }
  .ff-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-primary);
    cursor: pointer;
  }
  .ff-row.off { color: var(--text-ghost); }
  .ff-swatch { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }
  .ff-swatch-src { background: var(--surface-elevated); border: 1px solid var(--card-border); }
  .ff-swatch-fact { background: var(--accent-tint-25); border: 1px solid var(--accent); }
  .ff-swatch-ent { background: var(--text-primary); }
  .ff-swatch-chal { background: rgba(196, 68, 68, 0.18); border: 1px solid #c44; }
  .ff-label { flex: 1; }
  .ff-count {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
  }

  .ff-groupby { display: flex; flex-direction: column; gap: 6px; }
  .ff-groupby h3 { margin: 0; }
  .ff-select {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 4px 8px;
    background: var(--bg);
    border: 1px solid var(--card-border);
    color: var(--text-muted);
    cursor: not-allowed;
    width: 100%;
  }
  .ff-soon {
    align-self: flex-start;
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
</style>
