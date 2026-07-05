<script lang="ts">
  import { onMount } from 'svelte';

  interface CredentialEntry {
    id: string;
    label: string;
    kind: string;
  }

  interface Props {
    integrationType: string;
    value: string | undefined;
    onChange: (id: string | undefined) => void;
    label?: string;
    hint?: string;
  }
  let { integrationType, value, onChange, label = 'Credential', hint }: Props = $props();

  let credentials = $state<CredentialEntry[]>([]);
  let loading = $state(true);
  let fetchError = $state<string | null>(null);

  async function refresh() {
    loading = true;
    fetchError = null;
    try {
      const res = await fetch(`/api/admin/integrations/list?integrationType=${encodeURIComponent(integrationType)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      credentials = (await res.json()).credentials;
    } catch (err) {
      fetchError = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  onMount(refresh);

  // Re-fetch when integrationType changes (e.g. panel reconfigured).
  let prevIntegrationType = integrationType;
  $effect(() => {
    if (integrationType !== prevIntegrationType) {
      prevIntegrationType = integrationType;
      void refresh();
    }
  });

  function handleChange(e: Event) {
    const val = (e.currentTarget as HTMLSelectElement).value;
    onChange(val || undefined);
  }
</script>

<div class="cp">
  <span class="cp-label">{label}</span>
  {#if hint}<span class="cp-hint">{hint}</span>{/if}

  {#if loading}
    <select class="cp-select" disabled><option>Loading…</option></select>
  {:else if fetchError}
    <div class="cp-row">
      <select class="cp-select" disabled><option>Error loading credentials</option></select>
      <button type="button" class="cp-mini" onclick={refresh}>↻ Retry</button>
    </div>
    <span class="cp-hint cp-err">Couldn't load: {fetchError}</span>
  {:else if credentials.length === 0}
    <select class="cp-select" disabled><option>No credentials for {integrationType}</option></select>
    <span class="cp-hint">
      No connected credentials.
      <a href="/admin/connections/credentials" target="_blank" rel="noreferrer">Add one at /admin/connections/credentials</a>.
    </span>
  {:else}
    <div class="cp-row">
      <select class="cp-select" value={value ?? ''} onchange={handleChange}>
        <option value="">— select —</option>
        {#each credentials as c (c.id)}
          <option value={c.id}>{c.label} · {c.kind}</option>
        {/each}
      </select>
      <button type="button" class="cp-mini" onclick={refresh} title="Refresh from server">↻</button>
    </div>
    {#if !value}
      <span class="cp-warn">⚠ pick a credential</span>
    {:else}
      <span class="cp-hint">{credentials.length} credential{credentials.length === 1 ? '' : 's'} available.</span>
    {/if}
  {/if}

  <span class="cp-hint">
    Manage credentials at
    <a href="/admin/connections/credentials" target="_blank" rel="noreferrer"><code>/admin/connections/credentials</code></a>.
  </span>
</div>

<style>
  .cp {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .cp-label {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .cp-row {
    display: flex;
    gap: 4px;
    align-items: stretch;
  }
  .cp-row .cp-select {
    flex: 1;
  }
  .cp-select {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    font-family: var(--font-mono);
    font-size: 11px;
    box-sizing: border-box;
    outline: none;
  }
  .cp-select:focus {
    border-color: var(--text-muted);
  }
  .cp-mini {
    padding: 2px 8px;
    background: var(--bg);
    color: var(--text-muted);
    border: 1px dashed var(--card-border);
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    cursor: pointer;
    white-space: nowrap;
  }
  .cp-mini:hover {
    color: var(--text-primary);
  }
  .cp-hint {
    font-size: 11px;
    color: var(--text-ghost);
  }
  .cp-hint a {
    color: var(--text-muted);
  }
  .cp-hint.cp-err {
    color: var(--status-error, #c0392b);
  }
  .cp-warn {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--status-error, #c0392b);
  }
</style>
