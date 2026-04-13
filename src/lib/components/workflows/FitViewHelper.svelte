<script lang="ts">
  import { useSvelteFlow } from '@xyflow/svelte';
  import { onMount } from 'svelte';

  let {
    nodeCount,
    options = { padding: 0.15, maxZoom: 1.2, duration: 300 },
  }: {
    nodeCount: number;
    options?: { padding?: number; maxZoom?: number; duration?: number };
  } = $props();

  const { fitView } = useSvelteFlow();

  let prevCount = $state(nodeCount);
  let userInteracted = $state(false);
  let interactionTimer: ReturnType<typeof setTimeout> | null = null;

  // Fit on mount
  onMount(() => {
    requestAnimationFrame(() => fitView(options));
  });

  // Re-fit when node count changes (orchestrator generated a workflow)
  $effect(() => {
    if (nodeCount !== prevCount) {
      prevCount = nodeCount;
      // Reset user interaction flag when nodes change — new workflow generated
      userInteracted = false;
      requestAnimationFrame(() => fitView(options));
    }
  });
</script>
