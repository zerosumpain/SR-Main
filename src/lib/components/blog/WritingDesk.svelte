<script lang="ts">
  /**
   * The writing desk — a durable pre-publish checklist.
   *
   * Two lanes feed it, and the difference matters:
   *
   *  - DETERMINISTIC checks (alt text, metadata, links, placeholders left in
   *    the draft, readability). Rules find these, no model is involved, they
   *    are the same every run, and they are the ONLY lane allowed to raise a
   *    blocker.
   *  - GROUNDED claim checks. Factual assertions are extracted, searched, and
   *    judged against what comes back. These are never blockers, because a
   *    model's opinion is not allowed to stop John publishing.
   *
   * Findings PERSIST. That is the whole reason this is not the old assistant:
   * a proposal is a diff awaiting a decision, and it evaporates on reload; a
   * checklist item is a standing concern with a lifecycle. Resolving one keeps
   * it resolved, and re-running does not replay everything already dealt with.
   */
  import type { ChecklistItem, CheckSeverity } from '$lib/blog/desk/types';

  let {
    postId,
    adminToken,
    canPublish = true,
    onBlockersChanged,
  }: {
    postId: number;
    adminToken: string;
    canPublish?: boolean;
    onBlockersChanged?: (blockers: number) => void;
  } = $props();

  let items = $state<ChecklistItem[]>([]);
  let blockers = $state(0);
  let showResolved = $state(false);
  let loading = $state(false);
  let running = $state(false);
  let phase = $state<string | null>(null);
  let summary = $state<string | null>(null);
  let loaded = $state(false);

  const SEVERITY_ORDER: Record<CheckSeverity, number> = { blocker: 0, review: 1, nit: 2 };

  const visible = $derived(
    [...items]
      .filter((i) => (showResolved ? true : i.status === 'open'))
      .sort((a, b) => {
        const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
        return s !== 0 ? s : a.kind.localeCompare(b.kind);
      }),
  );

  const openCount = $derived(items.filter((i) => i.status === 'open').length);

  async function load() {
    loading = true;
    try {
      const res = await fetch(`/api/admin/blog/${postId}/desk?status=all&token=${adminToken}`);
      if (!res.ok) return;
      const body = (await res.json()) as { items: ChecklistItem[]; blockers: number };
      items = body.items ?? [];
      blockers = body.blockers ?? 0;
      onBlockersChanged?.(blockers);
      loaded = true;
    } catch {
      // The desk is an aid, not the post. A failed load must not break editing.
    } finally {
      loading = false;
    }
  }

  async function run() {
    if (running) return;
    running = true;
    summary = null;
    phase = 'Starting…';
    try {
      const res = await fetch(`/api/admin/blog/${postId}/desk?token=${adminToken}`, { method: 'POST' });
      if (!res.ok || !res.body) {
        summary = `The run failed (${res.status}).`;
        return;
      }
      // NDJSON: whole lines only, the trailing partial carries to the next chunk.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl = buffer.indexOf('\n');
        while (nl !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          nl = buffer.indexOf('\n');
          if (!line) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.type === 'phase') phase = String(ev.message ?? '');
          else if (ev.type === 'claim-start') phase = `Checking: ${String(ev.claim ?? '').slice(0, 70)}…`;
          else if (ev.type === 'error') summary = String(ev.error ?? 'Something failed.');
          else if (ev.type === 'done') {
            const swept = Number(ev.swept ?? 0);
            summary = swept
              ? `Done. ${swept} finding${swept === 1 ? '' : 's'} retired — that text has changed.`
              : 'Done.';
          }
        }
      }
      await load();
    } catch (e) {
      summary = e instanceof Error ? e.message : 'The run failed.';
    } finally {
      running = false;
      phase = null;
    }
  }

  async function setStatus(item: ChecklistItem, status: 'open' | 'resolved' | 'dismissed') {
    const previous = item.status;
    // Optimistic: the queue should not stutter on every click.
    items = items.map((i) => (i.id === item.id ? { ...i, status } : i));
    if (item.severity === 'blocker') {
      blockers = items.filter((i) => i.severity === 'blocker' && i.status === 'open').length;
      onBlockersChanged?.(blockers);
    }
    try {
      const res = await fetch(`/api/admin/blog/${postId}/desk?token=${adminToken}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, status }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      items = items.map((i) => (i.id === item.id ? { ...i, status: previous } : i));
      blockers = items.filter((i) => i.severity === 'blocker' && i.status === 'open').length;
      onBlockersChanged?.(blockers);
    }
  }

  const KIND_LABEL: Record<string, string> = {
    claim: 'Claim',
    link: 'Link',
    readability: 'Readability',
    meta: 'Metadata',
    'alt-text': 'Alt text',
    voice: 'Voice',
    consistency: 'Consistency',
  };
</script>

<section class="nm-sec">
  <div class="nm-sec-hd">
    <span class="sr-label-tight">Before publishing</span>
    <span class="wd-status">
      {#if phase}
        {phase}
      {:else if summary}
        {summary}
      {:else if loaded}
        {openCount === 0 ? 'Nothing outstanding' : `${openCount} to review`}
      {/if}
    </span>
  </div>

  {#if !loaded}
    <div class="wd-actions">
      <button class="nm-btn-ghost" onclick={load} disabled={loading}>
        {loading ? 'Loading…' : 'Show checklist'}
      </button>
      <button class="nm-btn-ghost" onclick={run} disabled={running}>
        {running ? 'Checking…' : 'Run checks'}
      </button>
    </div>
  {:else}
    {#if blockers > 0}
      <p class="wd-blocked">
        {blockers} blocking {blockers === 1 ? 'item' : 'items'}. These are deterministic faults —
        a missing title, a placeholder left in the draft, a broken link — not opinions.
        {#if canPublish}You can still publish; the gate is advisory.{/if}
      </p>
    {/if}

    {#if visible.length === 0}
      <div class="nm-empty">
        {showResolved ? 'Nothing here yet — run the checks.' : 'Nothing outstanding.'}
      </div>
    {:else}
      <ul class="wd-list">
        {#each visible as item (item.id)}
          <li class="wd-item" class:resolved={item.status !== 'open'}>
            <div class="wd-item-hd">
              <span class="wd-sev wd-sev-{item.severity}">{item.severity}</span>
              <span class="wd-kind">{KIND_LABEL[item.kind] ?? item.kind}</span>
              <span class="wd-title">{item.title}</span>
            </div>
            <p class="wd-detail">{item.detail}</p>

            {#if item.anchorText}
              <p class="wd-anchor">“{item.anchorText}”</p>
            {/if}

            {#if item.evidence && item.evidence.length > 0}
              <ul class="wd-evidence">
                {#each item.evidence as e (e.url)}
                  <li>
                    <span class="wd-stance wd-stance-{e.stance}">{e.stance}</span>
                    <a href={e.url} target="_blank" rel="noopener noreferrer">{e.title || e.url}</a>
                  </li>
                {/each}
              </ul>
            {/if}

            <div class="wd-item-actions">
              {#if item.status === 'open'}
                <button class="row-link" onclick={() => setStatus(item, 'resolved')}>Fixed</button>
                <button class="row-link" onclick={() => setStatus(item, 'dismissed')}>Not an issue</button>
              {:else}
                <span class="wd-done">{item.status}</span>
                <button class="row-link" onclick={() => setStatus(item, 'open')}>Reopen</button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    <div class="wd-actions">
      <button class="nm-btn-ghost" onclick={run} disabled={running}>
        {running ? 'Checking…' : 'Re-run checks'}
      </button>
      <button class="nm-btn-ghost" onclick={() => (showResolved = !showResolved)}>
        {showResolved ? 'Hide dealt-with' : 'Show dealt-with'}
      </button>
    </div>
  {/if}
</section>

<style>
  .wd-status {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }

  .wd-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .wd-blocked {
    margin: 0 0 0.75rem;
    padding: 0.55rem 0.8rem;
    border-left: 3px solid var(--warn);
    background: var(--card-bg);
    font-size: var(--fs-body-sm);
    line-height: 1.5;
    color: var(--text-primary);
  }

  .wd-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .wd-item {
    padding: 0.7rem 0;
    border-bottom: 1px solid var(--card-border);
  }

  .wd-item.resolved {
    opacity: 0.5;
  }

  .wd-item-hd {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .wd-sev {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 0.05rem 0.35rem;
    border: 1px solid currentColor;
  }

  .wd-sev-blocker {
    color: var(--error);
  }

  .wd-sev-review {
    color: var(--accent);
  }

  .wd-sev-nit {
    color: var(--text-muted);
  }

  .wd-kind {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }

  .wd-title {
    font-size: var(--fs-body-sm);
    color: var(--text-primary);
  }

  .wd-detail {
    margin: 0.3rem 0 0;
    font-size: var(--fs-body-sm);
    line-height: 1.5;
    color: var(--text-secondary);
  }

  .wd-anchor {
    margin: 0.35rem 0 0;
    padding-left: 0.7rem;
    border-left: 2px solid var(--card-border);
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-muted);
  }

  .wd-evidence {
    list-style: none;
    margin: 0.4rem 0 0;
    padding: 0;
  }

  .wd-evidence li {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    font-size: var(--fs-label);
    margin-bottom: 0.15rem;
  }

  .wd-evidence a {
    color: var(--accent);
    overflow-wrap: anywhere;
  }

  .wd-stance {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    flex: none;
  }

  .wd-stance-supports {
    color: var(--success);
  }

  .wd-stance-contradicts {
    color: var(--error);
  }

  .wd-stance-unclear {
    color: var(--text-muted);
  }

  .wd-item-actions {
    display: flex;
    gap: 0.85rem;
    align-items: center;
    margin-top: 0.4rem;
  }

  .wd-done {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
  }
</style>
