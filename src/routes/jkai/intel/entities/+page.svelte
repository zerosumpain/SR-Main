<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';

  let { data } = $props();
</script>

<PageHeader title="ENTITIES" titleHref="/jkai/intel" />

<div class="p-6 sm:p-10 max-w-5xl mx-auto">
  <!-- Type Filter -->
  <div class="flex flex-wrap gap-2 mb-6">
    <a
      href="/jkai/intel/entities"
      class="px-3 py-1.5 rounded-full text-sm border"
      style="{!data.activeTypeId ? 'background: var(--accent); color: white; border-color: var(--accent);' : 'background: var(--card-bg); border-color: var(--card-border);'}"
    >All</a>
    {#each data.types as type}
      <a
        href="/jkai/intel/entities?typeId={type.id}"
        class="px-3 py-1.5 rounded-full text-sm border"
        style="{data.activeTypeId === type.id ? 'background: var(--accent); color: white; border-color: var(--accent);' : 'background: var(--card-bg); border-color: var(--card-border);'}"
      >{type.icon} {type.name}</a>
    {/each}
  </div>

  {#if data.entities.length === 0}
    <div class="text-center py-16" style="color: var(--text-ghost);">
      <p>No entities found. Add notes to start building your knowledge graph.</p>
    </div>
  {:else}
    <div class="grid grid-cols-2 gap-3">
      {#each data.entities as entity}
        <a
          href="/jkai/intel/entities/{entity.id}"
          class="rounded-[var(--radius-round)] p-4 hover:opacity-80 transition border"
          style="background: var(--card-bg); border-color: var(--card-border);"
        >
          <div class="flex items-center gap-3 mb-2">
            <span class="text-xl">{entity.typeIcon}</span>
            <div>
              <div class="font-medium">{entity.name}</div>
              <div class="text-xs" style="color: var(--text-ghost);">{entity.typeName}</div>
            </div>
            {#if !entity.confirmed}
              <span class="ml-auto text-xs px-2 py-0.5 rounded" style="background: var(--warn-bg); color: var(--warn);">unconfirmed</span>
            {/if}
          </div>
          {#if entity.summary}
            <p class="text-sm line-clamp-2" style="color: var(--text-secondary);">{entity.summary}</p>
          {/if}
          <div class="text-xs mt-2" style="color: var(--text-ghost);">
            {entity.noteCount} notes &middot; {entity.relationshipCount} connections
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
