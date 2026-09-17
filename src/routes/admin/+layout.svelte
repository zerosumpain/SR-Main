<script lang="ts">
  import '../../app.css';
  import '$lib/styles/nm-tokens.css';
  import './admin.css';

  import { page } from '$app/stores';
  import AdminShell from '$lib/components/admin/AdminShell.svelte';

  let { children } = $props();

  // Make admin token available to all admin pages (passed via ?token= URL param)

</script>

<AdminShell>
  {@render children()}
</AdminShell>
