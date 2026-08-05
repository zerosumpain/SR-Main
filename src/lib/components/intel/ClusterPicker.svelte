<script lang="ts">
  // The clusters the graph found, as a legend you can act on.
  //
  // Replaces a bare <select>, which could only ever do one of the two things
  // people want from a cluster, and did the more destructive one:
  //
  //   FOCUS   bring one cluster forward and let the rest recede. Nothing leaves
  //           the graph. This is what answers "where does this sit among the
  //           others", which is the question in a 3D view where clusters
  //           interpenetrate — and it cannot be answered by a view with the
  //           others removed.
  //   FILTER  cut the graph down to one cluster, server-side. A different and
  //           narrower question, kept as a deliberate second step.
  //
  // Fully controlled, holding no state of its own, matching SourcePicker.

  import { clusterColour } from './graph-visual';

  let {
    communities = [],
    focused = null,
    filtered = null,
    onFocus,
    onFilter,
  }: {
    communities: Array<{ id: number; size: number; label: string }>;
    /** Brought forward in the graph, or null. */
    focused: number | null;
    /** Filtered to server-side, or null. */
    filtered: number | null;
    onFocus: (id: number | null) => void;
    onFilter: (id: number | null) => void;
  } = $props();

  const total = $derived(communities.reduce((sum, c) => sum + c.size, 0));
</script>

<div class="ctl">
  <span class="ctl-title">
    Clusters
    {#if focused !== null || filtered !== null}
      <button
        type="button"
        class="clear"
        onclick={() => {
          onFocus(null);
          onFilter(null);
        }}>reset</button
      >
    {/if}
  </span>

  {#if !communities.length}
    <p class="hint">No clusters detected yet.</p>
  {:else}
    <div class="rows">
      {#each communities as c (c.id)}
        {@const on = focused === c.id}
        <div class="line" class:on>
          <button
            type="button"
            class="row"
            class:on
            aria-pressed={on}
            title="Bring this cluster forward"
            onclick={() => onFocus(on ? null : c.id)}
          >
            <span class="swatch" style="--sw: {clusterColour(c.id)}" aria-hidden="true"></span>
            <span class="name">{c.label}</span>
            <span class="count">{c.size}</span>
          </button>
          <button
            type="button"
            class="only"
            class:on={filtered === c.id}
            aria-pressed={filtered === c.id}
            title="Show only this cluster"
            onclick={() => onFilter(filtered === c.id ? null : c.id)}>only</button
          >
        </div>
      {/each}
    </div>

    <p class="hint">
      {#if focused !== null}
        Everything else is dimmed, not removed — the rest of the graph is still there for context.
      {:else}
        {communities.length} clusters covering {total} entities. Pick one to bring it forward.
      {/if}
    </p>
  {/if}
</div>

<style>
  .ctl {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .ctl-title {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
  }
  .clear {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    cursor: pointer;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 210px;
    overflow-y: auto;
  }

  .line {
    display: flex;
    align-items: stretch;
    gap: 4px;
  }

  .row {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 6px;
    font: inherit;
    font-size: var(--fs-label);
    text-align: left;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-sharp);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .row:hover {
    background: var(--accent-tint-08);
  }
  .row.on {
    border-color: var(--accent-tint-35);
    background: var(--accent-tint-08);
    color: var(--text-primary);
  }

  .swatch {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: var(--radius-round);
    background: var(--sw);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }

  .only {
    flex: none;
    padding: 0 7px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: none;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    color: var(--text-ghost);
    cursor: pointer;
  }
  .only:hover {
    color: var(--accent);
    border-color: var(--accent-tint-35);
  }
  .only.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }

  .hint {
    margin: 0;
    font-size: var(--fs-label-xs);
    line-height: 1.45;
    color: var(--text-ghost);
  }
</style>
