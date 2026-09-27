<svelte:head><title>Gmail — Admin</title></svelte:head>
<script lang="ts">
  import { page } from '$app/stores';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';

  let { data } = $props();

  let accounts = $state(data.accounts);
  let openAccountId = $state<number | null>(null);
  let testQuery = $state<Record<number, string>>({});
  let testResult = $state<Record<number, { count: number; sample: any } | null>>({});
  let busy = $state<Record<string, boolean>>({});

  const connected = $derived($page.url.searchParams.get('connected'));
  const errorCode = $derived($page.url.searchParams.get('error'));

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
    sub="Connected Gmail accounts. Disconnecting one deletes the notes, graph facts and files taken from its mail."
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
              <!-- Test fetch -->
              <div class="account-section">
                <span class="sr-label-tight">Test fetch</span>
                <div class="test-row">
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
  .caret { font-size: var(--fs-label-xs); color: var(--text-ghost); width: 0.8rem; }
  .account-email { font-size: 0.95rem; color: var(--text-primary); font-weight: 500; }
  .account-date { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); margin-left: auto; }
  .account-body { display: flex; flex-direction: column; gap: 0.9rem; padding-top: 0.6rem; }
  .account-section { display: flex; flex-direction: column; gap: 0.4rem; }
  .test-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.5rem;
    align-items: center;
  }
  @media (max-width: 600px) {
    .test-row { grid-template-columns: 1fr; }
  }
  .test-result {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.5rem 0.7rem;
    background: var(--bg);
    border: 1px solid var(--divider);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .sample-body { margin: 0.4rem 0 0; white-space: pre-wrap; color: var(--text-ghost); }
  .muted { color: var(--text-ghost); }
</style>
