<script lang="ts">
  import JsonTree from './JsonTree.svelte';

  let {
    nodeId,
    nodeLabel,
    nodeType,
    config,
    nodeDef,
    workflowId,
    runId,
    isPaused,
    onClose,
    onContinue,
    onConfigChange,
    reasoning,
  }: {
    nodeId: string;
    nodeLabel: string;
    nodeType: string;
    config: Record<string, unknown>;
    nodeDef?: { inputs?: { name: string; type: string; label?: string }[]; outputs?: { name: string; type: string; label?: string }[]; configSchema?: Record<string, unknown>; description?: string } | null;
    workflowId: string;
    runId?: string | null;
    isPaused?: boolean;
    onClose: () => void;
    onContinue?: (modifiedInput?: Record<string, unknown>) => void;
    onConfigChange?: (config: Record<string, unknown>) => void;
    reasoning?: {
      reason: string;
      alternatives: Array<{ nodeType: string; whyRejected: string }>;
      searchQuery?: string;
      isNewNode?: boolean;
    } | null;
  } = $props();

  let activeTab = $state<'config' | 'schema' | 'data' | 'reasoning'>('config');
  let nodeData = $state<{ inputData: unknown; outputData: unknown; status: string; error?: string } | null>(null);
  let loading = $state(false);
  let editableInput = $state('');

  $effect(() => {
    if (runId && nodeId) {
      loadNodeData();
    }
  });

  async function loadNodeData() {
    if (!runId) return;
    loading = true;
    try {
      const res = await fetch(`/api/workflows/${workflowId}/runs/${runId}/nodes/${nodeId}`);
      if (res.ok) {
        nodeData = await res.json();
        if (nodeData?.inputData) {
          editableInput = JSON.stringify(nodeData.inputData, null, 2);
        }
      }
    } catch {
      // ignore
    } finally {
      loading = false;
    }
  }

  function handleContinue() {
    if (!onContinue) return;
    try {
      const modified = editableInput ? JSON.parse(editableInput) : undefined;
      onContinue(modified);
    } catch {
      onContinue();
    }
  }
</script>

