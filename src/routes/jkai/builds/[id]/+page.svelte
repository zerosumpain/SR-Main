<script lang="ts">
  import BuildDetailLegacy from '$lib/builds/BuildDetailLegacy.svelte';
  import BuildDetailV2 from '$lib/builds/BuildDetailV2.svelte';
  import BuildSession from '$lib/builds/BuildSession.svelte';

  let { data } = $props();
</script>

{#if data.v3}
  <BuildSession {data} />
{:else if data.flagOn}
  <BuildDetailV2 {data} />
{:else}
  <BuildDetailLegacy {data} />
{/if}
