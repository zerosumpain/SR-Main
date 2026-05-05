<script lang="ts">
  /**
   * Iteration boundary card rendered inline in the V3 single-pane stream.
   * Marks where one iteration ends and the next begins, surfaces per-iter
   * metadata (goals, evaluation, duration, tokens, status), and lets the
   * user collapse a finished iteration's body to a one-line summary so
   * recent activity stays visible without scrolling past everything.
   */
  import type { JkaiIteration } from '$lib/db/schema';

  let {
    iter,
    eventCount,
    expanded = true,
    isLatest = false,
    onToggle,
  }: {
    iter: JkaiIteration | null;
    eventCount: number;
    expanded?: boolean;
    isLatest?: boolean;
    onToggle?: () => void;
  } = $props();

  function fmtDuration(ms: number | null | undefined): string {
    if (!ms || !Number.isFinite(ms)) return '';
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }
  function fmtTokens(n: number | null | undefined): string {
    if (!n) return '';
    if (n < 1000) return `${n} tok`;
    if (n < 1000000) return `${(n / 1000).toFixed(1)}k tok`;
    return `${(n / 1000000).toFixed(2)}M tok`;
  }

  // First non-empty line of evaluation works as a 1-line summary in the
  // collapsed state. If no evaluation yet, fall back to goals or a
  // generic "running…" placeholder.
  const summaryLine = $derived.by(() => {
    if (iter?.evaluation) {
      const firstLine = iter.evaluation.split('\n').find((l) => l.trim());
      if (firstLine) return firstLine.trim().slice(0, 200);
    }
    if (iter?.goals) {
      const firstLine = iter.goals.split('\n').find((l) => l.trim());
      if (firstLine) return firstLine.trim().slice(0, 200);
    }
    return iter?.status === 'running' ? 'running…' : 'No summary recorded';
  });

  const iterLabel = $derived(
    iter?.number === 0 ? 'Plan' : `Iteration ${iter?.number ?? '?'}`,
  );
  const statusKind = $derived(iter?.status ?? 'unknown');

  function toggle(): void {
    onToggle?.();
  }
</script>

<div class="iter-hdr" data-status={statusKind} class:expanded class:latest={isLatest}>
  <button class="iter-toggle" onclick={toggle} type="button" aria-expanded={expanded}>
    <span class="iter-caret">{expanded ? '▾' : '▸'}</span>
    <span class="iter-rule" aria-hidden="true">━━</span>
    <span class="iter-name">{iterLabel}</span>
    <span class="iter-status" data-status={statusKind}>{statusKind}</span>
    {#if iter?.durationMs}
      <span class="iter-meta">{fmtDuration(iter.durationMs)}</span>
    {/if}
    {#if iter?.tokensUsed}
      <span class="iter-meta">{fmtTokens(iter.tokensUsed)}</span>
    {/if}
    {#if !expanded && eventCount > 0}
      <span class="iter-meta dim">{eventCount} event{eventCount === 1 ? '' : 's'}</span>
    {/if}
    <span class="iter-summary">{summaryLine}</span>
    <span class="iter-rule fill" aria-hidden="true"></span>
  </button>

  {#if expanded && (iter?.goals || iter?.evaluation || iter?.nextSteps)}
    <div class="iter-detail">
      {#if iter?.goals && iter.number > 0}
        <div class="iter-section">
          <span class="iter-section-label">Goal</span>
          <span class="iter-section-body">{iter.goals}</span>
        </div>
      {/if}
      {#if iter?.evaluation}
        <div class="iter-section">
          <span class="iter-section-label">Evaluation</span>
          <span class="iter-section-body">{iter.evaluation}</span>
        </div>
      {/if}
      {#if iter?.nextSteps}
        <div class="iter-section">
          <span class="iter-section-label">Next</span>
          <span class="iter-section-body">{iter.nextSteps}</span>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .iter-hdr {
    margin: 0.6rem 0 0.3rem;
    padding: 0;
    border-top: 1px dashed var(--card-border);
    background: color-mix(in srgb, var(--text-primary) 3%, transparent);
  }
  .iter-hdr.latest {
    border-top: 2px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 5%, transparent);
  }
  .iter-toggle {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    width: 100%;
    background: transparent;
    border: none;
    padding: 0.4rem 0.5rem;
    cursor: pointer;
    text-align: left;
    color: var(--text-primary);
    font-family: var(--font-mono), monospace;
    font-size: 11px;
  }
  .iter-toggle:hover { background: color-mix(in srgb, var(--accent) 6%, transparent); }
  .iter-caret { color: var(--accent); flex-shrink: 0; width: 12px; }
  .iter-rule { color: var(--accent); flex-shrink: 0; }
  .iter-rule.fill {
    flex: 1;
    border-bottom: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
    margin-bottom: 4px;
    margin-left: 0.5rem;
  }
  .iter-name {
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-weight: 700;
    color: var(--text-primary);
    flex-shrink: 0;
  }
  .iter-status {
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 9px;
    padding: 1px 6px;
    border: 1px solid currentColor;
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .iter-status[data-status='running'] { color: var(--accent); }
  .iter-status[data-status='completed'] { color: var(--status-success, #10b981); }
  .iter-status[data-status='failed'] { color: var(--status-error, #c0392b); }
  .iter-meta {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .iter-meta.dim { color: var(--text-ghost); }
  .iter-summary {
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
    font-style: italic;
  }
  .iter-detail {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.4rem 0.7rem;
    padding: 0.2rem 0.6rem 0.5rem 1.7rem;
    font-family: var(--font-mono), monospace;
    font-size: 11px;
  }
  .iter-section {
    display: contents;
  }
  .iter-section-label {
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 9px;
    color: var(--accent);
    align-self: start;
  }
  .iter-section-body {
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
