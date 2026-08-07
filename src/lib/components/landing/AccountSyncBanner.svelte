<script lang="ts">
  // Owner-only, and only when something is actually wrong. A banner that is
  // present every day is a banner you stop reading, so there is deliberately no
  // "all good" state — silence is the healthy signal.
  import type { SyncAttentionSummary } from '$lib/connectors/summary';

  let { summary }: { summary: SyncAttentionSummary | null } = $props();

  // Three names read fine inline; past that it becomes a list nobody parses at
  // a glance, so the rest collapse into a count.
  const named = $derived(summary ? summary.names.slice(0, 3).join(', ') : '');
  const extra = $derived(summary ? summary.names.length - 3 : 0);
</script>

{#if summary && summary.count > 0}
  <a class="asb" href="/admin/connections">
    <span class="asb-dot" aria-hidden="true"></span>
    <span class="asb-text">
      <strong>{summary.count} account{summary.count === 1 ? '' : 's'}</strong>
      need{summary.count === 1 ? 's' : ''} resyncing — {named}{extra > 0 ? ` +${extra} more` : ''}
    </span>
    <span class="asb-cta">Fix →</span>
  </a>
{/if}

<style>
  .asb {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px clamp(24px, 5vw, 64px);
    border-bottom: 1px solid var(--card-border);
    background: var(--accent-tint-14, rgba(196, 87, 10, 0.08));
    text-decoration: none;
    color: var(--text-primary);
    transition: background 0.15s ease;
  }
  .asb:hover {
    background: var(--surface-overlay);
  }
  .asb-dot {
    width: 7px;
    height: 7px;
    flex-shrink: 0;
    border-radius: var(--radius-pill, 100px);
    background: var(--accent, #c4570a);
  }
  .asb-text {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.04em;
    min-width: 0;
    flex: 1;
  }
  .asb-cta {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent, #c4570a);
    white-space: nowrap;
  }
</style>
