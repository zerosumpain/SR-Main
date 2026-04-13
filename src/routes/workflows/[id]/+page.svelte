<script lang="ts">
  import { onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { workflowNodesToCanvas, workflowEdgesToCanvas, canvasNodesToWorkflow, canvasEdgesToWorkflow } from '$lib/components/workflows/adapter';
  import type { CanvasNode, CanvasEdge } from '$lib/components/workflows/adapter';

  let { data } = $props();

  let nodes = $state<CanvasNode[]>(workflowNodesToCanvas(data.nodes as any));
  let edges = $state<CanvasEdge[]>(workflowEdgesToCanvas(data.edges as any));
  let workflowName = $state(data.workflow.name);
  let runStatus = $state<string | null>(null);
  let eventSource: EventSource | null = null;

  // Dynamic imports for browser-only components
  let Canvas: any = $state(null);
  let NodePalette: any = $state(null);
  let WorkflowToolbar: any = $state(null);
  let ChatPanel: any = $state(null);
  let registryModule: any = $state(null);

  if (browser) {
    import('$lib/components/workflows/Canvas.svelte').then(m => Canvas = m.default);
    import('$lib/components/workflows/NodePalette.svelte').then(m => NodePalette = m.default);
    import('$lib/components/workflows/WorkflowToolbar.svelte').then(m => WorkflowToolbar = m.default);
    import('$lib/components/workflows/ChatPanel.svelte').then(m => ChatPanel = m.default);
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

  function handleNodeDoubleClick(nodeId: string) {
    console.log('Double-click node:', nodeId);
  }

  function handleEdgeClick(edgeId: string) {
    console.log('Click edge:', edgeId);
  }

  async function handleSave() {
    const workflowNodes = canvasNodesToWorkflow(nodes);
    const workflowEdges = canvasEdgesToWorkflow(edges);

    await fetch(`/api/workflows/${data.workflow.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: workflowName,
        nodes: workflowNodes,
        edges: workflowEdges,
      }),
    });
  }

  async function handleRun() {
    const res = await fetch(`/api/workflows/${data.workflow.id}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: {} }),
    });
    const result = await res.json();
    if (res.ok) {
      runStatus = 'running';
      connectSSE(result.runId);
    }
  }

  function connectSSE(runId: string) {
    eventSource?.close();
    eventSource = new EventSource(`/api/workflows/${data.workflow.id}/runs/${runId}/stream`);

    eventSource.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.type === 'node_started' && event.nodeId) {
        updateNodeStatus(event.nodeId, 'running');
      } else if (event.type === 'node_completed' && event.nodeId) {
        updateNodeStatus(event.nodeId, 'completed');
      } else if (event.type === 'node_failed' && event.nodeId) {
        updateNodeStatus(event.nodeId, 'failed');
      } else if (event.type === 'run_completed') {
        runStatus = 'completed';
        eventSource?.close();
      } else if (event.type === 'run_failed') {
        runStatus = 'failed';
        eventSource?.close();
      }
    };

    eventSource.onerror = () => {
      eventSource?.close();
    };
  }

  function updateNodeStatus(nodeId: string, status: string) {
    nodes = nodes.map((n) =>
      n.id === nodeId ? { ...n, data: { ...n.data, status } } : n,
    );
  }

  function handleStop() {
    eventSource?.close();
    runStatus = null;
    nodes = nodes.map((n) => ({ ...n, data: { ...n.data, status: undefined } }));
  }

  function handleNameChange(name: string) {
    workflowName = name;
  }

  function handleWorkflowGenerated(generated: any) {
    if (!generated?.nodes) return;
    nodes = generated.nodes.map((n: any) => ({
      id: n.id,
      type: n.type,
      position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
      data: { label: n.label, nodeType: n.type, config: n.config || {} },
    }));
    edges = generated.edges.map((e: any) => ({
      id: e.id,
      source: e.sourceNodeId,
      target: e.targetNodeId,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
    }));
    workflowName = generated.name || workflowName;
  }

  onDestroy(() => {
    eventSource?.close();
  });
</script>

<svelte:head>
  <title>{workflowName} — Workflows</title>
</svelte:head>

<div class="flex flex-col h-screen">
  {#if WorkflowToolbar}
    <WorkflowToolbar
      {workflowName}
      {runStatus}
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
        onNodeDoubleClick={handleNodeDoubleClick}
        onEdgeClick={handleEdgeClick}
        onDrop={handleDrop}
      />
    {/if}

    {#if ChatPanel}
      <ChatPanel
        workflowId={data.workflow.id}
        onWorkflowGenerated={handleWorkflowGenerated}
        currentNodes={canvasNodesToWorkflow(nodes)}
        currentEdges={canvasEdgesToWorkflow(edges)}
      />
    {/if}
  </div>
</div>
