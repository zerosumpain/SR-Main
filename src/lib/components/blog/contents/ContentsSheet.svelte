<script lang="ts">
  // The blog's contents pages (/blog, /blog/tag/[tag]) as an exercise book: an
  // optional ink cover, then one sheet of ruled paper lying on the desk, its
  // torn top edge over whatever ink sits above it (the cover, or the site's
  // header bar), and the double red margin rule down it. The geometry is the
  // landing showcase's: a gutter, a margin column the kickers and dates sit
  // in, and the content beyond it, all inside 1312px.
  //
  // Everything inside is set on the rules of `.np-ruled` (the notes-paper
  // kit's baseline grid, at the blog's 32px pitch, measured for DM Sans), so
  // a cover or a block only says how many rules its type takes. Blocks rule
  // themselves (ContentsBlock); the sheet itself is plain paper, so its lines
  // are never drawn twice.
  import type { Snippet } from 'svelte';
  import './contents.css';

  let {
    cover,
    children,
  }: {
    /** The ink cover band above the sheet; it is the tear's ink. */
    cover?: Snippet;
    children: Snippet;
  } = $props();
</script>

<div class="cs np-ruled" data-np-font="body">
  {#if cover}{@render cover()}{/if}
  <div class="np-desk cs-desk">
    <div class="np-sheet np-tear cs-sheet">
      {@render children()}
    </div>
  </div>
</div>

<style>
  .cs {
    /* The landing showcase's measures, so the contents page and the landing's
       notes pages put their margin in the same place. */
    --cs-gut: clamp(16px, 4vw, 64px);
    /* The landing's margin from about 1160px up; narrower than that it keeps
       room for a two-word kicker ("The ledger") without reaching into the
       page's 16px side gutter. */
    --cs-mg: clamp(104px, 9vw, 148px);
    --cs-pad: clamp(14px, 2vw, 32px);
    /* The orange that WRITES on this paper (margin dates, kickers, numbers,
       "read on" links), a shade darker than the kit's so small mono caps
       clear 4.5:1 on the cream with room to spare (about 5.9:1). */
    --np-pen-text: #8f3c06;
    /* The paper and its feint as solid colours, for a tall heading's band
       (contents.css, `.cs-tall`). */
    --cs-ground: var(--np-paper);
    --cs-feint: color-mix(in srgb, rgb(14 91 102) 16%, var(--np-paper));
    display: flex;
    flex-direction: column;
    flex: 1;
    color: var(--text-primary);
  }
  .cs-desk {
    flex: 1;
    display: flex;
    flex-direction: column;
    /* The desk is seen only past the paper's edges on a wide screen, and the
       sheet's shadow must not open a scrollbar on a narrow one. */
    overflow-x: clip;
  }
  .cs-sheet {
    flex: 1;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: calc(1312px + 2 * var(--cs-gut));
    margin: 0 auto;
    box-sizing: border-box;
    /* A tall heading's band stops at the paper's edge, short of the desk. */
    overflow-x: clip;
    /* The margin rule on the same line as every block's margin column (the
       blocks centre 1312px inside the sheet), from just under the torn edge.
       The percentage resolves where the kit uses it, against the sheet. */
    --np-margin-x: calc(max(0px, (100% - 1312px) / 2) + var(--cs-gut) + var(--cs-mg));
    --np-margin-top: 28px;
  }

  /* Night paper keeps the kit's own (lighter) pen. */
  :global(html[data-reading-theme='sepia']) .cs {
    --cs-feint: color-mix(in srgb, rgb(14 91 102) 15%, var(--np-paper));
  }
  :global(html[data-reading-theme='night']) .cs {
    --np-pen-text: var(--accent);
    --cs-feint: color-mix(in srgb, rgb(127 184 192) 13%, var(--np-paper));
  }

  /* The last block takes the rest of a short sheet, so the ruling runs on
     to the foot of the page instead of stopping on blank paper. */
  .cs-sheet > :global(:last-child) {
    flex: 1 0 auto;
  }

  @media (max-width: 760px) {
    .cs {
      --cs-mg: 30px;
      --cs-pad: 14px;
    }
  }

  @media print {
    .cs-desk,
    .cs-sheet {
      display: block;
      max-width: none;
    }
  }
</style>
