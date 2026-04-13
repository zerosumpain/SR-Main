<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows';

  let {
    definitions,
    onDragStart,
  }: {
    definitions: NodeDefinition[];
    onDragStart: (type: string, event: DragEvent) => void;
  } = $props();

  let search = $state('');

  let filtered = $derived(
    definitions.filter(
      (d) =>
        d.label.toLowerCase().includes(search.toLowerCase()) ||
        d.description.toLowerCase().includes(search.toLowerCase()),
    ),
  );

  const categories = ['trigger', 'core', 'agentic', 'control', 'integration', 'custom'] as const;

  let grouped = $derived(
    categories
      .map((cat) => ({
        category: cat,
        nodes: filtered.filter((d) => d.category === cat),
      }))
      .filter((g) => g.nodes.length > 0),
  );

  function handleDragStart(type: string, event: DragEvent) {
    event.dataTransfer?.setData('application/workflow-node', type);
    onDragStart(type, event);
  }
</script>

<div class="h-full flex flex-col border-r" style="background: var(--bg); border-color: var(--card-border); width: 220px;">
  <div class="p-3 border-b" style="border-color: var(--card-border);">
    <input
      type="text"
      bind:value={search}
      placeholder="Search nodes..."
      class="w-full px-2 py-1.5 rounded text-sm border"
      style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary);"
    />
  </div>

  <div class="flex-1 overflow-y-auto p-2">
    {#each grouped as group}
      <div class="mb-3">
        <div
          class="text-[10px] uppercase tracking-[0.2em] px-2 py-1 mb-1"
          style="color: var(--text-ghost); font-family: var(--font-mono);"
        >
          {group.category}
        </div>
        {#each group.nodes as nodeDef}
          <div
            class="px-3 py-2 rounded cursor-grab text-sm mb-1 border transition-colors hover:border-[var(--accent)]"
            style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary);"
            draggable="true"
            ondragstart={(e) => handleDragStart(nodeDef.type, e)}
            role="button"
            tabindex="0"
          >
            <div class="font-medium text-xs">{nodeDef.label}</div>
            <div class="text-[11px] mt-0.5" style="color: var(--text-ghost);">
              {nodeDef.description.slice(0, 60)}
            </div>
          </div>
        {/each}
      </div>
    {/each}
  </div>
</div>
