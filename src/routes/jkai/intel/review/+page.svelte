<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';

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
    low: 'color: #b91c1c;',
    medium: 'color: #92400e;',
    high: 'color: #065f46;',
  };
</script>

<PageHeader title="REVIEW" titleHref="/jkai/intel" />

<div class="p-6 sm:p-10 max-w-4xl mx-auto">
  {#if newTypes.length > 0}
    <div class="mb-8">
      <h2 class="text-sm font-semibold mb-3" style="color: var(--accent);">New Entity Types</h2>
      <div class="space-y-2">
        {#each newTypes as type}
          <div class="rounded-lg p-4 flex items-center justify-between border" style="background: var(--card-bg); border-color: var(--card-border);">
            <div class="flex items-center gap-3">
              <span class="text-xl">{type.icon}</span>
              <div>
                <div class="font-medium text-sm">{type.name}</div>
                <div class="text-xs" style="color: var(--text-ghost);">{type.description}</div>
              </div>
            </div>
            <button onclick={() => deleteType(type.id)} class="text-xs px-3 py-1 border border-red-300 rounded text-red-700 hover:bg-red-50">Remove</button>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <h2 class="text-sm font-semibold text-amber-600 mb-3">Unconfirmed Entities ({entities.length})</h2>

  {#if entities.length === 0}
    <div class="text-center py-12" style="color: var(--text-ghost);">
      <p>Nothing to review. All entities are confirmed.</p>
    </div>
  {:else}
    <div class="space-y-2">
      {#each entities as entity}
        <div class="rounded-lg p-4 border" style="background: var(--card-bg); border-color: var(--card-border);">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <span class="text-lg">{entity.typeIcon}</span>
              <div>
                <div class="font-medium text-sm">{entity.name}</div>
                <div class="text-xs" style="color: var(--text-ghost);">
                  {entity.typeName}
                  <span class="ml-2" style="{confidenceColors[entity.confidence] ?? ''}">{entity.confidence} confidence</span>
                  {#if entity.noteTitle}
                    <span class="ml-2">from: {entity.noteTitle}</span>
                  {/if}
                </div>
              </div>
            </div>
            <div class="flex gap-2">
              <button onclick={() => reviewEntity(entity.id, 'accept')} class="text-xs px-3 py-1 border border-emerald-400 rounded text-emerald-700 hover:bg-emerald-50">Confirm</button>
              <button onclick={() => reviewEntity(entity.id, 'reject')} class="text-xs px-3 py-1 border border-red-300 rounded text-red-700 hover:bg-red-50">Reject</button>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
