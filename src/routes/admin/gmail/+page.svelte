<svelte:head><title>Gmail — Admin</title></svelte:head>
<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/stores';

  let { data } = $props();
  const adminToken = getContext<string>('adminToken');

  let accounts = $state(data.accounts);
  let watchesByAccount = $state<Record<number, any[]>>(
    Object.fromEntries(
      data.accounts.map((a: any) => [a.id, data.watches.filter((w: any) => w.accountId === a.id)])
    )
  );
  let openAccountId = $state<number | null>(null);
  let newLabel = $state<Record<number, string>>({});
  let newQuery = $state<Record<number, string>>({});
  let testQuery = $state<Record<number, string>>({});
  let testResult = $state<Record<number, { count: number; sample: any } | null>>({});
  let busy = $state<Record<string, boolean>>({});

  const connected = $derived($page.url.searchParams.get('connected'));
  const errorCode = $derived($page.url.searchParams.get('error'));

  async function loadWatches(accountId: number) {
    const res = await fetch(`/api/gmail/accounts/${accountId}/watches`);
    watchesByAccount[accountId] = await res.json();
  }

  async function addWatch(accountId: number) {
    const label = (newLabel[accountId] ?? '').trim();
    const query = (newQuery[accountId] ?? '').trim();
    if (!label || !query) return;
    busy[`add-${accountId}`] = true;
    try {
      await fetch(`/api/gmail/accounts/${accountId}/watches`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label, query }),
      });
      newLabel[accountId] = '';
      newQuery[accountId] = '';
      await loadWatches(accountId);
    } finally {
      busy[`add-${accountId}`] = false;
    }
  }

  async function deleteWatch(accountId: number, watchId: number) {
    busy[`del-watch-${watchId}`] = true;
    try {
      await fetch(`/api/gmail/accounts/${accountId}/watches?watchId=${watchId}`, { method: 'DELETE' });
      await loadWatches(accountId);
    } finally {
      busy[`del-watch-${watchId}`] = false;
    }
  }

  async function disconnect(accountId: number) {
    if (!confirm('Disconnect this Gmail account?')) return;
    busy[`disc-${accountId}`] = true;
    try {
      await fetch(`/api/gmail/accounts?id=${accountId}`, { method: 'DELETE' });
      accounts = accounts.filter((a: any) => a.id !== accountId);
      if (openAccountId === accountId) openAccountId = null;
    } finally {
      busy[`disc-${accountId}`] = false;
    }
  }

  async function runTest(accountId: number) {
    const query = (testQuery[accountId] ?? '').trim();
    if (!query) return;
    busy[`test-${accountId}`] = true;
    testResult[accountId] = null;
    try {
      const res = await fetch(`/api/gmail/accounts/${accountId}/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      testResult[accountId] = await res.json();
    } finally {
      busy[`test-${accountId}`] = false;
    }
  }

  function toggleAccount(id: number) {
    if (openAccountId === id) {
      openAccountId = null;
    } else {
      openAccountId = id;
      if (!watchesByAccount[id]) loadWatches(id);
    }
  }

  function statusColor(status: string) {
    if (status === 'active') return '#2d7a3a';
    if (status === 'auth_expired') return '#8b3a1a';
    return 'var(--text-ghost)';
  }

  function formatDate(d: Date | string | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
</script>

<div class="max-w-2xl mx-auto px-6 py-12">
  <!-- Header -->
  <div class="flex items-center justify-between mb-8">
    <a href="/admin?token={adminToken}" class="back-link back-link--xs">Admin</a>
    <h1 class="text-[10px] uppercase tracking-[0.3em]" style="color: var(--text-ghost); font-family: var(--font-mono);">
      Gmail
    </h1>
    <a
      href="/api/gmail/connect"
      class="text-[10px] uppercase tracking-[0.2em] px-4 py-2 rounded-lg"
      style="background: var(--accent); color: white; font-family: var(--font-mono);"
    >
      Connect account
    </a>
  </div>

  <!-- Query-string banners -->
  {#if connected}
    <div class="mb-4 p-3 rounded-lg text-[10px]" style="background: rgba(45,122,58,0.1); border: 1px solid #2d7a3a; color: #2d7a3a; font-family: var(--font-mono);">
      Connected: {connected}
    </div>
  {/if}
  {#if errorCode}
    <div class="mb-4 p-3 rounded-lg text-[10px]" style="background: rgba(139,58,26,0.1); border: 1px solid #8b3a1a; color: #8b3a1a; font-family: var(--font-mono);">
      Error: {errorCode}
    </div>
  {/if}

  <!-- Accounts -->
  {#if accounts.length === 0}
    <p class="text-sm py-8" style="color: var(--text-muted);">No Gmail accounts connected.</p>
  {:else}
    <div class="space-y-3">
      {#each accounts as account}
        {@const isOpen = openAccountId === account.id}
        <div class="rounded-xl border" style="background: var(--card-bg); border-color: var(--card-border);">
          <!-- Account row -->
          <div class="flex items-center gap-3 p-4 cursor-pointer" role="button" tabindex="0"
            onclick={() => toggleAccount(account.id)}
            onkeydown={(e) => e.key === 'Enter' && toggleAccount(account.id)}>
            <span class="flex-1 text-sm font-medium" style="color: var(--text-primary);">{account.email}</span>
            <span class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5 rounded" style="font-family: var(--font-mono); color: {statusColor(account.status)}; border: 1px solid {statusColor(account.status)};">
              {account.status}
            </span>
            <span class="text-[9px]" style="color: var(--text-ghost); font-family: var(--font-mono);">{formatDate(account.createdAt)}</span>
            <button
              onclick={(e) => { e.stopPropagation(); disconnect(account.id); }}
              disabled={busy[`disc-${account.id}`]}
              class="text-[9px] uppercase tracking-[0.15em] px-2 py-1 rounded transition-colors disabled:opacity-50"
              style="font-family: var(--font-mono); color: #8b3a1a; border: 1px solid #8b3a1a;"
            >
              {busy[`disc-${account.id}`] ? '…' : 'Disconnect'}
            </button>
          </div>

          {#if account.lastError}
            <div class="px-4 pb-2 text-[9px]" style="color: #8b3a1a; font-family: var(--font-mono);">
              Error: {account.lastError}
            </div>
          {/if}

          <!-- Expanded panel -->
          {#if isOpen}
            <div class="border-t px-4 pb-4 pt-3 space-y-4" style="border-color: var(--card-border);">
              <!-- Watches table -->
              <div>
                <p class="text-[9px] uppercase tracking-[0.2em] mb-2" style="color: var(--text-ghost); font-family: var(--font-mono);">Watches</p>
                {#if (watchesByAccount[account.id] ?? []).length === 0}
                  <p class="text-[10px]" style="color: var(--text-muted);">No watches yet.</p>
                {:else}
                  <table class="w-full text-[10px]" style="font-family: var(--font-mono); color: var(--text-secondary);">
                    <thead>
                      <tr style="border-bottom: 1px solid var(--divider);">
                        <th class="text-left py-1 pr-3 font-normal" style="color: var(--text-ghost);">Label</th>
                        <th class="text-left py-1 pr-3 font-normal" style="color: var(--text-ghost);">Query</th>
                        <th class="text-left py-1 pr-3 font-normal" style="color: var(--text-ghost);">On</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each watchesByAccount[account.id] as w}
                        <tr style="border-bottom: 1px solid var(--divider);">
                          <td class="py-1 pr-3">{w.label}</td>
                          <td class="py-1 pr-3 font-mono" style="color: var(--text-ghost);">{w.query}</td>
                          <td class="py-1 pr-3">{w.enabled ? 'yes' : 'no'}</td>
                          <td class="py-1">
                            <button
                              onclick={() => deleteWatch(account.id, w.id)}
                              disabled={busy[`del-watch-${w.id}`]}
                              class="px-2 py-0.5 rounded disabled:opacity-50"
                              style="color: #8b3a1a; border: 1px solid #8b3a1a;"
                            >
                              {busy[`del-watch-${w.id}`] ? '…' : 'Delete'}
                            </button>
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                {/if}
              </div>

              <!-- Add watch form -->
              <div>
                <p class="text-[9px] uppercase tracking-[0.2em] mb-2" style="color: var(--text-ghost); font-family: var(--font-mono);">Add watch</p>
                <div class="flex gap-2 mb-1">
                  <input
                    type="text"
                    placeholder="Label"
                    bind:value={newLabel[account.id]}
                    class="flex-1 px-2 py-1 rounded text-[11px]"
                    style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-body); outline: none;"
                  />
                  <input
                    type="text"
                    placeholder="Query"
                    bind:value={newQuery[account.id]}
                    class="flex-2 px-2 py-1 rounded text-[11px]"
                    style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-body); outline: none; min-width: 0; flex: 2;"
                  />
                  <button
                    onclick={() => addWatch(account.id)}
                    disabled={busy[`add-${account.id}`]}
                    class="text-[10px] uppercase tracking-[0.15em] px-3 py-1 rounded disabled:opacity-50"
                    style="background: var(--accent); color: white; font-family: var(--font-mono);"
                  >
                    {busy[`add-${account.id}`] ? '…' : 'Add'}
                  </button>
                </div>
                <p class="text-[9px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
                  e.g. newer_than:1d from:someone@example.com
                </p>
              </div>

              <!-- Test fetch -->
              <div>
                <p class="text-[9px] uppercase tracking-[0.2em] mb-2" style="color: var(--text-ghost); font-family: var(--font-mono);">Test fetch</p>
                <div class="flex gap-2 mb-2">
                  <input
                    type="text"
                    placeholder="Query"
                    bind:value={testQuery[account.id]}
                    class="flex-1 px-2 py-1 rounded text-[11px]"
                    style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-body); outline: none;"
                  />
                  <button
                    onclick={() => runTest(account.id)}
                    disabled={busy[`test-${account.id}`]}
                    class="text-[10px] uppercase tracking-[0.15em] px-3 py-1 rounded disabled:opacity-50"
                    style="border: 1px solid var(--card-border); color: var(--text-secondary); font-family: var(--font-mono);"
                  >
                    {busy[`test-${account.id}`] ? '…' : 'Run test'}
                  </button>
                </div>
                {#if testResult[account.id] !== undefined && testResult[account.id] !== null}
                  {@const r = testResult[account.id]!}
                  <div class="p-3 rounded text-[10px] space-y-1" style="background: rgba(0,0,0,0.04); border: 1px solid var(--divider); font-family: var(--font-mono); color: var(--text-secondary);">
                    <div>Count: {r.count}</div>
                    {#if r.sample}
                      <div>Subject: {r.sample.headers?.subject ?? '—'}</div>
                      <div>From: {r.sample.headers?.from ?? '—'}</div>
                      {#if r.sample.bodyText}
                        <div class="pt-1" style="color: var(--text-ghost); white-space: pre-wrap;">{r.sample.bodyText.slice(0, 200)}</div>
                      {/if}
                    {:else}
                      <div>No sample.</div>
                    {/if}
                  </div>
                {/if}
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
