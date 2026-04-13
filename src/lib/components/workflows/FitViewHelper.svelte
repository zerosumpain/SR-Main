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

  let flow: ReturnType<typeof useSvelteFlow> | null = null;
  try {
    flow = useSvelteFlow();
  } catch {
    // May fail if context not ready
  }

  let prevCount = $state(nodeCount);

  onMount(() => {
    if (flow) {
      requestAnimationFrame(() => flow!.fitView(options));
    }
  });

  $effect(() => {
    if (nodeCount !== prevCount && flow) {
      prevCount = nodeCount;
      requestAnimationFrame(() => flow!.fitView(options));
    }
  });
</script>
