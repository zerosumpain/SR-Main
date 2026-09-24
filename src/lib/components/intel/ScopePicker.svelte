<script lang="ts">
  // Whose intel, and where it came from.
  //
  // Two questions the Sources section cannot answer. SPACE is whose graph it
  // is — yours, or the household's — and DOMAIN is the grain a person asks at:
  // "show me what email told me", not "show me the rows whose pipeline source
  // is 'email'". Sources stays below as the finer control; this is the coarse
  // one, so it sits first.
  //
  // Selecting NOTHING means no filter, exactly as in SourcePicker: an empty
  // selection that blanked the graph would be a trap, and a full one would
  // silently drop any space or domain added later.
  //
  // Counts come from the whole scoped graph, never the filtered view, so a chip
  // you have switched off still says what it would bring back.

  import { INTEL_DOMAINS } from '$lib/jkai/intel/domains';

  let {
    spaces = [],
    domains = [],
    activeSpaces = [],
    activeDomains = [],
    onToggleSpace,
    onToggleDomain,
    onClear,
  }: {
    /** Every space this reader may see, with its entity count. */
    spaces: Array<{ id: string; count: number }>;
    /** Every domain, in INTEL_DOMAINS order, with its count. */
    domains: Array<{ id: string; count: number }>;
    activeSpaces: string[];
    activeDomains: string[];
    onToggleSpace: (id: string) => void;
    onToggleDomain: (id: string) => void;
    onClear: () => void;
  } = $props();

  /** Plain names for the stored ids. An unknown id falls through to itself, so a
   *  space added later still appears rather than vanishing from the control. */
  const SPACE_LABELS: Record<string, string> = { owner: 'Mine', household: 'Household' };
  const spaceLabel = (id: string) => SPACE_LABELS[id] ?? id;

  const filtering = $derived(activeSpaces.length > 0 || activeDomains.length > 0);

  /**
   * The domain chips, in table order, each with its count.
   *
   * `other` is the bucket for sources nothing has classified yet. Shown empty it
   * is noise, so it only appears once something lands in it — or while it is
   * switched on, so a filter can never be hidden. Home stays visible at zero,
   * disabled, because it is a domain that is coming rather than one that is not.
   */
  const domainChips = $derived(
    INTEL_DOMAINS.map((d) => ({
      ...d,
      count: domains.find((x) => x.id === d.id)?.count ?? 0,
      on: activeDomains.includes(d.id),
    })).filter((d) => d.id !== 'other' || d.count > 0 || d.on),
  );
</script>

<div class="ctl">
  <!-- No heading of its own: the rail section already says "Scope". -->
  {#if filtering}
    <div class="ctl-actions">
      <button type="button" class="clear" onclick={onClear}>Clear</button>
    </div>
  {/if}

  <div class="group">
    <span class="group-title">Space</span>
    {#if !spaces.length}
      <p class="hint">No spaces yet.</p>
    {:else}
      <div class="chips">
        {#each spaces as s (s.id)}
          {@const on = activeSpaces.includes(s.id)}
          <button
            type="button"
            class="chip"
            class:on
            aria-pressed={on}
            onclick={() => onToggleSpace(s.id)}
          >
            {spaceLabel(s.id)}<span class="count">{s.count}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="group">
    <span class="group-title">Domain</span>
    <div class="chips">
      {#each domainChips as d (d.id)}
        {@const off = d.count === 0 && !d.on}
        <button
          type="button"
          class="chip"
          class:on={d.on}
          aria-pressed={d.on}
          disabled={off}
          aria-disabled={off ? 'true' : undefined}
          title={d.hint}
          onclick={() => onToggleDomain(d.id)}
        >
          {d.label}<span class="count">{d.count}</span>
        </button>
      {/each}
    </div>
  </div>

  <p class="hint">
    {#if !filtering}
      Everything you can see. Pick a space or a domain to narrow it.
    {:else}
      Pick more to widen within a group; the two groups narrow each other.
    {/if}
  </p>
</div>

<style>
  /* Chip, action and hint styles are SourcePicker's, copied rather than
     reinvented, so the two sections read as one rail. */
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
    border: none;
    background: none;
    padding: 0;
    font: inherit;
    text-transform: none;
    letter-spacing: 0;
    color: var(--accent);
    cursor: pointer;
  }
  .clear:hover {
    text-decoration: underline;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .group-title {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .chip {
    padding: 3px 9px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-pill);
    background: transparent;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .chip:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .chip.on {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .chip:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .count {
    margin-left: 6px;
    color: var(--text-ghost);
  }
  .chip.on .count {
    color: inherit;
  }

  .hint {
    margin: 0;
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    color: var(--text-ghost);
  }
</style>
