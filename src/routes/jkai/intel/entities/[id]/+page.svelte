<script lang="ts">
  let { data } = $props();

  const entity = data.entity;
  const properties = (entity.properties ?? {}) as Record<string, unknown>;
  const propEntries = Object.entries(properties).filter(([, v]) => v != null && v !== '');
</script>

<div class="p-6 max-w-5xl mx-auto">
  <a href="/jkai/intel/entities" class="text-sm text-gray-400 hover:text-gray-300">&larr; Entities</a>

  <!-- Header -->
  <div class="flex items-center gap-4 mt-4 mb-6">
    <div class="w-14 h-14 rounded-full flex items-center justify-center text-2xl" style="background: {entity.typeColor}20">
      {entity.typeIcon}
    </div>
    <div>
      <h1 class="text-2xl font-bold">{entity.name}</h1>
      <div class="text-sm text-gray-400">
        {entity.typeName}
        {#if entity.confirmed}
          <span class="text-emerald-400 ml-2">confirmed</span>
        {:else}
          <span class="text-amber-400 ml-2">unconfirmed</span>
        {/if}
      </div>
    </div>
  </div>

  <div class="grid grid-cols-2 gap-6">
    <!-- Left Column -->
    <div class="space-y-4">
      {#if entity.summary}
        <div class="bg-gray-900 rounded-lg p-4">
          <h2 class="text-xs text-gray-400 uppercase mb-2">Summary</h2>
          <p class="text-sm leading-relaxed">{entity.summary}</p>
        </div>
      {/if}

      {#if propEntries.length > 0}
        <div class="bg-gray-900 rounded-lg p-4">
          <h2 class="text-xs text-gray-400 uppercase mb-2">Properties</h2>
          <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {#each propEntries as [key, value]}
              <span class="text-gray-400 capitalize">{key}:</span>
              <span>{value}</span>
            {/each}
          </div>
        </div>
      {/if}

      <div class="bg-gray-900 rounded-lg p-4">
        <h2 class="text-xs text-gray-400 uppercase mb-2">Appears in {data.notes.length} notes</h2>
        {#each data.notes as note}
          <a href="/jkai/intel/notes/{note.noteId}" class="block py-2 border-b border-gray-800 last:border-0 hover:bg-gray-800/50 -mx-2 px-2 rounded">
            <div class="text-sm text-sky-400">{note.noteTitle ?? 'Untitled'}</div>
            <div class="text-xs text-gray-400 mt-0.5">{new Date(note.noteCreatedAt).toLocaleDateString()} &middot; {note.relevance}</div>
            {#if note.excerpt}
              <div class="text-xs text-gray-500 mt-1 line-clamp-2">{note.excerpt}</div>
            {/if}
          </a>
        {/each}
      </div>
    </div>

    <!-- Right Column -->
    <div class="space-y-4">
      <div class="bg-gray-900 rounded-lg p-4">
        <h2 class="text-xs text-gray-400 uppercase mb-2">Relationships</h2>
        {#if data.relationships.length === 0}
          <p class="text-sm text-gray-500">No relationships yet.</p>
        {:else}
          {#each data.relationships as rel}
            <a href="/jkai/intel/entities/{rel.otherEntityId}" class="flex items-center gap-2 py-1.5 hover:bg-gray-800 -mx-2 px-2 rounded text-sm">
              <span class="text-gray-500">{rel.direction === 'outgoing' ? '→' : '←'}</span>
              <span class="text-sky-400 font-medium">{rel.type.replace(/_/g, ' ')}</span>
              <span>{rel.otherEntityIcon} {rel.otherEntityName}</span>
            </a>
          {/each}
        {/if}
      </div>

      {#if data.timelineEvents.length > 0}
        <div class="bg-gray-900 rounded-lg p-4">
          <h2 class="text-xs text-gray-400 uppercase mb-2">Timeline</h2>
          <div class="border-l-2 border-gray-700 pl-3 space-y-3">
            {#each data.timelineEvents as event}
              <div>
                <div class="text-xs text-gray-400">{event.date}</div>
                <div class="text-sm">{event.title}</div>
                {#if event.description}
                  <div class="text-xs text-gray-500 mt-0.5">{event.description}</div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>
