<script lang="ts">
  import JkaiPageTitle from '$lib/components/jkai/JkaiPageTitle.svelte';

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

<JkaiPageTitle title="REVIEW" titleHref="/jkai/intel" />

<div class="p-6 sm:p-10 max-w-4xl mx-auto">
  {#if newTypes.length > 0}
    <div class="mb-8">
      <h2 class="text-sm font-semibold mb-3" style="color: var(--accent);">New Entity Types</h2>
      <div class="space-y-2">
        {#each newTypes as type}
          <div class="rounded-[var(--radius-round)] p-4 flex items-center justify-between border" style="background: var(--card-bg); border-color: var(--card-border);">
            <div class="flex items-center gap-3">
              <span class="text-xl">{type.icon}</span>
              <div>
                <div class="font-medium text-sm">{type.name}</div>
                <div class="text-xs" style="color: var(--text-ghost);">{type.description}</div>
              </div>
            </div>
            <button onclick={() => deleteType(type.id)} class="text-xs px-3 py-1 border rounded" style="border-color: var(--error-border); color: var(--error);">Remove</button>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <h2 class="text-sm font-semibold mb-3" style="color: var(--warn);">Unconfirmed Entities ({entities.length})</h2>

  {#if entities.length === 0}
    <div class="text-center py-12" style="color: var(--text-ghost);">
      <p>Nothing to review. All entities are confirmed.</p>
    </div>
  {:else}
    <div class="space-y-2">
      {#each entities as entity}
        <div class="rounded-[var(--radius-round)] p-4 border" style="background: var(--card-bg); border-color: var(--card-border);">
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
              <button onclick={() => reviewEntity(entity.id, 'accept')} class="text-xs px-3 py-1 border rounded" style="border-color: var(--success-border); color: var(--success);">Confirm</button>
              <button onclick={() => reviewEntity(entity.id, 'reject')} class="text-xs px-3 py-1 border rounded" style="border-color: var(--error-border); color: var(--error);">Reject</button>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
