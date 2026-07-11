<script lang="ts">
  // One slide: its blocks in order, staggered entrance. Layouts:
  // default (left column), center (centered column), full-bleed (media edge
  // to edge — embeds/iframes/images stretch).
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { dur } from '$lib/motion';
  import { BLOCK_COMPONENTS } from './block-components';
  import type { SlideNode } from '$lib/presentation/types';

  let { slide }: { slide: SlideNode } = $props();
</script>

<section class="slide" data-layout={slide.layout}>
  {#each slide.blocks as block, i (i)}
    {@const Comp = BLOCK_COMPONENTS[block.type]}
    {#if Comp}
      <div class="block" in:fly={{ y: 16, duration: dur(380), delay: dur(90 * i), easing: cubicOut }}>
        <Comp {block} />
      </div>
    {/if}
  {/each}
</section>

<style>
  .slide {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    gap: clamp(18px, 3vh, 34px);
    padding: clamp(24px, 5vw, 72px);
    overflow-y: auto;
    box-sizing: border-box;
  }
  .slide[data-layout='center'] {
    align-items: center;
    text-align: center;
  }
  .slide[data-layout='center'] .block { display: flex; flex-direction: column; align-items: center; }
  .slide[data-layout='full-bleed'] {
    padding: clamp(10px, 2vw, 24px);
    gap: 12px;
  }
  .block { width: 100%; display: flex; flex-direction: column; align-items: inherit; }
  .slide[data-layout='default'] .block { align-items: flex-start; }
</style>
