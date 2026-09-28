<script lang="ts">
  // The guide at the top of the Inbox: the four stages every note moves
  // through, each with its live count.
  //
  // Open on a first visit, with a sentence per stage. "Got it" folds it to a
  // one-line track that still carries the counts, and "How it works" opens it
  // again. The choice is kept in localStorage — a per-browser convenience, not
  // state; the page renders correctly (open) when storage is unavailable.
  import { onMount } from 'svelte';
  import { STAGES, STAGE_EXPLAIN, STAGE_LABEL, type Stage } from '$lib/daydream/think/explain';

  interface Props {
    counts: Record<Stage, number>;
    /** Words under each count. */
    captions: Record<Stage, string>;
  }
  let { counts, captions }: Props = $props();

  const KEY = 'sr.daydream.guide';
  let open = $state(true);
  onMount(() => {
    try {
      open = localStorage.getItem(KEY) !== 'folded';
    } catch {
      /* private window: stay open */
    }
  });
  function set(next: boolean) {
    open = next;
    try {
      localStorage.setItem(KEY, next ? 'open' : 'folded');
    } catch {
      /* no storage: the fold lasts this visit */
    }
  }
</script>

<section class="guide" class:open aria-labelledby="guide-title">
  <div class="guide-head">
    <p class="guide-kicker" id="guide-title">How daydream works</p>
    {#if open}
      <button type="button" class="guide-toggle" onclick={() => set(false)}>Got it — fold this away</button>
    {:else}
      <button type="button" class="guide-toggle" onclick={() => set(true)}>How it works</button>
    {/if}
  </div>

  <ol class="steps">
    {#each STAGES as s, i (s)}
      <li class="step">
        <div class="step-top">
          <span class="num">{String(i + 1).padStart(2, '0')}</span>
          <span class="name">{STAGE_LABEL[s]}</span>
          {#if i < STAGES.length - 1}
            <svg class="arrow" viewBox="0 0 24 12" aria-hidden="true"><path d="M0 6h21M16 1l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>
          {/if}
        </div>
        <p class="count"><strong>{counts[s]}</strong> <span>{captions[s]}</span></p>
        {#if open}<p class="explain">{STAGE_EXPLAIN[s]}</p>{/if}
      </li>
    {/each}
  </ol>
</section>

<style>
  .guide {
    border: 1px solid var(--line-strong);
    background: var(--surface-card, transparent);
    padding: 16px 18px;
  }
  .guide.open {
    background: var(--text-primary);
    color: var(--bg);
    border-color: var(--text-primary);
    padding: 22px clamp(18px, 2.4vw, 28px) 24px;
  }
  .guide-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 12px;
  }
  .guide-kicker {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--accent-ink);
  }
  .open .guide-kicker {
    color: var(--accent-on-dark);
  }
  .guide-toggle {
    background: none;
    border: 0;
    padding: 4px 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-secondary);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .open .guide-toggle {
    color: var(--bg);
    opacity: 0.8;
  }
  .guide-toggle:hover {
    color: var(--accent);
    opacity: 1;
  }
  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 18px;
  }
  .step {
    min-width: 0;
  }
  .step-top {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--line-hair);
  }
  .open .step-top {
    border-bottom-color: rgba(237, 228, 212, 0.18);
  }
  .num {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .open .num {
    color: var(--accent-on-dark);
  }
  .name {
    font-family: var(--font-display);
    font-size: var(--fs-body-lg);
    text-transform: uppercase;
    letter-spacing: 0.01em;
    white-space: nowrap;
  }
  .arrow {
    width: 22px;
    height: 12px;
    margin-left: auto;
    color: var(--text-ghost);
    flex: none;
  }
  .open .arrow {
    color: var(--accent-on-dark);
  }
  .count {
    margin: 8px 0 0;
    font-size: var(--fs-nav);
    color: var(--text-secondary);
    display: flex;
    align-items: baseline;
    gap: 6px;
    flex-wrap: wrap;
  }
  .open .count {
    color: rgba(237, 228, 212, 0.75);
  }
  .count strong {
    font-family: var(--font-display);
    font-size: var(--fs-display-xs);
    font-weight: 400;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
  .open .count strong {
    color: var(--bg);
  }
  .explain {
    margin: 10px 0 0;
    font-size: var(--fs-body-sm);
    line-height: 1.5;
    color: rgba(237, 228, 212, 0.86);
  }
  @media (max-width: 720px) {
    .steps {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .arrow {
      display: none;
    }
  }
</style>
