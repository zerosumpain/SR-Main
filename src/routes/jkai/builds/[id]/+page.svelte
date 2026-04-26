<script lang="ts">
  import BuildDetailLegacy from '$lib/builds/BuildDetailLegacy.svelte';
  import BuildDetailV2 from '$lib/builds/BuildDetailV2.svelte';

  let { data } = $props();
</script>

{#if data.flagOn}
  <BuildDetailV2 {data} />
{:else}
  <BuildDetailLegacy {data} />
{/if}
