<script lang="ts">
  import BuildDetailV2 from '$lib/builds/BuildDetailV2.svelte';
  import BuildSession from '$lib/builds/BuildSession.svelte';

  let { data } = $props();
</script>

{#if data.v3}
  <BuildSession {data} />
{:else}
  <BuildDetailV2 {data} />
{/if}
