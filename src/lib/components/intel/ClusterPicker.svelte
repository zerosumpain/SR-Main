<script lang="ts">
  // The clusters the graph found, as a legend you can act on.
  //
  // Replaces a bare <select>, which could only ever do one of the two things
  // people want from a cluster, and did the more destructive one:
  //
  //   FOCUS   bring clusters forward and let the rest recede. Nothing leaves
  //           the graph, and each selected cluster gains a bold outline of its
  //           own colour. This is what answers "where does this sit among the
  //           others", which is the question in a 3D view where clusters
  //           interpenetrate — and it cannot be answered by a view with the
  //           others removed.
  //   FILTER  cut the graph down to one cluster, server-side. A different and
  //           narrower question, kept as a deliberate second step.
  //
  // Focus is MULTI-select. The question that follows focusing one cluster is
  // nearly always about a second — do these two overlap, and what lives in the
  // overlap — and a control holding one answer at a time cannot ask it.
  //
  // Fully controlled, holding no state of its own except how much of the list is
  // shown, matching SourcePicker.

  import { clusterColour, clusterSlotOf } from './graph-visual';

  let {
    communities = [],
    focused = [],
    filtered = null,
    onToggleFocus,
    onClearFocus,
    onFilter,
  }: {
    communities: Array<{ id: number; size: number; label: string; colourIndex?: number | null; key?: string | null }>;
    /** Brought forward in the graph and outlined. Empty means all of them. */
    focused: number[];
    /** Filtered to server-side, or null. */
    filtered: number | null;
    onToggleFocus: (id: number) => void;
    onClearFocus: () => void;
    onFilter: (id: number | null) => void;
  } = $props();

  const total = $derived(communities.reduce((sum, c) => sum + c.size, 0));
  const focusSet = $derived(new Set(focused));

  /**
   * How many rows are shown before the list has to be asked for.
   *
   * This list used to be a 210px scroll box, which on a page whose whole
   * complaint was nested scrollbars meant a scroller inside a scroller inside
   * the page. Showing the big ones and putting the tail behind one button costs
   * a click and removes a scroll region.
   */
  const PREVIEW = 8;
  let showAll = $state(false);

  const ordered = $derived(
    [...communities].sort((a, b) => {
      // Anything selected stays in view even when the tail is collapsed —
      // otherwise deselecting a small cluster means expanding the list to find
      // the row you just used.
      const fa = focusSet.has(a.id) ? 1 : 0;
      const fb = focusSet.has(b.id) ? 1 : 0;
      return fb - fa || b.size - a.size;
    }),
  );
  const visible = $derived(showAll ? ordered : ordered.slice(0, PREVIEW));
</script>

<div class="ctl">
  <!-- No heading of its own — the rail section above already says "Clusters".
       Only `reset` survives, because it has nowhere else to live. -->
  {#if focused.length || filtered !== null}
    <div class="ctl-actions">
      <button
        type="button"
        class="clear"
        onclick={() => {
          onClearFocus();
          onFilter(null);
        }}>reset</button
      >
    </div>
  {/if}

  {#if !communities.length}
    <p class="hint">No clusters detected yet.</p>
  {:else}
    <div class="rows">
      {#each visible as c (c.id)}
        {@const on = focusSet.has(c.id)}
        <div class="line" class:on>
          <button
            type="button"
            class="row"
            class:on
            style="--sw: {clusterColour(clusterSlotOf({ clusterColourIndex: c.colourIndex, community: c.id }))}"
            aria-pressed={on}
            title={on ? 'Stop highlighting this cluster' : 'Bring this cluster forward'}
            onclick={() => onToggleFocus(c.id)}
          >
            <span class="swatch" aria-hidden="true"></span>
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

    {#if ordered.length > PREVIEW}
      <button type="button" class="more" onclick={() => (showAll = !showAll)}>
        {showAll ? 'Show fewer' : `All ${ordered.length} clusters`}
      </button>
    {/if}

    <p class="hint">
      {#if focused.length}
        {focused.length} cluster{focused.length === 1 ? '' : 's'} outlined. Everything else is dimmed,
        not removed — pick another to compare them.
      {:else}
        {communities.length} clusters covering {total} entities. Pick one or several to outline them.
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
  .ctl-actions {
    display: flex;
    justify-content: flex-end;
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

  /* No max-height and no overflow: the rail is the only scroller. */
  .rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
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
    /* Two borders' worth of space is reserved from the start so selecting a row
       cannot shift the ones under it. */
    border: 1px solid transparent;
    border-left: 3px solid transparent;
    border-radius: var(--radius-sharp);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .row:hover {
    background: var(--accent-tint-08);
  }
  /* Selected rows are bordered in the CLUSTER'S own colour, not the accent —
     the same line the graph draws around that cluster, so the legend and the
     picture are visibly the same statement. */
  .row.on {
    border-color: var(--sw);
    border-left-color: var(--sw);
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

  .more {
    align-self: flex-start;
    padding: 0;
    background: none;
    border: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--accent);
    cursor: pointer;
  }

  .hint {
    margin: 0;
    font-size: var(--fs-label-xs);
    line-height: 1.45;
    color: var(--text-ghost);
  }
</style>
