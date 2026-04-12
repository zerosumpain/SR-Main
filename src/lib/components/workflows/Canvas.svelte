<script lang="ts">
  import { SvelteFlow, Controls, MiniMap, Background, BackgroundVariant } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import type { CanvasNode, CanvasEdge } from './adapter';
  import ManualTriggerNode from './nodes/ManualTriggerNode.svelte';
  import CodeExecuteNode from './nodes/CodeExecuteNode.svelte';
  import TransformNode from './nodes/TransformNode.svelte';

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
  };

  // Double-click detection via two rapid clicks on the same node
  let lastClickNodeId: string | null = null;
  let lastClickTime = 0;
  const DOUBLE_CLICK_THRESHOLD_MS = 300;

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
