<script lang="ts">
  // Every Intel surface gets the same workbench nav, so "which page answers my
  // question" is answerable from wherever you happen to be rather than only
  // from the landing page.
  import type { Snippet } from 'svelte';
  import IntelWorkbench from '$lib/components/intel/IntelWorkbench.svelte';
  import type { LayoutData } from './$types';

  let { children, data }: { children: Snippet; data: LayoutData } = $props();
</script>

<IntelWorkbench counts={data.intelCounts} />

{@render children()}
