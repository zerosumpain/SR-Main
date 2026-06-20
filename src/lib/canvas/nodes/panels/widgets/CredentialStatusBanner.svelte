<script lang="ts">
  interface Props {
    credentialId: string | undefined;
  }
  let { credentialId }: Props = $props();

  let status = $state<'ok' | 'failed' | 'untested' | 'loading' | 'no-cred'>('no-cred');
  let lastError = $state<string | null>(null);

  async function refresh(id: string | undefined) {
    if (!id) { status = 'no-cred'; lastError = null; return; }
    status = 'loading';
    lastError = null;
    try {
      const res = await fetch(`/admin/integrations/${encodeURIComponent(id)}/status`);
      if (!res.ok) {
        status = 'failed';
        lastError = `Status fetch ${res.status}`;
        return;
      }
      const b = await res.json();
      status = (b.lastTestStatus as 'ok' | 'failed' | null) ?? 'untested';
      lastError = b.lastTestError ?? null;
    } catch (err) {
      status = 'failed';
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  // Re-fetch when credentialId changes. $effect runs after first mount too.
  $effect(() => {
    const id = credentialId;
    void refresh(id);
  });
</script>

{#if status === 'no-cred'}
  <div class="banner muted">No credential selected.</div>
{:else if status === 'loading'}
  <div class="banner muted">Checking credential…</div>
{:else if status === 'ok'}
  <div class="banner ok">✓ Credential OK</div>
{:else if status === 'failed'}
  <div class="banner err">✗ Credential failed: {lastError ?? 'unknown error'}</div>
{:else}
  <div class="banner warn">Credential not yet tested.</div>
{/if}

<style>
  .banner {
    padding: 5px 8px;
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border: 1px solid var(--card-border);
  }
  .muted {
    background: var(--bg);
    color: var(--text-ghost);
    border-color: var(--card-border);
  }
  .ok {
    background: color-mix(in srgb, var(--status-success, #27ae60) 12%, transparent);
    color: var(--status-success, #27ae60);
    border-color: var(--status-success, #27ae60);
  }
  .warn {
    background: color-mix(in srgb, var(--status-warn, #e67e22) 12%, transparent);
    color: var(--status-warn, #e67e22);
    border-color: var(--status-warn, #e67e22);
  }
  .err {
    background: color-mix(in srgb, var(--status-error, #c0392b) 12%, transparent);
    color: var(--status-error, #c0392b);
    border-color: var(--status-error, #c0392b);
  }
</style>
