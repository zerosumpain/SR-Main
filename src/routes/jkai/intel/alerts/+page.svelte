<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';

  let { data } = $props();

  let alerts = $state(data.alerts);

  const significanceColors: Record<string, { bg: string; text: string }> = {
    high: { bg: 'background: var(--error-bg);', text: 'color: var(--error);' },
    medium: { bg: 'background: var(--warn-bg);', text: 'color: var(--warn);' },
    low: { bg: 'background: var(--accent-ink-tint-06);', text: 'color: var(--accent-ink);' },
  };

  async function dismiss(id: string) {
    const res = await fetch(`/api/jkai/intel/alerts/${id}`, { method: 'PUT' });
    if (res.ok) {
      alerts = alerts.filter((a) => a.id !== id);
    }
  }
</script>

{#snippet typeIcon(type: string)}
  {#if type === 'connection'}
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M8 12l4-4M7 7l-1.5 1.5a3.5 3.5 0 005 5L12 12M13 13l1.5-1.5a3.5 3.5 0 00-5-5L8 8"/></svg>
  {:else if type === 'risk_change'}
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3L2 17h16L10 3z"/><line x1="10" y1="8" x2="10" y2="12"/><circle cx="10" cy="14.5" r="0.5" fill="currentColor"/></svg>
  {:else if type === 'contradiction'}
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="10" cy="10" r="7"/><line x1="7" y1="7" x2="13" y2="13"/><line x1="13" y1="7" x2="7" y2="13"/></svg>
  {:else if type === 'pattern'}
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8a6 6 0 0110-2.5L17 8"/><path d="M16 12a6 6 0 01-10 2.5L3 12"/><path d="M17 5v3h-3M3 15v-3h3"/></svg>
  {:else}
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3a4 4 0 014 4c0 4 2 5 2 5H4s2-1 2-5a4 4 0 014-4z"/><path d="M8.5 16a1.5 1.5 0 003 0"/></svg>
  {/if}
{/snippet}

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
      style="{data.filters.significance === 'high' ? 'background: var(--error); color: white; border-color: var(--error);' : 'background: var(--card-bg); border-color: var(--card-border);'}"
    >High</a>
    <a
      href="/jkai/intel/alerts?significance=medium"
      class="px-3 py-1.5 rounded-full text-sm border"
      style="{data.filters.significance === 'medium' ? 'background: var(--warn); color: white; border-color: var(--warn);' : 'background: var(--card-bg); border-color: var(--card-border);'}"
    >Medium</a>
    <a
      href="/jkai/intel/alerts?significance=low"
      class="px-3 py-1.5 rounded-full text-sm border"
      style="{data.filters.significance === 'low' ? 'background: var(--accent-ink); color: white; border-color: var(--accent-ink);' : 'background: var(--card-bg); border-color: var(--card-border);'}"
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
        <div class="rounded p-4 border" style="{colors.bg} border-color: var(--card-border);">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-2 mb-1">
              <span class="inline-flex" style="{colors.text}">{@render typeIcon(alert.type)}</span>
              <span class="font-medium text-sm">{alert.title}</span>
              <span class="text-xs px-1.5 py-0.5 rounded border" style="{colors.text} background: var(--card-bg); border-color: var(--card-border);">{alert.significance}</span>
            </div>
            <button onclick={() => dismiss(alert.id)} class="text-xs px-2 py-1 hover:opacity-80" style="color: var(--text-ghost);" title="Dismiss">dismiss</button>
          </div>
          <p class="text-sm mt-1" style="color: var(--text-secondary);">{alert.content}</p>
          <div class="text-xs mt-2" style="color: var(--text-ghost);">
            {new Date(alert.createdAt).toLocaleString()}
            {#if alert.delivered}
              <span class="ml-2" style="color: var(--success);">sent to WhatsApp</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
