<script lang="ts">
  import { page } from '$app/state';
  import AdminTopNav from './AdminTopNav.svelte';
  import AdminSubNav from './AdminSubNav.svelte';

  let { children } = $props();
</script>

<div class="admin-shell">
  <AdminTopNav />
  <AdminSubNav />
  {#if !page.data.isOwner}
    <!-- Admin showcase ($lib/server/showcase): what is shown is redacted in
         each load, and the server refuses every change. -->
    <p class="showcase-note">Showcase · read-only. Personal details and secrets are left out, and nothing here can be changed.</p>
  {/if}
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
  .showcase-note {
    margin: 0;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border, currentColor);
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }
</style>
