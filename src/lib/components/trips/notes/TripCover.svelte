<script lang="ts">
  // The ink cover at the top of a /trips page: the landing hero's ruled ink,
  // a mono kicker in the margin, the title in Inter 800 with a Fraunces italic
  // line under it, and whatever hand marks the page puts on the right (a date
  // stamp, a tally of days). The sheet below wears `.np-tear`, so the cover's
  // torn edge falls onto the paper.
  import type { Snippet } from 'svelte';

  let {
    kicker,
    title,
    line = null,
    titleId = 'trip-cover-h',
    marks,
    actions,
  }: {
    kicker: string;
    title: string;
    /** The Fraunces italic line under the title. */
    line?: string | null;
    titleId?: string;
    /** Hand marks on the right: stamps, tallies, ringed counts. */
    marks?: Snippet;
    /** Small controls under the title (Re-plan, Details). */
    actions?: Snippet;
  } = $props();
</script>

<section class="cover" aria-labelledby={titleId}>
  <div class="cover-in">
    <p class="cover-k" aria-hidden="true">{kicker}</p>
    <div class="cover-copy">
      <h1 id={titleId}>{title}</h1>
      {#if line}<p class="line">{line}</p>{/if}
      {#if actions}<div class="actions">{@render actions()}</div>{/if}
    </div>
    {#if marks}<div class="marks">{@render marks()}</div>{/if}
  </div>
</section>

<style>
  .cover {
    --cover-l: 32px;
    background-color: var(--text-primary);
    background-image: repeating-linear-gradient(
      to bottom,
      transparent 0 25px,
      var(--on-ink-05) 25px 26px,
      transparent 26px var(--cover-l)
    );
    color: var(--bg);
    padding: 40px 0 52px;
  }
  .cover-in {
    display: grid;
    grid-template-columns: var(--np-margin-x) minmax(0, 1fr) auto;
    align-items: end;
    gap: 0 28px;
    max-width: 1480px;
    margin: 0 auto;
    padding-right: 24px;
    box-sizing: border-box;
  }
  .cover-k {
    align-self: start;
    margin: 14px 0 0;
    padding-right: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    text-align: right;
    color: var(--accent-on-dark);
  }
  .cover-copy {
    min-width: 0;
  }
  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(42px, 6vw, 84px);
    line-height: 1;
    letter-spacing: -0.045em;
    color: var(--bg);
    overflow-wrap: anywhere;
  }
  .line {
    margin: 10px 0 0;
    max-width: 60ch;
    font-family: var(--fs-serif);
    font-optical-sizing: auto;
    font-style: italic;
    font-size: clamp(20px, 2.2vw, 28px);
    line-height: 1.3;
    color: var(--accent-on-dark);
    text-wrap: pretty;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 10px;
    margin-top: 18px;
  }
  .actions :global(button),
  .actions :global(a) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    text-decoration: none;
    padding: 6px 12px;
    border: 1px solid var(--on-ink-45);
    border-radius: 100px;
    background: transparent;
    color: var(--bg);
    cursor: pointer;
  }
  .actions :global(button:hover:not(:disabled)),
  .actions :global(a:hover),
  .actions :global(button:focus-visible),
  .actions :global(a:focus-visible) {
    border-color: var(--accent-on-dark);
    color: var(--accent-on-dark);
    outline: none;
  }
  .actions :global(button:disabled) {
    opacity: 0.5;
    cursor: progress;
  }
  .marks {
    display: flex;
    align-items: flex-end;
    gap: clamp(20px, 3vw, 44px);
  }
  /* Stamps and rings re-inked for the cover. */
  .marks :global(.np-stamp) {
    color: var(--accent-on-dark);
  }
  .marks :global(.np-stamp path),
  .marks :global(.np-ring path) {
    stroke: var(--accent-on-dark);
  }
  .marks :global(.np-tally) {
    --tone: var(--on-ink-80);
  }
  @media (max-width: 760px) {
    .cover {
      padding: 26px 0 40px;
    }
    .cover-in {
      grid-template-columns: var(--np-margin-x) minmax(0, 1fr);
      gap: 0 14px;
      padding-right: 16px;
    }
    .cover-k {
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      justify-self: center;
      margin: 4px 0 0;
      padding: 0;
    }
    .marks {
      grid-column: 2;
      flex-wrap: wrap;
      margin-top: 22px;
      gap: 18px 24px;
    }
  }
  @media print {
    .cover {
      background: none;
      color: #1a1008;
    }
    h1,
    .line {
      color: #1a1008;
    }
    .actions {
      display: none;
    }
  }
</style>
