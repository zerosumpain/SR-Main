<script lang="ts">
  interface Props {
    integrationType: string;
    credentialId: string | undefined;
    onResult?: (status: 'ok' | 'failed', error?: string) => void;
  }
  let { integrationType, credentialId, onResult }: Props = $props();

  let busy = $state(false);
  let lastResult = $state<{ status: 'ok' | 'failed'; error?: string } | null>(null);

  // Clear previous result when the credential or integration type changes.
  $effect(() => {
    // read both reactive props to track dependencies
    void integrationType;
    void credentialId;
    lastResult = null;
  });

  async function run() {
    if (!credentialId || busy) return;
    busy = true;
    lastResult = null;
    try {
      const res = await fetch(`/api/integrations/test/${encodeURIComponent(integrationType)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credentialId }),
      });
      const body = await res.json();
      const result = { status: body.status as 'ok' | 'failed', error: body.error as string | undefined };
      lastResult = result;
      onResult?.(result.status, result.error);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastResult = { status: 'failed', error: msg };
      onResult?.('failed', msg);
    } finally {
      busy = false;
    }
  }
</script>

<div class="tca">
  <button class="tca-btn" type="button" disabled={!credentialId || busy} onclick={run}>
    {busy ? 'Testing…' : 'Test connection'}
  </button>
  {#if lastResult}
    {#if lastResult.status === 'ok'}
      <span class="tca-ok">✓ OK</span>
    {:else}
      <span class="tca-err">✗ Failed: {lastResult.error ?? 'unknown'}</span>
    {/if}
  {/if}
</div>

<style>
  .tca {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .tca-btn {
    padding: 4px 10px;
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
  .tca-btn:hover:not(:disabled) {
    color: var(--text-primary);
  }
  .tca-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .tca-ok {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--status-success, #27ae60);
  }
  .tca-err {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--status-error, #c0392b);
  }
</style>
