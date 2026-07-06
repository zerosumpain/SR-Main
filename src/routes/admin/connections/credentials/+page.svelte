<svelte:head><title>Credentials — Admin</title></svelte:head>
<script lang="ts">
  import { untrack } from 'svelte';
  import type { PageData } from './$types';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';

  let { data }: { data: PageData } = $props();

  type CredRow = {
    id: string;
    integrationType: string;
    label: string;
    kind: string;
    lastTestedAt: Date | null;
    lastTestStatus: string | null;
    lastTestError: string | null;
    createdAt: Date;
    updatedAt: Date;
  };

  // Keyed by credentialId: 'idle' | 'testing' | 'deleting' | 'renaming'
  let busyId = $state<string | null>(null);
  let busyAction = $state<string | null>(null);

  // Inline rename state
  let renamingId = $state<string | null>(null);
  let renameValue = $state('');

  // Local copy of grouped so we can update labels without a full reload.
  // untrack() stops Svelte from re-tracking data.grouped on every render.
  let grouped = $state<Record<string, CredRow[]>>(
    untrack(() => data.grouped as Record<string, CredRow[]>)
  );

  function fmtDate(d: Date | null): string {
    if (!d) return '—';
    const dt = d instanceof Date ? d : new Date(d);
    return dt.toLocaleString();
  }

  function statusLabel(status: string | null, error: string | null): string {
    if (!status) return '—';
    if (status === 'ok') return 'ok';
    return `failed${error ? ': ' + error : ''}`;
  }

  function startRename(c: CredRow) {
    renamingId = c.id;
    renameValue = c.label;
  }

  function cancelRename() {
    renamingId = null;
    renameValue = '';
  }

  async function saveRename(c: CredRow) {
    const next = renameValue.trim();
    if (!next || next === c.label) { cancelRename(); return; }
    busyId = c.id;
    busyAction = 'renaming';
    try {
      const res = await fetch(`/admin/connections/credentials/${c.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: next }),
      });
      if (!res.ok) { alert('Rename failed'); return; }
      // Update label in local state
      for (const type of Object.keys(grouped)) {
        grouped[type] = grouped[type].map((row) =>
          row.id === c.id ? { ...row, label: next } : row
        );
      }
      cancelRename();
    } finally {
      busyId = null;
      busyAction = null;
    }
  }

  async function deleteCredential(c: CredRow) {
    if (!confirm(`Delete "${c.label}"? Workflows using it will stop working.`)) return;
    busyId = c.id;
    busyAction = 'deleting';
    try {
      const res = await fetch(`/admin/connections/credentials/${c.id}`, { method: 'DELETE' });
      if (!res.ok) { alert('Delete failed'); return; }
      grouped[c.integrationType] = grouped[c.integrationType].filter((row) => row.id !== c.id);
      if (grouped[c.integrationType].length === 0) {
        delete grouped[c.integrationType];
      }
    } finally {
      busyId = null;
      busyAction = null;
    }
  }

  async function testCredential(c: CredRow) {
    const adapter = data.adapters.find((a) => a.integrationType === c.integrationType);
    if (!adapter?.hasTest) { alert('This integration type has no test handler registered.'); return; }
    busyId = c.id;
    busyAction = 'testing';
    try {
      const res = await fetch(`/api/integrations/test/${c.integrationType}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credentialId: c.id }),
      });
      const body = await res.json();
      if (body.status === 'ok') {
        alert('Connection OK');
      } else {
        alert(`Test failed: ${body.error ?? 'unknown error'}`);
      }
      // Reload to show updated lastTestedAt / lastTestStatus from server
      location.reload();
    } finally {
      busyId = null;
      busyAction = null;
    }
  }

  async function startOAuth(integrationType: string) {
    const res = await fetch(`/api/integrations/oauth/${integrationType}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) { alert('Failed to start OAuth flow'); return; }
    const body = await res.json();
    if (body.authorizationUrl) {
      window.location.href = body.authorizationUrl;
    } else {
      alert('OAuth start returned no authorization URL');
    }
  }

  // ——— Manual (apikey / basic) credential creation ———
  type ManualField = { key: string; label: string; type: 'text' | 'password'; placeholder?: string };
  type ManualSpec = { kind: string; fields: ManualField[]; helpText?: string; helpUrl?: string };

  let connectingType = $state<string | null>(null);
  let connectLabel = $state('');
  let connectFields = $state<Record<string, string>>({});
  let connectBusy = $state(false);
  let connectError = $state<string | null>(null);

  function startConnect(integrationType: string, spec: ManualSpec) {
    connectingType = integrationType;
    connectLabel = '';
    connectError = null;
    const init: Record<string, string> = {};
    for (const f of spec.fields) init[f.key] = '';
    connectFields = init;
  }

  function cancelConnect() {
    connectingType = null;
    connectError = null;
  }

  async function submitConnect(integrationType: string) {
    connectBusy = true;
    connectError = null;
    try {
      const res = await fetch('/api/integrations/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          integrationType,
          label: connectLabel.trim() || integrationType,
          payload: { ...connectFields },
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        connectError = b.message || b.error || `HTTP ${res.status}`;
        return;
      }
      connectingType = null;
      location.reload();
    } finally {
      connectBusy = false;
    }
  }
</script>

<PageWrap width="standard">
  <PageHeader
    kicker="Integrations"
    title="Credentials"
    sub="Encrypted credentials for external services, used by workflow nodes. Add here, then reference in canvas nodes."
  />
  {#if data.adapters.length === 0}
    <section class="nm-sec">
      <div class="empty">
        No integration adapters registered yet. Adapters are added when workflow nodes
        (Apple Calendar, Trello, etc.) are installed and imported by the application.
      </div>
    </section>
  {:else}
    {#each data.adapters as adapter (adapter.integrationType)}
      {@const creds = grouped[adapter.integrationType] ?? []}
      <section class="nm-sec">
        <div class="nm-sec-hd">
          <span class="sr-label-tight">{adapter.integrationType}</span>
          <span class="nm-sec-meta">
            {creds.length} {creds.length === 1 ? 'credential' : 'credentials'}
          </span>
        </div>

        <div class="adapter-caps">
          {#if adapter.hasOauth}<span class="cap-chip">oauth</span>{/if}
          {#if adapter.hasTest}<span class="cap-chip">testable</span>{/if}
          {#if adapter.hasOptions}<span class="cap-chip">resource-picker</span>{/if}
        </div>

        {#if creds.length === 0}
          <div class="empty">No credentials yet for this integration.</div>
        {:else}
          <div class="cred-list">
            {#each creds as c (c.id)}
              {#if renamingId === c.id}
                <div class="cred-card editing">
                  <div class="rename-row">
                    <input
                      type="text"
                      bind:value={renameValue}
                      class="nm-text-input"
                      placeholder="Credential label"
                      onkeydown={(e) => {
                        if (e.key === 'Enter') saveRename(c);
                        if (e.key === 'Escape') cancelRename();
                      }}
                    />
                    <button
                      type="button"
                      class="nm-save-btn"
                      onclick={() => saveRename(c)}
                      disabled={busyId === c.id}
                    >
                      {busyId === c.id && busyAction === 'renaming' ? 'Saving…' : 'Save'}
                    </button>
                    <button type="button" class="btn-ghost" onclick={cancelRename}>Cancel</button>
                  </div>
                </div>
              {:else}
                <div class="cred-card">
                  <div class="cred-main">
                    <div class="cred-title">
                      <span class="cred-label">{c.label}</span>
                      <code class="cred-kind">{c.kind}</code>
                    </div>
                    <div class="cred-meta">
                      <span>Tested: {fmtDate(c.lastTestedAt)}</span>
                      <span class="dot">·</span>
                      <span
                        class="status-chip"
                        class:ok={c.lastTestStatus === 'ok'}
                        class:failed={c.lastTestStatus === 'failed'}
                      >{statusLabel(c.lastTestStatus, c.lastTestError)}</span>
                    </div>
                  </div>

                  <div class="cred-actions">
                    {#if adapter.hasTest}
                      <button
                        type="button"
                        class="row-link"
                        disabled={busyId === c.id}
                        onclick={() => testCredential(c)}
                      >
                        {busyId === c.id && busyAction === 'testing' ? 'Testing…' : 'Test'}
                      </button>
                    {/if}
                    <button
                      type="button"
                      class="row-link"
                      disabled={busyId === c.id}
                      onclick={() => startRename(c)}
                    >Rename</button>
                    <button
                      type="button"
                      class="row-link danger"
                      disabled={busyId === c.id}
                      onclick={() => deleteCredential(c)}
                    >
                      {busyId === c.id && busyAction === 'deleting' ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              {/if}
            {/each}
          </div>
        {/if}

        {#if adapter.hasOauth || adapter.manualCredential}
          <div class="add-row">
            {#if adapter.hasOauth}
              <button
                type="button"
                class="row-link add-link"
                onclick={() => startOAuth(adapter.integrationType)}
              >+ New via OAuth</button>
            {/if}
            {#if adapter.manualCredential && connectingType !== adapter.integrationType}
              <button
                type="button"
                class="row-link add-link"
                onclick={() => startConnect(adapter.integrationType, adapter.manualCredential!)}
              >+ Connect</button>
            {/if}
          </div>
        {/if}

        {#if adapter.manualCredential && connectingType === adapter.integrationType}
          <div class="connect-form">
            {#if adapter.manualCredential.helpText}
              <p class="connect-help">
                {adapter.manualCredential.helpText}
                {#if adapter.manualCredential.helpUrl}
                  <a href={adapter.manualCredential.helpUrl} target="_blank" rel="noreferrer">Learn how →</a>
                {/if}
              </p>
            {/if}
            <label class="connect-field">
              <span class="connect-label">Label</span>
              <input class="nm-text-input" type="text" bind:value={connectLabel} placeholder={`My ${adapter.integrationType}`} />
            </label>
            {#each adapter.manualCredential.fields as f (f.key)}
              <label class="connect-field">
                <span class="connect-label">{f.label}</span>
                <input
                  class="nm-text-input"
                  type={f.type}
                  placeholder={f.placeholder ?? ''}
                  autocomplete="off"
                  value={connectFields[f.key] ?? ''}
                  oninput={(e) => (connectFields = { ...connectFields, [f.key]: (e.currentTarget as HTMLInputElement).value })}
                />
              </label>
            {/each}
            {#if connectError}<p class="connect-err">{connectError}</p>{/if}
            <div class="connect-actions">
              <button type="button" class="nm-save-btn" disabled={connectBusy} onclick={() => submitConnect(adapter.integrationType)}>
                {connectBusy ? 'Connecting…' : 'Connect'}
              </button>
              <button type="button" class="btn-ghost" onclick={cancelConnect}>Cancel</button>
            </div>
          </div>
        {/if}
      </section>
    {/each}
  {/if}

  {#if Object.keys(grouped).some((t) => !data.adapters.find((a) => a.integrationType === t))}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Orphaned credentials</span>
        <span class="nm-sec-meta">no adapter registered</span>
      </div>
      <div class="cred-list">
        {#each Object.entries(grouped) as [type, creds] (type)}
          {#if !data.adapters.find((a) => a.integrationType === type)}
            {#each creds as c (c.id)}
              <div class="cred-card">
                <div class="cred-main">
                  <div class="cred-title">
                    <span class="cred-label">{c.label}</span>
                    <code class="cred-kind">{c.kind}</code>
                    <code class="cred-kind muted">{type}</code>
                  </div>
                  <div class="cred-meta">
                    <span>Tested: {fmtDate(c.lastTestedAt)}</span>
                  </div>
                </div>
                <div class="cred-actions">
                  <button
                    type="button"
                    class="row-link danger"
                    disabled={busyId === c.id}
                    onclick={() => deleteCredential(c)}
                  >Delete</button>
                </div>
              </div>
            {/each}
          {/if}
        {/each}
      </div>
    </section>
  {/if}
</PageWrap>

<style>
  /* ——— Adapter capability chips ——— */
  .adapter-caps {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
    margin-bottom: 0.75rem;
  }
  .cap-chip {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
    background: rgba(26, 16, 8, 0.04);
    border: 1px solid var(--card-border);
    padding: 2px 7px;
  }

  /* ——— Empty state ——— */
  .empty {
    padding: 1.5rem;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-ghost);
    font-style: italic;
    border: 1px dashed var(--card-border);
  }

  /* ——— Credential list ——— */
  .cred-list { display: grid; gap: 0.6rem; }
  .cred-card {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 1rem;
    padding: 0.85rem 1rem;
    background: var(--bg);
    border: 1px solid var(--card-border);
  }
  .cred-card:hover { border-color: var(--text-primary); }
  .cred-card.editing {
    grid-template-columns: 1fr;
    background: var(--bg-section);
    border-color: var(--accent);
    padding: 1rem 1.1rem;
  }

  .cred-main { min-width: 0; }
  .cred-title {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .cred-label {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    word-break: break-all;
  }
  .cred-kind {
    font-family: var(--font-mono);
    font-size: 10px;
    background: var(--code-bg, rgba(26, 16, 8, 0.06));
    color: var(--code-text, var(--text-secondary));
    padding: 0.08rem 0.38rem;
    border-radius: 2px;
  }
  .cred-kind.muted { opacity: 0.65; }
  .cred-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
    margin-top: 0.35rem;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
  }
  .cred-meta .dot { color: var(--text-ghost); }

  .status-chip {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
  }
  .status-chip.ok { color: var(--success); }
  .status-chip.failed { color: var(--error); }

  .cred-actions {
    display: flex;
    gap: 0.75rem;
    flex-shrink: 0;
    align-items: center;
  }

  .row-link {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-decoration: none;
  }
  .row-link:hover { color: var(--accent-hover); text-decoration: underline; }
  .row-link:disabled { opacity: 0.5; cursor: default; }
  .row-link:disabled:hover { text-decoration: none; color: var(--accent); }
  .row-link.danger { color: var(--error); }
  .row-link.danger:hover { color: var(--error-hover); }
  .row-link.danger:disabled:hover { color: var(--error); }

  /* ——— Rename inline form ——— */
  .rename-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .rename-row .nm-text-input { flex: 1; min-width: 0; }

  .btn-ghost {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 6px 14px;
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--card-border);
    cursor: pointer;
  }
  .btn-ghost:hover { border-color: var(--text-primary); color: var(--text-primary); }

  /* ——— Add via OAuth row ——— */
  .add-row {
    margin-top: 0.75rem;
    display: flex;
    justify-content: flex-start;
  }
  .add-link {
    font-size: 11px;
    letter-spacing: 0.08em;
  }

  /* ——— Manual connect form ——— */
  .connect-form {
    margin-top: 0.75rem;
    padding: 1rem 1.1rem;
    background: var(--bg-section);
    border: 1px solid var(--accent);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .connect-help {
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--text-secondary);
  }
  .connect-help a { color: var(--accent); text-decoration: none; white-space: nowrap; }
  .connect-help a:hover { text-decoration: underline; }
  .connect-field { display: flex; flex-direction: column; gap: 0.3rem; }
  .connect-label {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
  }
  .connect-err {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--error);
  }
  .connect-actions { display: flex; gap: 0.6rem; align-items: center; }

  @media (max-width: 640px) {
    .cred-card { grid-template-columns: 1fr; align-items: flex-start; }
    .cred-actions { justify-content: flex-start; }
    .rename-row { flex-wrap: wrap; }
  }
</style>
