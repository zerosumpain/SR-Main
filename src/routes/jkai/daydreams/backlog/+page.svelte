<script lang="ts">
  import type { PageData } from './$types';
  import { invalidateAll } from '$app/navigation';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import BurndownChart from '$lib/components/jkai/daydream/rooms/BurndownChart.svelte';
  import QueueBoard from '$lib/components/jkai/daydream/rooms/QueueBoard.svelte';
  import ThemeProposals from '$lib/components/jkai/daydream/rooms/ThemeProposals.svelte';
  import { postThought } from '$lib/daydream/feed-client';

  let { data }: { data: PageData } = $props();

  let busy = $state<string | null>(null);
  let actionError = $state<string | null>(null);

  async function act(body: Record<string, unknown>, key: string) {
    busy = key;
    actionError = null;
    const result = await postThought(body);
    if (!result.ok) actionError = result.error ?? 'that did not work';
    // A bulk action can partially succeed. Reload on both paths so cards never
    // claim the pre-action state after nineteen of twenty writes completed.
    await invalidateAll();
    busy = null;
    return result.ok;
  }
</script>

<svelte:head><title>Daydream backlog — JKAI</title></svelte:head>

<section class="band">
  <div class="inner">
    <SectionHead
      kicker="A / The backlog"
      title={['Everything it wants', 'to do next']}
      strap="Every feature the engine is holding, in the order it will reach for it. Add work directly, open any card to revise the brief, kind, priority or state, or remove it from the queue. Build history stays read-only: a form cannot pretend a failed attempt never happened or mark untested work live."
    />
    {#if actionError}<p class="err" role="alert">{actionError}</p>{/if}
    <QueueBoard view={data.board} caps={data.caps} {busy} {act} />
  </div>
</section>

<section class="band sunken" id="burndown">
  <div class="inner">
    <SectionHead
      kicker="B / Burndown"
      title={['Is the pile', 'actually shrinking?']}
      strap="A queue of four hundred reads the same whether it has been flat all year or doubled this fortnight, and those are different problems. Two exhibits: how many were open at the end of each day, and what went in against what came out. Reconstructed from the records rather than snapshotted, so it says which half of the curve it can prove."
    />
    {#if data.board.error}
      <div class="card t-urgent">
        <p class="card-body">
          The queue could not be read, so there is no curve to draw: {data.board.error}
        </p>
      </div>
    {:else}
      <BurndownChart view={data.board.burndown} />
    {/if}
  </div>
</section>

<section class="band" id="themes">
  <div class="inner">
    <SectionHead
      kicker="C / Themes"
      title={['The same idea,', 'asked ten ways']}
      strap="The queue restates itself. Ideas arrive from different questions, and the same want turns up under several phrasings. Grouping a theme puts its members in one swimlane; it never abandons them, because “about the same subject” and “says the same thing” are different judgements."
    />
    {#if actionError}<p class="err" role="alert">{actionError}</p>{/if}
    <ThemeProposals epics={data.epics.epics} error={data.epics.error} items={data.board.items} {busy} {act} />
  </div>
</section>
