<script lang="ts">
  // One stretch of a contents sheet: its own ruling, anchored at its own top
  // (`.np-lined`), and kept a whole number of rules tall (`snapToRule`), so
  // whatever the browser makes of the block above, this one starts on a line.
  // A kicker, when given, sits in the margin column on the block's first
  // rule, right up against the red rule (it runs down the margin on phones).
  // The space above and below is in whole rules and is PADDING, so it is
  // ruled too.
  //
  //   <ContentsBlock kicker="The ledger">…</ContentsBlock>
  //   <ContentsBlock wide>…rows that use the margin themselves…</ContentsBlock>
  import type { Snippet } from 'svelte';
  import { snapToRule } from '$lib/components/notes-paper/snap';

  let {
    kicker = null,
    kickerAs = 'p',
    wide = false,
    as = 'section',
    top = 0,
    bottom = 1,
    children,
    ...rest
  }: {
    /** Mono caps in the margin. */
    kicker?: string | null;
    /** `h2` when the kicker is the block's heading; otherwise it is a mark, hidden from screen readers. */
    kickerAs?: 'p' | 'h2';
    /** The body spans the margin column too (for rows that put dates there). */
    wide?: boolean;
    as?: 'section' | 'div' | 'nav';
    /** Blank rules above the block's first line. */
    top?: number;
    /** Blank rules after its last line. */
    bottom?: number;
    children: Snippet;
    [attr: string]: unknown;
  } = $props();
</script>

<svelte:element
  this={as}
  class="cb np-lined"
  style:--cb-top={top}
  style:--cb-bottom={bottom}
  use:snapToRule
  {...rest}
>
  <div class="cb-in" class:wide>
    {#if kicker && !wide}
      <svelte:element this={kickerAs} class="np-kicker cb-k" aria-hidden={kickerAs === 'p' ? 'true' : undefined}
        >{kicker}</svelte:element
      >
    {/if}
    <div class="cb-body">
      {@render children()}
    </div>
  </div>
</svelte:element>

<style>
  .cb {
    position: relative;
    padding-top: calc(var(--cb-top) * var(--np-l));
    padding-bottom: calc(var(--cb-bottom) * var(--np-l) + var(--np-snap, 0px));
  }
  .cb-in {
    display: grid;
    grid-template-columns: var(--cs-mg) minmax(0, 1fr);
    max-width: 1312px;
    margin: 0 auto;
    padding: 0 var(--cs-gut);
    box-sizing: border-box;
  }
  .cb-k {
    grid-column: 1;
    grid-row: 1;
    min-width: 0;
  }
  /* A two-word kicker in a narrow margin may borrow the gutter to its left
     rather than break onto a second rule. */
  @media (min-width: 761px) {
    .cb-k {
      margin-left: calc(-1 * var(--cs-gut));
      white-space: nowrap;
    }
  }
  .cb-body {
    grid-column: 2;
    grid-row: 1;
    min-width: 0;
    padding-left: var(--cs-pad);
  }
  .cb-in.wide .cb-body {
    grid-column: 1 / -1;
    padding-left: 0;
  }

  @media print {
    .cb {
      padding: 0 0 12px;
    }
    .cb-in {
      display: block;
      padding: 0;
    }
    .cb-k {
      display: none;
    }
    .cb-body {
      padding: 0;
    }
  }
</style>
