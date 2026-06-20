<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';

  let { data } = $props();

  const typeColors: Record<string, string> = {
    deadline: 'var(--error)',
    milestone: 'var(--success)',
    event: 'var(--accent-ink)',
    decision: 'var(--warn)',
  };

  const typeFilters = ['deadline', 'milestone', 'event', 'decision'];

  function groupByMonth(events: typeof data.events) {
    const groups = new Map<string, typeof data.events>();
    for (const event of events) {
      const month = event.date.slice(0, 7);
      if (!groups.has(month)) groups.set(month, []);
      groups.get(month)!.push(event);
    }
    return [...groups.entries()];
  }

  const grouped = $derived(groupByMonth(data.events));
</script>

<PageHeader title="TIMELINE" titleHref="/jkai/intel" />

<div class="p-6 sm:p-10 max-w-4xl mx-auto">
  <div class="flex flex-wrap gap-2 mb-6">
    <a
      href="/jkai/intel/timeline"
      class="px-3 py-1.5 rounded-full text-sm border"
      style="{!data.filters.type ? 'background: var(--accent); color: white; border-color: var(--accent);' : 'background: var(--card-bg); border-color: var(--card-border);'}"
    >All</a>
    {#each typeFilters as t}
      <a
        href="/jkai/intel/timeline?type={t}"
        class="px-3 py-1.5 rounded-full text-sm border"
        style="{data.filters.type === t ? 'background: var(--accent); color: white; border-color: var(--accent);' : 'background: var(--card-bg); border-color: var(--card-border);'}"
      >{t}</a>
    {/each}
  </div>

  {#if data.events.length === 0}
    <div class="text-center py-16" style="color: var(--text-ghost);">
      <p>No timeline events yet. Events are extracted automatically from your notes.</p>
    </div>
  {:else}
    <div class="border-l-2 ml-4" style="border-color: var(--card-border);">
      {#each grouped as [month, events]}
        <div class="mb-8">
          <div class="text-sm font-semibold mb-3 -ml-4 pl-8" style="color: var(--text-secondary);">
            {new Date(month + '-01').toLocaleDateString('en-GB', { year: 'numeric', month: 'long' })}
          </div>
          {#each events as event}
            <div class="relative pl-8 pb-4">
              <div class="absolute left-[-5px] top-1.5 w-2.5 h-2.5 rounded-full" style="background: {typeColors[event.type] ?? 'var(--text-ghost)'};"></div>
              <div class="rounded-[var(--radius-round)] p-3 hover:opacity-80 transition border" style="background: var(--card-bg); border-color: var(--card-border);">
                <div class="flex items-center gap-2 text-xs mb-1" style="color: var(--text-ghost);">
                  <span>{event.date}</span>
                  {#if event.dateEnd}
                    <span>— {event.dateEnd}</span>
                  {/if}
                  <span class="px-1.5 py-0.5 rounded text-xs border bg-transparent" style="border-color: {typeColors[event.type] ?? 'var(--card-border)'}; color: {typeColors[event.type] ?? 'var(--text-muted)'};">{event.type}</span>
                </div>
                <div class="text-sm font-medium">{event.title}</div>
                {#if event.description}
                  <div class="text-xs mt-1" style="color: var(--text-ghost);">{event.description}</div>
                {/if}
                {#if event.entityName}
                  <a href="/jkai/intel/entities/{event.entityId}" class="inline-flex items-center gap-1 text-xs mt-1 hover:underline" style="color: var(--accent);">
                    {event.entityTypeIcon} {event.entityName}
                  </a>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/each}
    </div>
  {/if}
</div>
