<script lang="ts">
  import type { ClarifyQuestion } from '$lib/workflows/chat/job-store';

  let { clarifyId, questions, jobId, onresolve }: {
    clarifyId: string;
    questions: ClarifyQuestion[];
    jobId: string;
    onresolve: (answers: Record<string, string>) => void;
  } = $props();

  let answers = $state<Record<string, string>>(
    Object.fromEntries(questions.map((q) => [q.id, '']))
  );
  let submitting = $state(false);
  let error = $state<string | null>(null);

  const canSubmit = $derived(questions.every((q) => (answers[q.id] ?? '').trim().length > 0));

  async function submit() {
    if (submitting || !canSubmit) return;
    submitting = true;
    error = null;
    try {
      const res = await fetch(`/api/workflows/orchestrator/chat?jobId=${encodeURIComponent(jobId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'clarify_ack', clarifyId, answers }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      onresolve(answers);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to submit answers';
      submitting = false;
    }
  }
</script>

<section class="clarify-card" aria-label="Clarifying questions">
  <header class="clarify-hdr">
    <span class="sr-label-tight">need a little more info</span>
  </header>
  <ul class="q-list">
    {#each questions as q (q.id)}
      <li class="q-item">
        <label for="clarify-{clarifyId}-{q.id}" class="q-text">{q.text}</label>
        {#if q.kind === 'choice' && q.choices && q.choices.length > 0}
          <select
            id="clarify-{clarifyId}-{q.id}"
            class="nm-text-input"
            bind:value={answers[q.id]}
            disabled={submitting}
          >
            <option value="">—</option>
            {#each q.choices as choice}
              <option value={choice}>{choice}</option>
            {/each}
          </select>
        {:else}
          <input
            id="clarify-{clarifyId}-{q.id}"
            class="nm-text-input"
            type="text"
            bind:value={answers[q.id]}
            disabled={submitting}
          />
        {/if}
      </li>
    {/each}
  </ul>
  {#if error}
    <div class="clarify-error">{error}</div>
  {/if}
  <div class="clarify-actions">
    <button class="nm-save-btn" disabled={submitting || !canSubmit} onclick={submit}>continue</button>
  </div>
</section>

<style>
  .clarify-card {
    background: var(--bg-section);
    border: 1px solid var(--accent);
    padding: 10px 12px;
    margin: 6px 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .clarify-hdr { border-bottom: 1px dashed var(--card-border); padding-bottom: 6px; }
  .q-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .q-item { display: flex; flex-direction: column; gap: 4px; }
  .q-text {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-primary);
  }
  .clarify-error {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--status-error);
    background: rgba(194, 91, 91, 0.08);
    border-left: 2px solid var(--status-error);
    padding: 4px 8px;
  }
  .clarify-actions { display: flex; gap: 8px; }
</style>
