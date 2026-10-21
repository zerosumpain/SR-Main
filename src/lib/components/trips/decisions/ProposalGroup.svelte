<script lang="ts">
  // A group of alternatives (two or three proposals for one slot, or the
  // trip's shapes): a heading saying what they are for, the cards, and a
  // side-by-side comparison when two are marked "Compare". Taking one closes
  // the others (the server supersedes them; the desk hides them meanwhile).
  import { tick } from 'svelte';
  import type { Proposal } from '$lib/trips/decisions';
  import type { DecisionDesk } from '$lib/trips/decisions-desk.svelte';
  import ProposalCard from './ProposalCard.svelte';
  import CompareView from './CompareView.svelte';

  let {
    heading,
    groupId,
    proposals,
    desk,
    previewId = null,
    onPreview,
    grid = false,
    headingLevel = 3,
  }: {
    heading: string;
    groupId: string;
    proposals: Proposal[];
    desk: DecisionDesk;
    previewId?: string | null;
    onPreview?: (p: Proposal | null) => void;
    /** Cards side by side (the shapes, on a wide sheet) rather than stacked (the rail). */
    grid?: boolean;
    headingLevel?: 2 | 3;
  } = $props();

  // Two marked for comparing, by id (never by object).
  let marked = $state<string[]>([]);
  const pair = $derived.by(() => {
    const live = marked.map((id) => proposals.find((p) => p.id === id)).filter((p): p is Proposal => !!p);
    return live.length === 2 ? live : null;
  });
  function toggle(p: Proposal) {
    marked = marked.includes(p.id) ? marked.filter((id) => id !== p.id) : [...marked, p.id].slice(-2);
  }

  let headEl = $state<HTMLElement | null>(null);
  /** After a card leaves (turned down), keep focus in the group. */
  function settled() {
    void tick().then(() => headEl?.focus());
  }
  /** Bring a group that just arrived into view (a swap, a fill, a nudge). */
  let seen = 0;
  $effect(() => {
    const f = desk.fresh;
    if (!f || f.groupId !== groupId || f.n === seen) return;
    seen = f.n;
    void tick().then(() => headEl?.focus());
  });
  const tag = $derived(`h${headingLevel}`);
</script>

<section class="pg" aria-labelledby="pg-{groupId}">
  <svelte:element this={tag} id="pg-{groupId}" class="pg-h" tabindex="-1" bind:this={headEl}>{heading}</svelte:element>
  {#if proposals.length > 1}<p class="dx-aside pg-sub">{proposals.length} to choose from — taking one closes the others.</p>{/if}
  {#if pair}
    <CompareView a={pair[0]} b={pair[1]} {desk} onClose={() => (marked = [])} />
  {:else if marked.length === 1 && proposals.length > 1}
    <p class="dx-note" role="status">Mark one more to compare them side by side.</p>
  {/if}
  <ul class="pg-cards" class:grid role="list">
    {#each proposals as p (p.id)}
      <li>
        <ProposalCard
          {p}
          {desk}
          previewing={previewId === p.id}
          {onPreview}
          comparing={marked.includes(p.id)}
          onCompare={proposals.length > 1 ? toggle : undefined}
          onSettled={settled}
          headingLevel={headingLevel === 2 ? 3 : 4}
        />
      </li>
    {/each}
  </ul>
</section>

<style>
  .pg {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .pg-h {
    margin: 0;
    font-family: var(--fs-serif);
    font-style: italic;
    font-weight: 400;
    font-size: 20px;
    line-height: 28px;
    color: var(--np-ink);
  }
  .pg-h:focus-visible {
    outline: 2px solid var(--accent-ink);
    outline-offset: 2px;
  }
  .pg-h:focus:not(:focus-visible) {
    outline: none;
  }
  .pg-sub {
    font-size: 15px;
    margin-top: -6px;
  }
  .pg-cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 12px;
  }
  .pg-cards.grid {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
    gap: 18px;
    align-items: start;
  }
</style>
