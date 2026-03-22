<script lang="ts">
  let { children } = $props();
</script>

<!-- Solid background covers the biome canvas behind it -->
<div style="background: #0a0a0f; min-height: 100vh; position: relative; z-index: 10;">
  {@render children()}
</div>
