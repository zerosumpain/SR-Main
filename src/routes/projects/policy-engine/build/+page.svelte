<script lang="ts">
  // The levers are now a drawer available on every page. This legacy route opens the drawer
  // and forwards to Outcomes so old links keep working.
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { app } from '../lib/appState.svelte';
  onMount(async () => {
    await goto('/projects/policy-engine/outcomes', { replaceState: true });
    app.drawerOpen = true; app.drawerPinned = true;
  });
</script>

<div class="redir">Opening the levers…</div>
<style>.redir { padding: 40px 28px; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: rgba(28,22,17,0.5); }</style>
