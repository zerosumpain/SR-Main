<svelte:head><title>{data.session.topic} — The Desk (Shared)</title></svelte:head>
<script lang="ts">
  import type { PageData } from './$types';
  import ResearchDesk from '$lib/canvas/intelligence/ResearchDesk.svelte';

  let { data }: { data: PageData } = $props();
</script>

<div class="desk-host">
  <ResearchDesk
    sessionId={data.session.id}
    mode="deep"
    readonly
    initialTopic={data.session.topic}
    initialStatus={data.session.status}
  />
</div>

<style>
  .desk-host {
    position: fixed;
    inset: 0;
    background: var(--bg);
    overflow: hidden;
    z-index: 0;
  }
</style>
