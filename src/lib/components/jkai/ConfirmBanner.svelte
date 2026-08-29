<script lang="ts">
  let { confirmId, prompt, destructive = true, details, jobId, onresolve }: {
    confirmId: string;
    prompt: string;
    destructive?: boolean;
    details?: Record<string, unknown>;
    jobId: string;
    onresolve: (decision: 'approved' | 'rejected') => void;
  } = $props();

  let submitting = $state(false);
  let error = $state<string | null>(null);

  async function send(decision: 'approved' | 'rejected') {
    if (submitting) return;
    submitting = true;
    error = null;
    try {
      const res = await fetch(`/api/workflows/orchestrator/chat?jobId=${encodeURIComponent(jobId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'confirm_ack', confirmId, decision }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      onresolve(decision);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to send decision';
      submitting = false;
    }
  }
</script>

<section class="confirm-banner" data-destructive={destructive ? 'true' : 'false'} aria-label="Confirm action">
  <header class="confirm-hdr">
    <span class="sr-label-tight">{destructive ? 'confirm destructive action' : 'confirm'}</span>
  </header>
  <p class="confirm-prompt">{prompt}</p>
  {#if details && Object.keys(details).length > 0}
    <details>
      <summary class="sr-label-tight">details</summary>
      <pre class="confirm-details">{JSON.stringify(details, null, 2)}</pre>
    </details>
  {/if}
  {#if error}
    <div class="confirm-error">{error}</div>
  {/if}
  <div class="confirm-actions">
    <button class="nm-save-btn" disabled={submitting} onclick={() => send('approved')}>proceed</button>
    <button class="nm-btn-ghost" disabled={submitting} onclick={() => send('rejected')}>cancel</button>
  </div>
</section>

<style>
  .confirm-banner {
    background: var(--surface-sunken);
    border: 1px solid var(--line-strong);
    padding: 10px 12px;
    margin: 6px 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .confirm-banner[data-destructive="true"] { border-color: var(--status-error); }
  .confirm-hdr { border-bottom: 1px dashed var(--line-strong); padding-bottom: 6px; }
  .confirm-prompt {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }
  .confirm-details {
    font-family: var(--font-code);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    background: var(--surface-sunken);
    padding: 6px 8px;
    margin: 6px 0 0;
    overflow-x: auto;
    max-height: 200px;
  }
  .confirm-error {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--status-error);
    background: var(--error-bg);
    border-left: 2px solid var(--status-error);
    padding: 4px 8px;
  }
  .confirm-actions { display: flex; gap: 8px; align-items: center; }
</style>
