<script lang="ts">
  let { data } = $props();

  let entities = $state(data.entities);
  let newTypes = $state(data.newTypes);

  async function reviewEntity(id: string, action: 'accept' | 'reject') {
    const res = await fetch(`/api/jkai/intel/review/${id}?action=${action}`, { method: 'POST' });
    if (res.ok) {
      entities = entities.filter((e) => e.id !== id);
    }
  }

  async function deleteType(id: string) {
    const res = await fetch(`/api/jkai/intel/review/${id}?action=delete-type`, { method: 'POST' });
    if (res.ok) {
      newTypes = newTypes.filter((t) => t.id !== id);
    }
  }

  const confidenceColors: Record<string, string> = {
    low: 'text-red-400',
    medium: 'text-amber-400',
    high: 'text-emerald-400',
  };
</script>

<div class="p-6 max-w-4xl mx-auto">
  <a href="/jkai/intel" class="text-sm text-gray-400 hover:text-gray-300">&larr; Dashboard</a>
  <h1 class="text-2xl font-bold mt-2 mb-6">Review Queue</h1>

  {#if newTypes.length > 0}
    <div class="mb-8">
      <h2 class="text-sm font-semibold text-purple-400 mb-3">New Entity Types</h2>
      <div class="space-y-2">
        {#each newTypes as type}
          <div class="bg-gray-900 rounded-lg p-4 flex items-center justify-between">
            <div class="flex items-center gap-3">
              <span class="text-xl">{type.icon}</span>
              <div>
                <div class="font-medium text-sm">{type.name}</div>
                <div class="text-xs text-gray-400">{type.description}</div>
              </div>
            </div>
            <button onclick={() => deleteType(type.id)} class="text-xs text-red-400 hover:text-red-300 px-3 py-1 border border-red-800 rounded hover:bg-red-900/30">Remove</button>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <h2 class="text-sm font-semibold text-amber-400 mb-3">Unconfirmed Entities ({entities.length})</h2>

  {#if entities.length === 0}
    <div class="text-center py-12 text-gray-500">
      <p>Nothing to review. All entities are confirmed.</p>
    </div>
  {:else}
    <div class="space-y-2">
      {#each entities as entity}
        <div class="bg-gray-900 rounded-lg p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <span class="text-lg">{entity.typeIcon}</span>
              <div>
                <div class="font-medium text-sm">{entity.name}</div>
                <div class="text-xs text-gray-400">
                  {entity.typeName}
                  <span class="ml-2 {confidenceColors[entity.confidence] ?? ''}">{entity.confidence} confidence</span>
                  {#if entity.noteTitle}
                    <span class="ml-2">from: {entity.noteTitle}</span>
                  {/if}
                </div>
              </div>
            </div>
            <div class="flex gap-2">
              <button onclick={() => reviewEntity(entity.id, 'accept')} class="text-xs text-emerald-400 hover:text-emerald-300 px-3 py-1 border border-emerald-800 rounded hover:bg-emerald-900/30">Confirm</button>
              <button onclick={() => reviewEntity(entity.id, 'reject')} class="text-xs text-red-400 hover:text-red-300 px-3 py-1 border border-red-800 rounded hover:bg-red-900/30">Reject</button>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
