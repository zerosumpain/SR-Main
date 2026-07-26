<script lang="ts">
  import JkaiPageTitle from '$lib/components/jkai/JkaiPageTitle.svelte';

  let { data } = $props();

  const statusColors: Record<string, string> = {
    pending: '',
    processing: 'color: var(--warn);',
    processed: 'color: var(--success);',
    failed: 'color: var(--error);',
  };
</script>

{#snippet sourceIcon(source: string)}
  {#if source === 'web'}
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c2 2.5 2 11.5 0 14M10 3c-2 2.5-2 11.5 0 14"/></svg>
  {:else if source === 'whatsapp'}
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 16l1-3a6 6 0 113 2.5L4 16z"/></svg>
  {:else if source === 'pwa'}
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><rect x="6" y="3" width="8" height="14" rx="1"/><line x1="9" y1="14.5" x2="11" y2="14.5"/></svg>
  {:else if source === 'email'}
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="14" height="10" rx="1"/><path d="M3 6l7 5 7-5"/></svg>
  {:else}
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3h7l3 3v11H5z"/><path d="M12 3v3h3"/><line x1="7.5" y1="10" x2="12.5" y2="10"/><line x1="7.5" y1="13" x2="12.5" y2="13"/></svg>
  {/if}
{/snippet}

<JkaiPageTitle title="NOTES" titleHref="/jkai/intel" />

<div class="p-6 sm:p-10 max-w-5xl mx-auto">
  <div class="flex items-center justify-between mb-6">
    <div></div>
    <a href="/jkai/intel/notes/new" class="px-4 py-2 rounded-[var(--radius-round)] text-sm font-medium" style="background: var(--accent); color: white;">
      + New Note
    </a>
  </div>

  {#if data.notes.length === 0}
    <div class="text-center py-16" style="color: var(--text-ghost);">
      <p class="text-lg mb-2">No notes yet</p>
      <p class="text-sm">Add your first note to start building your knowledge graph.</p>
    </div>
  {:else}
    <div class="space-y-2">
      {#each data.notes as note}
        <a
          href="/jkai/intel/notes/{note.id}"
          class="block rounded-[var(--radius-round)] p-4 border hover:opacity-80 transition"
          style="background: var(--card-bg); border-color: var(--card-border);"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <span class="inline-flex" style="color: var(--text-muted);">{@render sourceIcon(note.source)}</span>
              <div>
                <div class="font-medium text-sm">{note.title ?? 'Untitled'}</div>
                <div class="text-xs mt-0.5" style="color: var(--text-ghost);">
                  {note.source} &middot; {note.format} &middot; {new Date(note.createdAt).toLocaleDateString()} &middot; {note.entityCount} entities
                </div>
              </div>
            </div>
            <span class="text-xs" style="{statusColors[note.status] ?? ''}">{note.status}</span>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
