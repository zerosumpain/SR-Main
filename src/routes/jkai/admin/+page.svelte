<script lang="ts">
  import { onMount } from 'svelte';

  interface SandboxStatus {
    running: boolean;
    containerId?: string;
    image?: string;
    uptime?: string;
  }

  interface Container {
    name: string;
    image: string;
    status: string;
    ports: string;
    created: string;
  }

  interface ComponentInfo {
    name: string;
    version: string;
    category: 'runtime' | 'python-pkg' | 'npm-global' | 'system-tool';
    usageCount: number;
    lastUsed: string | null;
    lastContext: string | null;
    lastSource: string | null;
    cronCount: number;
  }

  let sandboxStatus = $state<SandboxStatus>({ running: false });
  let containers = $state<Container[]>([]);
  let components = $state<ComponentInfo[]>([]);
  let componentsLoading = $state(false);
  let loading = $state(false);
  let actionMessage = $state('');
  let execCommand = $state('');
  let execOutput = $state('');
  let execRunning = $state(false);
  let componentFilter = $state<string>('all');
  let componentSearch = $state('');

  const CATEGORY_LABELS: Record<string, string> = {
    'runtime': 'Runtime',
    'python-pkg': 'Python',
    'npm-global': 'npm Global',
    'system-tool': 'System',
  };

  let filteredComponents = $derived(
    components.filter((c) => {
      const matchesCategory = componentFilter === 'all' || c.category === componentFilter;
      const matchesSearch = !componentSearch || c.name.toLowerCase().includes(componentSearch.toLowerCase());
      return matchesCategory && matchesSearch;
    })
  );

  let categoryStats = $derived(() => {
    const stats: Record<string, number> = { all: components.length };
    for (const c of components) {
      stats[c.category] = (stats[c.category] || 0) + 1;
    }
    return stats;
  });

  async function refresh() {
    const [statusRes, containersRes] = await Promise.all([
      fetch('/api/jkai/sandbox'),
      fetch('/api/jkai/sandbox?action=containers'),
    ]);
    if (statusRes.ok) sandboxStatus = await statusRes.json();
    if (containersRes.ok) containers = await containersRes.json();

    if (sandboxStatus.running) {
      loadComponents();
    }
  }

  async function loadComponents() {
    componentsLoading = true;
    const res = await fetch('/api/jkai/sandbox?action=components');
    if (res.ok) {
      const data = await res.json();
      components = data.components || [];
    }
    componentsLoading = false;
  }

  async function sandboxAction(action: string) {
    loading = true;
    actionMessage = '';
    const res = await fetch('/api/jkai/sandbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    if (data.ok) {
      actionMessage = `${action} completed`;
    } else {
      actionMessage = `Error: ${data.error}`;
    }
    loading = false;
    await refresh();
  }

  async function runCommand() {
    if (!execCommand.trim() || execRunning) return;
    execRunning = true;
    execOutput = '';
    const res = await fetch('/api/jkai/sandbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'exec', command: execCommand, timeout: 30000 }),
    });
    const data = await res.json();
    execOutput = data.stdout || '';
    if (data.stderr) execOutput += (execOutput ? '\n' : '') + data.stderr;
    if (data.exitCode !== 0) execOutput += `\n[exit code: ${data.exitCode}]`;
    execRunning = false;
  }

  function handleExecKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      runCommand();
    }
  }

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  onMount(refresh);
</script>

