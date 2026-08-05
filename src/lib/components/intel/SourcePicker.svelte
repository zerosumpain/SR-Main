<script lang="ts">
  // Which sources are allowed to contribute to the graph.
  //
  // The graph mixes Drive files, email, deep-dive research, chat and workflow
  // output, and until now there was no way to ask what any ONE of them was
  // telling you. That matters most since the mailbox arrived: twelve weeks of
  // correspondence adds a great many people, and "show me only what the
  // documents say" is a different and often better question than "show me
  // everything".
  //
  // Selecting NOTHING means no filter, not an empty graph. A picker whose
  // natural empty state blanks the page is a trap, and the alternative —
  // starting with every source ticked — silently breaks whenever a new source
  // kind appears, because it would not be in the saved selection.
  //
  // Categories are nested under Files because that is what they describe: they
  // are set on Drive folders and mean nothing for an email or a deep dive.

  import type { NetCategory } from './types';

  let {
    sources = [],
    categories = [],
    activeSources = [],
    activeCategories = [],
    onToggleSource,
    onToggleCategory,
    onClear,
  }: {
    /** Every source present in the graph, with its entity count. */
    sources: Array<{ id: string; count: number }>;
    categories: NetCategory[];
    activeSources: string[];
    activeCategories: string[];
    onToggleSource: (id: string) => void;
    onToggleCategory: (slug: string) => void;
    onClear: () => void;
  } = $props();

  /** Readable names and marks. Unknown kinds fall through to their raw id, so a
   *  source added later still appears rather than vanishing from the control. */
  const LABELS: Record<string, { name: string; hint: string }> = {
    email: { name: 'Email', hint: 'Gmail, rolling 12 weeks' },
    file: { name: 'Files', hint: 'Drive uploads' },
    research: { name: 'Research', hint: 'Deep dives' },
    chat: { name: 'Chat', hint: 'jkai conversations' },
    web: { name: 'Web', hint: 'Captured pages and notes' },
    whatsapp: { name: 'WhatsApp', hint: 'Bridged messages' },
    workflow: { name: 'Workflows', hint: 'Canvas output' },
    pwa: { name: 'Mobile', hint: 'Captured on the phone' },
  };

  const labelFor = (id: string) => LABELS[id]?.name ?? id;
  const hintFor = (id: string) => LABELS[id]?.hint ?? '';

  const filtering = $derived(activeSources.length > 0 || activeCategories.length > 0);
  /** Files are selected, or nothing is — either way categories are meaningful. */
  const filesInPlay = $derived(!activeSources.length || activeSources.includes('file'));
  const total = $derived(sources.reduce((sum, s) => sum + s.count, 0));
</script>

<div class="ctl">
  <!-- No heading of its own: the rail section it sits in already says
       "Sources", and two identical labels one above the other is exactly the
       kind of doubling that made the rail read as noise. Only `reset` survives,
       because it has nowhere else to live. -->
  {#if filtering}
    <div class="ctl-actions">
      <button type="button" class="clear" onclick={onClear}>reset</button>
    </div>
  {/if}

  {#if !sources.length}
    <p class="hint">No sources recorded yet.</p>
  {:else}
    <div class="rows">
      {#each sources as s (s.id)}
        {@const on = activeSources.includes(s.id)}
        <button
          type="button"
          class="row"
          class:on
          aria-pressed={on}
          onclick={() => onToggleSource(s.id)}
        >
          <span class="mark" aria-hidden="true"></span>
          <span class="name">
            {labelFor(s.id)}
            {#if hintFor(s.id)}<em>{hintFor(s.id)}</em>{/if}
          </span>
          <span class="count">{s.count}</span>
        </button>
      {/each}
    </div>

    <p class="hint">
      {#if !activeSources.length}
        Everything is contributing — {total} entity mention{total === 1 ? '' : 's'} across
        {sources.length} source{sources.length === 1 ? '' : 's'}. Pick one or more to narrow it.
      {:else}
        Showing what {activeSources.map(labelFor).join(' and ')} contributed.
      {/if}
    </p>
  {/if}

  {#if categories.length && filesInPlay}
    <div class="sub">
      <span class="sub-title">Files by category</span>
      <div class="chips">
        {#each categories as c (c.id)}
          <button
            type="button"
            class="chip"
            class:on={activeCategories.includes(c.slug)}
            style="--chip: {c.color}"
            onclick={() => onToggleCategory(c.slug)}
          >{c.name}</button>
        {/each}
      </div>
      <p class="hint">Set on Drive folders — see /drive.</p>
    </div>
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

  .rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 5px 7px;
    border: 1px solid transparent;
    border-radius: var(--radius-sharp);
    background: none;
    font: inherit;
    text-align: left;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background var(--t-fast) var(--ease-out);
  }
  .row:hover {
    background: var(--bg-section);
  }
  .row.on {
    color: var(--text-primary);
  }

  .mark {
    flex-shrink: 0;
    width: 12px;
    height: 12px;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    background: var(--bg);
  }
  .row.on .mark {
    background: var(--accent);
    border-color: var(--accent);
  }

  .name {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    font-size: var(--fs-label);
    line-height: 1.25;
  }
  .name em {
    font-style: normal;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }

  .count {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }

  .sub {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 4px;
    padding-top: 8px;
    padding-left: 10px;
    border-top: 1px solid var(--divider);
    border-left: 2px solid var(--divider);
  }
  .sub-title {
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
    border: 1px solid var(--card-border);
    border-radius: var(--radius-pill);
    background: transparent;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .chip:hover {
    border-color: var(--chip, var(--accent));
  }
  .chip.on {
    background: var(--chip, var(--accent));
    border-color: var(--chip, var(--accent));
    color: #fff;
  }

  .hint {
    margin: 0;
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    color: var(--text-ghost);
  }
</style>
