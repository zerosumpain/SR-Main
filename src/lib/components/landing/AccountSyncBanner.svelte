<script lang="ts">
  // Owner-only, and only when something actually wants attention. A banner that
  // is present every day is a banner you stop reading, so there is deliberately
  // no "all good" state — silence is the healthy signal.
  //
  // Two signals share the strip because they answer the same question on the way
  // past: an account that has stopped syncing (something is broken), and work
  // finished and waiting on GitHub (something is ready). They are coloured apart
  // — orange for a fault, petrol for a ready thing — so the strip never implies
  // a merge is a problem.
  import type { SyncAttentionSummary } from '$lib/connectors/summary';
  import type { MergeablePrSummary } from '$lib/github/open-prs';

  let {
    summary,
    prs = null,
  }: { summary: SyncAttentionSummary | null; prs?: MergeablePrSummary | null } = $props();

  // Three names read fine inline; past that it becomes a list nobody parses at
  // a glance, so the rest collapse into a count.
  const named = $derived(summary ? summary.names.slice(0, 3).join(', ') : '');
  const extra = $derived(summary ? summary.names.length - 3 : 0);

  // Same rule for PR numbers, which are shorter, so a couple more fit.
  const prNumbers = $derived(prs ? prs.numbers.slice(0, 4).map((n) => `#${n}`).join(', ') : '');
  const prExtra = $derived(prs ? prs.numbers.length - 4 : 0);
</script>

{#if (summary && summary.count > 0) || (prs && prs.count > 0)}
  <div class="asb-stack">
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

    {#if prs && prs.count > 0}
      <!-- Opens GitHub, which is only useful to someone signed in there with
           access to the repo — the same person this whole strip is gated to. -->
      <a class="asb asb--ready" href={prs.url} target="_blank" rel="noopener noreferrer">
        <span class="asb-dot" aria-hidden="true"></span>
        <span class="asb-text">
          <strong>{prs.count} pull request{prs.count === 1 ? '' : 's'}</strong>
          ready to merge — {prNumbers}{prExtra > 0 ? ` +${prExtra} more` : ''}
        </span>
        <span class="asb-cta">Review →</span>
      </a>
    {/if}
  </div>
{/if}

<style>
  .asb-stack {
    display: flex;
    flex-direction: column;
  }
  /* The owner's strip sits between the ink nav and the hero, so it is the
     masthead's SECOND TIER, not a notice pasted onto the page. Cream on ink
     with an accent seam down the left edge: it continues the band instead of
     cutting it, which is what a cream-on-tinted strip did to the L the nav and
     the vitals rail now form. */
  .asb {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px clamp(24px, 5vw, 64px);
    border-bottom: 1px solid rgba(237, 228, 212, 0.16);
    box-shadow: inset 3px 0 0 var(--accent-on-dark);
    background: var(--text-primary);
    text-decoration: none;
    color: var(--bg);
    transition: background 0.15s ease;
  }
  .asb:hover {
    background: #241608;
  }
  .asb-dot {
    width: 7px;
    height: 7px;
    flex-shrink: 0;
    border-radius: var(--radius-pill, 100px);
    background: var(--accent-on-dark);
    box-shadow: 0 0 6px rgba(232, 134, 58, 0.55);
  }
  .asb-text {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    min-width: 0;
    flex: 1;
  }
  .asb-cta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent-on-dark);
    white-space: nowrap;
  }

  /* Ready, not broken. Same geometry, the other half of the site palette —
     petrol lifted for the ink ground the way the accent is (#0e5b66 scores
     worse than the orange does on #1a1008). */
  .asb--ready {
    box-shadow: inset 3px 0 0 #3fa3b0;
  }
  .asb--ready .asb-dot {
    background: #3fa3b0;
    box-shadow: 0 0 6px rgba(63, 163, 176, 0.5);
  }
  .asb--ready .asb-cta {
    color: #3fa3b0;
  }
</style>
