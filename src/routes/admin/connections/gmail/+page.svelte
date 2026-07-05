<svelte:head><title>Gmail — Admin</title></svelte:head>
<script lang="ts">
  import { page } from '$app/stores';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';

  let { data } = $props();

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

  function fmtDate(d: Date | string | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
</script>

<PageWrap>
  <PageHeader
    kicker="Channels"
    title="Gmail"
    sub="Multi-account inbox watches. The polling watcher fires workflows whose start node matches a watch query."
  >
    {#snippet actions()}
      <a class="nm-save-btn" href="/api/gmail/connect">Connect account</a>
    {/snippet}
  </PageHeader>

  {#if connected}
    <div class="banner banner-success">Connected: {connected}</div>
  {/if}
  {#if errorCode}
    <div class="banner banner-error">Error: {errorCode}</div>
  {/if}

  {#if accounts.length === 0}
    <div class="nm-empty">No Gmail accounts connected. Click <strong>Connect account</strong> to start the OAuth flow.</div>
  {:else}
    <div class="account-list">
      {#each accounts as account}
        {@const isOpen = openAccountId === account.id}
        <section class="nm-sec account-card" class:open={isOpen}>
          <div class="account-row">
            <button class="account-summary" onclick={() => toggleAccount(account.id)}>
              <span class="caret">{isOpen ? '▾' : '▸'}</span>
              <span class="account-email">{account.email}</span>
              <span class="nm-pill" data-state={account.status}>{account.status}</span>
              <span class="account-date">since {fmtDate(account.createdAt)}</span>
            </button>
            <button class="nm-link-btn danger" onclick={() => disconnect(account.id)} disabled={busy[`disc-${account.id}`]}>
              {busy[`disc-${account.id}`] ? '…' : 'Disconnect'}
            </button>
          </div>

          {#if account.lastError}
            <div class="banner banner-error">{account.lastError}</div>
          {/if}

          {#if isOpen}
            <div class="account-body">
              <!-- Watches -->
              <div class="account-section">
                <span class="sr-label-tight">Watches</span>
                {#if (watchesByAccount[account.id] ?? []).length === 0}
                  <div class="nm-empty">No watches yet.</div>
                {:else}
                  <table class="nm-table">
                    <thead>
                      <tr><th>Label</th><th>Query</th><th>Enabled</th><th></th></tr>
                    </thead>
                    <tbody>
                      {#each watchesByAccount[account.id] as w}
                        <tr>
                          <td>{w.label}</td>
                          <td><code>{w.query}</code></td>
                          <td>{w.enabled ? 'yes' : 'no'}</td>
                          <td><button class="nm-link-btn danger" onclick={() => deleteWatch(account.id, w.id)} disabled={busy[`del-watch-${w.id}`]}>{busy[`del-watch-${w.id}`] ? '…' : 'Delete'}</button></td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                {/if}
              </div>

              <!-- Add watch -->
              <div class="account-section">
                <span class="sr-label-tight">Add watch</span>
                <div class="add-watch-row">
                  <input class="nm-text-input" type="text" placeholder="Label" bind:value={newLabel[account.id]} />
                  <input class="nm-text-input" type="text" placeholder="Query (e.g. newer_than:1d from:someone@x.com)" bind:value={newQuery[account.id]} />
                  <button class="nm-save-btn" onclick={() => addWatch(account.id)} disabled={busy[`add-${account.id}`]}>
                    {busy[`add-${account.id}`] ? '…' : 'Add'}
                  </button>
                </div>
              </div>

              <!-- Test fetch -->
              <div class="account-section">
                <span class="sr-label-tight">Test fetch</span>
                <div class="add-watch-row">
                  <input class="nm-text-input" type="text" placeholder="Gmail search query" bind:value={testQuery[account.id]} />
                  <button class="nm-btn-ghost" onclick={() => runTest(account.id)} disabled={busy[`test-${account.id}`]}>
                    {busy[`test-${account.id}`] ? '…' : 'Run test'}
                  </button>
                </div>
                {#if testResult[account.id] !== undefined && testResult[account.id] !== null}
                  {@const r = testResult[account.id]!}
                  <div class="test-result">
                    <div>Count: <strong>{r.count}</strong></div>
                    {#if r.sample}
                      <div>Subject: {r.sample.headers?.subject ?? '—'}</div>
                      <div>From: {r.sample.headers?.from ?? '—'}</div>
                      {#if r.sample.bodyText}
                        <pre class="sample-body">{r.sample.bodyText.slice(0, 280)}</pre>
                      {/if}
                    {:else}
                      <div class="muted">No sample.</div>
                    {/if}
                  </div>
                {/if}
              </div>
            </div>
          {/if}
        </section>
      {/each}
    </div>
  {/if}
</PageWrap>

<style>
  .account-list { display: flex; flex-direction: column; gap: 0.6rem; }
  .account-card { margin-bottom: 0; }
  .account-row { display: flex; align-items: center; gap: 0.6rem; }
  .account-summary {
    flex: 1;
    background: none;
    border: 0;
    padding: 0;
    text-align: left;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.7rem;
    color: inherit;
  }
  .caret { font-size: 9px; color: var(--text-ghost); width: 0.8rem; }
  .account-email { font-size: 0.95rem; color: var(--text-primary); font-weight: 500; }
  .account-date { font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); margin-left: auto; }
  .account-body { display: flex; flex-direction: column; gap: 0.9rem; padding-top: 0.6rem; }
  .account-section { display: flex; flex-direction: column; gap: 0.4rem; }
  .add-watch-row {
    display: grid;
    grid-template-columns: 200px 1fr auto;
    gap: 0.5rem;
    align-items: center;
  }
  @media (max-width: 600px) {
    .add-watch-row { grid-template-columns: 1fr; }
  }
  .test-result {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.5rem 0.7rem;
    background: var(--bg);
    border: 1px solid var(--divider);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-secondary);
  }
  .sample-body { margin: 0.4rem 0 0; white-space: pre-wrap; color: var(--text-ghost); }
  .muted { color: var(--text-ghost); }
  code {
    font-family: var(--font-mono);
    font-size: 0.85em;
    background: var(--code-bg);
    color: var(--code-text);
    padding: 0.08rem 0.38rem;
  }
</style>
