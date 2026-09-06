<script lang="ts">
  import type { PageData } from './$types';
  import QueueBoard from '$lib/components/jkai/daydream/rooms/QueueBoard.svelte';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Daydream epic backlog — JKAI</title></svelte:head>
<section class="band"><div class="inner">
  <header class="backlog-heading"><p class="mark">Daydream / Backlog</p><h1>Epic backlog</h1>
    <p>Related work joins one epic automatically. Open an epic to define and manage its deliverables.</p>
  </header>
  <QueueBoard epics={data.epics} error={data.error} />
</div></section>
<style>
  .backlog-heading { padding-bottom: 16px; margin-bottom: 16px; border-bottom: 2px solid var(--line-strong); }
  h1 { font: 2rem var(--font-display); margin: 6px 0; }
  .backlog-heading > p:last-child { font-size: var(--fs-nav); color: var(--text-secondary); margin: 0; }
</style>
