<script lang="ts">
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { canvasNodesToWorkflow, canvasEdgesToWorkflow } from '$lib/components/workflows/adapter';
  import type { CanvasNode, CanvasEdge } from '$lib/components/workflows/adapter';

  let nodes = $state<CanvasNode[]>([
    {
      id: crypto.randomUUID(),
      type: 'manual-trigger',
      position: { x: 100, y: 200 },
      data: { label: 'Start', nodeType: 'manual-trigger', config: {} },
    },
  ]);
  let edges = $state<CanvasEdge[]>([]);
  let workflowName = $state('Untitled Workflow');

  let Canvas: any = $state(null);
  let NodePalette: any = $state(null);
  let WorkflowToolbar: any = $state(null);
  let registryModule: any = $state(null);

  if (browser) {
    import('$lib/components/workflows/Canvas.svelte').then(m => Canvas = m.default);
    import('$lib/components/workflows/NodePalette.svelte').then(m => NodePalette = m.default);
    import('$lib/components/workflows/WorkflowToolbar.svelte').then(m => WorkflowToolbar = m.default);
    import('$lib/workflows/registry-client').then(m => registryModule = m);
  }

  let definitions = $derived(registryModule?.nodeDefinitions ?? []);

  function handleDragStart(_type: string, _event: DragEvent) {}

  function handleDrop(type: string, position: { x: number; y: number }) {
    const def = registryModule?.getDefinition(type);
    if (!def) return;

    const newNode: CanvasNode = {
      id: crypto.randomUUID(),
      type,
      position,
      data: {
        label: def.label,
        nodeType: type,
        config: { ...def.defaultConfig },
      },
    };
    nodes = [...nodes, newNode];
  }

  async function handleSave() {
    const res = await fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: workflowName,
        nodes: canvasNodesToWorkflow(nodes),
        edges: canvasEdgesToWorkflow(edges),
      }),
    });
    const workflow = await res.json();
    if (res.ok) {
      goto(`/workflows/${workflow.id}`);
    }
  }

  function handleRun() {
    handleSave();
  }

  function handleStop() {}

  function handleNameChange(name: string) {
    workflowName = name;
  }
</script>

<svelte:head>
  <title>New Workflow</title>
</svelte:head>

<div class="flex flex-col h-screen">
  {#if WorkflowToolbar}
    <WorkflowToolbar
      {workflowName}
      onSave={handleSave}
      onRun={handleRun}
      onStop={handleStop}
      onNameChange={handleNameChange}
    />
  {/if}

  <div class="flex flex-1 overflow-hidden">
    {#if NodePalette}
      <NodePalette {definitions} onDragStart={handleDragStart} />
    {/if}

    {#if Canvas}
      <Canvas
        bind:nodes
        bind:edges
        onDrop={handleDrop}
      />
    {/if}
  </div>
</div>
