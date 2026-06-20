<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';

  let { data } = $props();

  const significanceColor: Record<string, string> = {
    high: 'var(--error)',
    medium: 'var(--warn)',
    low: 'var(--accent-ink)',
  };

  const riskType = $derived(data.entityTypes.find((t) => t.name === 'risk'));
  const risksHref = $derived(riskType ? `/jkai/intel/entities?typeId=${riskType.id}` : '/jkai/intel/entities');
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

<PageHeader title="INTEL" />

<div class="p-6 sm:p-10 max-w-7xl mx-auto">
  <div class="flex items-center justify-between mb-6">
    <div class="flex items-center gap-3">
      <a href="/jkai/intel/search" class="px-4 py-2 rounded-[var(--radius-round)] text-sm border" style="background: var(--card-bg); border-color: var(--card-border);">
        Search
      </a>
      <a href="/jkai/intel/notes/new" class="px-4 py-2 rounded-[var(--radius-round)] text-sm font-medium" style="background: var(--accent); color: white;">
        + New Note
      </a>
    </div>
  </div>

  <!-- Stats Bar -->
  <div class="grid grid-cols-4 gap-4 mb-6">
    <a href="/jkai/intel/notes" class="rounded-[var(--radius-round)] p-4 text-center border block hover:opacity-80 transition" style="background: var(--card-bg); border-color: var(--card-border);">
      <div class="text-3xl font-bold" style="color: var(--accent-ink);">{data.stats.noteCount}</div>
      <div class="text-xs mt-1" style="color: var(--text-ghost);">Notes</div>
    </a>
    <a href="/jkai/intel/entities" class="rounded-[var(--radius-round)] p-4 text-center border block hover:opacity-80 transition" style="background: var(--card-bg); border-color: var(--card-border);">
      <div class="text-3xl font-bold" style="color: var(--success);">{data.stats.entityCount}</div>
      <div class="text-xs mt-1" style="color: var(--text-ghost);">Entities</div>
    </a>
    <a href={risksHref} class="rounded-[var(--radius-round)] p-4 text-center border block hover:opacity-80 transition" style="background: var(--card-bg); border-color: var(--card-border);">
      <div class="text-3xl font-bold" style="color: var(--warn);">{data.stats.riskCount}</div>
      <div class="text-xs mt-1" style="color: var(--text-ghost);">Active Risks</div>
    </a>
    <a href="/jkai/intel/review" class="rounded-[var(--radius-round)] p-4 text-center border block hover:opacity-80 transition" style="background: var(--card-bg); border-color: var(--card-border);">
      <div class="text-3xl font-bold" style="color: var(--accent);">{data.stats.pendingReviewCount}</div>
      <div class="text-xs mt-1" style="color: var(--text-ghost);">Pending Review</div>
    </a>
  </div>

  <div class="grid grid-cols-2 gap-4">
    <!-- Recent Alerts -->
    <div class="rounded-[var(--radius-round)] p-4 border" style="background: var(--card-bg); border-color: var(--card-border);">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-semibold" style="color: var(--warn);">Recent Alerts</h2>
        <a href="/jkai/intel/alerts" class="text-xs" style="color: var(--text-ghost);">View all</a>
      </div>
      {#if data.recentAlerts.length === 0}
        <p class="text-sm" style="color: var(--text-ghost);">No alerts yet. Start adding notes!</p>
      {:else}
        {#each data.recentAlerts as alert}
          <div class="pl-3 mb-3" style="border-left: 3px solid {significanceColor[alert.significance] ?? 'var(--divider)'};">
            <div class="text-sm">{alert.title}</div>
            <div class="text-xs mt-1" style="color: var(--text-ghost);">
              {new Date(alert.createdAt).toLocaleDateString()} &middot; {alert.significance}
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <!-- Recent Notes -->
    <div class="rounded-[var(--radius-round)] p-4 border" style="background: var(--card-bg); border-color: var(--card-border);">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-semibold" style="color: var(--accent-ink);">Recent Notes</h2>
        <a href="/jkai/intel/notes" class="text-xs" style="color: var(--text-ghost);">View all</a>
      </div>
      {#if data.recentNotes.length === 0}
        <p class="text-sm" style="color: var(--text-ghost);">No notes yet. Add your first note!</p>
      {:else}
        {#each data.recentNotes as note}
          <a href="/jkai/intel/notes/{note.id}" class="block py-2 border-b last:border-0 -mx-2 px-2 rounded hover:opacity-80 transition" style="border-color: var(--card-border);">
            <div class="flex items-center gap-2">
              <span class="inline-flex" style="color: var(--text-muted);">{@render sourceIcon(note.source)}</span>
              <span class="text-sm">{note.title ?? 'Untitled'}</span>
              {#if note.status === 'processing'}
                <span class="text-xs px-2 py-0.5 rounded" style="background: var(--warn-bg); color: var(--warn);">processing</span>
              {:else if note.status === 'failed'}
                <span class="text-xs px-2 py-0.5 rounded" style="background: var(--error-bg); color: var(--error);">failed</span>
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
    <div class="rounded-[var(--radius-round)] p-4 border" style="background: var(--card-bg); border-color: var(--card-border);">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-semibold" style="color: var(--accent);">Upcoming</h2>
        <a href="/jkai/intel/timeline" class="text-xs" style="color: var(--text-ghost);">View all</a>
      </div>
      {#if data.upcomingTimeline.length === 0}
        <p class="text-sm" style="color: var(--text-ghost);">No upcoming events.</p>
      {:else}
        {#each data.upcomingTimeline as event}
          <div class="py-2 text-sm">
            <span style="color: var(--warn);">{event.date}</span> — {event.title}
          </div>
        {/each}
      {/if}
    </div>

    <!-- Entity Types -->
    <div class="rounded-[var(--radius-round)] p-4 border" style="background: var(--card-bg); border-color: var(--card-border);">
      <h2 class="text-sm font-semibold mb-3" style="color: var(--success);">Entity Types</h2>
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
