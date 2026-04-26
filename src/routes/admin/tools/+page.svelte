<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { getContext } from 'svelte';

  let { data } = $props();
  const adminToken = getContext<string>('adminToken');

  type Tab = 'primitives' | 'site' | 'custom';
  let tab = $state<Tab>('primitives');

  let expanded = $state<Set<string>>(new Set());
  let deleting = $state<string | null>(null);
  let filter = $state('');

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

  const primitiveCount = $derived(data.primitives.length);
  const siteToolCount = $derived(data.toolsets.reduce((n, ts) => n + ts.tools.length, 0));
  const customCount = $derived(data.tools.length);

  const filteredPrimitives = $derived(
    filter.trim()
      ? data.primitives.filter((p) => {
          const q = filter.toLowerCase();
          return (
            p.type.toLowerCase().includes(q) ||
            p.label.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            p.category.toLowerCase().includes(q)
          );
        })
      : data.primitives,
  );

  const filteredToolsets = $derived(
    filter.trim()
      ? data.toolsets
          .map((ts) => ({
            ...ts,
            tools: ts.tools.filter((t) => {
              const q = filter.toLowerCase();
              return (
                t.name.toLowerCase().includes(q) ||
                t.description.toLowerCase().includes(q) ||
                ts.toolset.toLowerCase().includes(q)
              );
            }),
          }))
          .filter((ts) => ts.tools.length > 0)
      : data.toolsets,
  );

  const filteredCustom = $derived(
    filter.trim()
      ? data.tools.filter((t) => {
          const q = filter.toLowerCase();
          return (
            t.name.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q) ||
            t.toolset.toLowerCase().includes(q)
          );
        })
      : data.tools,
  );
</script>

<svelte:head><title>Admin — Tools</title></svelte:head>

