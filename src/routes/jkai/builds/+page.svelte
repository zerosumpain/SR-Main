<script lang="ts">
  import BuildsListV2 from '$lib/builds/BuildsListV2.svelte';

  let { data } = $props();
</script>

<BuildsListV2 builds={data.builds} />
