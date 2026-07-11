<script lang="ts">
  // A miniature live render of a slide — the "door" into a sub-deck on its
  // parent slide. Real blocks at a fixed virtual size scaled down; embeds and
  // iframes become a lightweight placeholder (no Three.js in a thumbnail).
  import { BLOCK_COMPONENTS } from './block-components';
  import type { SlideNode } from '$lib/presentation/types';

  let { slide }: { slide: SlideNode } = $props();

  // Virtual canvas the mini renders at before scaling (matches a laptop stage).
  const VW = 1280;
  const VH = 800;
  let boxW = $state(0);
</script>

<div class="mini" aria-hidden="true" bind:clientWidth={boxW}>
  <div class="mini-stage" style:width="{VW}px" style:height="{VH}px" style:transform="scale({boxW / VW})">
    <section class="mini-slide" data-layout={slide.layout}>
      {#each slide.blocks as block, i (i)}
        {#if block.type === 'embed' || block.type === 'iframe'}
          <div class="mini-embed">
            <span>◈ INTERACTIVE</span>
          </div>
        {:else}
          {@const Comp = BLOCK_COMPONENTS[block.type]}
          {#if Comp}<div class="mini-block"><Comp {block} /></div>{/if}
        {/if}
      {/each}
    </section>
  </div>
</div>

<style>
  .mini {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 10;
    overflow: hidden;
    pointer-events: none;
    background: radial-gradient(ellipse 90% 50% at 50% 0%, rgba(255, 255, 255, 0.4), transparent 60%), var(--paper);
  }
  .mini-stage {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: top left;
  }
  .mini-slide {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    gap: 26px;
    padding: 56px;
    box-sizing: border-box;
    overflow: hidden;
  }
  .mini-slide[data-layout='center'] {
    align-items: center;
    text-align: center;
  }
  .mini-slide[data-layout='center'] .mini-block { display: flex; flex-direction: column; align-items: center; }
  .mini-block { width: 100%; }
  .mini-embed {
    width: 100%;
    height: 420px;
    display: grid;
    place-content: center;
    border: 2px dashed rgba(28, 22, 17, 0.3);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.35);
  }
  .mini-embed span {
    font-family: 'JetBrains Mono', monospace;
    font-size: 22px;
    letter-spacing: 0.2em;
    color: var(--accent-ink);
  }
</style>