<div class="max-w-5xl mx-auto px-4 py-8">
  <a href="/admin?token={adminToken}" class="back-link back-link--xs mb-4">Admin</a>
  <header class="mb-6">
    <h1 class="text-2xl font-semibold mb-1" style="color: var(--text-primary);">Tools</h1>
    <p class="text-sm" style="color: var(--text-ghost);">
      Everything the orchestrator and the workflow engine can reach for. Primitives drop on the canvas; site tools are LLM-callable functions; custom tools are LLM-authored.
    </p>
  </header>

  <div class="flex items-center gap-1 mb-4 border-b" style="border-color: var(--card-border);">
    <button
      class="tab"
      class:active={tab === 'primitives'}
      onclick={() => (tab = 'primitives')}
    >Primitives <span class="count">{primitiveCount}</span></button>
    <button
      class="tab"
      class:active={tab === 'site'}
      onclick={() => (tab = 'site')}
    >Site tools <span class="count">{siteToolCount}</span></button>
    <button
      class="tab"
      class:active={tab === 'custom'}
      onclick={() => (tab = 'custom')}
    >Custom <span class="count">{customCount}</span></button>
  </div>

  <input
    type="text"
    bind:value={filter}
    placeholder="Filter by name, description, category…"
    class="w-full text-xs px-3 py-2 rounded mb-4 border"
    style="background: rgba(0,0,0,0.04); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
  />

  {#if tab === 'primitives'}
    <section>
      <p class="text-[11px] mb-2" style="color: var(--text-ghost);">
        Workflow node primitives — the building blocks the orchestrator picks from when generating a canvas. Hidden legacy nodes (multi-mode versions superseded by per-operation splits) are excluded; the orchestrator only sees what's listed here.
      </p>

      {#if filteredPrimitives.length === 0}
        <div class="text-center py-12 text-xs" style="color: var(--text-ghost);">No primitives match.</div>
      {:else}
        <div class="space-y-1">
          {#each filteredPrimitives as p (p.type)}
            <div
              class="rounded border"
              style="border-color: var(--card-border); background: color-mix(in srgb, var(--card-border) 12%, transparent);"
            >
              <button
                class="w-full text-left px-3 py-2 flex items-baseline gap-2"
                onclick={() => toggle(`prim:${p.type}`)}
              >
                <span class="text-[9px] opacity-60 w-3">{expanded.has(`prim:${p.type}`) ? '▾' : '▸'}</span>
                <span class="text-sm font-mono" style="color: var(--text-primary);">{p.type}</span>
                <span
                  class="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider"
                  style="background: color-mix(in srgb, #6e8cff 18%, transparent); color: #6e8cff;"
                >primitive</span>
                <span
                  class="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider opacity-70"
                  style="background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent);"
                >{p.category}</span>
                <span class="text-xs flex-1 truncate" style="color: var(--text-secondary);">{p.label} — {p.description}</span>
              </button>

              {#if expanded.has(`prim:${p.type}`)}
                <div class="px-3 pb-3 pt-1 space-y-2 border-t text-[11px]" style="border-color: var(--card-border); color: var(--text-secondary);">
                  {#if p.llmDescription}
                    <div>
                      <span class="text-[9px] uppercase tracking-wider" style="color: var(--text-ghost);">Orchestrator guidance</span>
                      <div class="mt-0.5">{p.llmDescription}</div>
                    </div>
                  {/if}
                  <div class="grid grid-cols-2 gap-3">
                    <div>
                      <span class="text-[9px] uppercase tracking-wider" style="color: var(--text-ghost);">Inputs</span>
                      <div class="mt-0.5 font-mono text-[10px]">
                        {#if p.inputs.length === 0}none{:else}{p.inputs.map((i) => `${i.name}:${i.type}`).join(', ')}{/if}
                      </div>
                    </div>
                    <div>
                      <span class="text-[9px] uppercase tracking-wider" style="color: var(--text-ghost);">Outputs</span>
                      <div class="mt-0.5 font-mono text-[10px]">
                        {#if p.outputs.length === 0}none{:else}{p.outputs.map((o) => `${o.name}:${o.type}`).join(', ')}{/if}
                      </div>
                    </div>
                  </div>
                  <div>
                    <span class="text-[9px] uppercase tracking-wider" style="color: var(--text-ghost);">Config schema</span>
                    <pre class="text-[10px] rounded px-2 py-1.5 mt-0.5 overflow-x-auto whitespace-pre-wrap" style="background: rgba(0,0,0,0.05); font-family: var(--font-mono); color: var(--text-primary);">{JSON.stringify(p.configSchema, null, 2)}</pre>
                  </div>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {/if}

  {#if tab === 'site'}
    <section>
      <p class="text-[11px] mb-2" style="color: var(--text-ghost);">
        Site tools — orchestrator-callable functions, hardcoded in code under <span class="font-mono">src/lib/workflows/site-tools/</span>. Grouped by toolset; the orchestrator activates a toolset before calling its tools.
      </p>

      {#if filteredToolsets.length === 0}
        <div class="text-center py-12 text-xs" style="color: var(--text-ghost);">No tools match.</div>
      {:else}
        <div class="space-y-3">
          {#each filteredToolsets as ts (ts.toolset)}
            <div
              class="rounded border"
              style="border-color: var(--card-border); background: color-mix(in srgb, var(--card-border) 12%, transparent);"
            >
              <div class="px-3 py-2 border-b flex items-baseline gap-2" style="border-color: var(--card-border);">
                <span class="text-sm font-mono uppercase tracking-wider" style="color: var(--accent);">{ts.toolset}</span>
                <span class="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider"
                  style="background: color-mix(in srgb, #38bdf8 18%, transparent); color: #38bdf8;"
                >site · {ts.tools.length}</span>
                <span class="text-xs flex-1" style="color: var(--text-secondary);">{ts.description}</span>
              </div>
              <div class="px-3 py-2 space-y-1">
                {#each ts.tools as t (t.name)}
                  <div class="flex items-baseline gap-2 text-[11px]">
                    <span class="font-mono shrink-0" style="color: var(--text-primary);">{t.name}</span>
                    <span class="opacity-60">—</span>
                    <span style="color: var(--text-secondary);">{t.description}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {/if}

  {#if tab === 'custom'}
    <section>
      <p class="text-[11px] mb-2" style="color: var(--text-ghost);">
        Custom tools — registered at runtime via <span class="font-mono">create_tool</span>. ORCHESTRATOR rows were authored by the LLM mid-conversation; USER rows would come from a future admin path. Disable or delete from here.
      </p>

      {#if filteredCustom.length === 0}
        <div class="text-center py-12 text-xs" style="color: var(--text-ghost);">No custom tools yet.</div>
      {:else}
        <div class="space-y-2">
          {#each filteredCustom as tool (tool.id)}
            <div
              class="rounded-lg border transition-colors"
              style="border-color: var(--card-border); background: color-mix(in srgb, var(--card-border) 15%, transparent);"
            >
              <div class="flex items-center gap-3 px-4 py-3">
                <button class="flex-1 text-left" onclick={() => toggle(tool.id)}>
                  <div class="flex items-baseline gap-2 mb-0.5 flex-wrap">
                    <span class="text-[9px] opacity-60">{expanded.has(tool.id) ? '▾' : '▸'}</span>
                    <span class="text-sm font-mono font-medium" style="color: var(--text-primary);">{tool.name}</span>
                    <span
                      class="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider"
                      style="background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent);"
                    >{tool.toolset}</span>
                    <span
                      class="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider"
                      style={tool.createdBy === 'orchestrator'
                        ? 'background: color-mix(in srgb, #a855f7 18%, transparent); color: #a855f7;'
                        : 'background: color-mix(in srgb, #f59e0b 18%, transparent); color: #f59e0b;'}
                    >{tool.createdBy}</span>
                    {#if !tool.enabled}
                      <span class="text-[10px] px-1.5 py-0.5 rounded" style="background: rgba(239,68,68,0.15); color: #ef4444;">disabled</span>
                    {/if}
                  </div>
                  <p class="text-xs line-clamp-2" style="color: var(--text-secondary);">{tool.description}</p>
                </button>

                <div class="text-right text-[11px] shrink-0" style="color: var(--text-ghost);">
                  <div><span style="color: var(--text-primary); font-weight: 500;">{tool.runCount}</span> runs</div>
                  {#if tool.errorCount > 0}
                    <div style="color: #ef4444;">{tool.errorCount} errors</div>
                  {/if}
                  <div class="text-[10px]">last: {relativeTime(tool.lastRunAt)}</div>
                </div>

                <div class="flex items-center gap-1 shrink-0">
                  <button
                    onclick={() => toggleEnabled(tool.name, !tool.enabled)}
                    class="text-[10px] px-2 py-1 rounded border transition-colors"
                    style="border-color: var(--card-border); color: var(--text-secondary);"
                    title={tool.enabled ? 'Disable tool' : 'Enable tool'}
                  >{tool.enabled ? 'Disable' : 'Enable'}</button>
                  <button
                    onclick={() => deleteTool(tool.name)}
                    disabled={deleting === tool.name}
                    class="text-[10px] px-2 py-1 rounded border transition-colors"
                    style="border-color: rgba(239,68,68,0.3); color: #ef4444;"
                    title="Delete tool permanently"
                  >{deleting === tool.name ? '…' : 'Delete'}</button>
                </div>
              </div>

              {#if expanded.has(tool.id)}
                <div class="px-4 pb-3 pt-2 space-y-3 border-t" style="border-color: var(--card-border);">
                  <div>
                    <div class="text-[9px] uppercase tracking-wider mb-1" style="color: var(--text-ghost);">Parameters (JSON Schema)</div>
                    <pre class="text-[10px] rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap" style="background: rgba(0,0,0,0.05); font-family: var(--font-mono); color: var(--text-primary);">{JSON.stringify(tool.parameters, null, 2)}</pre>
                  </div>
                  <div>
                    <div class="text-[9px] uppercase tracking-wider mb-1" style="color: var(--text-ghost);">Handler code</div>
                    <pre class="text-[10px] rounded px-2 py-1.5 overflow-x-auto max-h-64 whitespace-pre-wrap" style="background: rgba(0,0,0,0.05); font-family: var(--font-mono); color: var(--text-primary);">{tool.handlerCode}</pre>
                  </div>
                  <div class="flex gap-4 text-[10px]" style="color: var(--text-ghost);">
                    <span>Created: {new Date(tool.createdAt ?? '').toLocaleString()}</span>
                    {#if tool.lastRunAt}<span>Last run: {new Date(tool.lastRunAt).toLocaleString()}</span>{/if}
                  </div>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .tab {
    padding: 6px 12px;
    font-size: 11px;
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    transition: color 120ms ease, border-color 120ms ease;
  }
  .tab:hover { color: var(--text-secondary); }
  .tab.active {
    color: var(--text-primary);
    border-bottom-color: var(--accent);
  }
  .tab .count {
    display: inline-block;
    margin-left: 4px;
    padding: 0 5px;
    font-size: 9px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--card-border) 30%, transparent);
    color: var(--text-secondary);
  }
</style>
