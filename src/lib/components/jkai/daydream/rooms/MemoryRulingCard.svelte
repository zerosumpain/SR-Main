<script lang="ts">
  // One verdict the reviewer reached, and whether it stuck.
  //
  // `remembered` / `not remembered yet` is the whole point of the row. Only a
  // ruling with a memory behind it reaches the nightly consolidation, and only
  // a remembered refutation becomes binding — production once ran to 66
  // rulings with one memory behind them while the same misreading came round
  // eight times under eight names. A ruling that changed nothing must not look
  // like one that did.
  import { familyMark, kindLabel } from '$lib/daydream/thought-groups';
  import { rulingTone, rulingWord, type RulingListRow } from '$lib/daydream/rooms/memory';
  import { ago } from '$lib/daydream/feed-client';

  interface Props {
    ruling: RulingListRow;
  }

  let { ruling }: Props = $props();

  const tone = $derived(rulingTone(ruling.verdict));
</script>

<article class="card t-{tone}">
  <div class="card-hd">
    <div class="hd-text">
      <span class="mark">{familyMark(ruling.kind)}</span>
      <p class="card-title as-text">
        <a class="link" href="/jkai/daydreams/feed?open={ruling.id}">{ruling.title}</a>
      </p>
    </div>
    <span class="pill t-{tone}">{rulingWord(ruling.verdict)}</span>
  </div>

  {#if ruling.reasoning}<p class="card-body">{ruling.reasoning}</p>{/if}

  <div class="card-meta">
    <span class="tag">{kindLabel(ruling.kind)}</span>
    {#if typeof ruling.likelihood === 'number'}
      <span class="meta-item">{Math.round(ruling.likelihood * 100)}% likely true</span>
    {/if}
    {#if ruling.ruledAt}<span class="meta-item stamp">{ago(ruling.ruledAt)}</span>{/if}
    {#if ruling.model}<span class="meta-item">{ruling.model}</span>{/if}
    {#if ruling.memoryId}
      <span class="meta-item good">remembered</span>
    {:else}
      <span class="meta-item warn">not remembered yet</span>
    {/if}
  </div>

  {#if ruling.sources.length}
    <p class="note">Checked: {ruling.sources.slice(0, 4).join(' · ')}</p>
  {/if}
</article>

<style>
  .card-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 14px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .hd-text {
    min-width: 0;
  }
  .hd-text .card-title {
    margin-top: 4px;
  }
</style>
