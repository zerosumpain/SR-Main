<script lang="ts">
  import UmamiTracker from '$lib/components/UmamiTracker.svelte';
  let { children } = $props();
</script>

<UmamiTracker />
{@render children()}
