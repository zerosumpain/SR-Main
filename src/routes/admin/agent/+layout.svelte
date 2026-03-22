<script lang="ts">
  let { children } = $props();
</script>

<div style="background: var(--bg, #f5f0e8); min-height: 100vh; position: relative; z-index: 10;">
  {@render children()}
</div>
