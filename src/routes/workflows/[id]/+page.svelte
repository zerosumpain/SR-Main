<script lang="ts">
  import { onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { workflowNodesToCanvas, workflowEdgesToCanvas, canvasNodesToWorkflow, canvasEdgesToWorkflow } from '$lib/components/workflows/adapter';
  import type { CanvasNode, CanvasEdge } from '$lib/components/workflows/adapter';

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

  // Modal state for node inspection
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

  if (browser) {
    import('@xyflow/svelte').then(m => { SvelteFlowModule = m; });
    import('$lib/components/workflows/NodePalette.svelte').then(m => NodePalette = m.default);
    import('$lib/components/workflows/WorkflowToolbar.svelte').then(m => WorkflowToolbar = m.default);
    import('$lib/components/workflows/ChatPanel.svelte').then(m => ChatPanel = m.default);
    import('$lib/components/workflows/RunHistoryPanel.svelte').then(m => RunHistoryPanel = m.default);
    import('$lib/workflows/registry-client').then(m => registryModule = m);

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
    ]).then(([mt, ce, tr, hr, lc, co, lo, de, eh, ds, em, st, wh, or_]) => {
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
      };
    });
  }

  let definitions = $derived(registryModule?.nodeDefinitions ?? []);
  let hasNodeTypes = $derived(Object.keys(nodeTypeComponents).length > 0);

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

  function handleEdgeClick(payload: any) {
    const edgeId = payload?.edge?.id;
    if (edgeId) {
      inspectedEdgeId = edgeId;
      rightPanel = 'edge';
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
    }
  }

  function connectSSE(runId: string) {
    eventSource?.close();
    eventSource = new EventSource(`/api/workflows/${data.workflow.id}/runs/${runId}/stream`);
    eventSource.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.type === 'node_started' && event.nodeId) updateNodeStatus(event.nodeId, 'running');
      else if (event.type === 'node_completed' && event.nodeId) updateNodeStatus(event.nodeId, 'completed');
      else if (event.type === 'node_failed' && event.nodeId) updateNodeStatus(event.nodeId, 'failed');
      else if (event.type === 'breakpoint_hit' && event.nodeId) {
        updateNodeStatus(event.nodeId, 'paused_breakpoint');
        modalNodeId = event.nodeId;
        showNodeModal = true;
      }
      else if (event.type === 'run_completed') { runStatus = 'completed'; eventSource?.close(); }
      else if (event.type === 'run_failed') { runStatus = 'failed'; eventSource?.close(); }
    };
    eventSource.onerror = () => { eventSource?.close(); };
  }

  function updateNodeStatus(nodeId: string, status: string) {
    nodes = nodes.map(n => n.id === nodeId ? { ...n, data: { ...n.data, status } } : n);
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

  onDestroy(() => { eventSource?.close(); });
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

  {#if nodes.length > 0}
    <div class="flex items-center gap-2 px-4 py-2 border-b overflow-x-auto" style="border-color: var(--card-border); background: var(--card-bg);">
      <span class="text-[10px] uppercase tracking-wider shrink-0" style="color: var(--text-ghost); font-family: var(--font-mono);">Nodes:</span>
      {#each nodes as node (node.id)}
        <button
          onclick={() => openNodeInspect(node.id)}
          class="shrink-0 px-2 py-1 rounded text-[11px] border transition-colors hover:border-[var(--accent)]"
          style="border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
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

    {#if rightPanel === 'edge' && inspectedEdgeId}
      <!-- Edge inspector inline -->
      <div class="h-full flex flex-col border-l" style="background: var(--bg); border-color: var(--card-border); width: 360px;">
        <div class="px-4 py-3 border-b flex items-center justify-between" style="border-color: var(--card-border);">
          <h3 class="text-sm font-medium" style="color: var(--text-primary);">Edge Data</h3>
          <button onclick={() => { rightPanel = 'chat'; inspectedEdgeId = null; }} class="text-sm px-2 py-1 rounded hover:bg-black/5" style="color: var(--text-ghost);">Back</button>
        </div>
        <div class="flex-1 overflow-y-auto p-3">
          <p class="text-xs" style="color: var(--text-ghost);">Run the workflow then click an edge to see data flow.</p>
        </div>
      </div>
    {:else if rightPanel === 'runs' && RunHistoryPanel}
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
      <div class="px-5 py-4 border-b flex items-center justify-between" style="border-color: var(--card-border);">
        <div>
          <h2 class="text-base font-medium" style="color: var(--text-primary);">{modalNode.data.label}</h2>
          <p class="text-[10px] uppercase tracking-wider mt-0.5" style="color: var(--text-ghost); font-family: var(--font-mono);">{modalNode.data.nodeType}</p>
        </div>
        <button onclick={() => { showNodeModal = false; }} class="text-lg px-2 py-1 rounded hover:bg-black/10" style="color: var(--text-ghost);">&times;</button>
      </div>

      <div class="p-5 space-y-5">
        {#if modalNodeDef?.description}
          <p class="text-sm" style="color: var(--text-secondary);">{modalNodeDef.description}</p>
        {/if}

        <div>
          <h3 class="text-[11px] uppercase tracking-wider mb-2" style="color: var(--text-ghost); font-family: var(--font-mono);">Configuration</h3>
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
          <button
            onclick={saveNodeConfig}
            class="mt-3 w-full px-3 py-2 rounded text-sm font-medium transition-colors"
            style="background: var(--accent); color: white;"
          >
            Save Configuration
          </button>
        </div>

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
