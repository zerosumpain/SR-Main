<script lang="ts">
  import BuildsListLegacy from '$lib/builds/BuildsListLegacy.svelte';
  import BuildsListV2 from '$lib/builds/BuildsListV2.svelte';

  let { data } = $props();
</script>

{#if data.flagOn}
  <BuildsListV2 builds={data.builds} />
{:else}
  <BuildsListLegacy builds={data.builds} />
{/if}
