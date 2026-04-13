<script lang="ts">
  import { SvelteFlow, Controls, MiniMap, Background, BackgroundVariant } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
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

  // Double-click detection via two rapid clicks on the same node
  let lastClickNodeId: string | null = null;
  let lastClickTime = 0;
  const DOUBLE_CLICK_THRESHOLD_MS = 300;

  // Long-press detection for mobile (fires onNodeDoubleClick after 300ms hold)
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressNodeId: string | null = null;

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

  function handleNodeClick({ node }: { node: CanvasNode; event: MouseEvent | TouchEvent }) {
    const now = Date.now();
    if (
      onNodeDoubleClick &&
      lastClickNodeId === node.id &&
      now - lastClickTime < DOUBLE_CLICK_THRESHOLD_MS
    ) {
      onNodeDoubleClick(node.id);
      lastClickNodeId = null;
      lastClickTime = 0;
    } else {
      lastClickNodeId = node.id;
      lastClickTime = now;
    }
  }

  function handleEdgeClick({ edge }: { edge: CanvasEdge; event: MouseEvent }) {
    onEdgeClick?.(edge.id);
  }

  function handleNodePointerDown({ node }: { node: CanvasNode; event: PointerEvent | MouseEvent | TouchEvent }) {
    longPressNodeId = node.id;
    longPressTimer = setTimeout(() => {
      if (longPressNodeId === node.id) {
        onNodeDoubleClick?.(node.id);
      }
      longPressNodeId = null;
    }, 300);
  }

  function handleNodePointerUp() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    longPressNodeId = null;
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
    onnodeclick={handleNodeClick}
    onedgeclick={handleEdgeClick}
    onnodepointerdown={handleNodePointerDown}
    onnodepointerup={handleNodePointerUp}
    defaultEdgeOptions={{ type: 'smoothstep', animated: false }}
  >
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
