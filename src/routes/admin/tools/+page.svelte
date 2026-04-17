<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { getContext } from 'svelte';

  let { data } = $props();
  const adminToken = getContext<string>('adminToken');

  let expanded = $state<Set<string>>(new Set());
  let deleting = $state<string | null>(null);

  function toggle(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expanded = next;
  }

  function relativeTime(iso: string | Date | null): string {
    if (!iso) return 'never';
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60000) return 'just now';
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
    if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
    return `${Math.floor(ms / 86400000)}d ago`;
  }

  async function deleteTool(name: string) {
    if (!confirm(`Delete tool "${name}"? This cannot be undone.`)) return;
    deleting = name;
    try {
      const res = await fetch(`/api/admin/tools/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(`Delete failed: ${body.error || res.statusText}`);
        return;
      }
      await invalidateAll();
    } catch (err) {
      alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      deleting = null;
    }
  }

  async function toggleEnabled(name: string, nextEnabled: boolean) {
    try {
      const res = await fetch(`/api/admin/tools/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(`Update failed: ${body.error || res.statusText}`);
        return;
      }
      await invalidateAll();
    } catch (err) {
      alert(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
</script>

<svelte:head>
  <title>Admin — Custom Tools</title>
</svelte:head>

<div class="max-w-4xl mx-auto px-4 py-8">
  <a
    href="/admin?token={adminToken}"
    class="inline-block text-[10px] uppercase tracking-[0.3em] mb-4"
    style="color: var(--text-ghost); font-family: var(--font-mono);"
  >
    &larr; Admin
  </a>
  <header class="mb-6">
    <h1 class="text-2xl font-semibold mb-1" style="color: var(--text-primary);">Custom Tools</h1>
    <p class="text-sm" style="color: var(--text-ghost);">
      Tools the assistant has created for itself. Built-in tools are not shown.
    </p>
  </header>

  {#if data.tools.length === 0}
    <div class="text-center py-12" style="color: var(--text-ghost);">
      No custom tools yet.
    </div>
  {:else}
    <div class="space-y-2">
      {#each data.tools as tool (tool.id)}
        <div
          class="rounded-lg border transition-colors"
          style="border-color: var(--card-border); background: color-mix(in srgb, var(--card-border) 15%, transparent);"
        >
          <!-- Header row -->
          <div class="flex items-center gap-3 px-4 py-3">
            <button
              class="flex-1 text-left"
              onclick={() => toggle(tool.id)}
            >
              <div class="flex items-baseline gap-2 mb-0.5">
                <span class="text-[9px] opacity-60">{expanded.has(tool.id) ? '▾' : '▸'}</span>
                <span class="text-sm font-mono font-medium" style="color: var(--text-primary);">
                  {tool.name}
                </span>
                <span
                  class="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider"
                  style="background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent);"
                >
                  {tool.toolset}
                </span>
                {#if !tool.enabled}
                  <span class="text-[10px] px-1.5 py-0.5 rounded" style="background: rgba(239,68,68,0.15); color: #ef4444;">
                    disabled
                  </span>
                {/if}
              </div>
              <p class="text-xs line-clamp-2" style="color: var(--text-secondary);">
                {tool.description}
              </p>
            </button>

            <!-- Stats column -->
            <div class="text-right text-[11px] shrink-0" style="color: var(--text-ghost);">
              <div><span style="color: var(--text-primary); font-weight: 500;">{tool.runCount}</span> runs</div>
              {#if tool.errorCount > 0}
                <div style="color: #ef4444;">{tool.errorCount} errors</div>
              {/if}
              <div class="text-[10px]">last: {relativeTime(tool.lastRunAt)}</div>
            </div>

            <!-- Actions -->
            <div class="flex items-center gap-1 shrink-0">
              <button
                onclick={() => toggleEnabled(tool.name, !tool.enabled)}
                class="text-[10px] px-2 py-1 rounded border transition-colors"
                style="border-color: var(--card-border); color: var(--text-secondary);"
                title={tool.enabled ? 'Disable tool' : 'Enable tool'}
              >
                {tool.enabled ? 'Disable' : 'Enable'}
              </button>
              <button
                onclick={() => deleteTool(tool.name)}
                disabled={deleting === tool.name}
                class="text-[10px] px-2 py-1 rounded border transition-colors"
                style="border-color: rgba(239,68,68,0.3); color: #ef4444;"
                title="Delete tool permanently"
              >
                {deleting === tool.name ? '...' : 'Delete'}
              </button>
            </div>
          </div>

          <!-- Expanded detail -->
          {#if expanded.has(tool.id)}
            <div class="px-4 pb-3 pt-2 space-y-3 border-t" style="border-color: var(--card-border);">
              <div>
                <div class="text-[9px] uppercase tracking-wider mb-1" style="color: var(--text-ghost);">
                  Parameters (JSON Schema)
                </div>
                <pre class="text-[10px] rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap" style="background: rgba(0,0,0,0.05); font-family: var(--font-mono); color: var(--text-primary);">{JSON.stringify(tool.parameters, null, 2)}</pre>
              </div>
              <div>
                <div class="text-[9px] uppercase tracking-wider mb-1" style="color: var(--text-ghost);">
                  Handler code
                </div>
                <pre class="text-[10px] rounded px-2 py-1.5 overflow-x-auto max-h-64 whitespace-pre-wrap" style="background: rgba(0,0,0,0.05); font-family: var(--font-mono); color: var(--text-primary);">{tool.handlerCode}</pre>
              </div>
              <div class="flex gap-4 text-[10px]" style="color: var(--text-ghost);">
                <span>Created: {new Date(tool.createdAt ?? '').toLocaleString()}</span>
                {#if tool.lastRunAt}
                  <span>Last run: {new Date(tool.lastRunAt).toLocaleString()}</span>
                {/if}
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
