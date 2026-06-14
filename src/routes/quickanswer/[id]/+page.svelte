<script lang="ts">
  import type { PageData } from './$types';
  import ResearchDesk from '$lib/canvas/intelligence/ResearchDesk.svelte';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Quick Answer — {data.answer.topic}</title></svelte:head>

<div class="desk-host">
  <ResearchDesk
    sessionId={data.answer.id}
    mode="quick"
    initialTopic={data.answer.topic}
    quickInitial={{
      status: data.answer.status,
      answer: data.answer.answer ?? '',
      sources: data.answer.sources ?? [],
      errorMessage: data.answer.errorMessage ?? '',
      durationMs: data.answer.durationMs ?? 0,
      createdAt: data.answer.createdAt,
    }}
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
