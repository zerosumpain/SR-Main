<script lang="ts">
  let {
    buildId,
    failureKind,
    onAfter,
  }: {
    buildId: string;
    failureKind: string | null;
    onAfter: () => void | Promise<void>;
  } = $props();

  let prompt = $state('');
  let busy = $state<string | null>(null);
  let lastError = $state<string | null>(null);

  async function call(label: string, url: string, init: RequestInit) {
    busy = label;
    lastError = null;
    try {
      const r = await fetch(url, init);
      if (!r.ok) {
        const body = await r.text().catch(() => r.statusText);
        lastError = `${label}: ${body.slice(0, 200) || r.statusText}`;
        return false;
      }
      await onAfter();
      return true;
    } finally {
      busy = null;
    }
  }

  async function restart() {
    return call('Restart', `/api/jkai/builds/${buildId}/restart`, { method: 'POST' });
  }
  async function continueWith() {
    if (!prompt.trim()) {
      lastError = 'Add some instructions for the next iteration first.';
      return;
    }
    const ok = await call('Continue', `/api/jkai/builds/${buildId}/continue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: prompt.trim() }),
    });
    if (ok) prompt = '';
  }
  async function replan() {
    if (!confirm('Re-plan from scratch? All iterations will be wiped and the planner will run again.')) return;
    return call('Re-plan', `/api/jkai/builds/${buildId}/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'replan' }),
    });
  }
</script>

<section class="nm-sec recovery">
  <header class="nm-sec-hd">
    <span class="sr-label-tight">Build failed{failureKind ? ` — ${failureKind}` : ''}</span>
  </header>
  <p class="dim">Recovery options:</p>
  <ul class="dim opts">
    <li><strong>Restart</strong> — pick up from the last good iteration with no new instructions. Use this when a service restart or transient error killed the build mid-flight.</li>
    <li><strong>Continue with notes</strong> — fold new guidance into the build prompt and run a fresh planning pass over the existing work.</li>
    <li><strong>Re-plan from scratch</strong> — wipe all iterations and re-run the planner. Use when the original direction was wrong.</li>
  </ul>

  <div class="actions">
    <button class="nm-save-btn" disabled={busy !== null} onclick={restart} type="button">
      {busy === 'Restart' ? '…' : 'Restart from last good iteration'}
    </button>
    <button class="nm-btn-ghost danger" disabled={busy !== null} onclick={replan} type="button">
      {busy === 'Re-plan' ? '…' : 'Re-plan from scratch'}
    </button>
  </div>

  <label class="lbl">Continue with notes</label>
  <textarea
    class="nm-text-input"
    rows="3"
    placeholder="(optional) e.g. 'fix the dark-mode toggle' or 'add the export-to-csv feature' — folded into the prompt for the next planning pass"
    bind:value={prompt}
  ></textarea>
  <div class="actions">
    <button class="nm-btn-ghost" disabled={busy !== null} onclick={continueWith} type="button">
      {busy === 'Continue' ? '…' : 'Continue with notes'}
    </button>
  </div>

  {#if lastError}<p class="err">{lastError}</p>{/if}
</section>

<style>
  .recovery {
    border-left: 3px solid var(--status-error);
    margin-bottom: 1rem;
  }
  .dim {
    color: var(--text-muted);
    font-size: var(--fs-label);
    margin: 0 0 0.5rem;
  }
  .opts {
    padding-left: 1.2rem;
    margin: 0 0 0.8rem;
  }
  .opts li {
    margin-bottom: 0.3rem;
  }
  .opts strong {
    color: var(--text-primary);
  }
  .actions {
    display: flex;
    gap: 0.6rem;
    margin: 0.5rem 0;
    flex-wrap: wrap;
  }
  .lbl {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    margin-top: 0.5rem;
  }
  textarea {
    font-family: var(--font-mono);
    font-size: var(--fs-body);
    margin-top: 0.3rem;
  }
  .err {
    color: var(--status-error);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    margin: 0.5rem 0 0;
  }
</style>
