<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';

  let { data } = $props();

  const sourceIcon: Record<string, string> = {
    web: '🌐', whatsapp: '💬', pwa: '📱', email: '📧',
  };

  const statusColors: Record<string, string> = {
    pending: '',
    processing: 'color: #d97706;',
    processed: 'color: #059669;',
    failed: 'color: #dc2626;',
  };
</script>

<PageHeader title="NOTES" titleHref="/jkai/intel" />

<div class="p-6 sm:p-10 max-w-5xl mx-auto">
  <div class="flex items-center justify-between mb-6">
    <div></div>
    <a href="/jkai/intel/notes/new" class="px-4 py-2 rounded-lg text-sm font-medium" style="background: var(--accent); color: white;">
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
          class="block rounded-lg p-4 border hover:opacity-80 transition"
          style="background: var(--card-bg); border-color: var(--card-border);"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <span class="text-lg">{sourceIcon[note.source] ?? '📝'}</span>
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
