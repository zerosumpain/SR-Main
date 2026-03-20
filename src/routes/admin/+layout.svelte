<script lang="ts">
  import '../../app.css';
  let { children } = $props();
</script>

<div class="min-h-screen" style="background: var(--bg);">
  {@render children()}
</div>
