<script lang="ts">
  let {
    variant = 'full',
  }: {
    /** 'full' — brand + secondary links (home/blog/projects). 'compact' — just brand + home. */
    variant?: 'full' | 'compact';
  } = $props();
</script>

<footer class="site-footer" class:site-footer--compact={variant === 'compact'}>
  <a href="/" class="brand site-footer-brand">strange ramblings</a>
  <nav class="site-footer-links" aria-label="Footer">
    {#if variant === 'full'}
      <a href="/projects" class="site-footer-link">Projects</a>
      <a href="/blog" class="site-footer-link">Writing</a>
      <a href="/health" class="site-footer-link">Health</a>
      <a href="/live" class="site-footer-link">Live</a>
      <a href="https://library.strangeramblings.com" class="site-footer-link">Library</a>
      <a href="https://github.com/jkrup" target="_blank" rel="noopener" class="site-footer-link">GitHub</a>
    {:else}
      <a href="/" class="site-footer-link">Home</a>
      <a href="/blog" class="site-footer-link">Writing</a>
      <a href="/projects" class="site-footer-link">Projects</a>
    {/if}
  </nav>
</footer>

<style>
  .site-footer {
    padding: 1.75rem 1.5rem;
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 1rem 1.5rem;
    border-top: 2px solid var(--card-border);
    margin-top: auto;
  }

  @media (min-width: 640px) {
    .site-footer {
      padding: 1.75rem 2.5rem;
    }
  }

  @media (min-width: 768px) {
    .site-footer {
      padding: 2rem 4rem;
    }
  }

  .site-footer-brand {
    font-size: 14px;
    color: var(--text-ghost);
  }
  .site-footer-brand:hover {
    color: var(--accent);
  }

  .site-footer-links {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1.5rem;
  }

  .site-footer-link {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-muted);
    transition: color 0.18s ease-out;
  }
  .site-footer-link:hover {
    color: var(--accent);
  }

  .site-footer--compact {
    padding-top: 1.25rem;
    padding-bottom: 1.25rem;
  }
</style>
