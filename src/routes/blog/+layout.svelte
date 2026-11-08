<script lang="ts">
  // Every public /blog page (the index, a tag, a post, a share-link preview)
  // is written on the landing page's notes paper. The kit's stylesheet loads
  // here, once, for all of them, and `.np-paper` carries its inks (the feint,
  // the margin rule, the pens) so a page only has to say WHERE its sheet, rules
  // and margin go. The wrapper sets custom properties and nothing else: no
  // background, no box, no landmark, so each page keeps its own <main>,
  // headings and chrome. The owner's editor lives under /admin and never
  // loads this.
  import '$lib/components/notes-paper/notes-paper.css';

  let { children } = $props();
</script>

<div class="np-paper">
  {@render children()}
</div>
