<script lang="ts">
  import type { PageData } from './$types';
  import { invalidateAll } from '$app/navigation';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import StatDeck from '$lib/components/jkai/daydream/hub/StatDeck.svelte';
  import type { DeckTile } from '$lib/components/jkai/daydream/hub/types';
  import QueueBoard from '$lib/components/jkai/daydream/rooms/QueueBoard.svelte';
  import ReviewLane from '$lib/components/jkai/daydream/rooms/ReviewLane.svelte';
  import BurndownChart from '$lib/components/jkai/daydream/rooms/BurndownChart.svelte';
  import { postThought } from '$lib/daydream/feed-client';

  let { data }: { data: PageData } = $props();

  let busy = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  /** Set by the review lane so a decision made there can open the epic it
   *  belongs to. The board owns the panel; this is the only cross-section
   *  handle, and it is a slug rather than an object for the same reason the
   *  board's own is — `invalidateAll()` replaces every epic. */
  let openFromReview = $state<string | null>(null);

  async function act(body: Record<string, unknown>, key: string) {
    busy = key;
    actionError = null;
    const result = await postThought(body);
    if (!result.ok) actionError = result.error ?? 'that did not work';
    // A bulk action can partially succeed. Reload on both paths, so no card can
    // claim the pre-action state after nineteen of twenty writes landed.
    await invalidateAll();
    busy = null;
    return result.ok;
  }

  const totals = $derived(data.board.totals);
  const pending = $derived(data.epics.reduce((n, e) => n + (e.suggestions?.length ?? 0), 0));
  const deliverables = $derived(data.epics.reduce((n, e) => n + e.deliverables.length, 0));

  const tiles = $derived<DeckTile[]>([
    {
      key: 'epics',
      label: 'Epics on the board',
      value: String(data.epics.length),
      tone: 'steady',
      sub: `${deliverables} deliverables grouped into them`,
    },
    {
      key: 'open',
      label: 'Open in the queue',
      value: String(totals.open),
      tone: totals.open ? 'action' : 'good',
      lit: totals.open > 0,
      sub: `${totals.untried} never once attempted`,
    },
    {
      key: 'tied',
      label: 'Tied on one priority',
      value: String(totals.tiedOnPriority),
      suffix: totals.open ? `/${totals.open}` : null,
      tone: totals.tiedOnPriority > totals.open / 2 ? 'watch' : 'steady',
      sub:
        totals.tiedPriority == null
          ? 'nothing open'
          : `all at P${totals.tiedPriority} — the field pickWork ranks on`,
    },
    {
      key: 'review',
      label: 'Waiting on a ruling',
      value: String(pending),
      tone: pending ? 'watch' : 'good',
      lit: pending > 0,
      sub: pending ? 'matches too weak to apply automatically' : 'nothing needs a second look',
    },
    {
      key: 'served',
      label: 'Already served',
      value: String(totals.alreadyServed),
      tone: totals.alreadyServed ? 'urgent' : 'good',
      sub: totals.alreadyServed ? 'a shipped sibling looks to cover these' : 'no duplicates found',
    },
  ]);
</script>

<svelte:head><title>Daydream backlog — JKAI</title></svelte:head>

<section class="band">
  <div class="inner">
    <SectionHead
      kicker="A / The backlog"
      title={['Everything it wants', 'to do next']}
      strap="Every feature the engine is holding, grouped into the areas they belong to and ordered the way it will reach for them. Switch the board between epics and the deliverables inside them, drag a card to accept or park it, and open any card to name it, rank it or take it out."
    />

    {#if data.error}
      <div class="card t-urgent">
        <p class="card-body">The backlog could not be read, so nothing below is drawn from it: {data.error}</p>
      </div>
    {:else}
      <StatDeck {tiles} min={210} />
      {#if actionError}<p class="err" role="alert">{actionError}</p>{/if}
      <QueueBoard epics={data.epics} {busy} {act} bind:openSlug={openFromReview} />
    {/if}
  </div>
</section>

{#if !data.error}
  <section class="band sunken" id="review">
    <div class="inner">
      <SectionHead
        kicker="B / Needs review"
        title={['The ones it', 'would not decide']}
        strap="Grouping runs on every arrival and applies what it can prove. These are the residue: close enough to something queued or already shipped to be worth raising, not close enough to act on. Rule on them in a batch — a hundred single decisions is a hundred rebuilds of this room."
      />
      {#if actionError}<p class="err" role="alert">{actionError}</p>{/if}
      <ReviewLane epics={data.epics} {busy} {act} onopen={(slug) => (openFromReview = slug)} />
    </div>
  </section>

  <section class="band" id="burndown">
    <div class="inner">
      <SectionHead
        kicker="C / Burndown"
        title={['Is the pile', 'actually shrinking?']}
        strap="A queue of four hundred reads the same whether it has been flat all year or doubled this fortnight, and those are different problems. Two exhibits: how many were open at the end of each day, and what went in against what came out. Reconstructed from the records rather than snapshotted, so it says which half of the curve it can prove."
      />
      <BurndownChart view={data.board.burndown} />
    </div>
  </section>
{/if}
