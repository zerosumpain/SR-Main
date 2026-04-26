<script lang="ts">
  import ChatMarkdown from '$lib/canvas/ChatMarkdown.svelte';

  let { content }: { content: string } = $props();
</script>

<div class="lane-output">
  <ChatMarkdown {content} role="assistant" />
</div>

<style>
  .lane-output {
    margin: 0.5rem 0;
  }
</style>
