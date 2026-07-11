<script lang="ts">
  // Site-page embed — the cheap route to "dynamic content that already exists
  // on the site". src is validated site-relative at the registry layer.
  import type { IframeBlock } from '$lib/presentation/types';

  let { block }: { block: IframeBlock } = $props();
</script>

<div class="frame" style:height="{block.height ?? 520}px">
  <iframe src={block.src} title={block.title} loading="lazy"></iframe>
</div>

<style>
  .frame {
    width: 100%;
    max-width: 1100px;
    border: 1px solid rgba(28, 22, 17, 0.2);
    border-radius: var(--radius-round);
    overflow: hidden;
    background: rgba(255, 255, 255, 0.45);
  }
  iframe { width: 100%; height: 100%; border: 0; display: block; }
</style>
