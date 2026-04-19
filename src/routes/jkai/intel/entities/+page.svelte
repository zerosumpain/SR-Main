<script lang="ts">
  let { data } = $props();
</script>

<div class="p-6 max-w-5xl mx-auto">
  <a href="/jkai/intel" class="text-sm text-gray-400 hover:text-gray-300">&larr; Dashboard</a>
  <h1 class="text-2xl font-bold mt-2 mb-6">Entities</h1>

  <!-- Type Filter -->
  <div class="flex flex-wrap gap-2 mb-6">
    <a
      href="/jkai/intel/entities"
      class="px-3 py-1.5 rounded-full text-sm {!data.activeTypeId ? 'bg-sky-600' : 'bg-gray-800 hover:bg-gray-700'}"
    >All</a>
    {#each data.types as type}
      <a
        href="/jkai/intel/entities?typeId={type.id}"
        class="px-3 py-1.5 rounded-full text-sm {data.activeTypeId === type.id ? 'bg-sky-600' : 'bg-gray-800 hover:bg-gray-700'}"
      >{type.icon} {type.name}</a>
    {/each}
  </div>

  {#if data.entities.length === 0}
    <div class="text-center py-16 text-gray-500">
      <p>No entities found. Add notes to start building your knowledge graph.</p>
    </div>
  {:else}
    <div class="grid grid-cols-2 gap-3">
      {#each data.entities as entity}
        <a
          href="/jkai/intel/entities/{entity.id}"
          class="bg-gray-900 rounded-lg p-4 hover:bg-gray-800/80 transition"
        >
          <div class="flex items-center gap-3 mb-2">
            <span class="text-xl">{entity.typeIcon}</span>
            <div>
              <div class="font-medium">{entity.name}</div>
              <div class="text-xs text-gray-400">{entity.typeName}</div>
            </div>
            {#if !entity.confirmed}
              <span class="ml-auto text-xs bg-amber-900/30 text-amber-400 px-2 py-0.5 rounded">unconfirmed</span>
            {/if}
          </div>
          {#if entity.summary}
            <p class="text-sm text-gray-300 line-clamp-2">{entity.summary}</p>
          {/if}
          <div class="text-xs text-gray-500 mt-2">
            {entity.noteCount} notes &middot; {entity.relationshipCount} connections
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
