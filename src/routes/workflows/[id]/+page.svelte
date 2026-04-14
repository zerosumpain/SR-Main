<script lang="ts">
  import { onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { workflowNodesToCanvas, workflowEdgesToCanvas, canvasNodesToWorkflow, canvasEdgesToWorkflow } from '$lib/components/workflows/adapter';
  import type { CanvasNode, CanvasEdge } from '$lib/components/workflows/adapter';
  import { resolveUpstreamSchema, schemaToVariablePaths } from '$lib/workflows/schema-propagation';
  import type { JsonSchema } from '$lib/workflows/types';

  import '@xyflow/svelte/dist/style.css';

  let { data } = $props();

  let nodes = $state<CanvasNode[]>(workflowNodesToCanvas(data.nodes as any));
  let edges = $state<CanvasEdge[]>(workflowEdgesToCanvas(data.edges as any));
  let workflowName = $state(data.workflow.name);
  let runStatus = $state<string | null>(null);
  let eventSource: EventSource | null = null;

  let rightPanel = $state<'chat' | 'inspector' | 'runs' | 'edge'>('chat');
  let inspectedNodeId = $state<string | null>(null);
  let inspectedEdgeId = $state<string | null>(null);
  let currentRunId = $state<string | null>(null);

  interface HealingState {
    nodeId: string;
    nodeLabel: string;
    error: string;
    attempts: Array<{
      diagnosis: string;
      reasoning: string;
      fixDescription?: string;
      fixApplied: boolean;
      retrySucceeded?: boolean;
      resultError?: string;
    }>;
    status: 'diagnosing' | 'retrying' | 'succeeded' | 'failed' | 'blocked';
    environmentAction?: string;
    alternative?: string;
    undoIds: string[];
  }

  let healingStates = $state<HealingState[]>([]);

  // Modal state for node inspection
  let showEdgeModal = $state(false);
  let edgeModalData = $state<{ source: any; target: any }>({ source: null, target: null });
  let inspectedEdgeObj = $derived(inspectedEdgeId ? edges.find(e => e.id === inspectedEdgeId) : null);
  let edgeSourceLabel = $derived(inspectedEdgeObj ? nodes.find(n => n.id === inspectedEdgeObj.source)?.data.label ?? '?' : '?');
  let edgeTargetLabel = $derived(inspectedEdgeObj ? nodes.find(n => n.id === inspectedEdgeObj.target)?.data.label ?? '?' : '?');

  let lastClickedNodeId = $state<string | null>(null);
  let lastClickTime = $state(0);

  function openNodeInspect(nodeId: string) {
    const now = Date.now();
    if (lastClickedNodeId === nodeId && now - lastClickTime < 400) {
      // Double click detected
      modalNodeId = nodeId;
      showNodeModal = true;
      modalNodeData = null;
      if (currentRunId) {
        fetch(`/api/workflows/${data.workflow.id}/runs/${currentRunId}/nodes/${nodeId}`)
          .then(r => r.ok ? r.json() : null)
          .then(d => { modalNodeData = d; })
          .catch(() => {});
      }
      lastClickedNodeId = null;
      lastClickTime = 0;
    } else {
      lastClickedNodeId = nodeId;
      lastClickTime = now;
    }
  }

  let showNodeModal = $state(false);
  let modalNodeId = $state<string | null>(null);
  let modalNode = $derived(modalNodeId ? nodes.find(n => n.id === modalNodeId) : null);
  let modalNodeDef = $derived(modalNode ? registryModule?.getDefinition(modalNode.data.nodeType) : null);
  let modalNodeData = $state<{ inputData: unknown; outputData: unknown } | null>(null);
  let editingConfig = $state<Record<string, string>>({});
  let configMode = $state<'basic' | 'advanced'>('basic');

  // When modal opens, populate editable config
  $effect(() => {
    if (showNodeModal && modalNode) {
      const cfg: Record<string, string> = {};
      for (const [k, v] of Object.entries(modalNode.data.config || {})) {
        cfg[k] = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
      }
      editingConfig = cfg;
    }
  });

  function saveNodeConfig() {
    if (!modalNodeId) return;
    const parsed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(editingConfig)) {
      try { parsed[k] = JSON.parse(v); } catch { parsed[k] = v; }
    }
    nodes = nodes.map(n =>
      n.id === modalNodeId ? { ...n, data: { ...n.data, config: parsed } } : n
    );
    // Auto-save to DB
    handleSave();
    showNodeModal = false;
  }

  // Dynamic imports for browser-only components
  let SvelteFlowModule: any = $state(null);
  let NodePalette: any = $state(null);
  let WorkflowToolbar: any = $state(null);
  let ChatPanel: any = $state(null);
  let RunHistoryPanel: any = $state(null);
  let registryModule: any = $state(null);
  let nodeTypeComponents: Record<string, any> = $state({});
  let BasicConfigRendererComponent: any = $state(null);
  let WhatsAppConfigPanelComponent: any = $state(null);
  let HomeAssistantConfigPanelComponent: any = $state(null);
  let UpstreamSchemaPanelComponent: any = $state(null);

  if (browser) {
    import('@xyflow/svelte').then(m => { SvelteFlowModule = m; });
    import('$lib/components/workflows/NodePalette.svelte').then(m => NodePalette = m.default);
    import('$lib/components/workflows/WorkflowToolbar.svelte').then(m => WorkflowToolbar = m.default);
    import('$lib/components/workflows/ChatPanel.svelte').then(m => ChatPanel = m.default);
    import('$lib/components/workflows/RunHistoryPanel.svelte').then(m => RunHistoryPanel = m.default);
    import('$lib/workflows/registry-client').then(m => registryModule = m);
    import('$lib/components/workflows/BasicConfigRenderer.svelte').then(m => BasicConfigRendererComponent = m.default);
    import('$lib/components/workflows/WhatsAppConfigPanel.svelte').then(m => WhatsAppConfigPanelComponent = m.default);
    import('$lib/components/workflows/HomeAssistantConfigPanel.svelte').then(m => HomeAssistantConfigPanelComponent = m.default);
    import('$lib/components/workflows/UpstreamSchemaPanel.svelte').then(m => UpstreamSchemaPanelComponent = m.default);

    // Load all node type components
    Promise.all([
      import('$lib/components/workflows/nodes/ManualTriggerNode.svelte'),
      import('$lib/components/workflows/nodes/CodeExecuteNode.svelte'),
      import('$lib/components/workflows/nodes/TransformNode.svelte'),
      import('$lib/components/workflows/nodes/HttpRequestNode.svelte'),
      import('$lib/components/workflows/nodes/LlmCallNode.svelte'),
      import('$lib/components/workflows/nodes/ConditionalNode.svelte'),
      import('$lib/components/workflows/nodes/LoopNode.svelte'),
      import('$lib/components/workflows/nodes/DelayNode.svelte'),
      import('$lib/components/workflows/nodes/ErrorHandlerNode.svelte'),
      import('$lib/components/workflows/nodes/DataStoreNode.svelte'),
      import('$lib/components/workflows/nodes/EmailNode.svelte'),
      import('$lib/components/workflows/nodes/StravaNode.svelte'),
      import('$lib/components/workflows/nodes/WhoopNode.svelte'),
      import('$lib/components/workflows/nodes/OpenRouterNode.svelte'),
      import('$lib/components/workflows/nodes/ValidatorNode.svelte'),
      import('$lib/components/workflows/nodes/ThinkNode.svelte'),
      import('$lib/components/workflows/nodes/LlmRouterNode.svelte'),
      import('$lib/components/workflows/nodes/MergeNode.svelte'),
      import('$lib/components/workflows/nodes/TextParserNode.svelte'),
      import('$lib/components/workflows/nodes/AccumulatorNode.svelte'),
      import('$lib/components/workflows/nodes/SubWorkflowNode.svelte'),
      import('$lib/components/workflows/nodes/LlmAgentNode.svelte'),
      import('$lib/components/workflows/nodes/WhatsAppNode.svelte'),
      import('$lib/components/workflows/nodes/HomeAssistantNode.svelte'),
    ]).then(([mt, ce, tr, hr, lc, co, lo, de, eh, ds, em, st, wh, or_, va, th, lr, me, tp, ac, sw, la, wa, ha]) => {
      nodeTypeComponents = {
        'manual-trigger': mt.default,
        'code-execute': ce.default,
        'transform': tr.default,
        'http-request': hr.default,
        'llm-call': lc.default,
        'conditional': co.default,
        'loop': lo.default,
        'delay': de.default,
        'error-handler': eh.default,
        'data-store': ds.default,
        'email': em.default,
        'strava': st.default,
        'whoop': wh.default,
        'openrouter': or_.default,
        'validator': va.default,
        'think': th.default,
        'llm-router': lr.default,
        'merge': me.default,
        'text-parser': tp.default,
        'accumulator': ac.default,
        'sub-workflow': sw.default,
        'llm-agent': la.default,
        'whatsapp': wa.default,
        'home-assistant': ha.default,
      };
    });
  }

  let definitions = $derived(registryModule?.nodeDefinitions ?? []);
  let hasNodeTypes = $derived(Object.keys(nodeTypeComponents).length > 0);

  // Check if modal node is connected (has incoming edges) or is a trigger
  let modalNodeIsConnected = $derived.by(() => {
    if (!modalNodeId) return false;
    const node = nodes.find((n) => n.id === modalNodeId);
    if (!node) return false;
    const def = registryModule?.getDefinition(node.data.nodeType);
    if (def?.category === 'trigger') return true;
    // WhatsApp node config must be accessible without upstream connection (for connection management)
    if (node.data.nodeType === 'whatsapp') return true;
    if (node.data.nodeType === 'home-assistant') return true;
    return edges.some((e) => e.target === modalNodeId);
  });

  // Compute upstream variables for autocomplete
  let modalUpstreamVariables = $derived.by(() => {
    if (!modalNodeId || !registryModule) return [];
    const workflowNodes = canvasNodesToWorkflow(nodes);
    const workflowEdges = canvasEdgesToWorkflow(edges);
    const schema = resolveUpstreamSchema(
      modalNodeId,
      workflowNodes,
      workflowEdges,
      (type: string, config: Record<string, unknown>) => getStaticOutputSchema(type, config),
    );
    return schemaToVariablePaths(schema);
  });

  function getStaticOutputSchema(type: string, config: Record<string, unknown>): JsonSchema {
    if (config.outputSchema && typeof config.outputSchema === 'object') {
      return config.outputSchema as JsonSchema;
    }
    const schemas: Record<string, JsonSchema> = {
      'manual-trigger': { type: 'object', properties: { data: { type: 'object' } } },
      'http-request': {
        type: 'object',
        properties: {
          status: { type: 'number', description: 'HTTP status code' },
          headers: { type: 'object', description: 'Response headers' },
          body: { type: 'any', description: 'Response body' },
        },
      },
      'llm-call': {
        type: 'object',
        properties: {
          response: { type: 'string', description: 'LLM response text' },
          usage: {
            type: 'object',
            properties: {
              promptTokens: { type: 'number' },
              completionTokens: { type: 'number' },
            },
          },
        },
      },
      'email': {
        type: 'object',
        properties: { messageId: { type: 'string' }, accepted: { type: 'array' } },
      },
      'data-store': {
        type: 'object',
        properties: { value: { type: 'any', description: 'Stored value' }, key: { type: 'string' } },
      },
      'loop': {
        type: 'object',
        properties: {
          results: { type: 'array', description: 'Array of transformed items' },
          count: { type: 'number', description: 'Number of items processed' },
        },
      },
      'strava': { type: 'object', properties: { data: { type: 'any' } } },
      'whoop': { type: 'object', properties: { data: { type: 'any' } } },
      'openrouter': {
        type: 'object',
        properties: { response: { type: 'string' }, usage: { type: 'object' } },
      },
      'llm-agent': {
        type: 'object',
        properties: {
          response: { type: 'string', description: 'Final LLM response' },
          toolCallHistory: { type: 'array', description: 'Tool call records' },
          iterationCount: { type: 'number', description: 'Number of LLM rounds' },
          stopReason: { type: 'string', description: 'Why the agent stopped' },
          tokensUsed: {
            type: 'object',
            properties: {
              prompt: { type: 'number' },
              completion: { type: 'number' },
              total: { type: 'number' },
            },
          },
        },
      },
      'think': {
        type: 'object',
        properties: {
          reasoning: { type: 'string' },
          conclusion: { type: 'string' },
          fullResponse: { type: 'string' },
        },
      },
      'validator': {
        type: 'object',
        properties: { valid: { type: 'boolean' }, errors: { type: 'array' } },
      },
      'text-parser': {
        type: 'object',
        properties: { parsed: { type: 'any' }, items: { type: 'array' }, count: { type: 'number' } },
      },
      'merge': { type: 'object', description: 'Merged data' },
      'accumulator': {
        type: 'object',
        properties: { items: { type: 'array' }, count: { type: 'number' } },
      },
    };
    if (type === 'conditional' || type === 'error-handler' || type === 'delay') {
      return { type: 'object', description: 'Input passed through' };
    }
    return schemas[type] || { type: 'object' };
  }

  function deleteNode(nodeId: string) {
    nodes = nodes.filter(n => n.id !== nodeId);
    edges = edges.filter(e => e.source !== nodeId && e.target !== nodeId);
    handleSave();
  }

  function handleDragStart(_type: string, _event: DragEvent) {}

  function handleDrop(type: string, position: { x: number; y: number }) {
    const def = registryModule?.getDefinition(type);
    if (!def) return;
    const newNode: CanvasNode = {
      id: crypto.randomUUID(),
      type,
      position,
      data: { label: def.label, nodeType: type, config: { ...def.defaultConfig } },
    };
    nodes = [...nodes, newNode];
  }

  function handleCanvasDragOver(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  function handleCanvasDrop(event: DragEvent) {
    event.preventDefault();
    const type = event.dataTransfer?.getData('application/workflow-node');
    if (!type) return;
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    handleDrop(type, { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  }

  function handleNodeClick(payload: any) {
    const nodeId = payload?.node?.id;
    if (nodeId) openNodeInspect(nodeId);
  }

  let lastClickedEdgeId = $state<string | null>(null);
  let lastEdgeClickTime = $state(0);

  function handleEdgeClick(payload: any) {
    const edgeId = payload?.edge?.id;
    if (!edgeId) return;
    const now = Date.now();
    if (lastClickedEdgeId === edgeId && now - lastEdgeClickTime < 400) {
      // Double click — open edge data modal
      inspectedEdgeId = edgeId;
      showEdgeModal = true;
      edgeModalData = { source: null, target: null };
      const edge = edges.find(e => e.id === edgeId);
      if (edge && currentRunId) {
        Promise.all([
          fetch(`/api/workflows/${data.workflow.id}/runs/${currentRunId}/nodes/${edge.source}`).then(r => r.ok ? r.json() : null),
          fetch(`/api/workflows/${data.workflow.id}/runs/${currentRunId}/nodes/${edge.target}`).then(r => r.ok ? r.json() : null),
        ]).then(([src, tgt]) => { edgeModalData = { source: src, target: tgt }; }).catch(() => {});
      }
      lastClickedEdgeId = null;
      lastEdgeClickTime = 0;
    } else {
      lastClickedEdgeId = edgeId;
      lastEdgeClickTime = now;
    }
  }

  async function handleSave() {
    await fetch(`/api/workflows/${data.workflow.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: workflowName,
        nodes: canvasNodesToWorkflow(nodes),
        edges: canvasEdgesToWorkflow(edges),
      }),
    });
  }

  async function handleRun() {
    healingStates = [];
    // Reset all node statuses
    nodes = nodes.map(n => ({ ...n, data: { ...n.data, status: 'pending' } }));
    edges = edges.map(e => ({ ...e, animated: false }));

    const res = await fetch(`/api/workflows/${data.workflow.id}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: {} }),
    });
    const result = await res.json();
    if (res.ok) {
      runStatus = 'running';
      currentRunId = result.runId;
      connectSSE(result.runId);
      // Also poll for completion in case SSE misses events (fast workflows)
      pollRunStatus(result.runId);
    }
  }

  async function pollRunStatus(runId: string) {
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (runStatus !== 'running') return; // SSE already handled it
      try {
        const res = await fetch(`/api/workflows/${data.workflow.id}/runs/${runId}`);
        if (!res.ok) continue;
        const run = await res.json();
        if (run.status === 'completed' || run.status === 'failed') {
          runStatus = run.status;
          // Update node statuses from execution data
          const executedNodes = new Set<string>();
          for (const exec of run.nodeExecutions || []) {
            executedNodes.add(exec.nodeId);
            updateNodeStatus(exec.nodeId, exec.status, exec.error);
          }
          // Mark any remaining pending nodes as skipped
          for (const n of nodes) {
            if (!executedNodes.has(n.id) && n.data.status === 'pending') {
              updateNodeStatus(n.id, 'skipped');
            }
          }
          // Stop edge animations
          edges = edges.map(e => ({ ...e, animated: false }));
          eventSource?.close();
          return;
        }
      } catch { /* ignore */ }
    }
  }

  function connectSSE(runId: string) {
    eventSource?.close();
    eventSource = new EventSource(`/api/workflows/${data.workflow.id}/runs/${runId}/stream`);
    eventSource.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.type === 'node_started' && event.nodeId) {
        updateNodeStatus(event.nodeId, 'running');
        // Animate incoming edges to this node
        animateEdgesToNode(event.nodeId, true);
      }
      else if (event.type === 'node_completed' && event.nodeId) {
        updateNodeStatus(event.nodeId, 'completed');
        // Stop animating incoming edges, animate outgoing edges
        animateEdgesToNode(event.nodeId, false);
        animateEdgesFromNode(event.nodeId, true);
        // Brief delay then stop outgoing animation
        setTimeout(() => animateEdgesFromNode(event.nodeId, false), 1500);
      }
      else if (event.type === 'node_failed' && event.nodeId) {
        updateNodeStatus(event.nodeId, 'failed', event.data?.error);
        animateEdgesToNode(event.nodeId, false);
      }
      else if (event.type === 'node_skipped' && event.nodeId) {
        updateNodeStatus(event.nodeId, 'skipped');
        animateEdgesToNode(event.nodeId, false);
      }
      else if (event.type === 'healing_started' && event.nodeId) {
        updateNodeStatus(event.nodeId, 'healing');
        const existing = healingStates.find(h => h.nodeId === event.nodeId);
        if (!existing) {
          healingStates = [...healingStates, {
            nodeId: event.nodeId,
            nodeLabel: event.data?.nodeLabel || event.nodeId,
            error: event.data?.error || 'Unknown error',
            attempts: [],
            status: 'diagnosing',
            undoIds: [],
          }];
        } else {
          healingStates = healingStates.map(h => h.nodeId === event.nodeId ? { ...h, status: 'diagnosing' } : h);
        }
      }
      else if (event.type === 'healing_progress' && event.nodeId) {
        healingStates = healingStates.map(h => {
          if (h.nodeId !== event.nodeId) return h;
          const text = event.data?.text || '';
          const lastAttempt = h.attempts[h.attempts.length - 1];
          if (lastAttempt && !lastAttempt.fixApplied) {
            return { ...h, attempts: [...h.attempts.slice(0, -1), { ...lastAttempt, diagnosis: text }] };
          }
          return { ...h, attempts: [...h.attempts, { diagnosis: text, reasoning: '', fixApplied: false }] };
        });
      }
      else if (event.type === 'healing_fix_applied' && event.nodeId) {
        updateNodeStatus(event.nodeId, 'running');
        healingStates = healingStates.map(h => {
          if (h.nodeId !== event.nodeId) return h;
          const undoId = event.data?.undoId as string;
          const newUndoIds = undoId ? [...h.undoIds, undoId] : h.undoIds;
          const lastAttempt = h.attempts[h.attempts.length - 1];
          if (lastAttempt) {
            return {
              ...h,
              status: 'retrying' as const,
              undoIds: newUndoIds,
              attempts: [...h.attempts.slice(0, -1), {
                ...lastAttempt,
                fixDescription: (event.data?.description as string) || 'Fix applied',
                fixApplied: true,
              }],
            };
          }
          return { ...h, status: 'retrying' as const, undoIds: newUndoIds };
        });
      }
      else if (event.type === 'healing_succeeded' && event.nodeId) {
        updateNodeStatus(event.nodeId, 'completed');
        healingStates = healingStates.map(h => {
          if (h.nodeId !== event.nodeId) return h;
          const lastAttempt = h.attempts[h.attempts.length - 1];
          if (lastAttempt) {
            return {
              ...h,
              status: 'succeeded' as const,
              attempts: [...h.attempts.slice(0, -1), { ...lastAttempt, retrySucceeded: true }],
            };
          }
          return { ...h, status: 'succeeded' as const };
        });
      }
      else if (event.type === 'healing_failed' && event.nodeId) {
        updateNodeStatus(event.nodeId, 'failed');
        healingStates = healingStates.map(h =>
          h.nodeId === event.nodeId ? { ...h, status: 'failed' as const } : h,
        );
      }
      else if (event.type === 'healing_blocked' && event.nodeId) {
        updateNodeStatus(event.nodeId, 'blocked');
        healingStates = healingStates.map(h =>
          h.nodeId === event.nodeId ? {
            ...h,
            status: 'blocked' as const,
            environmentAction: event.data?.environmentAction as string,
            alternative: event.data?.alternative as string,
          } : h,
        );
      }
      else if (event.type === 'run_completed_with_errors') {
        runStatus = 'completed_with_errors';
        edges = edges.map(e => ({ ...e, animated: false }));
        eventSource?.close();
      }
      else if (event.type === 'breakpoint_hit' && event.nodeId) {
        updateNodeStatus(event.nodeId, 'paused_breakpoint');
        modalNodeId = event.nodeId;
        showNodeModal = true;
      }
      else if (event.type === 'run_completed') {
        runStatus = 'completed';
        edges = edges.map(e => ({ ...e, animated: false }));
        eventSource?.close();
      }
      else if (event.type === 'run_failed') {
        runStatus = 'failed';
        edges = edges.map(e => ({ ...e, animated: false }));
        eventSource?.close();
      }
    };
    eventSource.onerror = () => { eventSource?.close(); };
  }

  function updateNodeStatus(nodeId: string, status: string, error?: string) {
    nodes = nodes.map(n => n.id === nodeId ? { ...n, data: { ...n.data, status, ...(error !== undefined ? { error } : {}) } } : n);
  }

  function animateEdgesToNode(nodeId: string, animate: boolean) {
    edges = edges.map(e => e.target === nodeId ? { ...e, animated: animate } : e);
  }

  function animateEdgesFromNode(nodeId: string, animate: boolean) {
    edges = edges.map(e => e.source === nodeId ? { ...e, animated: animate } : e);
  }

  async function handleHealingUndo(undoId: string) {
    if (!currentRunId) return;
    try {
      const res = await fetch(`/api/workflows/${data.workflow.id}/runs/${currentRunId}/undo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ undoId }),
      });
      if (res.ok) {
        location.reload();
      }
    } catch { /* ignore */ }
  }

  function handleStop() {
    eventSource?.close();
    runStatus = null;
    nodes = nodes.map(n => ({ ...n, data: { ...n.data, status: undefined } }));
  }

  function handleNameChange(name: string) { workflowName = name; }

  function handleWorkflowGenerated(generated: any) {
    if (!generated?.nodes) return;
    nodes = generated.nodes.map((n: any) => ({
      id: n.id, type: n.type,
      position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
      data: { label: n.label, nodeType: n.type, config: n.config || {} },
    }));
    edges = (generated.edges || []).map((e: any) => ({
      id: e.id || `edge-${crypto.randomUUID().slice(0, 8)}`,
      source: e.sourceNodeId || e.source,
      target: e.targetNodeId || e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
      type: 'smoothstep',
    }));
    workflowName = generated.name || workflowName;
  }

  import { onMount } from 'svelte';

  // Capture-phase listener for delete buttons inside Svelte Flow nodes
  function handleDeletePointerDown(e: PointerEvent) {
    const target = (e.target as HTMLElement)?.closest?.('[data-delete-node]');
    if (target) {
      e.stopImmediatePropagation();
      e.preventDefault();
      const nodeId = (target as HTMLElement).dataset.deleteNode;
      if (nodeId) deleteNode(nodeId);
    }
  }

  onMount(() => {
    document.addEventListener('pointerdown', handleDeletePointerDown, true);
  });

  onDestroy(() => {
    eventSource?.close();
    if (browser) document.removeEventListener('pointerdown', handleDeletePointerDown, true);
  });
</script>

<svelte:head>
  <title>{workflowName} — Workflows</title>
</svelte:head>

<div class="flex flex-col h-screen">
  {#if WorkflowToolbar}
    <WorkflowToolbar
      {workflowName}
      workflowId={data.workflow.id}
      {runStatus}
      onSave={handleSave}
      onRun={handleRun}
      onStop={handleStop}
      onNameChange={handleNameChange}
      onShowRuns={() => { rightPanel = 'runs'; }}
    />
  {/if}

  {#if runStatus}
    <div
      class="flex items-center gap-2 px-4 py-1.5 border-b"
      style="border-color: var(--card-border); background: {runStatus === 'running' ? 'rgba(86,156,214,0.1)' : runStatus === 'completed' ? 'rgba(45,125,70,0.1)' : runStatus === 'completed_with_errors' ? 'rgba(243,156,18,0.1)' : 'rgba(180,50,50,0.1)'};"
    >
      {#if runStatus === 'running'}
        <span class="w-2 h-2 rounded-full animate-pulse" style="background: #569cd6;"></span>
        <span class="text-xs" style="color: #569cd6;">Running...</span>
      {:else if runStatus === 'completed'}
        <span class="w-2 h-2 rounded-full" style="background: #2d7d46;"></span>
        <span class="text-xs" style="color: #2d7d46;">Completed</span>
      {:else if runStatus === 'completed_with_errors'}
        <span class="w-2 h-2 rounded-full" style="background: #f39c12;"></span>
        <span class="text-xs" style="color: #f39c12;">Completed with errors</span>
      {:else if runStatus === 'failed'}
        <span class="w-2 h-2 rounded-full" style="background: #b43232;"></span>
        <span class="text-xs" style="color: #b43232;">Failed</span>
      {/if}
      <button onclick={() => { runStatus = null; nodes = nodes.map(n => ({ ...n, data: { ...n.data, status: undefined } })); }} class="ml-auto text-[10px] px-1.5 py-0.5 rounded" style="color: var(--text-ghost);">Clear</button>
    </div>
  {/if}

  {#if nodes.length > 0}
    <div class="flex items-center gap-2 px-4 py-2 border-b overflow-x-auto" style="border-color: var(--card-border); background: var(--card-bg);">
      <span class="text-[10px] uppercase tracking-wider shrink-0" style="color: var(--text-ghost); font-family: var(--font-mono);">Nodes:</span>
      {#each nodes as node (node.id)}
        <button
          onclick={() => openNodeInspect(node.id)}
          class="shrink-0 px-2 py-1 rounded text-[11px] border transition-colors hover:border-[var(--accent)]"
          style="border-color: {node.data.status === 'completed' ? '#2d7d46' : node.data.status === 'failed' ? '#b43232' : node.data.status === 'running' ? '#569cd6' : 'var(--card-border)'}; color: var(--text-primary); font-family: var(--font-mono);"
        >
          {node.data.label}
        </button>
      {/each}
    </div>
  {/if}

  <div class="flex flex-1 overflow-hidden">
    {#if NodePalette}
      <NodePalette {definitions} onDragStart={handleDragStart} />
    {/if}

    <div class="flex-1 h-full" ondragover={handleCanvasDragOver} ondrop={handleCanvasDrop} role="application">
      {#if SvelteFlowModule && hasNodeTypes}
        <SvelteFlowModule.SvelteFlow
          {nodes}
          {edges}
          nodeTypes={nodeTypeComponents}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1.2 }}
          minZoom={0.1}
          maxZoom={1.5}
          onnodeclick={handleNodeClick}
          onedgeclick={handleEdgeClick}
          defaultEdgeOptions={{ type: 'smoothstep', animated: false }}
        >
          <SvelteFlowModule.Controls />
          <SvelteFlowModule.MiniMap />
          <SvelteFlowModule.Background variant="dots" gap={20} size={1} />
        </SvelteFlowModule.SvelteFlow>
      {:else}
        <div class="flex items-center justify-center h-full">
          <p class="text-sm animate-pulse" style="color: var(--text-ghost);">Loading canvas...</p>
        </div>
      {/if}
    </div>

    {#if rightPanel === 'runs' && RunHistoryPanel}
      <RunHistoryPanel
        workflowId={data.workflow.id}
        onSelectRun={(runId) => { currentRunId = runId; }}
        onClose={() => { rightPanel = 'chat'; }}
      />
    {:else if ChatPanel}
      <ChatPanel
        workflowId={data.workflow.id}
        onWorkflowGenerated={handleWorkflowGenerated}
        currentNodes={canvasNodesToWorkflow(nodes)}
        currentEdges={canvasEdgesToWorkflow(edges)}
        {healingStates}
        onHealingUndo={handleHealingUndo}
      />
    {/if}
  </div>
</div>

{#if showNodeModal && modalNode}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center"
    role="presentation"
    onclick={() => { showNodeModal = false; }}
  >
    <div class="absolute inset-0 bg-black/70"></div>
    <div
      class="relative rounded-xl border w-full max-w-lg max-h-[80vh] overflow-y-auto shadow-2xl"
      style="background: var(--bg, #ede4d4); border-color: var(--card-border);"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
    >
      <!-- Header -->
      <div class="px-5 py-4 border-b flex items-center justify-between" style="border-color: var(--card-border);">
        <div>
          <h2 class="text-base font-medium" style="color: var(--text-primary);">{modalNode.data.label}</h2>
          <p class="text-[10px] uppercase tracking-wider mt-0.5" style="color: var(--text-ghost); font-family: var(--font-mono);">{modalNode.data.nodeType}</p>
        </div>
        <div class="flex items-center gap-2">
          {#if modalNodeDef?.basicConfig && modalNodeIsConnected}
            <div class="flex rounded border text-[10px]" style="border-color: var(--card-border);">
              <button
                onclick={() => { configMode = 'basic'; }}
                class="px-2 py-1 transition-colors"
                style="background: {configMode === 'basic' ? 'var(--accent)' : 'transparent'}; color: {configMode === 'basic' ? 'white' : 'var(--text-ghost)'};"
              >Basic</button>
              <button
                onclick={() => { configMode = 'advanced'; }}
                class="px-2 py-1 transition-colors"
                style="background: {configMode === 'advanced' ? 'var(--accent)' : 'transparent'}; color: {configMode === 'advanced' ? 'white' : 'var(--text-ghost)'};"
              >Advanced</button>
            </div>
          {/if}
          <button onclick={() => { showNodeModal = false; }} class="text-lg px-2 py-1 rounded hover:bg-black/10" style="color: var(--text-ghost);">&times;</button>
        </div>
      </div>

      <div class="p-5 space-y-5">
        {#if !modalNodeIsConnected}
          <!-- Connection gate -->
          <div class="text-center py-8">
            <div class="text-3xl mb-3" style="color: var(--text-ghost);">&#8594;</div>
            <p class="text-sm font-medium mb-1" style="color: var(--text-primary);">Standalone Node</p>
            <p class="text-xs" style="color: var(--text-ghost);">
              Connect this node to an upstream node to configure it. Drag an edge from another node's output to this node's input.
            </p>
          </div>
          <button
            onclick={() => { deleteNode(modalNodeId!); showNodeModal = false; }}
            class="w-full px-3 py-2 rounded text-sm transition-colors border"
            style="border-color: #b43232; color: #b43232;"
          >Delete Node</button>

        {:else}
          {#if modalNodeDef?.description}
            <p class="text-sm" style="color: var(--text-secondary);">{modalNodeDef.description}</p>
          {/if}

          <!-- Upstream variables panel -->
          {#if UpstreamSchemaPanelComponent}
            <svelte:component this={UpstreamSchemaPanelComponent} variables={modalUpstreamVariables} />
          {/if}

          <!-- Configuration -->
          <div>
            <h3 class="text-[11px] uppercase tracking-wider mb-2" style="color: var(--text-ghost); font-family: var(--font-mono);">Configuration</h3>

            {#if modalNode.data.nodeType === 'home-assistant' && HomeAssistantConfigPanelComponent}
              <svelte:component
                this={HomeAssistantConfigPanelComponent}
                fields={modalNodeDef?.basicConfig || []}
                config={modalNode.data.config || {}}
                variables={modalUpstreamVariables}
                showAdvanced={false}
                onConfigChange={(newConfig) => {
                  nodes = nodes.map(n =>
                    n.id === modalNodeId ? { ...n, data: { ...n.data, config: newConfig } } : n
                  );
                  editingConfig = {};
                  for (const [k, v] of Object.entries(newConfig)) {
                    editingConfig[k] = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
                  }
                }}
              />
            {:else if modalNode.data.nodeType === 'whatsapp' && WhatsAppConfigPanelComponent}
              <svelte:component
                this={WhatsAppConfigPanelComponent}
                fields={modalNodeDef?.basicConfig || []}
                config={modalNode.data.config || {}}
                variables={modalUpstreamVariables}
                showAdvanced={false}
                onConfigChange={(newConfig) => {
                  nodes = nodes.map(n =>
                    n.id === modalNodeId ? { ...n, data: { ...n.data, config: newConfig } } : n
                  );
                  editingConfig = {};
                  for (const [k, v] of Object.entries(newConfig)) {
                    editingConfig[k] = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
                  }
                }}
              />
            {:else if configMode === 'basic' && modalNodeDef?.basicConfig && BasicConfigRendererComponent}
              <svelte:component
                this={BasicConfigRendererComponent}
                fields={modalNodeDef.basicConfig}
                config={modalNode.data.config || {}}
                variables={modalUpstreamVariables}
                showAdvanced={false}
                onConfigChange={(newConfig) => {
                  nodes = nodes.map(n =>
                    n.id === modalNodeId ? { ...n, data: { ...n.data, config: newConfig } } : n
                  );
                  editingConfig = {};
                  for (const [k, v] of Object.entries(newConfig)) {
                    editingConfig[k] = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
                  }
                }}
              />
            {:else}
              <!-- Advanced: raw config editing -->
              <div class="space-y-2">
                {#each Object.entries(editingConfig) as [key, value]}
                  <div>
                    <label class="text-[11px] uppercase tracking-wider mb-1 block" style="color: var(--text-ghost); font-family: var(--font-mono);">{key}</label>
                    {#if value.length > 60 || value.includes('\n')}
                      <textarea
                        value={editingConfig[key]}
                        oninput={(e) => { editingConfig = { ...editingConfig, [key]: (e.target as HTMLTextAreaElement).value }; }}
                        class="w-full px-2 py-1.5 rounded text-xs border resize-vertical"
                        style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono); min-height: 80px;"
                        rows="4"
                      ></textarea>
                    {:else}
                      <input
                        type="text"
                        value={editingConfig[key]}
                        oninput={(e) => { editingConfig = { ...editingConfig, [key]: (e.target as HTMLInputElement).value }; }}
                        class="w-full px-2 py-1.5 rounded text-xs border"
                        style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
                      />
                    {/if}
                  </div>
                {/each}
                {#if Object.keys(editingConfig).length === 0}
                  <p class="text-xs" style="color: var(--text-ghost);">No configuration</p>
                {/if}
              </div>
            {/if}

            <button
              onclick={saveNodeConfig}
              class="mt-3 w-full px-3 py-2 rounded text-sm font-medium transition-colors"
              style="background: var(--accent); color: white;"
            >Save Configuration</button>
          </div>

          <!-- Schema -->
          {#if modalNodeDef}
            <div>
              <h3 class="text-[11px] uppercase tracking-wider mb-2" style="color: var(--text-ghost); font-family: var(--font-mono);">Schema</h3>
              <div class="grid grid-cols-2 gap-3">
                <div class="p-2 rounded border" style="background: var(--card-bg); border-color: var(--card-border);">
                  <span class="text-[10px] uppercase tracking-wider" style="color: #569cd6; font-family: var(--font-mono);">Inputs</span>
                  {#each modalNodeDef.inputs || [] as port}
                    <div class="text-xs mt-1" style="color: var(--text-primary); font-family: var(--font-mono);">{port.name} <span style="color: var(--text-ghost);">({port.type})</span></div>
                  {:else}
                    <p class="text-xs mt-1" style="color: var(--text-ghost);">None (trigger)</p>
                  {/each}
                </div>
                <div class="p-2 rounded border" style="background: var(--card-bg); border-color: var(--card-border);">
                  <span class="text-[10px] uppercase tracking-wider" style="color: #2d7d46; font-family: var(--font-mono);">Outputs</span>
                  {#each modalNodeDef.outputs || [] as port}
                    <div class="text-xs mt-1" style="color: var(--text-primary); font-family: var(--font-mono);">{port.name} <span style="color: var(--text-ghost);">({port.type})</span></div>
                  {:else}
                    <p class="text-xs mt-1" style="color: var(--text-ghost);">None</p>
                  {/each}
                </div>
              </div>
            </div>
          {/if}

          <!-- Run data -->
          {#if modalNodeData}
            <div>
              <h3 class="text-[11px] uppercase tracking-wider mb-2" style="color: var(--text-ghost); font-family: var(--font-mono);">Run Data</h3>
              {#if modalNodeData.inputData}
                <div class="mb-3">
                  <span class="text-[10px] uppercase tracking-wider" style="color: #569cd6; font-family: var(--font-mono);">Input</span>
                  <pre class="mt-1 p-2 rounded border text-xs overflow-x-auto" style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);">{JSON.stringify(modalNodeData.inputData, null, 2)}</pre>
                </div>
              {/if}
              {#if modalNodeData.outputData}
                <div>
                  <span class="text-[10px] uppercase tracking-wider" style="color: #2d7d46; font-family: var(--font-mono);">Output</span>
                  <pre class="mt-1 p-2 rounded border text-xs overflow-x-auto" style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);">{JSON.stringify(modalNodeData.outputData, null, 2)}</pre>
                </div>
              {/if}
            </div>
          {:else if currentRunId}
            <p class="text-xs" style="color: var(--text-ghost);">No run data for this node yet.</p>
          {:else}
            <p class="text-xs" style="color: var(--text-ghost);">Run the workflow to see data flow.</p>
          {/if}

          <button
            onclick={() => { deleteNode(modalNodeId!); showNodeModal = false; }}
            class="w-full px-3 py-2 rounded text-sm transition-colors border"
            style="border-color: #b43232; color: #b43232;"
          >Delete Node</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if showEdgeModal && inspectedEdgeObj}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center"
    role="presentation"
    onclick={() => { showEdgeModal = false; }}
  >
    <div class="absolute inset-0 bg-black/70"></div>
    <div
      class="relative rounded-xl border w-full max-w-lg max-h-[80vh] overflow-y-auto shadow-2xl"
      style="background: var(--bg, #ede4d4); border-color: var(--card-border);"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
    >
      <div class="px-5 py-4 border-b flex items-center justify-between" style="border-color: var(--card-border);">
        <div>
          <h2 class="text-base font-medium" style="color: var(--text-primary);">Edge Data Flow</h2>
          <p class="text-[10px] uppercase tracking-wider mt-0.5" style="color: var(--text-ghost); font-family: var(--font-mono);">{edgeSourceLabel} → {edgeTargetLabel}</p>
        </div>
        <button onclick={() => { showEdgeModal = false; }} class="text-lg px-2 py-1 rounded hover:bg-black/10" style="color: var(--text-ghost);">&times;</button>
      </div>

      <div class="p-5 space-y-4">
        <div>
          <div class="flex items-center gap-2 mb-2">
            <span class="w-2 h-2 rounded-full" style="background: #2d7d46;"></span>
            <h3 class="text-[11px] uppercase tracking-wider" style="color: var(--text-ghost); font-family: var(--font-mono);">Source Output — {edgeSourceLabel}</h3>
          </div>
          <pre class="p-2 rounded border text-xs overflow-x-auto" style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);">{edgeModalData.source?.outputData ? JSON.stringify(edgeModalData.source.outputData, null, 2) : 'No data — run the workflow first'}</pre>
        </div>

        <div class="flex justify-center" style="color: var(--text-ghost);">
          <span class="text-lg">↓</span>
        </div>

        <div>
          <div class="flex items-center gap-2 mb-2">
            <span class="w-2 h-2 rounded-full" style="background: #569cd6;"></span>
            <h3 class="text-[11px] uppercase tracking-wider" style="color: var(--text-ghost); font-family: var(--font-mono);">Target Input — {edgeTargetLabel}</h3>
          </div>
          <pre class="p-2 rounded border text-xs overflow-x-auto" style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);">{edgeModalData.target?.inputData ? JSON.stringify(edgeModalData.target.inputData, null, 2) : 'No data — run the workflow first'}</pre>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  :global(.svelte-flow) {
    --xy-background-color: var(--bg, #ede4d4);
    --xy-node-border-radius: 8px;
  }
</style>
