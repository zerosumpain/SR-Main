<script lang="ts">
  let query = $state('');
  let results = $state<{ notes: any[]; entities: any[] }>({ notes: [], entities: [] });
  let searching = $state(false);
  let debounceTimer: ReturnType<typeof setTimeout>;

  const sourceIcon: Record<string, string> = {
    web: '🌐', whatsapp: '💬', pwa: '📱', email: '📧',
  };

  function onInput() {
    clearTimeout(debounceTimer);
    if (query.trim().length < 2) {
      results = { notes: [], entities: [] };
      return;
    }
    debounceTimer = setTimeout(search, 300);
  }

  async function search() {
    searching = true;
    try {
      const res = await fetch(`/api/jkai/intel/search?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        results = await res.json();
      }
    } finally {
      searching = false;
    }
  }
</script>

<div class="p-6 max-w-4xl mx-auto">
  <a href="/jkai/intel" class="text-sm text-gray-400 hover:text-gray-300">&larr; Dashboard</a>
  <h1 class="text-2xl font-bold mt-2 mb-6">Search</h1>

  <input
    type="text"
    bind:value={query}
    oninput={onInput}
    placeholder="Search notes, entities, relationships..."
    class="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-sky-500 mb-6"
    autofocus
  />

  {#if searching}
    <div class="text-center py-8 text-gray-500">Searching...</div>
  {:else if query.length >= 2 && results.entities.length === 0 && results.notes.length === 0}
    <div class="text-center py-8 text-gray-500">No results found for "{query}"</div>
  {:else}
    {#if results.entities.length > 0}
      <div class="mb-8">
        <h2 class="text-sm font-semibold text-emerald-400 mb-3">Entities ({results.entities.length})</h2>
        <div class="grid grid-cols-2 gap-2">
          {#each results.entities as entity}
            <a href="/jkai/intel/entities/{entity.id}" class="bg-gray-900 rounded-lg p-3 hover:bg-gray-800/80 transition">
              <div class="flex items-center gap-2 mb-1">
                <span>{entity.typeIcon}</span>
                <span class="font-medium text-sm">{entity.name}</span>
                <span class="text-xs text-gray-500">{entity.typeName}</span>
              </div>
              {#if entity.summary}
                <p class="text-xs text-gray-400 line-clamp-2">{entity.summary}</p>
              {/if}
            </a>
          {/each}
        </div>
      </div>
    {/if}

    {#if results.notes.length > 0}
      <div>
        <h2 class="text-sm font-semibold text-sky-400 mb-3">Notes ({results.notes.length})</h2>
        <div class="space-y-2">
          {#each results.notes as note}
            <a href="/jkai/intel/notes/{note.id}" class="block bg-gray-900 rounded-lg p-3 hover:bg-gray-800/80 transition">
              <div class="flex items-center gap-2 mb-1">
                <span>{sourceIcon[note.source] ?? '📝'}</span>
                <span class="font-medium text-sm">{note.title ?? 'Untitled'}</span>
              </div>
              {#if note.snippet}
                <p class="text-xs text-gray-400 line-clamp-2">{note.snippet}</p>
              {/if}
              <div class="text-xs text-gray-500 mt-1">{new Date(note.createdAt).toLocaleDateString()}</div>
            </a>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>
