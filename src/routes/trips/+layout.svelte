<script lang="ts">
  // Every /trips page is written in the notebook: the landing page's NOTES
  // theme (ink cover, torn edge, cream ruled paper with the double red margin
  // rule, index cards, stamps and pencil marks). The kit's stylesheet loads
  // here once; `.np-paper` only sets its inks as custom properties, so each
  // page still decides where its cover, sheet and margin go.
  import '$lib/components/notes-paper/notes-paper.css';
  // v8: the decision cards' shared marks (dx- classes only).
  import '$lib/components/trips/decisions/decisions.css';

  let { children } = $props();
</script>

<div class="np-paper trips-paper">
  {@render children()}
</div>

<style>
  .trips-paper {
    min-height: 100%;
    background: var(--np-desk);
  }
</style>
