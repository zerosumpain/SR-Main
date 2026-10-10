<script lang="ts">
  /**
   * Article body: the element a post's rendered HTML is written into.
   *
   * Its only consumer is PostSheet, the /blog reading surface. Its typography
   * and layout are the notes paper and live in
   * `$lib/components/blog/post-prose.css` and `post-paper.css`, loaded by
   * `PostSheet`, keyed on the `pp-prose` class the sheet passes: the body is a
   * subgrid of the sheet, so figures can bleed, margin notes can sit in the
   * right-hand column and every text block is set on the page's rules. They
   * used to live here, as `.prose :global(tag)` rules at (0,2,1); a paper
   * surface cannot be layered over those without out-specifying every one of
   * them. The old single-column "plain" mode went with them: nothing used it.
   *
   * The `prose` class itself stays: the reading themes in app.css dim images
   * under `.prose` on the night ground.
   */
  let {
    class: className = '',
    /** A `--font-*` reference from $lib/blog/fonts. */
    bodyFont = 'var(--font-read)',
    children,
  }: {
    class?: string;
    bodyFont?: string;
    children: import('svelte').Snippet;
  } = $props();
</script>

<div class="prose {className}" style="--prose-font: {bodyFont};">
  {@render children()}
</div>

<style>
  .prose {
    font-family: var(--prose-font, var(--font-body));
  }
</style>
