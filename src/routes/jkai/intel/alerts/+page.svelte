<script lang="ts">
  let { data } = $props();

  let alerts = $state(data.alerts);

  const significanceColors: Record<string, { border: string; bg: string; text: string }> = {
    high: { border: 'border-red-500', bg: 'bg-red-900/20', text: 'text-red-400' },
    medium: { border: 'border-amber-500', bg: 'bg-amber-900/20', text: 'text-amber-400' },
    low: { border: 'border-blue-500', bg: 'bg-blue-900/20', text: 'text-blue-400' },
  };

  const typeIcons: Record<string, string> = {
    connection: '🔗',
    risk_change: '⚠️',
    contradiction: '❌',
    pattern: '🔄',
  };

  async function dismiss(id: string) {
    const res = await fetch(`/api/jkai/intel/alerts/${id}`, { method: 'PUT' });
    if (res.ok) {
      alerts = alerts.filter((a) => a.id !== id);
    }
  }
</script>

<div class="p-6 max-w-4xl mx-auto">
  <a href="/jkai/intel" class="text-sm text-gray-400 hover:text-gray-300">&larr; Dashboard</a>
  <h1 class="text-2xl font-bold mt-2 mb-6">Alerts</h1>

  <div class="flex flex-wrap gap-2 mb-6">
    <a href="/jkai/intel/alerts" class="px-3 py-1.5 rounded-full text-sm {!data.filters.significance ? 'bg-sky-600' : 'bg-gray-800 hover:bg-gray-700'}">All</a>
    <a href="/jkai/intel/alerts?significance=high" class="px-3 py-1.5 rounded-full text-sm {data.filters.significance === 'high' ? 'bg-red-600' : 'bg-gray-800 hover:bg-gray-700'}">High</a>
    <a href="/jkai/intel/alerts?significance=medium" class="px-3 py-1.5 rounded-full text-sm {data.filters.significance === 'medium' ? 'bg-amber-600' : 'bg-gray-800 hover:bg-gray-700'}">Medium</a>
    <a href="/jkai/intel/alerts?significance=low" class="px-3 py-1.5 rounded-full text-sm {data.filters.significance === 'low' ? 'bg-blue-600' : 'bg-gray-800 hover:bg-gray-700'}">Low</a>
  </div>

  {#if alerts.length === 0}
    <div class="text-center py-16 text-gray-500">
      <p>No alerts. Alerts are generated when new notes surface connections to existing knowledge.</p>
    </div>
  {:else}
    <div class="space-y-3">
      {#each alerts as alert}
        {@const colors = significanceColors[alert.significance] ?? significanceColors.medium}
        <div class="border-l-3 {colors.border} {colors.bg} rounded-lg p-4">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-2 mb-1">
              <span>{typeIcons[alert.type] ?? '🔔'}</span>
              <span class="font-medium text-sm">{alert.title}</span>
              <span class="text-xs {colors.text} px-1.5 py-0.5 rounded bg-gray-900/50">{alert.significance}</span>
            </div>
            <button onclick={() => dismiss(alert.id)} class="text-xs text-gray-500 hover:text-gray-300 px-2 py-1" title="Dismiss">dismiss</button>
          </div>
          <p class="text-sm text-gray-300 mt-1">{alert.content}</p>
          <div class="text-xs text-gray-500 mt-2">
            {new Date(alert.createdAt).toLocaleString()}
            {#if alert.delivered}
              <span class="ml-2 text-emerald-500">sent to WhatsApp</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
