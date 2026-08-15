<svelte:head><title>Tools — Admin</title></svelte:head>
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';

  let { data } = $props();

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
  const siteNodeCount = $derived(data.siteNodeFamilies.reduce((n, g) => n + g.nodes.length, 0));
  const toolsetCount = $derived(data.toolsets.reduce((n, ts) => n + ts.tools.length, 0));
  const siteToolCount = $derived(siteNodeCount + toolsetCount);
  const customCount = $derived(data.tools.length);

  function matchPrim(p: { type: string; label: string; description: string; category: string }, q: string) {
    return (
      p.type.toLowerCase().includes(q) ||
      p.label.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q)
    );
  }

  const filteredPrimitives = $derived(
    filter.trim()
      ? data.primitives.filter((p) => matchPrim(p, filter.toLowerCase()))
      : data.primitives,
  );

  const filteredSiteFamilies = $derived(
    filter.trim()
      ? data.siteNodeFamilies
          .map((g) => ({
            ...g,
            nodes: g.nodes.filter((n) => {
              const q = filter.toLowerCase();
              return matchPrim(n, q) || g.family.toLowerCase().includes(q);
            }),
          }))
          .filter((g) => g.nodes.length > 0)
      : data.siteNodeFamilies,
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

<PageWrap width="wide">
  <PageHeader
    kicker="AI Config"
    title="Tools"
    sub="Everything the orchestrator and the workflow engine can reach for. Primitives are the general building blocks; site tools cover this site's features and connected accounts; custom tools are LLM-authored."
  />

  <div class="nm-tabs">
    <button class="nm-tab" class:active={tab === 'primitives'} onclick={() => (tab = 'primitives')}>
      Primitives <span class="nm-tab-count">{primitiveCount}</span>
    </button>
    <button class="nm-tab" class:active={tab === 'site'} onclick={() => (tab = 'site')}>
      Site tools <span class="nm-tab-count">{siteToolCount}</span>
    </button>
    <button class="nm-tab" class:active={tab === 'custom'} onclick={() => (tab = 'custom')}>
      Custom <span class="nm-tab-count">{customCount}</span>
    </button>
  </div>

  <input
    class="nm-text-input"
    type="text"
    bind:value={filter}
    placeholder="Filter by name, description, category…"
    style="margin-bottom: 0.9rem;"
  />

  {#if tab === 'primitives'}
    <p class="tab-note">General workflow building blocks — triggers, control flow, LLM calls, generic integrations. The orchestrator combines these to compose any activity. Site-specific things (blog, deep-dive, intel, gmail, etc.) live under <strong>Site tools</strong>.</p>
    {#if filteredPrimitives.length === 0}
      <div class="nm-empty">No primitives match.</div>
    {:else}
      <div class="row-list">
        {#each filteredPrimitives as p (p.type)}
          <div class="row-card">
            <button class="row-head" onclick={() => toggle(`prim:${p.type}`)}>
              <span class="caret">{expanded.has(`prim:${p.type}`) ? '▾' : '▸'}</span>
              <span class="row-name">{p.type}</span>
              <span class="nm-pill">primitive</span>
              <span class="nm-pill" data-state="warn">{p.category}</span>
              <span class="row-desc">{p.label} — {p.description}</span>
            </button>
            {#if expanded.has(`prim:${p.type}`)}
              <div class="row-body">
                {#if p.llmDescription}
                  <div>
                    <span class="sr-label-tight">Orchestrator guidance</span>
                    <p class="hint-line">{p.llmDescription}</p>
                  </div>
                {/if}
                <div class="io-grid">
                  <div>
                    <span class="sr-label-tight">Inputs</span>
                    <div class="io-line">{p.inputs.length === 0 ? 'none' : p.inputs.map((i) => `${i.name}:${i.type}`).join(', ')}</div>
                  </div>
                  <div>
                    <span class="sr-label-tight">Outputs</span>
                    <div class="io-line">{p.outputs.length === 0 ? 'none' : p.outputs.map((o) => `${o.name}:${o.type}`).join(', ')}</div>
                  </div>
                </div>
                <div>
                  <span class="sr-label-tight">Config schema</span>
                  <pre class="code">{JSON.stringify(p.configSchema, null, 2)}</pre>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {/if}

  {#if tab === 'site'}
    <p class="tab-note">Tools tied to this site's features and connected accounts — workflow node primitives that hit those features, plus orchestrator-callable functions hardcoded under <code>src/lib/workflows/site-tools/</code>.</p>

    {#if filteredSiteFamilies.length === 0 && filteredToolsets.length === 0}
      <div class="nm-empty">No site tools match.</div>
    {/if}

    {#if filteredSiteFamilies.length > 0}
      <h3 class="section-h">Workflow nodes</h3>
      <div class="row-list">
        {#each filteredSiteFamilies as g (g.family)}
          <div class="row-card">
            <div class="row-head static">
              <span class="row-name">{g.family}</span>
              <span class="nm-pill" data-state="connected">site · {g.nodes.length}</span>
              <span class="row-desc">{g.description}</span>
            </div>
            <div class="row-body family-nodes">
              {#each g.nodes as n (n.type)}
                <div class="row-card inner">
                  <button class="row-head" onclick={() => toggle(`site:${n.type}`)}>
                    <span class="caret">{expanded.has(`site:${n.type}`) ? '▾' : '▸'}</span>
                    <span class="row-name">{n.type}</span>
                    <span class="nm-pill">primitive</span>
                    <span class="nm-pill" data-state="warn">{n.category}</span>
                    <span class="row-desc">{n.label} — {n.description}</span>
                  </button>
                  {#if expanded.has(`site:${n.type}`)}
                    <div class="row-body">
                      {#if n.llmDescription}
                        <div>
                          <span class="sr-label-tight">Orchestrator guidance</span>
                          <p class="hint-line">{n.llmDescription}</p>
                        </div>
                      {/if}
                      <div class="io-grid">
                        <div>
                          <span class="sr-label-tight">Inputs</span>
                          <div class="io-line">{n.inputs.length === 0 ? 'none' : n.inputs.map((i) => `${i.name}:${i.type}`).join(', ')}</div>
                        </div>
                        <div>
                          <span class="sr-label-tight">Outputs</span>
                          <div class="io-line">{n.outputs.length === 0 ? 'none' : n.outputs.map((o) => `${o.name}:${o.type}`).join(', ')}</div>
                        </div>
                      </div>
                      <div>
                        <span class="sr-label-tight">Config schema</span>
                        <pre class="code">{JSON.stringify(n.configSchema, null, 2)}</pre>
                      </div>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    {#if filteredToolsets.length > 0}
      <h3 class="section-h">Orchestrator functions</h3>
      <div class="row-list">
        {#each filteredToolsets as ts (ts.toolset)}
          <div class="row-card">
            <div class="row-head static">
              <span class="row-name">{ts.toolset}</span>
              <span class="nm-pill" data-state="connected">site · {ts.tools.length}</span>
              <span class="row-desc">{ts.description}</span>
            </div>
            <div class="row-body subtle">
              {#each ts.tools as t (t.name)}
                <div class="tool-line">
                  <span class="tool-name">{t.name}</span>
                  <span class="tool-sep">—</span>
                  <span class="tool-desc">{t.description}</span>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}

  {#if tab === 'custom'}
    <p class="tab-note">Custom tools — registered at runtime via <code>create_tool</code>. ORCHESTRATOR rows were authored by the LLM; USER rows would come from a future admin path.</p>
    {#if filteredCustom.length === 0}
      <div class="nm-empty">No custom tools yet.</div>
    {:else}
      <div class="row-list">
        {#each filteredCustom as tool (tool.id)}
          <div class="row-card">
            <button class="row-head" onclick={() => toggle(tool.id)}>
              <span class="caret">{expanded.has(tool.id) ? '▾' : '▸'}</span>
              <span class="row-name">{tool.name}</span>
              <span class="nm-pill" data-state="warn">{tool.toolset}</span>
              <span class="nm-pill" data-state={tool.createdBy === 'orchestrator' ? 'warn' : 'success'}>{tool.createdBy}</span>
              {#if !tool.enabled}
                <span class="nm-pill" data-state="error">disabled</span>
              {/if}
              <span class="row-desc">{tool.description}</span>
              <span class="run-stats">
                <span class="run-num">{tool.runCount}</span> runs
                {#if tool.errorCount > 0}<span class="run-err">· {tool.errorCount} err</span>{/if}
                <span class="run-time">· {relativeTime(tool.lastRunAt)}</span>
              </span>
            </button>
            <div class="row-actions">
              <button class="nm-btn-ghost" onclick={() => toggleEnabled(tool.name, !tool.enabled)}>
                {tool.enabled ? 'Disable' : 'Enable'}
              </button>
              <button class="nm-link-btn danger" onclick={() => deleteTool(tool.name)} disabled={deleting === tool.name}>
                {deleting === tool.name ? '…' : 'Delete'}
              </button>
            </div>
            {#if expanded.has(tool.id)}
              <div class="row-body">
                <div>
                  <span class="sr-label-tight">Parameters (JSON Schema)</span>
                  <pre class="code">{JSON.stringify(tool.parameters, null, 2)}</pre>
                </div>
                <div>
                  <span class="sr-label-tight">Handler code</span>
                  <pre class="code tall">{tool.handlerCode}</pre>
                </div>
                <div class="meta-line">
                  <span>Created: {new Date(tool.createdAt ?? '').toLocaleString()}</span>
                  {#if tool.lastRunAt}<span>Last run: {new Date(tool.lastRunAt).toLocaleString()}</span>{/if}
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</PageWrap>

<style>
  .tab-note {
    font-size: 0.85rem;
    color: var(--text-secondary);
    margin: 0 0 0.8rem;
  }
  .section-h {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-ghost);
    margin: 1.2rem 0 0.45rem;
    font-weight: 500;
  }
  .section-h:first-of-type { margin-top: 0.2rem; }
  .row-body.family-nodes { padding: 0.55rem 0.55rem 0.7rem; gap: 0.4rem; }
  .row-card.inner { background: var(--bg-base, var(--bg-section)); }
  .tab-note code {
    font-family: var(--font-mono);
    font-size: max(0.85em, var(--fs-label-xs));
    background: var(--code-bg);
    color: var(--code-text);
    padding: 0.08rem 0.38rem;
  }

  .row-list { display: flex; flex-direction: column; gap: 0.4rem; }
  .row-card {
    background: var(--bg-section);
    border: 1px solid var(--card-border);
    transition: border-color 120ms ease;
  }
  .row-card:hover { border-color: var(--text-primary); }

  .row-head {
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    padding: 0.6rem 0.8rem;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.6rem;
    cursor: pointer;
    color: inherit;
  }
  .row-head.static { cursor: default; padding-bottom: 0.5rem; border-bottom: 1px solid var(--divider); }
  .caret { font-size: var(--fs-label-xs); color: var(--text-ghost); width: 0.8rem; }
  .row-name {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    color: var(--text-primary);
  }
  .row-desc {
    flex: 1 1 200px;
    font-size: 0.82rem;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row-body {
    padding: 0.7rem 0.8rem 0.85rem;
    border-top: 1px solid var(--divider);
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  .row-body.subtle { padding: 0.55rem 0.8rem; gap: 0.25rem; border-top: 0; }
  .row-actions {
    display: flex;
    gap: 0.6rem;
    padding: 0 0.8rem 0.6rem;
    align-items: center;
  }
  .hint-line { margin: 0.3rem 0 0; font-size: 0.85rem; color: var(--text-secondary); }

  .io-grid { display: grid; gap: 0.7rem; grid-template-columns: 1fr 1fr; }
  @media (max-width: 540px) { .io-grid { grid-template-columns: 1fr; } }
  .io-line {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    margin-top: 0.3rem;
  }

  .code {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    background: var(--code-bg);
    color: var(--code-text);
    padding: 0.55rem 0.7rem;
    margin: 0.3rem 0 0;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .code.tall { max-height: 280px; overflow-y: auto; }

  .tool-line {
    display: flex;
    gap: 0.45rem;
    align-items: baseline;
    font-size: var(--fs-label-xs);
    padding: 2px 0;
  }
  .tool-name { font-family: var(--font-mono); color: var(--text-primary); flex-shrink: 0; }
  .tool-sep { color: var(--text-ghost); }
  .tool-desc { color: var(--text-secondary); }

  .run-stats {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    margin-left: auto;
  }
  .run-num { color: var(--text-primary); font-weight: 500; }
  .run-err { color: var(--error); }
  .run-time { margin-left: 4px; }

  .meta-line {
    display: flex;
    gap: 1rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
</style>
