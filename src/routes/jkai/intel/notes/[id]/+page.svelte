<script lang="ts">
  let { data } = $props();

  const statusBadge: Record<string, { bg: string; text: string }> = {
    pending: { bg: 'bg-gray-700', text: 'text-gray-300' },
    processing: { bg: 'bg-amber-900/50', text: 'text-amber-400' },
    processed: { bg: 'bg-emerald-900/50', text: 'text-emerald-400' },
    failed: { bg: 'bg-red-900/50', text: 'text-red-400' },
  };

  const badge = statusBadge[data.note.status] ?? statusBadge.pending;
</script>

<div class="p-6 max-w-4xl mx-auto">
  <a href="/jkai/intel" class="text-sm text-gray-400 hover:text-gray-300 mb-4 inline-block">&larr; Dashboard</a>

  <div class="flex items-start justify-between mb-4">
    <h1 class="text-2xl font-bold">{data.note.title ?? 'Untitled Note'}</h1>
    <span class="{badge.bg} {badge.text} px-2 py-1 rounded text-xs">{data.note.status}</span>
  </div>

  <div class="text-xs text-gray-400 mb-6">
    {data.note.source} &middot; {data.note.format} &middot; {new Date(data.note.createdAt).toLocaleString()}
  </div>

  <div class="grid grid-cols-3 gap-6">
    <div class="col-span-2 space-y-4">
      <div class="bg-gray-900 rounded-lg p-4">
        <h2 class="text-xs text-gray-400 uppercase mb-2">Content</h2>
        <pre class="text-sm whitespace-pre-wrap leading-relaxed">{data.note.processedContent ?? data.note.rawContent}</pre>
      </div>

      {#if data.note.processedContent && data.note.processedContent !== data.note.rawContent}
        <details class="bg-gray-900 rounded-lg p-4">
          <summary class="text-xs text-gray-400 uppercase cursor-pointer">Raw Input</summary>
          <pre class="text-sm whitespace-pre-wrap leading-relaxed mt-2">{data.note.rawContent}</pre>
        </details>
      {/if}
    </div>

    <div class="space-y-4">
      <div class="bg-gray-900 rounded-lg p-4">
        <h2 class="text-xs text-gray-400 uppercase mb-2">Extracted Entities</h2>
        {#if data.entities.length === 0}
          <p class="text-sm text-gray-500">No entities extracted.</p>
        {:else}
          {#each data.entities as entity}
            <a
              href="/jkai/intel/entities/{entity.entityId}"
              class="flex items-center gap-2 py-1.5 hover:bg-gray-800 -mx-2 px-2 rounded text-sm"
            >
              <span>{entity.entityTypeIcon}</span>
              <span>{entity.entityName}</span>
              <span class="text-xs text-gray-500">{entity.relevance}</span>
            </a>
          {/each}
        {/if}
      </div>

      {#if data.timelineEvents.length > 0}
        <div class="bg-gray-900 rounded-lg p-4">
          <h2 class="text-xs text-gray-400 uppercase mb-2">Timeline Events</h2>
          {#each data.timelineEvents as event}
            <div class="py-1.5 text-sm">
              <span class="text-amber-400">{event.date}</span>
              <span class="text-gray-400 mx-1">&middot;</span>
              <span>{event.title}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
