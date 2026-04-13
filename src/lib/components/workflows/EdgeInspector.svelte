<script lang="ts">
  import JsonTree from './JsonTree.svelte';

  let {
    edgeId,
    sourceNode,
    targetNode,
    workflowId,
    runId,
    onClose,
  }: {
    edgeId: string;
    sourceNode: { id: string; label: string; nodeType: string } | null;
    targetNode: { id: string; label: string; nodeType: string } | null;
    workflowId: string;
    runId?: string | null;
    onClose: () => void;
  } = $props();

  let sourceData = $state<{ outputData: unknown } | null>(null);
  let targetData = $state<{ inputData: unknown } | null>(null);
  let loading = $state(false);

  $effect(() => {
    if (runId && sourceNode && targetNode) {
      loadEdgeData();
    }
  });

  async function loadEdgeData() {
    if (!runId || !sourceNode || !targetNode) return;
    loading = true;
    try {
      const [srcRes, tgtRes] = await Promise.all([
        fetch(`/api/workflows/${workflowId}/runs/${runId}/nodes/${sourceNode.id}`),
        fetch(`/api/workflows/${workflowId}/runs/${runId}/nodes/${targetNode.id}`),
      ]);
      if (srcRes.ok) sourceData = await srcRes.json();
      if (tgtRes.ok) targetData = await tgtRes.json();
    } catch {
      // ignore
    } finally {
      loading = false;
    }
  }
</script>

<div class="h-full flex flex-col border-l" style="background: var(--bg); border-color: var(--card-border); width: 360px;">
  <div class="px-4 py-3 border-b flex items-center justify-between" style="border-color: var(--card-border);">
    <div>
      <h3 class="text-sm font-medium" style="color: var(--text-primary);">Edge Data Flow</h3>
      <p class="text-[10px] mt-0.5" style="color: var(--text-ghost); font-family: var(--font-mono);">
        {sourceNode?.label ?? '?'} → {targetNode?.label ?? '?'}
      </p>
    </div>
    <button onclick={onClose} class="text-sm px-2 py-1 rounded hover:bg-black/5" style="color: var(--text-ghost);">Back</button>
  </div>

  <div class="flex-1 overflow-y-auto p-3 space-y-4">
    <div>
      <div class="flex items-center gap-2 mb-2">
        <span class="w-2 h-2 rounded-full" style="background: #2d7d46;"></span>
        <h4 class="text-[11px] uppercase tracking-wider" style="color: var(--text-ghost); font-family: var(--font-mono);">
          Source Output — {sourceNode?.label}
        </h4>
      </div>
      <div class="p-2 rounded border" style="background: var(--card-bg); border-color: var(--card-border);">
        {#if loading}
          <p class="text-xs animate-pulse" style="color: var(--text-ghost);">Loading...</p>
        {:else if sourceData?.outputData}
          <JsonTree data={sourceData.outputData} />
        {:else}
          <p class="text-xs" style="color: var(--text-ghost);">No data — run the workflow first</p>
        {/if}
      </div>
    </div>

    <div class="flex justify-center">
      <div class="flex flex-col items-center gap-1" style="color: var(--text-ghost);">
        <span class="text-lg">↓</span>
        <span class="text-[10px] uppercase tracking-wider">flows to</span>
        <span class="text-lg">↓</span>
      </div>
    </div>

    <div>
      <div class="flex items-center gap-2 mb-2">
        <span class="w-2 h-2 rounded-full" style="background: #569cd6;"></span>
        <h4 class="text-[11px] uppercase tracking-wider" style="color: var(--text-ghost); font-family: var(--font-mono);">
          Target Input — {targetNode?.label}
        </h4>
      </div>
      <div class="p-2 rounded border" style="background: var(--card-bg); border-color: var(--card-border);">
        {#if loading}
          <p class="text-xs animate-pulse" style="color: var(--text-ghost);">Loading...</p>
        {:else if targetData?.inputData}
          <JsonTree data={targetData.inputData} />
        {:else}
          <p class="text-xs" style="color: var(--text-ghost);">No data — run the workflow first</p>
        {/if}
      </div>
    </div>
  </div>
</div>
