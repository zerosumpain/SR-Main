<script lang="ts">
  let { data } = $props();

  const sourceIcon: Record<string, string> = {
    web: '🌐', whatsapp: '💬', pwa: '📱', email: '📧',
  };

  const statusColors: Record<string, string> = {
    pending: 'text-gray-400',
    processing: 'text-amber-400',
    processed: 'text-emerald-400',
    failed: 'text-red-400',
  };
</script>

<div class="p-6 max-w-5xl mx-auto">
  <div class="flex items-center justify-between mb-6">
    <div>
      <a href="/jkai/intel" class="text-sm text-gray-400 hover:text-gray-300">&larr; Dashboard</a>
      <h1 class="text-2xl font-bold mt-2">Notes</h1>
    </div>
    <a href="/jkai/intel/notes/new" class="px-4 py-2 bg-emerald-600 rounded-lg hover:bg-emerald-500 text-sm font-medium">
      + New Note
    </a>
  </div>

  {#if data.notes.length === 0}
    <div class="text-center py-16 text-gray-500">
      <p class="text-lg mb-2">No notes yet</p>
      <p class="text-sm">Add your first note to start building your knowledge graph.</p>
    </div>
  {:else}
    <div class="space-y-2">
      {#each data.notes as note}
        <a
          href="/jkai/intel/notes/{note.id}"
          class="block bg-gray-900 rounded-lg p-4 hover:bg-gray-800/80 transition"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <span class="text-lg">{sourceIcon[note.source] ?? '📝'}</span>
              <div>
                <div class="font-medium text-sm">{note.title ?? 'Untitled'}</div>
                <div class="text-xs text-gray-400 mt-0.5">
                  {note.source} &middot; {note.format} &middot; {new Date(note.createdAt).toLocaleDateString()} &middot; {note.entityCount} entities
                </div>
              </div>
            </div>
            <span class="text-xs {statusColors[note.status] ?? ''}">{note.status}</span>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
