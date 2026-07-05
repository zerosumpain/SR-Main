<script lang="ts">
  import AdminTopNav from './AdminTopNav.svelte';
  import AdminSubNav from './AdminSubNav.svelte';

  let { children } = $props();
</script>

<div class="admin-shell">
  <AdminTopNav />
  <AdminSubNav />
  <main class="admin-content">
    {@render children()}
  </main>
</div>

<style>
  .admin-shell {
    min-height: 100vh;
    background: var(--bg-base);
    color: var(--text-primary);
    font-family: var(--font-body);
  }
  .admin-content {
    min-width: 0;
  }
</style>
