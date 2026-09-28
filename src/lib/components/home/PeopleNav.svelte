<script lang="ts">
  let { active, owner = true }: { active: 'now' | 'places'; owner?: boolean } = $props();
</script>
<nav class="people-nav" aria-label="People pages">
  <a href="/home/people" aria-current={active === 'now' ? 'page' : undefined}>Travel desk</a>
  {#if owner}
    <a href="/home/people/places" aria-current={active === 'places' ? 'page' : undefined}>Places map</a>
    <a class="settings" href="/admin/access">Household settings ↗</a>
  {/if}
</nav>
<style>
  .people-nav { display: flex; flex-wrap: wrap; gap: 0 1.6rem; padding: 0 clamp(20px, 3vw, 44px); border-bottom: 1px solid var(--line-strong); background: var(--surface-rail); }
  a { padding: 1rem 0; color: var(--text-secondary); text-decoration: none; font-size: var(--fs-nav); font-weight: 700; border-bottom: 3px solid transparent; }
  a[aria-current] { border-color: var(--accent); color: var(--accent); }
  a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .settings { margin-left: auto; font-weight: 400; }
  @media(max-width: 600px) { .settings { margin-left: 0; } }
</style>
