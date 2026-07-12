<script lang="ts">
  // Figure block — plain image with a mono caption kicker.
  import type { ImageBlock } from '$lib/presentation/types';

  let { block }: { block: ImageBlock } = $props();
</script>

<figure class="fig">
  <img src={block.src} alt={block.alt} loading="lazy" />
  {#if block.caption}<figcaption>{block.caption}</figcaption>{/if}
</figure>

<style>
  .fig { margin: 0; max-width: 100%; }
  .fig img {
    display: block;
    max-width: 100%;
    max-height: 446.5px;
    border: 1px solid rgba(28, 22, 17, 0.16);
    border-radius: var(--radius-round);
  }
  .fig figcaption {
    margin-top: 10px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
</style>
