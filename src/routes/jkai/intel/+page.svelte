<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';

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

  const riskType = $derived(data.entityTypes.find((t) => t.name === 'risk'));
  const risksHref = $derived(riskType ? `/jkai/intel/entities?typeId=${riskType.id}` : '/jkai/intel/entities');
</script>

<PageHeader title="INTEL" />

<div class="p-6 sm:p-10 max-w-7xl mx-auto">
  <div class="flex items-center justify-between mb-6">
    <div class="flex items-center gap-3">
      <a href="/jkai/intel/search" class="px-4 py-2 rounded-lg text-sm border" style="background: var(--card-bg); border-color: var(--card-border);">
        Search
      </a>
      <a href="/jkai/intel/notes/new" class="px-4 py-2 rounded-lg text-sm font-medium" style="background: var(--accent); color: white;">
        + New Note
      </a>
    </div>
  </div>

  <!-- Stats Bar -->
  <div class="grid grid-cols-4 gap-4 mb-6">
    <a href="/jkai/intel/notes" class="rounded-lg p-4 text-center border block hover:opacity-80 transition" style="background: var(--card-bg); border-color: var(--card-border);">
      <div class="text-3xl font-bold text-sky-500">{data.stats.noteCount}</div>
      <div class="text-xs mt-1" style="color: var(--text-ghost);">Notes</div>
    </a>
    <a href="/jkai/intel/entities" class="rounded-lg p-4 text-center border block hover:opacity-80 transition" style="background: var(--card-bg); border-color: var(--card-border);">
      <div class="text-3xl font-bold text-emerald-600">{data.stats.entityCount}</div>
      <div class="text-xs mt-1" style="color: var(--text-ghost);">Entities</div>
    </a>
    <a href={risksHref} class="rounded-lg p-4 text-center border block hover:opacity-80 transition" style="background: var(--card-bg); border-color: var(--card-border);">
      <div class="text-3xl font-bold text-amber-600">{data.stats.riskCount}</div>
      <div class="text-xs mt-1" style="color: var(--text-ghost);">Active Risks</div>
    </a>
    <a href="/jkai/intel/review" class="rounded-lg p-4 text-center border block hover:opacity-80 transition" style="background: var(--card-bg); border-color: var(--card-border);">
      <div class="text-3xl font-bold" style="color: var(--accent);">{data.stats.pendingReviewCount}</div>
      <div class="text-xs mt-1" style="color: var(--text-ghost);">Pending Review</div>
    </a>
  </div>

  <div class="grid grid-cols-2 gap-4">
    <!-- Recent Alerts -->
    <div class="rounded-lg p-4 border" style="background: var(--card-bg); border-color: var(--card-border);">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-semibold text-amber-600">Recent Alerts</h2>
        <a href="/jkai/intel/alerts" class="text-xs" style="color: var(--text-ghost);">View all</a>
      </div>
      {#if data.recentAlerts.length === 0}
        <p class="text-sm" style="color: var(--text-ghost);">No alerts yet. Start adding notes!</p>
      {:else}
        {#each data.recentAlerts as alert}
          <div class="border-l-3 {significanceColor[alert.significance] ?? 'border-gray-400'} pl-3 mb-3">
            <div class="text-sm">{alert.title}</div>
            <div class="text-xs mt-1" style="color: var(--text-ghost);">
              {new Date(alert.createdAt).toLocaleDateString()} &middot; {alert.significance}
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <!-- Recent Notes -->
    <div class="rounded-lg p-4 border" style="background: var(--card-bg); border-color: var(--card-border);">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-semibold text-sky-600">Recent Notes</h2>
        <a href="/jkai/intel/notes" class="text-xs" style="color: var(--text-ghost);">View all</a>
      </div>
      {#if data.recentNotes.length === 0}
        <p class="text-sm" style="color: var(--text-ghost);">No notes yet. Add your first note!</p>
      {:else}
        {#each data.recentNotes as note}
          <a href="/jkai/intel/notes/{note.id}" class="block py-2 border-b last:border-0 -mx-2 px-2 rounded hover:opacity-80 transition" style="border-color: var(--card-border);">
            <div class="flex items-center gap-2">
              <span>{sourceIcon[note.source] ?? '📝'}</span>
              <span class="text-sm">{note.title ?? 'Untitled'}</span>
              {#if note.status === 'processing'}
                <span class="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">processing</span>
              {:else if note.status === 'failed'}
                <span class="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">failed</span>
              {/if}
            </div>
            <div class="text-xs mt-1" style="color: var(--text-ghost);">
              {note.source} &middot; {new Date(note.createdAt).toLocaleDateString()} &middot; {note.entityCount} entities
            </div>
          </a>
        {/each}
      {/if}
    </div>

    <!-- Upcoming Timeline -->
    <div class="rounded-lg p-4 border" style="background: var(--card-bg); border-color: var(--card-border);">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-semibold" style="color: var(--accent);">Upcoming</h2>
        <a href="/jkai/intel/timeline" class="text-xs" style="color: var(--text-ghost);">View all</a>
      </div>
      {#if data.upcomingTimeline.length === 0}
        <p class="text-sm" style="color: var(--text-ghost);">No upcoming events.</p>
      {:else}
        {#each data.upcomingTimeline as event}
          <div class="py-2 text-sm">
            <span class="text-amber-600">{event.date}</span> — {event.title}
          </div>
        {/each}
      {/if}
    </div>

    <!-- Entity Types -->
    <div class="rounded-lg p-4 border" style="background: var(--card-bg); border-color: var(--card-border);">
      <h2 class="text-sm font-semibold text-emerald-600 mb-3">Entity Types</h2>
      <div class="flex flex-wrap gap-2">
        {#each data.entityTypes as type}
          <a href="/jkai/intel/entities?typeId={type.id}" class="px-3 py-1.5 rounded-full text-sm border hover:opacity-80 transition" style="background: var(--bg-section); border-color: var(--card-border);">
            {type.icon} {type.name}
          </a>
        {/each}
      </div>
    </div>
  </div>
</div>
