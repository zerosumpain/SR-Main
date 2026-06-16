<script lang="ts">
  // StorySection — the co-visible storytelling unit: prose pinned in a narrow left column
  // while the data column scrolls past it. Stacks on narrow screens. (From policy-engine.)
  import type { Snippet } from 'svelte';

  let { title, prose, data }: { title: string; prose: Snippet; data: Snippet } = $props();
</script>

<section class="ss">
  <div class="ss-prose">
    <h2 class="pe-h2 ss-h">{title}</h2>
    {@render prose()}
  </div>
  <div class="ss-data">{@render data()}</div>
</section>

<style>
  .ss { display: grid; grid-template-columns: minmax(260px, 36ch) minmax(0, 1fr); gap: 18px 36px; margin: 30px 0; align-items: start; }
  .ss-prose { position: sticky; top: calc(var(--topH, 0px) + 62px); }
  .ss-h { margin-top: 0; }
  .ss-data { min-width: 0; }
  @media (max-width: 1099px) {
    .ss { grid-template-columns: 1fr; gap: 10px; }
    .ss-prose { position: static; }
  }
</style>
