<script lang="ts">
  let {
    children,
    width = 'standard',
  }: {
    children: import('svelte').Snippet;
    width?: 'standard' | 'wide' | 'full';
  } = $props();
</script>

<div class="page-wrap" data-width={width}>
  {@render children()}
</div>

<style>
  .page-wrap {
    width: 100%;
    margin: 0 auto;
    padding: 2.25rem 1.75rem 4rem;
    color: var(--text-primary);
    font-family: var(--font-body);
  }
  .page-wrap[data-width="standard"] { max-width: 980px; }
  .page-wrap[data-width="wide"] { max-width: 1240px; }
  .page-wrap[data-width="full"] { max-width: none; }

  @media (max-width: 640px) {
    .page-wrap { padding: 1.5rem 1rem 3rem; }
  }
</style>
