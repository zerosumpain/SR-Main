<script lang="ts">
  let { children } = $props();
</script>

<div class="jkai-root">
  {@render children()}
</div>

<style>
  .jkai-root {
    min-height: 100vh;
    background: var(--bg, #ede4d4);
    color: var(--text-primary, #1a1008);
    font-family: var(--font-body);
  }
</style>
