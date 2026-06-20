<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { goto } from '$app/navigation';

  let { data } = $props();

  let noteStatus = $state(data.note.status);
  let retrying = $state(false);
  let deleting = $state(false);
  let deleteError = $state<string | null>(null);

  const statusBadge: Record<string, { bg: string; text: string }> = {
    pending: { bg: 'background: var(--card-bg);', text: 'color: var(--text-secondary);' },
    processing: { bg: 'background: #fef3c7;', text: 'color: #92400e;' },
    processed: { bg: 'background: #d1fae5;', text: 'color: #065f46;' },
    failed: { bg: 'background: #fee2e2;', text: 'color: #991b1b;' },
  };

  const badge = $derived(statusBadge[noteStatus] ?? statusBadge.pending);

  async function retryProcessing() {
    retrying = true;
    noteStatus = 'processing';
    try {
      const res = await fetch(`/api/jkai/intel/notes/${data.note.id}`, { method: 'POST' });
      if (!res.ok) throw new Error('Retry failed');
      // Poll for completion
      const poll = setInterval(async () => {
        const r = await fetch(`/api/jkai/intel/notes/${data.note.id}`);
        if (r.ok) {
          const d = await r.json();
          noteStatus = d.note.status;
          if (d.note.status === 'processed' || d.note.status === 'failed') {
            clearInterval(poll);
            retrying = false;
            if (d.note.status === 'processed') {
              window.location.reload();
            }
          }
        }
      }, 3000);
    } catch {
      noteStatus = 'failed';
      retrying = false;
    }
  }

  async function deleteNote() {
    const ok = confirm(
      'Delete this note? Any entities and relationships that came only from this note will also be removed.',
    );
    if (!ok) return;

    deleting = true;
    deleteError = null;
    try {
      const res = await fetch(`/api/jkai/intel/notes/${data.note.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      await goto('/jkai/intel/notes');
    } catch (err) {
      deleteError = err instanceof Error ? err.message : 'Delete failed';
      deleting = false;
    }
  }
</script>

<PageHeader title="NOTE" titleHref="/jkai/intel/notes" />

<div class="p-6 sm:p-10 max-w-4xl mx-auto">
  <div class="flex items-start justify-between mb-4">
    <h2 class="text-xl font-bold">{data.note.title ?? 'Untitled Note'}</h2>
    <div class="flex items-center gap-2">
      {#if noteStatus === 'failed' || noteStatus === 'pending'}
        <button
          onclick={retryProcessing}
          disabled={retrying}
          class="px-3 py-1 rounded text-xs border transition-colors hover:opacity-80"
          style="background: var(--accent); color: white; border-color: var(--accent);"
        >{retrying ? 'Retrying...' : 'Retry'}</button>
      {/if}
      <span class="px-2 py-1 rounded text-xs border" style="{badge.bg} {badge.text} border-color: var(--card-border);">{noteStatus}</span>
      <button
        onclick={deleteNote}
        disabled={deleting}
        class="px-3 py-1 rounded text-xs border transition-colors nm-delete-btn"
        style="background: transparent; color: var(--text-secondary); border-color: var(--card-border);"
        aria-label="Delete note"
      >{deleting ? 'Deleting...' : 'Delete'}</button>
    </div>
  </div>
  {#if deleteError}
    <div class="mb-4 text-sm" style="color: #dc2626;">{deleteError}</div>
  {/if}

  <div class="text-xs mb-6" style="color: var(--text-ghost);">
    {data.note.source} &middot; {data.note.format} &middot; {new Date(data.note.createdAt).toLocaleString()}
  </div>

  <div class="grid grid-cols-3 gap-6">
    <div class="col-span-2 space-y-4">
      <div class="rounded-[var(--radius-round)] p-4 border" style="background: var(--card-bg); border-color: var(--card-border);">
        <h2 class="text-xs uppercase mb-2" style="color: var(--text-ghost);">Content</h2>
        <pre class="text-sm whitespace-pre-wrap leading-relaxed">{data.note.processedContent ?? data.note.rawContent}</pre>
      </div>

      {#if data.note.processedContent && data.note.processedContent !== data.note.rawContent}
        <details class="rounded-[var(--radius-round)] p-4 border" style="background: var(--card-bg); border-color: var(--card-border);">
          <summary class="text-xs uppercase cursor-pointer" style="color: var(--text-ghost);">Raw Input</summary>
          <pre class="text-sm whitespace-pre-wrap leading-relaxed mt-2">{data.note.rawContent}</pre>
        </details>
      {/if}
    </div>

    <div class="space-y-4">
      <div class="rounded-[var(--radius-round)] p-4 border" style="background: var(--card-bg); border-color: var(--card-border);">
        <h2 class="text-xs uppercase mb-2" style="color: var(--text-ghost);">Extracted Entities</h2>
        {#if data.entities.length === 0}
          <p class="text-sm" style="color: var(--text-ghost);">No entities extracted.</p>
        {:else}
          {#each data.entities as entity}
            <a
              href="/jkai/intel/entities/{entity.entityId}"
              class="flex items-center gap-2 py-1.5 -mx-2 px-2 rounded text-sm hover:opacity-80 transition"
            >
              <span>{entity.entityTypeIcon}</span>
              <span>{entity.entityName}</span>
              <span class="text-xs" style="color: var(--text-ghost);">{entity.relevance}</span>
            </a>
          {/each}
        {/if}
      </div>

      {#if data.timelineEvents.length > 0}
        <div class="rounded-[var(--radius-round)] p-4 border" style="background: var(--card-bg); border-color: var(--card-border);">
          <h2 class="text-xs uppercase mb-2" style="color: var(--text-ghost);">Timeline Events</h2>
          {#each data.timelineEvents as event}
            <div class="py-1.5 text-sm">
              <span style="color: var(--warn);">{event.date}</span>
              <span class="mx-1" style="color: var(--text-ghost);">&middot;</span>
              <span>{event.title}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .nm-delete-btn:hover {
    background: var(--error-bg);
    color: var(--error);
    border-color: var(--error-border);
  }
</style>
