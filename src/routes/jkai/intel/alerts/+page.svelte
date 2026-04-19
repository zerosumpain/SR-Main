<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';

  let { data } = $props();

  let alerts = $state(data.alerts);

  const significanceColors: Record<string, { border: string; bg: string; text: string }> = {
    high: { border: 'border-red-500', bg: 'background: rgba(239,68,68,0.08);', text: 'color: #b91c1c;' },
    medium: { border: 'border-amber-500', bg: 'background: rgba(245,158,11,0.08);', text: 'color: #92400e;' },
    low: { border: 'border-blue-500', bg: 'background: rgba(59,130,246,0.08);', text: 'color: #1d4ed8;' },
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

<PageHeader title="ALERTS" titleHref="/jkai/intel" />

<div class="p-6 sm:p-10 max-w-4xl mx-auto">
  <div class="flex flex-wrap gap-2 mb-6">
    <a
      href="/jkai/intel/alerts"
      class="px-3 py-1.5 rounded-full text-sm border"
      style="{!data.filters.significance ? 'background: var(--accent); color: white; border-color: var(--accent);' : 'background: var(--card-bg); border-color: var(--card-border);'}"
    >All</a>
    <a
      href="/jkai/intel/alerts?significance=high"
      class="px-3 py-1.5 rounded-full text-sm border"
      style="{data.filters.significance === 'high' ? 'background: #dc2626; color: white; border-color: #dc2626;' : 'background: var(--card-bg); border-color: var(--card-border);'}"
    >High</a>
    <a
      href="/jkai/intel/alerts?significance=medium"
      class="px-3 py-1.5 rounded-full text-sm border"
      style="{data.filters.significance === 'medium' ? 'background: #d97706; color: white; border-color: #d97706;' : 'background: var(--card-bg); border-color: var(--card-border);'}"
    >Medium</a>
    <a
      href="/jkai/intel/alerts?significance=low"
      class="px-3 py-1.5 rounded-full text-sm border"
      style="{data.filters.significance === 'low' ? 'background: #2563eb; color: white; border-color: #2563eb;' : 'background: var(--card-bg); border-color: var(--card-border);'}"
    >Low</a>
  </div>

  {#if alerts.length === 0}
    <div class="text-center py-16" style="color: var(--text-ghost);">
      <p>No alerts. Alerts are generated when new notes surface connections to existing knowledge.</p>
    </div>
  {:else}
    <div class="space-y-3">
      {#each alerts as alert}
        {@const colors = significanceColors[alert.significance] ?? significanceColors.medium}
        <div class="border-l-3 {colors.border} rounded-lg p-4 border" style="{colors.bg} border-color: var(--card-border);">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-2 mb-1">
              <span>{typeIcons[alert.type] ?? '🔔'}</span>
              <span class="font-medium text-sm">{alert.title}</span>
              <span class="text-xs px-1.5 py-0.5 rounded border" style="{colors.text} background: var(--card-bg); border-color: var(--card-border);">{alert.significance}</span>
            </div>
            <button onclick={() => dismiss(alert.id)} class="text-xs px-2 py-1 hover:opacity-80" style="color: var(--text-ghost);" title="Dismiss">dismiss</button>
          </div>
          <p class="text-sm mt-1" style="color: var(--text-secondary);">{alert.content}</p>
          <div class="text-xs mt-2" style="color: var(--text-ghost);">
            {new Date(alert.createdAt).toLocaleString()}
            {#if alert.delivered}
              <span class="ml-2 text-emerald-600">sent to WhatsApp</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
