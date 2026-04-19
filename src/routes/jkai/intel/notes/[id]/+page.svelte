<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';

  let { data } = $props();

  const statusBadge: Record<string, { bg: string; text: string }> = {
    pending: { bg: 'background: var(--card-bg);', text: 'color: var(--text-secondary);' },
    processing: { bg: 'background: #fef3c7;', text: 'color: #92400e;' },
    processed: { bg: 'background: #d1fae5;', text: 'color: #065f46;' },
    failed: { bg: 'background: #fee2e2;', text: 'color: #991b1b;' },
  };

  const badge = statusBadge[data.note.status] ?? statusBadge.pending;
</script>

<PageHeader title="NOTE" titleHref="/jkai/intel/notes" />

<div class="p-6 sm:p-10 max-w-4xl mx-auto">
  <div class="flex items-start justify-between mb-4">
    <h2 class="text-xl font-bold">{data.note.title ?? 'Untitled Note'}</h2>
    <span class="px-2 py-1 rounded text-xs border" style="{badge.bg} {badge.text} border-color: var(--card-border);">{data.note.status}</span>
  </div>

  <div class="text-xs mb-6" style="color: var(--text-ghost);">
    {data.note.source} &middot; {data.note.format} &middot; {new Date(data.note.createdAt).toLocaleString()}
  </div>

  <div class="grid grid-cols-3 gap-6">
    <div class="col-span-2 space-y-4">
      <div class="rounded-lg p-4 border" style="background: var(--card-bg); border-color: var(--card-border);">
        <h2 class="text-xs uppercase mb-2" style="color: var(--text-ghost);">Content</h2>
        <pre class="text-sm whitespace-pre-wrap leading-relaxed">{data.note.processedContent ?? data.note.rawContent}</pre>
      </div>

      {#if data.note.processedContent && data.note.processedContent !== data.note.rawContent}
        <details class="rounded-lg p-4 border" style="background: var(--card-bg); border-color: var(--card-border);">
          <summary class="text-xs uppercase cursor-pointer" style="color: var(--text-ghost);">Raw Input</summary>
          <pre class="text-sm whitespace-pre-wrap leading-relaxed mt-2">{data.note.rawContent}</pre>
        </details>
      {/if}
    </div>

    <div class="space-y-4">
      <div class="rounded-lg p-4 border" style="background: var(--card-bg); border-color: var(--card-border);">
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
        <div class="rounded-lg p-4 border" style="background: var(--card-bg); border-color: var(--card-border);">
          <h2 class="text-xs uppercase mb-2" style="color: var(--text-ghost);">Timeline Events</h2>
          {#each data.timelineEvents as event}
            <div class="py-1.5 text-sm">
              <span class="text-amber-600">{event.date}</span>
              <span class="mx-1" style="color: var(--text-ghost);">&middot;</span>
              <span>{event.title}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
