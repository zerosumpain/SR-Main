<script lang="ts">
  let {
    buildId,
    onAfter,
  }: {
    buildId: string;
    onAfter: () => void | Promise<void>;
  } = $props();

  let notes = $state('');
  let saving = $state(false);
  let lastError = $state<string | null>(null);

  async function call(action: string, body: Record<string, unknown> = {}) {
    saving = true;
    lastError = null;
    try {
      const r = await fetch(`/api/jkai/builds/${buildId}/iter`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...body }),
      });
      if (!r.ok) {
        lastError = `${r.status}: ${(await r.text()).slice(0, 200) || r.statusText}`;
        return;
      }
      await onAfter();
    } finally {
      saving = false;
    }
  }
</script>

<section class="nm-sec gate">
  <header class="nm-sec-hd">
    <span class="sr-label-tight">Iteration awaiting approval</span>
  </header>
  <p class="dim">The latest iteration completed. Review the activity above and either continue or reject with notes that will be fed into the next iteration.</p>
  <textarea
    class="nm-text-input"
    rows="4"
    placeholder="(optional) reject notes — guidance for the next iteration"
    bind:value={notes}
  ></textarea>
  <div class="actions">
    <button class="nm-save-btn" disabled={saving} onclick={() => call('approve')} type="button">
      {saving ? 'Saving…' : 'Approve & Continue'}
    </button>
    <button class="nm-btn-ghost" disabled={saving} onclick={() => call('reject', { notes })} type="button">
      Reject with notes
    </button>
  </div>
  {#if lastError}<p class="err">{lastError}</p>{/if}
</section>

<style>
  .gate {
    margin-bottom: 1rem;
  }
  .actions {
    display: flex;
    gap: 0.6rem;
    margin-top: 0.6rem;
  }
  textarea {
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .dim {
    color: var(--text-muted);
    margin: 0 0 0.5rem;
    font-size: 12px;
  }
  .err {
    color: var(--status-error);
    font-family: var(--font-mono);
    font-size: 11px;
    margin: 0.5rem 0 0;
  }
</style>
