<script lang="ts">
  import { SvelteFlow, Controls, MiniMap, Background, BackgroundVariant } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import { setInspectCallback } from './inspect-store';
  import type { CanvasNode, CanvasEdge } from './adapter';
  import ManualTriggerNode from './nodes/ManualTriggerNode.svelte';
  import CodeExecuteNode from './nodes/CodeExecuteNode.svelte';
  import TransformNode from './nodes/TransformNode.svelte';
  import HttpRequestNode from './nodes/HttpRequestNode.svelte';
  import LlmCallNode from './nodes/LlmCallNode.svelte';
  import ConditionalNode from './nodes/ConditionalNode.svelte';
  import LoopNode from './nodes/LoopNode.svelte';
  import DelayNode from './nodes/DelayNode.svelte';
  import ErrorHandlerNode from './nodes/ErrorHandlerNode.svelte';
  import DataStoreNode from './nodes/DataStoreNode.svelte';
  import EmailNode from './nodes/EmailNode.svelte';
  import StravaNode from './nodes/StravaNode.svelte';
  import WhoopNode from './nodes/WhoopNode.svelte';
  import OpenRouterNode from './nodes/OpenRouterNode.svelte';
  import FitViewHelper from './FitViewHelper.svelte';

  let {
    nodes = $bindable([]),
    edges = $bindable([]),
    onNodeDoubleClick,
    onEdgeClick,
    onDrop,
  }: {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
    onNodeDoubleClick?: (nodeId: string) => void;
    onEdgeClick?: (edgeId: string) => void;
    onDrop?: (type: string, position: { x: number; y: number }) => void;
  } = $props();

  const nodeTypes = {
    'manual-trigger': ManualTriggerNode,
    'code-execute': CodeExecuteNode,
    'transform': TransformNode,
    'http-request': HttpRequestNode,
    'llm-call': LlmCallNode,
    'conditional': ConditionalNode,
    'loop': LoopNode,
    'delay': DelayNode,
    'error-handler': ErrorHandlerNode,
    'data-store': DataStoreNode,
    'email': EmailNode,
    'strava': StravaNode,
    'whoop': WhoopNode,
    'openrouter': OpenRouterNode,
  };

  // Max zoom cap — prevents nodes from being too large
  const MAX_ZOOM = 1.5;
  const MIN_ZOOM = 0.1;
  const FIT_VIEW_OPTIONS = { padding: 0.15, maxZoom: 1.2, duration: 300 };

  // Set module-level callback so BaseNode can trigger inspection
  setInspectCallback((nodeId: string) => {
    onNodeDoubleClick?.(nodeId);
  });

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    const type = event.dataTransfer?.getData('application/workflow-node');
    if (!type || !onDrop) return;

    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const position = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    onDrop(type, position);
  }

  function handleNodeClick(payload: any) {
    const nodeId = payload?.node?.id;
    if (nodeId) {
      onNodeDoubleClick?.(nodeId);
    }
  }

  function handleEdgeClick(payload: any) {
    const edgeId = payload?.edge?.id;
    if (edgeId) {
      onEdgeClick?.(edgeId);
    }
  }
</script>

<div
  class="flex-1 h-full"
  ondragover={handleDragOver}
  ondrop={handleDrop}
  role="application"
>
  <SvelteFlow
    {nodes}
    {edges}
    {nodeTypes}
    fitView
    fitViewOptions={FIT_VIEW_OPTIONS}
    minZoom={MIN_ZOOM}
    maxZoom={MAX_ZOOM}
    onnodeclick={handleNodeClick}
    onedgeclick={handleEdgeClick}
    defaultEdgeOptions={{ type: 'smoothstep', animated: false }}
  >
    <FitViewHelper nodeCount={nodes.length} options={FIT_VIEW_OPTIONS} />
    <Controls />
    <MiniMap />
    <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
  </SvelteFlow>
</div>

<style>
  :global(.svelte-flow) {
    --xy-background-color: var(--bg, #ede4d4);
    --xy-node-border-radius: 8px;
  }
</style>
