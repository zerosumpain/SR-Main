<script lang="ts">
  // I — THE VERDICT. Two lines of Archivo Black, the second at 22% opacity, and
  // beside them the one instruction that matters plus the dates it gets judged
  // on.
  //
  // Every word is computed. `verdict.ts` composes the headline and the body
  // from the same instrument readings the deck drew, which is why this section
  // can be a summary without being a second opinion.
  import type { Verdict } from '$lib/health/verdict';
  import type { Move } from '$lib/health/moves';

  interface Props {
    verdict: Verdict | null;
    /** See `ExperimentsSection` — the anonymous document is one section shorter. */
    letter?: string;
    /**
     * Section D's own list, so the closing quote can offer the button that
     * belongs to the move it is quoting. Anonymous readers get moves whose
     * `action` is null, so this resolves to nothing for them without a second
     * audience check here.
     */
    moves?: Move[];
  }

  let { verdict, letter = 'I', moves = [] }: Props = $props();

  /** The first of the quoted moves that actually has somewhere to send you. */
  const quoteAction = $derived.by(() => {
    // Same guard as the experiment chips: an older payload without the field
    // must cost the button, not the page.
    for (const id of verdict?.pullQuoteMoves ?? []) {
      const action = (moves ?? []).find((m) => m.id === id)?.action;
      if (action) return action;
    }
    return null;
  });
</script>

{#if verdict}
  <section id="health-i" class="i">
    <div class="i-inner">
      <div class="i-left">
        <p class="i-kicker">{letter} / The verdict</p>
        <h2 class="i-headline">
          {verdict.headline[0]}<br /><span class="i-headline-fade">{verdict.headline[1]}</span>
        </h2>
        {#each verdict.body as para, idx (idx)}
          <p class="i-body">{para}</p>
        {/each}
      </div>

      <div class="i-right">
        <p class="i-quote-label">{verdict.pullQuoteLabel}</p>
        <p class="i-quote">{verdict.pullQuote}</p>
        <p class="i-follow">{verdict.pullQuoteFollow}</p>
        <!-- The quote IS the top move's imperative, so the closing section can
             offer the same button section D carries rather than restating the
             sentence and stopping. The action comes off `moves` — it is built
             once there and stripped for the anonymous payload there, so nothing
             unstripped rides along on `verdict`, which is also public. -->
        {#if quoteAction}
          <a class="i-go" href={quoteAction.href} data-sveltekit-preload-data="hover">
            {quoteAction.label} →
          </a>
        {/if}
        {#if verdict.reviews.length}
          <div class="i-reviews">
            {#each verdict.reviews as review (review.label)}
              <div class="i-review">
                <p class="i-review-label">{review.label}</p>
                <p class="i-review-date"><time datetime={review.iso}>{review.date}</time></p>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </section>
{/if}

<style>
  /* The section sets no ground of its own, so it inherits paper — the accent
     and the strong line are the paper tokens, not the on-dark partners. */
  .i-go {
    display: inline-block;
    margin-top: 16px;
    padding: 9px 16px;
    background: none;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-primary);
    text-decoration: none;
    transition:
      border-color 120ms ease,
      color 120ms ease,
      background-color 120ms ease;
  }
  .i-go:hover,
  .i-go:focus-visible {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-tint-04);
  }

  .i {
    padding: clamp(48px, 6vw, 88px) clamp(20px, 3vw, 44px);
  }
  .i-inner {
    max-width: 1400px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
    gap: clamp(32px, 4vw, 72px);
    align-items: start;
  }
  .i-left,
  .i-right {
    min-width: 0;
  }

  .i-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-secondary);
    margin: 0 0 22px;
  }
  .i-headline {
    font-family: var(--font-display);
    font-size: clamp(40px, 6.5vw, 96px);
    line-height: 0.88;
    letter-spacing: -0.02em;
    text-transform: uppercase;
    margin: 0 0 26px;
  }
  .i-headline-fade {
    color: rgba(26, 16, 8, 0.22);
  }
  .i-body {
    font-size: var(--fs-body-lg);
    line-height: 1.6;
    color: var(--text-secondary);
    max-width: 58ch;
    text-wrap: pretty;
    margin: 0 0 18px;
  }
  .i-body:last-child {
    margin-bottom: 0;
  }

  .i-right {
    border-left: 3px solid var(--accent);
    padding-left: clamp(20px, 2.5vw, 32px);
  }
  .i-quote-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0 0 16px;
  }
  .i-quote {
    font-size: clamp(20px, 2.4vw, 30px);
    line-height: 1.35;
    color: var(--text-primary);
    text-wrap: pretty;
    margin: 0 0 28px;
  }
  .i-follow {
    font-size: var(--fs-body-sm);
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 0 0 24px;
    text-wrap: pretty;
  }

  .i-reviews {
    display: flex;
    flex-direction: column;
    gap: 14px;
    border-top: 1px solid rgba(26, 16, 8, 0.14);
    padding-top: 22px;
  }
  .i-review {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 14px;
  }
  .i-review-label,
  .i-review-date {
    font-family: var(--font-mono);
    margin: 0;
  }
  .i-review-label {
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .i-review-date {
    font-size: var(--fs-label);
    font-weight: 500;
    white-space: nowrap;
  }
  .i-review:last-child .i-review-date {
    color: var(--accent);
  }

  @media (max-width: 860px) {
    .i-inner {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