<div class="h-full flex flex-col border-l" style="background: var(--bg); border-color: var(--card-border); width: 360px;">
  <div class="px-4 py-3 border-b flex items-center justify-between" style="border-color: var(--card-border);">
    <div>
      <h3 class="text-sm font-medium" style="color: var(--text-primary);">{nodeLabel}</h3>
      <p class="text-[10px] uppercase tracking-wider" style="color: var(--text-ghost); font-family: var(--font-mono);">{nodeType}</p>
    </div>
    <button onclick={onClose} class="text-sm px-2 py-1 rounded hover:bg-black/5" style="color: var(--text-ghost);">Back</button>
  </div>

  <div class="flex border-b" style="border-color: var(--card-border);">
    {#each ['config', 'schema', 'data', ...(reasoning ? ['reasoning'] : [])] as tab}
      <button
        onclick={() => activeTab = tab as any}
        class="flex-1 px-3 py-2 text-xs uppercase tracking-wider transition-colors"
        style="color: {activeTab === tab ? 'var(--accent)' : 'var(--text-ghost)'}; border-bottom: 2px solid {activeTab === tab ? 'var(--accent)' : 'transparent'};"
      >
        {tab}
      </button>
    {/each}
  </div>

  <div class="flex-1 overflow-y-auto p-3">
    {#if activeTab === 'config'}
      <div class="space-y-3">
        {#each Object.entries(config) as [key, value]}
          <div>
            <label class="text-[11px] uppercase tracking-wider mb-1 block" style="color: var(--text-ghost); font-family: var(--font-mono);">{key}</label>
            {#if typeof value === 'string' && value.length > 50}
              <textarea
                value={value}
                oninput={(e) => {
                  const newConfig = { ...config, [key]: (e.target as HTMLTextAreaElement).value };
                  onConfigChange?.(newConfig);
                }}
                class="w-full px-2 py-1.5 rounded text-sm border resize-none"
                style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono); min-height: 80px;"
                rows="4"
              ></textarea>
            {:else}
              <input
                type="text"
                value={typeof value === 'string' ? value : JSON.stringify(value)}
                oninput={(e) => {
                  let parsed: unknown = (e.target as HTMLInputElement).value;
                  try { parsed = JSON.parse(parsed as string); } catch {}
                  const newConfig = { ...config, [key]: parsed };
                  onConfigChange?.(newConfig);
                }}
                class="w-full px-2 py-1.5 rounded text-sm border"
                style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
              />
            {/if}
          </div>
        {/each}
      </div>

    {:else if activeTab === 'schema'}
      <div class="space-y-4">
        {#if nodeDef?.description}
          <p class="text-xs" style="color: var(--text-secondary);">{nodeDef.description}</p>
        {/if}
        <div>
          <h4 class="text-[11px] uppercase tracking-wider mb-2" style="color: var(--text-ghost); font-family: var(--font-mono);">Inputs</h4>
          <div class="p-2 rounded border" style="background: var(--card-bg); border-color: var(--card-border);">
            {#if nodeDef?.inputs && nodeDef.inputs.length > 0}
              {#each nodeDef.inputs as port}
                <div class="flex items-center gap-2 py-1">
                  <span class="w-2 h-2 rounded-full" style="background: #569cd6;"></span>
                  <span class="text-xs font-medium" style="color: var(--text-primary); font-family: var(--font-mono);">{port.name}</span>
                  <span class="text-[10px]" style="color: var(--text-ghost);">({port.type})</span>
                  {#if port.label}<span class="text-[10px]" style="color: var(--text-ghost);">— {port.label}</span>{/if}
                </div>
              {/each}
            {:else}
              <p class="text-xs" style="color: var(--text-ghost);">No inputs (trigger node)</p>
            {/if}
          </div>
        </div>
        <div>
          <h4 class="text-[11px] uppercase tracking-wider mb-2" style="color: var(--text-ghost); font-family: var(--font-mono);">Outputs</h4>
          <div class="p-2 rounded border" style="background: var(--card-bg); border-color: var(--card-border);">
            {#if nodeDef?.outputs && nodeDef.outputs.length > 0}
              {#each nodeDef.outputs as port}
                <div class="flex items-center gap-2 py-1">
                  <span class="w-2 h-2 rounded-full" style="background: #2d7d46;"></span>
                  <span class="text-xs font-medium" style="color: var(--text-primary); font-family: var(--font-mono);">{port.name}</span>
                  <span class="text-[10px]" style="color: var(--text-ghost);">({port.type})</span>
                  {#if port.label}<span class="text-[10px]" style="color: var(--text-ghost);">— {port.label}</span>{/if}
                </div>
              {/each}
            {:else}
              <p class="text-xs" style="color: var(--text-ghost);">No outputs</p>
            {/if}
          </div>
        </div>
        {#if nodeDef?.configSchema?.properties}
          <div>
            <h4 class="text-[11px] uppercase tracking-wider mb-2" style="color: var(--text-ghost); font-family: var(--font-mono);">Config Schema</h4>
            <div class="p-2 rounded border" style="background: var(--card-bg); border-color: var(--card-border);">
              <JsonTree data={nodeDef.configSchema.properties} />
            </div>
          </div>
        {/if}
      </div>

    {:else if activeTab === 'data'}
      {#if loading}
        <p class="text-sm animate-pulse" style="color: var(--text-ghost);">Loading...</p>
      {:else if nodeData}
        <div class="space-y-4">
          <div>
            <h4 class="text-[11px] uppercase tracking-wider mb-2" style="color: var(--text-ghost); font-family: var(--font-mono);">Input Data</h4>
            {#if isPaused}
              <textarea
                bind:value={editableInput}
                class="w-full px-2 py-1.5 rounded text-xs border resize-none"
                style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono); min-height: 120px;"
                rows="8"
              ></textarea>
            {:else}
              <div class="p-2 rounded border" style="background: var(--card-bg); border-color: var(--card-border);">
                <JsonTree data={nodeData.inputData} />
              </div>
            {/if}
          </div>
          {#if nodeData.outputData}
            <div>
              <h4 class="text-[11px] uppercase tracking-wider mb-2" style="color: var(--text-ghost); font-family: var(--font-mono);">Output Data</h4>
              <div class="p-2 rounded border" style="background: var(--card-bg); border-color: var(--card-border);">
                <JsonTree data={nodeData.outputData} />
              </div>
            </div>
          {/if}
          {#if nodeData.error}
            <div>
              <h4 class="text-[11px] uppercase tracking-wider mb-2" style="color: #e74c3c; font-family: var(--font-mono);">Error</h4>
              <div class="p-2 rounded border" style="background: rgba(231, 76, 60, 0.08); border-color: #e74c3c;">
                <p class="text-xs break-words" style="color: #e74c3c; font-family: var(--font-mono);">{nodeData.error}</p>
              </div>
            </div>
          {/if}
          {#if nodeData.status}
            <div>
              <h4 class="text-[11px] uppercase tracking-wider mb-2" style="color: var(--text-ghost); font-family: var(--font-mono);">Status</h4>
              <span
                class="text-xs px-2 py-0.5 rounded font-medium"
                style="background: {nodeData.status === 'completed' ? 'rgba(39,174,96,0.1)' : nodeData.status === 'failed' ? 'rgba(231,76,60,0.1)' : 'rgba(0,0,0,0.05)'}; color: {nodeData.status === 'completed' ? '#27ae60' : nodeData.status === 'failed' ? '#e74c3c' : 'var(--text-ghost)'};"
              >
                {nodeData.status}
              </span>
            </div>
          {/if}
        </div>

        {#if isPaused}
          <button
            onclick={handleContinue}
            class="mt-4 w-full px-3 py-2 rounded text-sm font-medium transition-colors"
            style="background: var(--accent); color: white;"
          >
            Continue Execution
          </button>
        {/if}
      {:else}
        <p class="text-sm" style="color: var(--text-ghost);">No run data available. Run the workflow to see data here.</p>
      {/if}
    {:else if activeTab === 'reasoning' && reasoning}
      <div class="space-y-4">
        {#if reasoning.isNewNode}
          <div class="px-2 py-1 rounded text-[11px] font-medium inline-block" style="background: var(--accent); color: white;">
            New node — created for this workflow
          </div>
        {/if}

        <div>
          <h4 class="text-[11px] uppercase tracking-wider mb-2" style="color: var(--text-ghost); font-family: var(--font-mono);">Why this node</h4>
          <p class="text-xs" style="color: var(--text-secondary);">{reasoning.reason}</p>
        </div>

        {#if reasoning.searchQuery}
          <div>
            <h4 class="text-[11px] uppercase tracking-wider mb-2" style="color: var(--text-ghost); font-family: var(--font-mono);">Search query</h4>
            <p class="text-xs" style="color: var(--text-secondary); font-family: var(--font-mono);">{reasoning.searchQuery}</p>
          </div>
        {/if}

        {#if reasoning.alternatives.length > 0}
          <div>
            <h4 class="text-[11px] uppercase tracking-wider mb-2" style="color: var(--text-ghost); font-family: var(--font-mono);">Alternatives considered</h4>
            <div class="space-y-2">
              {#each reasoning.alternatives as alt}
                <div class="p-2 rounded border" style="background: var(--card-bg); border-color: var(--card-border);">
                  <span class="text-xs font-medium" style="color: var(--text-primary); font-family: var(--font-mono);">{alt.nodeType}</span>
                  <p class="text-[10px] mt-1" style="color: var(--text-ghost);">Rejected: {alt.whyRejected}</p>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
