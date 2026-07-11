<script lang="ts">
  // Editorial paragraph block — .pe-lede/.pe-prose typography at slide scale.
  // Body is markdown-lite rendered through the escape-then-allowlist helper.
  import { renderProse } from '$lib/presentation/prose';
  import type { ProseBlock } from '$lib/presentation/types';

  let { block }: { block: ProseBlock } = $props();
  const html = $derived(renderProse(block.body));
</script>

<div class="prose" class:lede={block.lede}>
  <!-- eslint-disable-next-line svelte/no-at-html-tags — renderProse escapes first -->
  {@html html}
</div>

<style>
  .prose { max-width: 58ch; }
  .prose :global(p) {
    font-size: clamp(15px, 1.8vw, 19px);
    line-height: 1.65;
    color: var(--ink-soft);
    margin: 0 0 14px;
  }
  .prose :global(p:last-child) { margin-bottom: 0; }
  .prose.lede :global(p) {
    font-size: clamp(18px, 2.4vw, 26px);
    line-height: 1.5;
    color: var(--ink);
  }
  .prose :global(b) { color: var(--ink); }
  .prose :global(a) { color: var(--accent-ink); }
</style>
