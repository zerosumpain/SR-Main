<script lang="ts">
  // Pending self-heal fixes for this canvas. Self-heal is propose-only: a fix
  // that let a failing step pass during a run is NOT written to the saved
  // workflow — it waits here until the owner applies it (a versioned, audited
  // edit through the amend path) or dismisses it (never proposed again).
  import { untrack } from 'svelte';

  type Proposal = {
    id: string;
    nodeId: string;
    nodeLabel: string;
    description: string;
    createdAt: string;
    runId: string;
    changedKeys: string[];
    occurrences: number;
  };

  type Props = {
    workflowId: string;
    /** Bumped by the page when a run settles — a run may have produced a fix. */
    refreshKey?: number;
    /** Select the node on the canvas. */
    onFocusNode?: (nodeId: string) => void;
  };
  let { workflowId, refreshKey = 0, onFocusNode }: Props = $props();

  let proposals = $state<Proposal[]>([]);
  let busyId = $state<string | null>(null);
  let error = $state<string | null>(null);
  // Internal handle — never read by the template (svelte5-pitfalls §1).
  let inflight: AbortController | null = null;

  async function load(id: string) {
    inflight?.abort();
    const ctrl = new AbortController();
    inflight = ctrl;
    try {
      const res = await fetch(`/api/workflows/${id}/fix-proposals`, { signal: ctrl.signal });
      if (!res.ok) return;
      const body = (await res.json()) as { proposals?: Proposal[] };
      proposals = body.proposals ?? [];
    } catch {
      /* aborted or offline — keep what is shown */
    } finally {
      if (inflight === ctrl) inflight = null;
    }
  }

  $effect(() => {
    // Tracked: the workflow and the run-settled counter. Nothing else.
    const id = workflowId;
    void refreshKey;
    if (!id) return;
    untrack(() => void load(id));
  });

  async function resolve(p: Proposal, action: 'accept' | 'dismiss') {
    busyId = p.id;
    error = null;
    try {
      const res = await fetch(
        `/api/workflows/${workflowId}/fix-proposals/${encodeURIComponent(p.id)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        error = body.error ?? `Could not ${action === 'accept' ? 'apply' : 'dismiss'} the fix (${res.status}).`;
        return;
      }
      // The node update itself reaches the canvas over the /live stream.
      proposals = proposals.filter((x) => x.id !== p.id);
    } finally {
      busyId = null;
    }
  }
</script>

{#if proposals.length > 0}
  <section class="fixp" aria-label="Fixes found during runs">
    {#each proposals as p (p.id)}
      <div class="fixp-row">
        <div class="fixp-text">
          <span class="fixp-hd">
            jkai fixed
            <button type="button" class="fixp-node" onclick={() => onFocusNode?.(p.nodeId)}>{p.nodeLabel}</button>
            during a run — apply permanently?
          </span>
          {#if p.description}<span class="fixp-desc">{p.description}</span>{/if}
          <span class="fixp-meta">
            changes {p.changedKeys.join(', ')}{p.occurrences > 1 ? ` · seen on ${p.occurrences} runs` : ''}
          </span>
        </div>
        <div class="fixp-actions">
          <button type="button" class="fixp-btn fixp-apply" disabled={busyId === p.id} onclick={() => resolve(p, 'accept')}>
            Apply
          </button>
          <button type="button" class="fixp-btn" disabled={busyId === p.id} onclick={() => resolve(p, 'dismiss')}>
            Dismiss
          </button>
        </div>
      </div>
    {/each}
    {#if error}<p class="fixp-err" role="alert">{error}</p>{/if}
  </section>
{/if}

<style>
  .fixp {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--card-border);
    background: color-mix(in srgb, var(--accent) 7%, var(--bg));
  }
  .fixp-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .fixp-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .fixp-hd {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-primary);
  }
  .fixp-node {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--accent-ink);
    text-decoration: underline;
    cursor: pointer;
  }
  .fixp-desc {
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }
  .fixp-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }
  .fixp-actions {
    display: flex;
    gap: 6px;
  }
  .fixp-btn {
    padding: 4px 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    border-radius: 2px;
    cursor: pointer;
  }
  .fixp-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .fixp-apply {
    border-color: var(--accent);
    color: var(--accent-ink);
  }
  .fixp-err {
    margin: 0;
    color: var(--error);
    font-size: var(--fs-label-xs);
  }
</style>
