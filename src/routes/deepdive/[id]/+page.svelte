<!-- src/routes/deepdive/[id]/+page.svelte -->
<script lang="ts">
  import ResearchDesk from '$lib/canvas/intelligence/ResearchDesk.svelte';
  let { data } = $props<{ data: { sessionId: string; topic: string; status: string } }>();
</script>

<svelte:head>
  <title>{data.topic || 'Research desk'} · sr.</title>
</svelte:head>

<ResearchDesk sessionId={data.sessionId} topic={data.topic} />
