<script lang="ts">
  // One slide: its blocks arranged by the slide's layout archetype (see
  // $lib/presentation/layouts.ts), with a staggered rise-and-settle entrance.
  // Layout zones are deterministic: split layouts send VISUAL_BLOCK_TYPES to
  // the visual column; poster uses the first image as its backdrop.
  import { blockIn } from '$lib/presentation/transitions';
  import { VISUAL_BLOCK_TYPES } from '$lib/presentation/layouts';
  import { BLOCK_COMPONENTS } from './block-components';
  import type { Block, ImageBlock, SlideNode } from '$lib/presentation/types';

  let { slide }: { slide: SlideNode } = $props();

  const STAGGER = 120;

  const isSplit = $derived(slide.layout === 'split' || slide.layout === 'split-flip');
  const textBlocks = $derived(slide.blocks.filter((b) => !VISUAL_BLOCK_TYPES.has(b.type)));
  const visualBlocks = $derived(slide.blocks.filter((b) => VISUAL_BLOCK_TYPES.has(b.type)));

  const posterImage = $derived(
    slide.layout === 'poster' ? ((slide.blocks.find((b) => b.type === 'image') as ImageBlock | undefined) ?? null) : null,
  );
  const posterRest = $derived(slide.blocks.filter((b) => b !== (posterImage as Block | null)));

  const gridLead = $derived(
    slide.layout === 'grid' && slide.blocks.length > 2 ? slide.blocks[0] : null,
  );
  const gridRest = $derived(gridLead ? slide.blocks.slice(1) : slide.blocks);
</script>

{#snippet renderBlock(block: Block, i: number)}
  {@const Comp = BLOCK_COMPONENTS[block.type]}
  {#if Comp}
    <div class="block" in:blockIn={{ delay: STAGGER * i }}>
      <Comp {block} />
    </div>
  {/if}
{/snippet}

{#if slide.layout === 'poster' && posterImage}
  <section class="slide poster">
    <img
      class="poster-bg"
      src={posterImage.src}
      alt={posterImage.alt}
      onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
    />
    <div class="poster-scrim" aria-hidden="true"></div>
    <div class="poster-overlay">
      {#each posterRest as block, i (i)}
        {@render renderBlock(block, i)}
      {/each}
    </div>
  </section>
{:else if isSplit}
  <section class="slide split" class:flip={slide.layout === 'split-flip'}>
    <div class="split-text">
      {#each textBlocks as block, i (i)}
        {@render renderBlock(block, i)}
      {/each}
    </div>
    <div class="split-visual">
      {#each visualBlocks as block, i (i)}
        {@render renderBlock(block, textBlocks.length + i)}
      {/each}
    </div>
  </section>
{:else if slide.layout === 'grid'}
  <section class="slide gridlay">
    {#if gridLead}
      <div class="grid-lead">{@render renderBlock(gridLead, 0)}</div>
    {/if}
    <div class="grid-cells">
      {#each gridRest as block, i (i)}
        {@render renderBlock(block, (gridLead ? 1 : 0) + i)}
      {/each}
    </div>
  </section>
{:else}
  <section class="slide" data-layout={slide.layout}>
    {#each slide.blocks as block, i (i)}
      {@render renderBlock(block, i)}
    {/each}
  </section>
{/if}

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
    position: relative;
  }
  .block { width: 100%; display: flex; flex-direction: column; align-items: inherit; }

  /* centered + statement */
  .slide[data-layout='center'],
  .slide[data-layout='statement'] {
    align-items: center;
    text-align: center;
  }
  .slide[data-layout='center'] .block,
  .slide[data-layout='statement'] .block { display: flex; flex-direction: column; align-items: center; }

  /* statement: poster-scale type for the dominant elements */
  .slide[data-layout='statement'] { gap: clamp(22px, 4vh, 44px); }
  .slide[data-layout='statement'] :global(.q) { max-width: 26ch; }
  .slide[data-layout='statement'] :global(.q-rail) { width: 5px; }
  .slide[data-layout='statement'] :global(.q-text) { font-size: clamp(34px, 5.6vw, 68px); line-height: 1.18; }
  .slide[data-layout='statement'] :global(.bn-num) { font-size: clamp(96px, 19vw, 240px); }
  .slide[data-layout='statement'] :global(.mh-title) { font-size: clamp(48px, 9vw, 120px); }
  .slide[data-layout='statement'] :global(.prose p) { font-size: clamp(20px, 2.8vw, 30px); line-height: 1.45; color: var(--ink); }

  .slide[data-layout='full-bleed'] {
    padding: clamp(10px, 2vw, 24px);
    gap: 12px;
  }
  .slide[data-layout='default'] .block { align-items: flex-start; }

  /* split — argument beside evidence */
  .split {
    display: grid;
    grid-template-columns: 38fr 62fr;
    gap: clamp(20px, 3.5vw, 56px);
    align-items: center;
  }
  .split.flip { grid-template-columns: 62fr 38fr; }
  .split-text {
    display: flex;
    flex-direction: column;
    gap: clamp(16px, 2.6vh, 28px);
    min-width: 0;
  }
  .split.flip .split-text { order: 2; }
  .split-visual {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
    align-self: center;
  }
  .split.flip .split-visual { order: 1; }
  .split-visual :global(.fig img) { max-height: 74vh; width: 100%; object-fit: cover; }

  /* grid — evidence-dense */
  .gridlay {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: clamp(16px, 2.6vh, 30px);
  }
  .grid-lead { width: 100%; }
  .grid-cells {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: clamp(14px, 2vw, 26px);
    align-items: start;
  }
  .grid-cells .block { min-width: 0; }

  /* poster — image backdrop, scrim, overlay */
  .poster { padding: 0; overflow: hidden; }
  .poster-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    filter: saturate(0.72) contrast(1.04);
  }
  .poster-scrim {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(200deg, rgba(28, 22, 17, 0) 30%, rgba(28, 22, 17, 0.72) 82%),
      radial-gradient(ellipse 120% 90% at 15% 95%, rgba(28, 22, 17, 0.65), transparent 55%);
  }
  .poster-overlay {
    position: absolute;
    left: clamp(24px, 5vw, 72px);
    right: clamp(24px, 18vw, 30vw);
    bottom: clamp(28px, 7vh, 76px);
    display: flex;
    flex-direction: column;
    gap: clamp(12px, 2vh, 22px);
    /* invert the ink onto the darkened photograph */
    --ink: #f4ecdc;
    --ink-soft: rgba(244, 236, 220, 0.78);
  }
  .poster-overlay :global(.prose p) { color: var(--ink-soft); }
  .poster-overlay :global(.prose b) { color: var(--ink); }
  .poster-overlay :global(.q) { border-left-color: var(--accent); }

  @media (max-width: 860px) {
    .split, .split.flip { display: flex; flex-direction: column; justify-content: center; }
    .split.flip .split-text { order: 0; }
    .split.flip .split-visual { order: 1; }
    .grid-cells { grid-template-columns: 1fr; }
    .poster-overlay { right: clamp(24px, 5vw, 72px); }
  }
</style>
