<script lang="ts">
  import '../../app.css';
  import { setContext } from 'svelte';
  let { children, data } = $props();

  // Make admin token available to all admin pages
  setContext('adminToken', data?.adminToken || '');
</script>

<div class="min-h-screen" style="background: var(--bg);">
  {@render children()}
</div>
