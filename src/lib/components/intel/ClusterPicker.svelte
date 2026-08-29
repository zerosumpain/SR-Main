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
  // A row now also OPENS, into a card describing what the cluster actually
  // holds: three fields (index, size, most central member) is enough to colour a
  // dot and nothing else.
  //
  // Fully controlled, holding no state of its own except how much of the list is
  // shown and which row is open, matching SourcePicker.

  import { clusterColour, clusterSlotOf } from './graph-visual';
  import ClusterCard from './ClusterCard.svelte';
  import type { ClusterView } from './cluster-types';

  let {
    communities = [],
    roster = [],
    narrowed = false,
    reachedTotal = 0,
    focused = [],
    filtered = null,
    stats = null,
    resolution = null,
    recalculating = false,
    narrating = null,
    onToggleFocus,
    onClearFocus,
    onFilter,
    onRecalculate,
    onRename,
    onNarrate,
    onOpen,
  }: {
    communities: Array<{
      id: number;
      size: number;
      /** How much of the cluster the current filter reaches; equals `size` unfiltered. */
      reach?: number;
      label: string;
      /**
       * What the cluster is called given what the filter admits. Null when
       * nothing is filtered, or when the user has named this cluster.
       */
      inViewLabel?: string | null;
      colourIndex?: number | null;
      key?: string | null;
    }>;
    /** The rich roster, joined to `communities` by key. */
    roster?: ClusterView[];
    /** True when a filter is narrowing the graph, so the list is a slice. */
    narrowed?: boolean;
    /** Every cluster the filter reaches, including any past the listed cap. */
    reachedTotal?: number;
    /** Brought forward in the graph and outlined. Empty means all of them. */
    focused: number[];
    /** Filtered to server-side, or null. */
    filtered: number | null;
    stats?: { isolated: number; tracked: number; untracked: number } | null;
    resolution?: number | null;
    recalculating?: boolean;
    /** Key of the cluster currently having its narrative written. */
    narrating?: string | null;
    onToggleFocus: (id: number) => void;
    onClearFocus: () => void;
    onFilter: (id: number | null) => void;
    onRecalculate?: () => void;
    onRename?: (key: string, name: string | null) => void;
    onNarrate?: (key: string) => void;
    onOpen?: (key: string) => void;
  } = $props();

  const total = $derived(communities.reduce((sum, c) => sum + c.size, 0));
  const focusSet = $derived(new Set(focused));
  const rosterByKey = $derived(new Map(roster.map((c) => [c.key, c])));

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
  let openKey = $state<string | null>(null);

  /**
   * Ordered by SIGNAL where the roster knows it, size otherwise.
   *
   * Size alone is what put four retail-email clusters above both clusters
   * carrying real work. The roster ranks by how many kinds of source corroborate
   * a cluster, which is what separates a subject from a feed.
   */
  const ordered = $derived(
    [...communities].sort((a, b) => {
      // Anything selected stays in view even when the tail is collapsed —
      // otherwise deselecting a small cluster means expanding the list to find
      // the row you just used.
      const fa = focusSet.has(a.id) ? 1 : 0;
      const fb = focusSet.has(b.id) ? 1 : 0;
      if (fa !== fb) return fb - fa;
      // Under a filter, REACH is the ranking that answers the question being
      // asked — "which clusters does this channel populate". Signal ranks
      // clusters as they are in the whole graph, which is the right answer only
      // when you are looking at the whole graph.
      if (narrowed) {
        const ra = a.reach ?? a.size;
        const rb = b.reach ?? b.size;
        if (ra !== rb) return rb - ra;
      }
      const sa = a.key ? rosterByKey.get(a.key)?.signal : undefined;
      const sb = b.key ? rosterByKey.get(b.key)?.signal : undefined;
      if (sa !== undefined && sb !== undefined && sa !== sb) return sb - sa;
      return b.size - a.size;
    }),
  );
  const visible = $derived(showAll ? ordered : ordered.slice(0, PREVIEW));
  const ranked = $derived(ordered.some((c) => c.key && rosterByKey.has(c.key)));
</script>

