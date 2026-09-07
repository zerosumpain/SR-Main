<script lang="ts">
  import { page } from '$app/state';
  import DevelopmentWorkspace from '$lib/builds/DevelopmentWorkspace.svelte';
</script>
<svelte:head><title>Development workspace — Strange Ramblings</title></svelte:head>
<DevelopmentWorkspace buildId={page.params.id!} />
