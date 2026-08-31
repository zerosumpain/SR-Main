<script lang="ts">
  // The masthead every section on the daydream hub opens with — the same shape
  // /health uses: a lettered mono kicker, a display headline broken where the
  // design wants it broken, and one standfirst pushed to the right edge.
  //
  // The headline is an ARRAY OF LINES rather than a string carrying a `<br>`,
  // so no copy has to travel through `{@html}` to keep its fold.
  import type { Snippet } from 'svelte';

  interface Props {
    /** `B / THE FEED` — the letter is part of the copy. */
    kicker: string;
    /** One entry per rendered line. */
    title: string[];
    strap?: string | null;
    /** On the `#1a1008` bands the kicker goes accent and the strap goes cream. */
    dark?: boolean;
    /** Measure of the standfirst. */
    strapCh?: number;
    /** Controls that belong with the head rather than the body — a CTA. */
    aside?: Snippet;
  }

  let {
    kicker,
    title,
    strap = null,
    dark = false,
    strapCh = 44,
    aside = undefined,
  }: Props = $props();
</script>

<div class="sh" class:dark>
  <div class="sh-left">
    <p class="sh-kicker">{kicker}</p>
    <h2 class="sh-title">
      {#each title as line, i (i)}{#if i > 0}<br />{/if}{line}{/each}
    </h2>
  </div>
  <div class="sh-right">
    {#if strap}
      <p class="sh-strap" style="max-width: {strapCh}ch">{strap}</p>
    {/if}
    {#if aside}
      <div class="sh-aside">{@render aside()}</div>
    {/if}
  </div>
</div>

<style>
  .sh {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 28px;
    flex-wrap: wrap;
    margin-bottom: clamp(22px, 2.8vw, 36px);
  }
  .sh-left {
    min-width: 0;
  }
  .sh-right {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 14px;
    min-width: 0;
  }

  .sh-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-secondary);
    margin: 0 0 12px;
  }
  .sh.dark .sh-kicker {
    color: var(--accent-on-dark);
  }

  .sh-title {
    font-family: var(--font-display);
    font-size: clamp(24px, 3.2vw, 40px);
    line-height: 0.94;
    letter-spacing: -0.02em;
    text-transform: uppercase;
    margin: 0;
  }

  .sh-strap {
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-secondary);
    text-wrap: pretty;
    margin: 0;
  }
  .sh.dark .sh-strap {
    color: rgba(237, 228, 212, 0.7);
  }

  .sh-aside {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
</style>
