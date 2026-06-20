<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';

  let query = $state('');
  let results = $state<{ notes: any[]; entities: any[] }>({ notes: [], entities: [] });
  let searching = $state(false);
  let debounceTimer: ReturnType<typeof setTimeout>;

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

{#snippet sourceIcon(source: string)}
  {#if source === 'web'}
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c2 2.5 2 11.5 0 14M10 3c-2 2.5-2 11.5 0 14"/></svg>
  {:else if source === 'whatsapp'}
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 16l1-3a6 6 0 113 2.5L4 16z"/></svg>
  {:else if source === 'pwa'}
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><rect x="6" y="3" width="8" height="14" rx="1"/><line x1="9" y1="14.5" x2="11" y2="14.5"/></svg>
  {:else if source === 'email'}
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="14" height="10" rx="1"/><path d="M3 6l7 5 7-5"/></svg>
  {:else}
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3h7l3 3v11H5z"/><path d="M12 3v3h3"/><line x1="7.5" y1="10" x2="12.5" y2="10"/><line x1="7.5" y1="13" x2="12.5" y2="13"/></svg>
  {/if}
{/snippet}

<PageHeader title="SEARCH" titleHref="/jkai/intel" />

<div class="p-6 sm:p-10 max-w-4xl mx-auto">
  <input
    type="text"
    bind:value={query}
    oninput={onInput}
    placeholder="Search notes, entities, relationships..."
    class="w-full rounded-[var(--radius-round)] px-4 py-3 text-sm focus:outline-none border mb-6"
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
        <h2 class="text-sm font-semibold mb-3" style="color: var(--success);">Entities ({results.entities.length})</h2>
        <div class="grid grid-cols-2 gap-2">
          {#each results.entities as entity}
            <a href="/jkai/intel/entities/{entity.id}" class="rounded-[var(--radius-round)] p-3 hover:opacity-80 transition border" style="background: var(--card-bg); border-color: var(--card-border);">
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
        <h2 class="text-sm font-semibold mb-3" style="color: var(--accent-ink);">Notes ({results.notes.length})</h2>
        <div class="space-y-2">
          {#each results.notes as note}
            <a href="/jkai/intel/notes/{note.id}" class="block rounded-[var(--radius-round)] p-3 hover:opacity-80 transition border" style="background: var(--card-bg); border-color: var(--card-border);">
              <div class="flex items-center gap-2 mb-1">
                <span class="inline-flex" style="color: var(--text-muted);">{@render sourceIcon(note.source)}</span>
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
