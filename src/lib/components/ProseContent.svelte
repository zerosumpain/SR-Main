<script lang="ts">
  let {
    class: className = '',
    children,
  }: {
    class?: string;
    children: import('svelte').Snippet;
  } = $props();
</script>

<div class="prose {className}">
  {@render children()}
</div>

<style>
  .prose :global(h1),
  .prose :global(h2),
  .prose :global(h3) {
    font-family: var(--font-display);
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    margin-top: 2em;
    margin-bottom: 0.5em;
  }

  .prose :global(h2) {
    font-size: 1.5rem;
  }

  .prose :global(h3) {
    font-size: 1.25rem;
  }

  .prose :global(p) {
    margin-bottom: 1.4em;
    line-height: 1.75;
    font-size: 1.0625rem;
    color: var(--text-secondary);
  }

  .prose :global(a) {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 3px;
    text-decoration-thickness: 2px;
  }

  .prose :global(a:hover) {
    color: var(--accent-hover);
  }

  .prose :global(code) {
    font-family: var(--font-mono);
    font-size: 0.875em;
    padding: 0.2em 0.5em;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
  }

  .prose :global(pre) {
    padding: 1.25em 1.5em;
    overflow-x: auto;
    margin: 1.5em 0;
    font-size: 0.875rem;
    line-height: 1.6;
    background: var(--card-bg);
    border: 2px solid var(--card-border);
  }

  .prose :global(pre code) {
    padding: 0;
    background: none;
    border: none;
  }

  .prose :global(blockquote) {
    border-left: 3px solid var(--accent);
    padding-left: 1.25em;
    margin: 1.5em 0;
    font-style: italic;
    color: var(--text-muted);
  }

  .prose :global(ul),
  .prose :global(ol) {
    padding-left: 1.5em;
    margin-bottom: 1.25em;
  }

  .prose :global(li) {
    margin-bottom: 0.5em;
    line-height: 1.75;
    font-size: 1.0625rem;
    color: var(--text-secondary);
  }

  .prose :global(img) {
    max-width: 100%;
    margin: 1.5em 0;
  }

  .prose :global(hr) {
    border: none;
    height: 2px;
    background: var(--text-primary);
    opacity: 0.08;
    margin: 2em 0;
  }
</style>
