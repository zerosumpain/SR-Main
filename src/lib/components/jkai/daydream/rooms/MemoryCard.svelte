<script lang="ts">
  // One raw memory — the receipt underneath a theme.
  //
  // The card is coloured by what the nightly pass DID with the sentence, not
  // by its category, because the only question worth asking of a receipt is
  // whether it changed anything. `memoryUse` says so in words as well: a
  // consolidated memory leaves the reasoning pack, and only a refuted ruling
  // additionally BINDS.
  import { ORIGIN_LABEL, memoryUse, type DaydreamMemory } from '$lib/daydream/memories';
  import { memoryTone } from '$lib/daydream/rooms/memory';
  import { kindLabel } from '$lib/daydream/thought-groups';
  import { stamp } from '$lib/daydream/feed-client';

  interface Props {
    memory: DaydreamMemory;
  }

  let { memory }: Props = $props();

  const use = $derived(memoryUse(memory));
  const tone = $derived(memoryTone(memory));
</script>

<article class="card anchored t-{tone}" id="memory-{memory.id}">
  <div class="card-hd">
    <span class="card-kicker">{ORIGIN_LABEL[memory.origin]}</span>
    {#if use.binding}
      <span class="pill t-urgent">binding refutation</span>
    {:else if memory.consolidatedAt == null}
      <span class="pill t-watch">awaiting tonight · not in pack</span>
    {:else if memory.themeIds.length}
      <span class="pill t-steady">
        rolled into {memory.themeIds.length} theme{memory.themeIds.length === 1 ? '' : 's'}
      </span>
    {:else}
      <span class="pill t-quiet">reviewed · archive only</span>
    {/if}
  </div>

  <p class="mem-sentence">{memory.content}</p>

  <div class="card-meta">
    <span class="tag">{memory.category}</span>
    <span class="meta-item">{memory.confidence} confidence</span>
    <span class="meta-item stamp">{stamp(memory.createdAt)}</span>
    {#if memory.thoughtKind}<span class="meta-item">from a {kindLabel(memory.thoughtKind)}</span>{/if}
    {#if memory.verdict}<span class="meta-item">{memory.verdict}</span>{/if}
  </div>

  {#if memory.thoughtTitle}
    {#if memory.thoughtId}
      <p class="note">
        About: <a class="link" href="/jkai/daydreams/feed?open={memory.thoughtId}">“{memory.thoughtTitle}”</a>
      </p>
    {:else}
      <p class="note">About: “{memory.thoughtTitle}”</p>
    {/if}
  {/if}

  <div class="mem-use">
    <p class="field-label">What happens to this detail</p>
    {#each use.lines as line, li (li)}<p class="detail-line">{line}</p>{/each}
  </div>
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
  .mem-sentence {
    margin: 10px 0 0;
    padding: 10px 12px;
    border-left: 2px solid var(--line-strong);
    background: rgba(26, 16, 8, 0.04);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-primary);
    text-wrap: pretty;
  }
  .mem-use {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--line-hair);
  }
  .mem-use :global(.detail-line + .detail-line) {
    margin-top: 6px;
  }
</style>
