<script lang="ts">
  import ChatMarkdown from '$lib/canvas/ChatMarkdown.svelte';

  let {
    plan,
    buildId,
    onAfter,
  }: {
    plan: string;
    buildId: string;
    onAfter: () => void | Promise<void>;
  } = $props();

  let body = $state(plan);
  let userTouched = $state(false);
  let preview = $state(false);
  let saving = $state(false);
  let lastError = $state<string | null>(null);
  let lastSyncedPlan = $state(plan);

  // Re-sync from the prop whenever the upstream plan changes (e.g. the
  // planner just emitted a fresh draft via plan_proposed) — but only if
  // the user hasn't started editing locally, so we don't clobber their
  // work mid-typing.
  $effect(() => {
    if (plan !== lastSyncedPlan) {
      lastSyncedPlan = plan;
      if (!userTouched) body = plan;
    }
  });

  async function call(action: string, extra: Record<string, unknown> = {}) {
    saving = true;
    lastError = null;
    try {
      const r = await fetch(`/api/jkai/builds/${buildId}/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      if (!r.ok) {
        const err = await r.text().catch(() => '');
        lastError = `${r.status}: ${err.slice(0, 200) || r.statusText}`;
        return false;
      }
      await onAfter();
      return true;
    } finally {
      saving = false;
    }
  }

  async function saveEdit() {
    return call('edit', { plan: body });
  }
  async function approve() {
    if (await saveEdit()) await call('approve');
  }
  async function skip() {
    return call('skip');
  }
  async function replan() {
    return call('replan');
  }
</script>

<section class="nm-sec planner">
  <header class="nm-sec-hd">
    <span class="sr-label-tight">{body.trim() ? 'Plan — awaiting approval' : 'Plan — none generated yet'}</span>
    <button class="row-link toggle" onclick={() => (preview = !preview)} type="button">
      {preview ? 'Edit' : 'Preview'}
    </button>
  </header>

  {#if !body.trim()}
    <p class="dim">No plan was generated. The planner may have failed mid-flight (e.g. a service restart). Click <strong>Re-plan</strong> to generate a fresh plan, or <strong>Skip & Code Now</strong> to proceed without one.</p>
  {/if}

  {#if preview}
    <div class="preview"><ChatMarkdown content={body} role="assistant" /></div>
  {:else}
    <textarea
      class="nm-text-input"
      rows="20"
      placeholder="Plan markdown will appear here once generated. You can also paste your own plan and click Approve & Start."
      value={body}
      oninput={(e) => {
        body = (e.currentTarget as HTMLTextAreaElement).value;
        userTouched = true;
      }}
    ></textarea>
  {/if}

  <div class="actions">
    <button class="nm-save-btn" disabled={saving} onclick={approve} type="button">
      {saving ? 'Saving…' : 'Approve & Start'}
    </button>
    <button class="nm-btn-ghost" disabled={saving} onclick={replan} type="button">
      Re-plan
    </button>
    <button class="nm-btn-ghost" disabled={saving} onclick={skip} type="button">
      Skip & Code Now
    </button>
  </div>

  {#if lastError}
    <p class="err">{lastError}</p>
  {/if}
</section>

<style>
  .planner {
    margin-bottom: 1rem;
  }
  .toggle {
    margin-left: auto;
  }
  textarea {
    min-height: 320px;
    resize: vertical;
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .preview {
    border: 1px solid var(--card-border);
    background: var(--bg);
    padding: 12px 14px;
    min-height: 200px;
  }
  .actions {
    display: flex;
    gap: 0.6rem;
    margin-top: 0.8rem;
  }
  .dim {
    color: var(--text-muted);
    font-size: 12px;
    margin: 0 0 0.6rem;
  }
  .err {
    color: var(--status-error);
    font-family: var(--font-mono);
    font-size: 11px;
    margin: 0.5rem 0 0;
  }
</style>