<div class="ctl">
  <div class="ctl-actions">
    {#if onRecalculate}
      <button
        type="button"
        class="recalc"
        disabled={recalculating}
        title="Re-detect clusters against the current graph, at the resolution that reads best"
        onclick={() => onRecalculate?.()}
      >
        {recalculating ? 'recalculating…' : 'recalculate'}
      </button>
    {/if}
    {#if focused.length || filtered !== null}
      <button
        type="button"
        class="clear"
        onclick={() => {
          onClearFocus();
          onFilter(null);
        }}>reset</button
      >
    {/if}
  </div>

  {#if !communities.length}
    <p class="hint">No clusters detected yet.</p>
  {:else}
    <div class="rows">
      {#each visible as c (c.id)}
        {@const on = focusSet.has(c.id)}
        {@const rich = c.key ? rosterByKey.get(c.key) : undefined}
        {@const isOpen = Boolean(c.key) && openKey === c.key}
        <div class="line" class:on>
          <button
            type="button"
            class="row"
            class:on
            style="--sw: {clusterColour(
              clusterSlotOf({ clusterColourIndex: c.colourIndex, community: c.id }),
            )}"
            aria-pressed={on}
            title={on ? 'Stop highlighting this cluster' : 'Bring this cluster forward'}
            onclick={() => onToggleFocus(c.id)}
          >
            <span class="swatch" aria-hidden="true"></span>
            <!-- A name the user typed wins outright — it is their word for this
                 cluster. Otherwise, under a filter, the cluster is named after
                 the part of it you can actually see: the stored label describes
                 all of it, and naming a filtered row after entities the filter
                 removed describes something that is not on screen. -->
            <span class="name">{rich?.name ?? c.inViewLabel ?? rich?.label ?? c.label}</span>
            {#if rich?.name}<span class="named" title="You named this cluster">·</span>{/if}
            <!-- Filtered, the row says how much of the cluster is in view over
                 how big it really is. Showing only the reach would make a large
                 cluster you have narrowed into look like a small one; showing
                 only the size would not say why it is listed. -->
            {#if narrowed && c.reach !== undefined && c.reach < c.size}
              <span class="count" title="{c.reach} of this cluster's {c.size} entities are in the current view">
                {c.reach}<span class="of">/{c.size}</span>
              </span>
            {:else}
              <span class="count">{c.size}</span>
            {/if}
          </button>
          {#if rich}
            <button
              type="button"
              class="only"
              class:on={isOpen}
              aria-expanded={isOpen}
              title={isOpen ? 'Close this cluster' : 'What is in this cluster'}
              onclick={() => (openKey = isOpen ? null : (c.key ?? null))}
              >{isOpen ? '−' : '?'}</button
            >
          {/if}
          <button
            type="button"
            class="only"
            class:on={filtered === c.id}
            aria-pressed={filtered === c.id}
            title="Show only this cluster"
            onclick={() => onFilter(filtered === c.id ? null : c.id)}>only</button
          >
        </div>

        {#if isOpen && rich}
          <ClusterCard
            cluster={rich}
            busy={narrating === rich.key}
            onRename={(key, name) => onRename?.(key, name)}
            onNarrate={(key) => onNarrate?.(key)}
            onOpen={onOpen ? (key) => onOpen(key) : undefined}
          />
        {/if}
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
      {:else if narrowed}
        <!-- Counted over the clusters the filter REACHES, never "how many are
             hidden": the listed set is capped and the roster only tracks
             clusters of five or more, so subtracting one from the other
             produced a number that belonged to neither population. -->
        {#if reachedTotal > communities.length}
          Top {communities.length} of {reachedTotal} clusters this filter reaches, most reached first.
        {:else}
          {communities.length} cluster{communities.length === 1 ? '' : 's'} reached by this filter, most
          reached first.
        {/if}
      {:else}
        {communities.length} clusters covering {total} entities{#if ranked}, strongest first — ranked by
          how many kinds of source corroborate them, not by size{/if}.
      {/if}
    </p>

    <!-- The graph is bigger than the clusters in it, and saying so is the only
         honest way to present a list that covers half of it. The isolated pile
         is a data-quality finding, so it links to the page that owns that. -->
    {#if stats && (stats.isolated > 0 || stats.untracked > 0)}
      <p class="tail">
        {#if stats.isolated > 0}
          <a href="/jkai/intel/quality"
            >{stats.isolated.toLocaleString()} entities are connected to nothing</a
          >
          and cannot be clustered at any setting.
        {/if}
        {#if stats.untracked > 0}
          A further {stats.untracked.toLocaleString()} sit in fragments too small to name.
        {/if}
      </p>
    {/if}

    {#if resolution !== null}
      <p class="tail">
        Resolution {resolution}, chosen to keep any one cluster under a twelfth of the graph.
      </p>
    {/if}
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
    gap: 10px;
  }
  .clear,
  .recalc {
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
  .recalc:disabled {
    color: var(--text-ghost);
    cursor: default;
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

  .named {
    flex: none;
    color: var(--accent);
  }

  .count {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  /* The denominator recedes: the reach is the number being read, the true size
     is the context for it. */
  .count .of {
    opacity: 0.55;
  }

  .only {
    flex: none;
    padding: 0 7px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: none;
    border: 1px solid var(--line-strong);
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

  .hint,
  .tail {
    margin: 0;
    font-size: var(--fs-label-xs);
    line-height: 1.45;
    color: var(--text-ghost);
  }
  .tail a {
    color: var(--text-secondary);
    text-decoration: none;
    border-bottom: 1px solid var(--accent-tint-35);
  }
  .tail a:hover {
    color: var(--accent);
  }
</style>
