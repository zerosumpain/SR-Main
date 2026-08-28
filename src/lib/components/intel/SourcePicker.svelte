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

  import type { NetCategory } from '$lib/codegraph/types';

  let {
    sources = [],
    sourceKinds = [],
    sourceDomains = [],
    categories = [],
    activeSources = [],
    activeCategories = [],
    onToggleSource,
    onToggleCategory,
    onClear,
  }: {
    /** Every source present in the graph, with its entity count. */
    sources: Array<{ id: string; count: number }>;
    /**
     * Finer facets under a source — email split into correspondence,
     * notification and bulk. `source` says which source they sit under.
     */
    sourceKinds?: Array<{ id: string; source: string; kind: string; count: number }>;
    /** Finer still: the individual sender domains under a source. */
    sourceDomains?: Array<{ id: string; source: string; domain: string; count: number }>;
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

  /**
   * A selected value in plain words, whichever of the three levels it is.
   *
   * The summary line ran every selection through `labelFor`, which only knows
   * plain sources — so picking a facet said "Showing what email:bulk
   * contributed", printing the storage key at the user. */
  const selectionLabel = (id: string) => {
    const at = id.indexOf('@');
    if (at > 0) return id.slice(at + 1);
    const colon = id.indexOf(':');
    if (colon > 0) {
      const kind = id.slice(colon + 1);
      return `${labelFor(id.slice(0, colon))} (${KIND_LABELS[kind] ?? kind})`;
    }
    return labelFor(id);
  };

  const filtering = $derived(activeSources.length > 0 || activeCategories.length > 0);
  /** Files are selected, or nothing is — either way categories are meaningful. */
  const filesInPlay = $derived(!activeSources.length || activeSources.includes('file'));
  const total = $derived(sources.reduce((sum, s) => sum + s.count, 0));

  /**
   * Plain words for the three kinds — the stored values are slugs.
   *
   * `correspondence` is deliberately NOT called "from a person". Two of the
   * three kinds are positively identified; the third is what is left over once
   * they have been taken out, and on the live mailbox it is still 39% of the
   * post with a long tail of unrecognised senders in it. Calling that "people"
   * would be the filter asserting something it has not established — and a
   * filter that overclaims is worse than one that admits its edge, because you
   * stop checking it.
   */
  const KIND_LABELS: Record<string, string> = {
    correspondence: 'everything else',
    notification: 'service notices',
    bulk: 'marketing and newsletters',
    // Not one of the three — see the ordering note below.
    important: 'marked important',
  };

  /**
   * The kinds are mutually exclusive; `important` is not.
   *
   * Gmail's IMPORTANT label is its own judgement about what matters in this
   * mailbox, and it cuts across all three — an important newsletter and a
   * routine note from a colleague are both ordinary things. It is pinned to the
   * top of the list rather than sorted in by count, because it is the one facet
   * here that nothing in this codebase decided.
   */
  const orderedKinds = (all: typeof sourceKinds, source: string) => {
    const mine = all.filter((k) => k.source === source);
    return [
      ...mine.filter((k) => k.kind === 'important'),
      ...mine.filter((k) => k.kind !== 'important'),
    ];
  };

  /**
   * Senders are collapsed, not previewed.
   *
   * This used to show five domains plus an "all N senders" button under every
   * source that had them, which on the live mailbox made Email alone ten rows
   * of a rail that has to hold search, clusters, types and categories too. Five
   * arbitrary senders is not a summary of four hundred — it is the top of a
   * list nobody asked to see — so the list now costs one row until it is
   * wanted, and the row says how many are behind it.
   */
  let openSenders = $state(new Set<string>());
  const toggleSenders = (id: string) => {
    const next = new Set(openSenders);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    openSenders = next;
  };

  /**
   * Senders listed at a time once the list is open.
   *
   * The live mailbox has 412 of them. Rendering the lot made the rail 34,000px
   * tall — a list that long is not a control, it is a document — so the open
   * state shows the busiest few and a box to find the rest by name. Typing is
   * the only way to reach the tail of a list this size; scrolling past four
   * hundred rows is not.
   */
  const SENDER_LIMIT = 12;
  let senderQuery = $state('');

  const matchingDomains = (domains: typeof sourceDomains) => {
    const needle = senderQuery.trim().toLowerCase();
    return needle ? domains.filter((d) => d.domain.toLowerCase().includes(needle)) : domains;
  };
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
        {@const kinds = orderedKinds(sourceKinds, s.id)}
        {@const domains = sourceDomains.filter((d) => d.source === s.id)}
        {@const sendersOpen = openSenders.has(s.id)}
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

        <!-- One word covers a colleague writing to you, a service reporting a
             build and a shop announcing a sale. These are how you tell them
             apart; the senders under them are how you get to one shop. -->
        {#each kinds as k (k.id)}
          {@const kindOn = activeSources.includes(k.id)}
          <button
            type="button"
            class="row sub"
            class:on={kindOn}
            aria-pressed={kindOn}
            title="Only {k.kind} {k.source}"
            onclick={() => onToggleSource(k.id)}
          >
            <span class="mark" aria-hidden="true"></span>
            <span class="name">{KIND_LABELS[k.kind] ?? k.kind}</span>
            <span class="count">{k.count}</span>
          </button>
        {/each}

        {#if domains.length}
          {@const picked = domains.filter((d) => activeSources.includes(d.id))}
          <!-- One row, whatever the mailbox is doing. Any sender you have
               actually selected stays visible while the list is shut, so
               collapsing it can never hide a filter that is switched on. -->
          <button
            type="button"
            class="row sub disclose"
            aria-expanded={sendersOpen}
            onclick={() => toggleSenders(s.id)}
          >
            <span class="caret" class:open={sendersOpen} aria-hidden="true"></span>
            <span class="name">
              {sendersOpen ? 'Hide senders' : 'By sender'}
              {#if !sendersOpen && picked.length}<em>{picked.length} on</em>{/if}
            </span>
            <span class="count">{domains.length}</span>
          </button>

          {#if sendersOpen && domains.length > SENDER_LIMIT}
            <input
              class="sender-find"
              type="search"
              placeholder="find a sender…"
              aria-label="Find a sender"
              bind:value={senderQuery}
            />
          {/if}

          {@const matched = sendersOpen ? matchingDomains(domains) : picked}
          {@const listed = sendersOpen ? matched.slice(0, SENDER_LIMIT) : matched}
          {#each listed as d (d.id)}
            {@const domOn = activeSources.includes(d.id)}
            <button
              type="button"
              class="row sub deep"
              class:on={domOn}
              aria-pressed={domOn}
              title="Only mail from {d.domain}"
              onclick={() => onToggleSource(d.id)}
            >
              <span class="mark" aria-hidden="true"></span>
              <span class="name">{d.domain}</span>
              <span class="count">{d.count}</span>
            </button>
          {/each}
          <!-- Says what is NOT shown rather than silently truncating: a list
               that stops at twelve without saying so reads as the whole list. -->
          {#if sendersOpen && matched.length > listed.length}
            <p class="sub-note">
              {matched.length - listed.length} more — narrow it by name.
            </p>
          {:else if sendersOpen && !matched.length}
            <p class="sub-note">No sender matches “{senderQuery}”.</p>
          {/if}
        {/if}
      {/each}
    </div>

    <p class="hint">
      {#if !activeSources.length}
        Everything is contributing — {total} entity mention{total === 1 ? '' : 's'} across
        {sources.length} source{sources.length === 1 ? '' : 's'}. Pick one or more to narrow it.
      {:else}
        Showing what {activeSources.map(selectionLabel).join(' and ')} contributed.
      {/if}
    </p>
  {/if}

  {#if categories.length && filesInPlay}
    <div class="cat-block">
      <span class="cat-title">Files by category</span>
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
    background: var(--surface-sunken);
  }
  .row.on {
    color: var(--text-primary);
  }

  .mark {
    flex-shrink: 0;
    width: 12px;
    height: 12px;
    border: 1px solid var(--line-strong);
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

  /* Indented, lighter, and smaller-capped: a facet is a narrowing OF the row
     above it, and reading as a sibling would make the list look like eleven
     sources rather than four with detail under them. */
  .row.sub {
    padding-left: 20px;
    color: var(--text-ghost);
  }
  .row.sub.deep {
    padding-left: 34px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }
  .row.sub.on {
    color: var(--text-primary);
  }

  /* The senders disclosure. A caret rather than a checkbox mark, because it
     opens a list — it does not select anything. */
  .row.sub.disclose .name {
    flex-direction: row;
    align-items: baseline;
    gap: 6px;
  }
  .row.sub.disclose .name em {
    font-style: normal;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent);
  }
  .caret {
    flex-shrink: 0;
    width: 12px;
    height: 12px;
    position: relative;
  }
  .caret::before {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 5px;
    height: 5px;
    border-right: 1px solid currentColor;
    border-bottom: 1px solid currentColor;
    transform: rotate(-45deg);
    transition: transform var(--t-fast) var(--ease-out);
  }
  .caret.open::before {
    transform: rotate(45deg);
  }

  .sender-find {
    margin: 2px 0 2px 34px;
    padding: 4px 7px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    background: var(--bg);
    font-family: var(--font-mono);
    /* 16px would be the rule for a form field, but this is a rail-width
       type-ahead beside 12px rows; the a11y floor is what governs here. */
    font-size: var(--fs-label-xs);
    color: var(--text-primary);
  }
  .sender-find:focus {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
  }
  .sub-note {
    margin: 1px 0 2px 34px;
    font-size: var(--fs-label-xs);
    line-height: 1.35;
    color: var(--text-ghost);
  }

  .count {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }

  /* The categories block. Named `.cat-block`, not `.sub`, because `.sub` also
     modifies a facet ROW (`.row.sub`) — and a bare `.sub` rule matched those
     too, stacking every kind and sender row into a bordered column three lines
     tall. Four kinds and five senders rendered as ~700px of rail that should
     have been ~230px, which is most of the reason the sources section was
     unusable. `.row.sub` only overrode padding and colour, so the layout
     properties leaked straight through. */
  .cat-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 4px;
    padding-top: 8px;
    padding-left: 10px;
    border-top: 1px solid var(--line-hair);
    border-left: 2px solid var(--line-hair);
  }
  .cat-title {
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
