<script lang="ts">
  // The workspace lives in $lib/components/builds, not $lib/builds: it imports
  // the daydream hub's chrome, and the module-boundary gate forbids a domain
  // module (`builds`) reaching up into the ui layer (`components`). The pure
  // halves — development-progress, development-activity, StreamLine — stay in
  // $lib/builds, which this component may import downward.
  import { page } from '$app/state';
  import DevelopmentWorkspace from '$lib/components/builds/DevelopmentWorkspace.svelte';
</script>
<svelte:head><title>Development workspace — Strange Ramblings</title></svelte:head>
<DevelopmentWorkspace buildId={page.params.id!} />
