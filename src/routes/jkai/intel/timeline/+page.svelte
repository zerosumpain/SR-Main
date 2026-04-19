<script lang="ts">
  let { data } = $props();

  const typeColors: Record<string, string> = {
    deadline: 'border-red-500 bg-red-500',
    milestone: 'border-emerald-500 bg-emerald-500',
    event: 'border-sky-500 bg-sky-500',
    decision: 'border-amber-500 bg-amber-500',
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

<div class="p-6 max-w-4xl mx-auto">
  <a href="/jkai/intel" class="text-sm text-gray-400 hover:text-gray-300">&larr; Dashboard</a>
  <h1 class="text-2xl font-bold mt-2 mb-6">Timeline</h1>

  <div class="flex flex-wrap gap-2 mb-6">
    <a href="/jkai/intel/timeline" class="px-3 py-1.5 rounded-full text-sm {!data.filters.type ? 'bg-sky-600' : 'bg-gray-800 hover:bg-gray-700'}">All</a>
    {#each typeFilters as t}
      <a href="/jkai/intel/timeline?type={t}" class="px-3 py-1.5 rounded-full text-sm {data.filters.type === t ? 'bg-sky-600' : 'bg-gray-800 hover:bg-gray-700'}">{t}</a>
    {/each}
  </div>

  {#if data.events.length === 0}
    <div class="text-center py-16 text-gray-500">
      <p>No timeline events yet. Events are extracted automatically from your notes.</p>
    </div>
  {:else}
    <div class="border-l-2 border-gray-700 ml-4">
      {#each grouped as [month, events]}
        <div class="mb-8">
          <div class="text-sm font-semibold text-gray-400 mb-3 -ml-4 pl-8">
            {new Date(month + '-01').toLocaleDateString('en-GB', { year: 'numeric', month: 'long' })}
          </div>
          {#each events as event}
            <div class="relative pl-8 pb-4">
              <div class="absolute left-[-5px] top-1.5 w-2.5 h-2.5 rounded-full {typeColors[event.type] ?? 'bg-gray-500'}"></div>
              <div class="bg-gray-900 rounded-lg p-3 hover:bg-gray-800/80 transition">
                <div class="flex items-center gap-2 text-xs text-gray-400 mb-1">
                  <span>{event.date}</span>
                  {#if event.dateEnd}
                    <span>— {event.dateEnd}</span>
                  {/if}
                  <span class="px-1.5 py-0.5 rounded text-xs {typeColors[event.type]?.split(' ')[0] ?? ''} border bg-transparent">{event.type}</span>
                </div>
                <div class="text-sm font-medium">{event.title}</div>
                {#if event.description}
                  <div class="text-xs text-gray-400 mt-1">{event.description}</div>
                {/if}
                {#if event.entityName}
                  <a href="/jkai/intel/entities/{event.entityId}" class="inline-flex items-center gap-1 text-xs text-sky-400 mt-1 hover:underline">
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
