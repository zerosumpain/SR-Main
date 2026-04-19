<script lang="ts">
  let { data } = $props();

  const significanceColor: Record<string, string> = {
    high: 'border-red-500',
    medium: 'border-amber-500',
    low: 'border-blue-500',
  };

  const sourceIcon: Record<string, string> = {
    web: '🌐',
    whatsapp: '💬',
    pwa: '📱',
    email: '📧',
  };
</script>

<div class="p-6 max-w-7xl mx-auto">
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-bold">Intelligence Dashboard</h1>
    <a href="/jkai/intel/notes/new" class="px-4 py-2 bg-emerald-600 rounded-lg hover:bg-emerald-500 text-sm font-medium">
      + New Note
    </a>
  </div>

  <!-- Stats Bar -->
  <div class="grid grid-cols-4 gap-4 mb-6">
    <div class="bg-gray-900 rounded-lg p-4 text-center">
      <div class="text-3xl font-bold text-sky-400">{data.stats.noteCount}</div>
      <div class="text-xs text-gray-400 mt-1">Notes</div>
    </div>
    <div class="bg-gray-900 rounded-lg p-4 text-center">
      <div class="text-3xl font-bold text-emerald-400">{data.stats.entityCount}</div>
      <div class="text-xs text-gray-400 mt-1">Entities</div>
    </div>
    <div class="bg-gray-900 rounded-lg p-4 text-center">
      <div class="text-3xl font-bold text-amber-400">{data.stats.riskCount}</div>
      <div class="text-xs text-gray-400 mt-1">Active Risks</div>
    </div>
    <div class="bg-gray-900 rounded-lg p-4 text-center">
      <div class="text-3xl font-bold text-pink-400">{data.stats.pendingReviewCount}</div>
      <div class="text-xs text-gray-400 mt-1">Pending Review</div>
    </div>
  </div>

  <div class="grid grid-cols-2 gap-4">
    <!-- Recent Alerts -->
    <div class="bg-gray-900 rounded-lg p-4">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-semibold text-amber-400">Recent Alerts</h2>
        <a href="/jkai/intel/alerts" class="text-xs text-gray-400 hover:text-gray-300">View all</a>
      </div>
      {#if data.recentAlerts.length === 0}
        <p class="text-sm text-gray-500">No alerts yet. Start adding notes!</p>
      {:else}
        {#each data.recentAlerts as alert}
          <div class="border-l-3 {significanceColor[alert.significance] ?? 'border-gray-600'} pl-3 mb-3">
            <div class="text-sm">{alert.title}</div>
            <div class="text-xs text-gray-400 mt-1">
              {new Date(alert.createdAt).toLocaleDateString()} &middot; {alert.significance}
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <!-- Recent Notes -->
    <div class="bg-gray-900 rounded-lg p-4">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-semibold text-sky-400">Recent Notes</h2>
        <a href="/jkai/intel/notes" class="text-xs text-gray-400 hover:text-gray-300">View all</a>
      </div>
      {#if data.recentNotes.length === 0}
        <p class="text-sm text-gray-500">No notes yet. Add your first note!</p>
      {:else}
        {#each data.recentNotes as note}
          <a href="/jkai/intel/notes/{note.id}" class="block py-2 border-b border-gray-800 last:border-0 hover:bg-gray-800/50 -mx-2 px-2 rounded">
            <div class="flex items-center gap-2">
              <span>{sourceIcon[note.source] ?? '📝'}</span>
              <span class="text-sm">{note.title ?? 'Untitled'}</span>
              {#if note.status === 'processing'}
                <span class="text-xs bg-amber-900/50 text-amber-400 px-2 py-0.5 rounded">processing</span>
              {:else if note.status === 'failed'}
                <span class="text-xs bg-red-900/50 text-red-400 px-2 py-0.5 rounded">failed</span>
              {/if}
            </div>
            <div class="text-xs text-gray-400 mt-1">
              {note.source} &middot; {new Date(note.createdAt).toLocaleDateString()} &middot; {note.entityCount} entities
            </div>
          </a>
        {/each}
      {/if}
    </div>

    <!-- Upcoming Timeline -->
    <div class="bg-gray-900 rounded-lg p-4">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-semibold text-pink-400">Upcoming</h2>
        <a href="/jkai/intel/timeline" class="text-xs text-gray-400 hover:text-gray-300">View all</a>
      </div>
      {#if data.upcomingTimeline.length === 0}
        <p class="text-sm text-gray-500">No upcoming events.</p>
      {:else}
        {#each data.upcomingTimeline as event}
          <div class="py-2 text-sm">
            <span class="text-amber-400">{event.date}</span> — {event.title}
          </div>
        {/each}
      {/if}
    </div>

    <!-- Entity Types -->
    <div class="bg-gray-900 rounded-lg p-4">
      <h2 class="text-sm font-semibold text-emerald-400 mb-3">Entity Types</h2>
      <div class="flex flex-wrap gap-2">
        {#each data.entityTypes as type}
          <a href="/jkai/intel/entities?typeId={type.id}" class="bg-gray-800 px-3 py-1.5 rounded-full text-sm hover:bg-gray-700">
            {type.icon} {type.name}
          </a>
        {/each}
      </div>
    </div>
  </div>
</div>