<div class="admin-page">
  <div class="admin-header">
    <div class="header-left">
      <a href="/jkai" class="back-link">&larr; Back to Chat</a>
      <h1 class="display" style="font-size: 28px;">JKAI Admin</h1>
    </div>
  </div>

  <div class="admin-grid">
    <!-- Sandbox Status -->
    <section class="card">
      <h2 class="label">Sandbox Environment</h2>
      <div class="status-row">
        <span class="status-dot" class:running={sandboxStatus.running}></span>
        <span>{sandboxStatus.running ? 'Running' : 'Stopped'}</span>
      </div>
      {#if sandboxStatus.running}
        <div class="meta-grid">
          <div class="meta-item">
            <span class="meta-label">Container</span>
            <span class="meta-value mono">{sandboxStatus.containerId}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Image</span>
            <span class="meta-value mono">{sandboxStatus.image}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Uptime</span>
            <span class="meta-value">{sandboxStatus.uptime}</span>
          </div>
        </div>
      {/if}
      <div class="action-buttons">
        {#if sandboxStatus.running}
          <button class="btn" onclick={() => sandboxAction('stop')} disabled={loading}>Stop</button>
        {:else}
          <button class="btn btn-accent" onclick={() => sandboxAction('start')} disabled={loading}>Start</button>
        {/if}
        <button class="btn" onclick={() => sandboxAction('build')} disabled={loading}>Rebuild Image</button>
        <button class="btn" onclick={refresh} disabled={loading}>Refresh</button>
      </div>
      {#if actionMessage}
        <p class="action-msg">{actionMessage}</p>
      {/if}
    </section>

    <!-- Sandbox Terminal -->
    <section class="card">
      <h2 class="label">Sandbox Terminal</h2>
      {#if !sandboxStatus.running}
        <p class="muted">Start the sandbox to use the terminal.</p>
      {:else}
        <div class="terminal">
          {#if execOutput}
            <pre class="terminal-output">{execOutput}</pre>
          {/if}
          <div class="terminal-input">
            <span class="terminal-prompt">$</span>
            <input
              type="text"
              bind:value={execCommand}
              onkeydown={handleExecKeydown}
              placeholder="Enter command..."
              disabled={execRunning}
            />
            <button class="btn btn-accent btn-sm" onclick={runCommand} disabled={execRunning || !execCommand.trim()}>
              Run
            </button>
          </div>
        </div>
      {/if}
    </section>

    <!-- Installed Components -->
    <section class="card full-width">
      <div class="components-header">
        <h2 class="label">Installed Components</h2>
        {#if sandboxStatus.running}
          <button class="btn btn-sm" onclick={loadComponents} disabled={componentsLoading}>
            {componentsLoading ? 'Scanning...' : 'Rescan'}
          </button>
        {/if}
      </div>

      {#if !sandboxStatus.running}
        <p class="muted">Start the sandbox to view installed components.</p>
      {:else if componentsLoading && components.length === 0}
        <p class="muted">Scanning sandbox for installed components...</p>
      {:else if components.length > 0}
        <div class="components-toolbar">
          <div class="filter-pills">
            {#each ['all', 'runtime', 'python-pkg', 'npm-global', 'system-tool'] as cat}
              <button
                class="pill"
                class:active={componentFilter === cat}
                onclick={() => componentFilter = cat}
              >
                {cat === 'all' ? 'All' : CATEGORY_LABELS[cat]}
                <span class="pill-count">{cat === 'all' ? components.length : components.filter(c => c.category === cat).length}</span>
              </button>
            {/each}
          </div>
          <input
            type="text"
            class="component-search"
            placeholder="Filter..."
            bind:value={componentSearch}
          />
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Component</th>
                <th>Version</th>
                <th>Category</th>
                <th>Uses</th>
                <th>Last Used</th>
                <th>Last Context</th>
                <th>Cron</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredComponents as comp}
                <tr class:used={comp.usageCount > 0} class:heavy={comp.usageCount >= 10}>
                  <td class="mono comp-name">{comp.name}</td>
                  <td class="mono version">{comp.version}</td>
                  <td>
                    <span class="cat-badge cat-{comp.category}">{CATEGORY_LABELS[comp.category]}</span>
                  </td>
                  <td class="center">
                    {#if comp.usageCount > 0}
                      <span class="usage-count">{comp.usageCount}</span>
                    {:else}
                      <span class="muted">-</span>
                    {/if}
                  </td>
                  <td>
                    {#if comp.lastUsed}
                      <span class="time-ago" title={comp.lastUsed}>{timeAgo(comp.lastUsed)}</span>
                    {:else}
                      <span class="muted">never</span>
                    {/if}
                  </td>
                  <td class="context-cell">
                    {#if comp.lastContext}
                      <span class="context-text" title={comp.lastContext}>{comp.lastContext.slice(0, 60)}{comp.lastContext.length > 60 ? '...' : ''}</span>
                    {:else}
                      <span class="muted">-</span>
                    {/if}
                  </td>
                  <td class="center">
                    {#if comp.cronCount > 0}
                      <span class="cron-badge">{comp.cronCount}</span>
                    {:else}
                      <span class="muted">-</span>
                    {/if}
                  </td>
                </tr>
              {/each}
              {#if filteredComponents.length === 0}
                <tr><td colspan="7" class="muted">No components match filter</td></tr>
              {/if}
            </tbody>
          </table>
        </div>
      {:else}
        <p class="muted">No components detected.</p>
      {/if}
    </section>

    <!-- Docker Containers -->
    <section class="card full-width">
      <h2 class="label">All Docker Containers</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Image</th>
              <th>Status</th>
              <th>Ports</th>
            </tr>
          </thead>
          <tbody>
            {#each containers as c}
              <tr class:jkai={c.name.includes('jkai')}>
                <td class="mono">{c.name}</td>
                <td class="mono">{c.image}</td>
                <td>
                  <span class="status-badge" class:up={c.status.startsWith('Up')} class:down={!c.status.startsWith('Up')}>
                    {c.status}
                  </span>
                </td>
                <td class="mono">{c.ports || '-'}</td>
              </tr>
            {/each}
            {#if containers.length === 0}
              <tr><td colspan="4" class="muted">No containers found</td></tr>
            {/if}
          </tbody>
        </table>
      </div>
    </section>
  </div>
</div>

<style>
  .admin-page {
    height: 100%;
    overflow-y: auto;
    padding: 24px;
  }
  .admin-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 32px;
    padding-bottom: 16px;
    border-bottom: 2px solid var(--card-border);
  }
  .header-left { display: flex; flex-direction: column; gap: 8px; }
  .back-link {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--accent);
    text-decoration: none;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .back-link:hover { text-decoration: underline; }

  .admin-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    max-width: 1400px;
  }
  .full-width { grid-column: 1 / -1; }

  .card {
    background: var(--card-bg);
    border: 2px solid var(--card-border);
    padding: 24px;
  }
  .card h2 { margin-bottom: 16px; }

  .status-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 15px;
    font-weight: 500;
    margin-bottom: 16px;
  }
  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #999;
  }
  .status-dot.running { background: #27ae60; }

  .meta-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-bottom: 16px;
  }
  .meta-item { display: flex; flex-direction: column; gap: 2px; }
  .meta-label {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
  }
  .meta-value { font-size: 14px; color: var(--text-primary); }
  .mono { font-family: var(--font-mono); font-size: 13px; }

  .action-buttons { display: flex; gap: 8px; flex-wrap: wrap; }
  .btn {
    background: var(--card-bg);
    border: 2px solid var(--card-border);
    color: var(--text-primary);
    padding: 8px 16px;
    font-family: var(--font-mono);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    cursor: pointer;
    transition: border-color 0.15s;
  }
  .btn:hover:not(:disabled) { border-color: var(--text-secondary); }
  .btn:disabled { opacity: 0.4; cursor: default; }
  .btn-accent { background: var(--accent); color: white; border-color: var(--accent); }
  .btn-accent:hover:not(:disabled) { background: var(--accent-hover); }
  .btn-sm { padding: 4px 12px; }

  .action-msg {
    margin-top: 12px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
  }
  .muted { color: var(--text-ghost); font-size: 14px; }

  /* Terminal */
  .terminal {
    background: #1a1008;
    border: 2px solid var(--card-border);
    padding: 16px;
    font-family: var(--font-mono);
    font-size: 13px;
  }
  .terminal-output {
    color: #ede4d4;
    white-space: pre-wrap;
    word-break: break-all;
    margin: 0 0 12px 0;
    max-height: 300px;
    overflow-y: auto;
  }
  .terminal-input {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .terminal-prompt {
    color: var(--accent);
    font-weight: 700;
  }
  .terminal-input input {
    flex: 1;
    background: none;
    border: none;
    color: #ede4d4;
    font-family: var(--font-mono);
    font-size: 13px;
    outline: none;
  }
  .terminal-input input::placeholder { color: rgba(237, 228, 212, 0.3); }

  /* Components */
  .components-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }
  .components-header h2 { margin-bottom: 0; }

  .components-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    margin-bottom: 16px;
  }
  .filter-pills {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .pill {
    background: none;
    border: 1px solid var(--card-border);
    color: var(--text-ghost);
    padding: 4px 10px;
    font-family: var(--font-mono);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .pill:hover { border-color: var(--text-secondary); color: var(--text-secondary); }
  .pill.active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }
  .pill-count {
    opacity: 0.7;
    font-size: 10px;
  }

  .component-search {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    color: var(--text-primary);
    padding: 4px 10px;
    font-family: var(--font-mono);
    font-size: 12px;
    width: 160px;
    outline: none;
  }
  .component-search:focus { border-color: var(--accent); }

  .center { text-align: center; }

  .comp-name { font-weight: 500; color: var(--text-primary); }
  .version { color: var(--text-ghost); font-size: 12px; }

  .cat-badge {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 2px 6px;
    border: 1px solid;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .cat-runtime { color: #e67e22; border-color: #e67e22; }
  .cat-python-pkg { color: #3498db; border-color: #3498db; }
  .cat-npm-global { color: #27ae60; border-color: #27ae60; }
  .cat-system-tool { color: #9b59b6; border-color: #9b59b6; }

  .usage-count {
    font-family: var(--font-mono);
    font-weight: 700;
    color: var(--text-primary);
  }
  tr.used td { color: var(--text-primary); }
  tr.heavy .usage-count { color: var(--accent); }

  .time-ago {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-secondary);
  }

  .context-cell { max-width: 250px; }
  .context-text {
    font-size: 12px;
    color: var(--text-ghost);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
  }

  .cron-badge {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 1px 6px;
    background: rgba(155, 89, 182, 0.15);
    color: #9b59b6;
    border: 1px solid #9b59b6;
  }

  /* Table */
  .table-wrap { overflow-x: auto; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th {
    text-align: left;
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
    padding: 8px 12px;
    border-bottom: 2px solid var(--card-border);
  }
  td {
    padding: 10px 12px;
    border-bottom: 1px solid var(--divider);
    color: var(--text-secondary);
  }
  tr.jkai td { color: var(--text-primary); font-weight: 500; }
  .status-badge {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 2px 8px;
    border: 1px solid;
  }
  .status-badge.up { color: #27ae60; border-color: #27ae60; }
  .status-badge.down { color: #999; border-color: #999; }
</style>
