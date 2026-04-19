<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';

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

<PageHeader title="SEARCH" titleHref="/jkai/intel" />

<div class="p-6 sm:p-10 max-w-4xl mx-auto">
  <input
    type="text"
    bind:value={query}
    oninput={onInput}
    placeholder="Search notes, entities, relationships..."
    class="w-full rounded-lg px-4 py-3 text-sm focus:outline-none border mb-6"
    style="background: var(--card-bg); border-color: var(--card-border);"
    autofocus
  />

  {#if searching}
    <div class="text-center py-8" style="color: var(--text-ghost);">Searching...</div>
  {:else if query.length >= 2 && results.entities.length === 0 && results.notes.length === 0}
    <div class="text-center py-8" style="color: var(--text-ghost);">No results found for "{query}"</div>
  {:else}
    {#if results.entities.length > 0}
      <div class="mb-8">
        <h2 class="text-sm font-semibold text-emerald-600 mb-3">Entities ({results.entities.length})</h2>
        <div class="grid grid-cols-2 gap-2">
          {#each results.entities as entity}
            <a href="/jkai/intel/entities/{entity.id}" class="rounded-lg p-3 hover:opacity-80 transition border" style="background: var(--card-bg); border-color: var(--card-border);">
              <div class="flex items-center gap-2 mb-1">
                <span>{entity.typeIcon}</span>
                <span class="font-medium text-sm">{entity.name}</span>
                <span class="text-xs" style="color: var(--text-ghost);">{entity.typeName}</span>
              </div>
              {#if entity.summary}
                <p class="text-xs line-clamp-2" style="color: var(--text-secondary);">{entity.summary}</p>
              {/if}
            </a>
          {/each}
        </div>
      </div>
    {/if}

    {#if results.notes.length > 0}
      <div>
        <h2 class="text-sm font-semibold text-sky-600 mb-3">Notes ({results.notes.length})</h2>
        <div class="space-y-2">
          {#each results.notes as note}
            <a href="/jkai/intel/notes/{note.id}" class="block rounded-lg p-3 hover:opacity-80 transition border" style="background: var(--card-bg); border-color: var(--card-border);">
              <div class="flex items-center gap-2 mb-1">
                <span>{sourceIcon[note.source] ?? '📝'}</span>
                <span class="font-medium text-sm">{note.title ?? 'Untitled'}</span>
              </div>
              {#if note.snippet}
                <p class="text-xs line-clamp-2" style="color: var(--text-secondary);">{note.snippet}</p>
              {/if}
              <div class="text-xs mt-1" style="color: var(--text-ghost);">{new Date(note.createdAt).toLocaleDateString()}</div>
            </a>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>
