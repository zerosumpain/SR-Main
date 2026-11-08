<script lang="ts">
  // One block on a /trips sheet: a mono kicker set in the margin, right up
  // against the double red rule, and the block's content to the right of it.
  // On a phone the margin narrows and the kicker turns to run down it
  // (notes-paper.css's .np-kicker).
  import type { Snippet } from 'svelte';

  let {
    kicker = null,
    as = 'section',
    id = undefined,
    children,
    ...rest
  }: {
    kicker?: string | null;
    as?: 'section' | 'div' | 'nav' | 'aside';
    id?: string;
    children: Snippet;
    [attr: string]: unknown;
  } = $props();
</script>

<svelte:element this={as} class="mb" {id} {...rest}>
  <p class="np-kicker mb-k" aria-hidden="true">{kicker ?? ''}</p>
  <div class="mb-body">{@render children()}</div>
</svelte:element>

<style>
  .mb {
    display: grid;
    grid-template-columns: var(--np-margin-x) minmax(0, 1fr);
    column-gap: 28px;
    padding: 20px 28px 20px 0;
    scroll-margin-top: calc(var(--site-nav-height, 48px) + 12px);
  }
  .mb-k {
    align-self: start;
  }
  .mb-body {
    min-width: 0;
  }
  @media (max-width: 760px) {
    .mb {
      column-gap: 12px;
      padding: 16px 16px 16px 0;
    }
  }
</style>
