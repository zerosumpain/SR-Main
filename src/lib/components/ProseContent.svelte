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
    font-size: max(0.875em, var(--fs-label-xs));
    padding: 0.2em 0.5em;
    background: var(--card-bg);
    border: 1px solid var(--line-strong);
  }

  .prose :global(pre) {
    padding: 1.25em 1.5em;
    overflow-x: auto;
    margin: 1.5em 0;
    font-size: 0.875rem;
    line-height: 1.6;
    background: var(--card-bg);
    border: 2px solid var(--line-strong);
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

  /* Tailwind's preflight strips list markers globally — restore them here. */
  .prose :global(ul),
  .prose :global(ol) {
    padding-left: 1.5em;
    margin-bottom: 1.25em;
  }

  .prose :global(ul) {
    list-style: disc;
  }

  .prose :global(ul ul) {
    list-style: circle;
    margin-top: 0.5em;
    margin-bottom: 0;
  }

  .prose :global(ol) {
    list-style: decimal;
  }

  .prose :global(ol ol) {
    margin-top: 0.5em;
    margin-bottom: 0;
  }

  .prose :global(li) {
    margin-bottom: 0.5em;
    line-height: 1.75;
    font-size: 1.0625rem;
    color: var(--text-secondary);
  }

  .prose :global(li::marker) {
    color: var(--accent);
  }

  .prose :global(ol > li::marker) {
    font-family: var(--font-mono);
  }

  .prose :global(img) {
    max-width: 100%;
    margin: 1.5em 0;
    border: 1px solid var(--card-border);
  }

  .prose :global(figure) {
    margin: 2em 0;
  }

  .prose :global(figure img) {
    margin: 0;
  }

  .prose :global(figcaption) {
    margin-top: 0.6em;
    font-family: var(--font-mono);
    font-size: max(0.8125rem, var(--fs-label-xs));
    color: var(--text-muted);
  }

  .prose :global(figure.project-embed) {
    border: 2px solid var(--line-strong);
    background: var(--card-bg);
  }

  .prose :global(figure.project-embed iframe) {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 10;
    border: 0;
  }

  .prose :global(figure.project-embed figcaption) {
    margin: 0;
    padding: 0.5rem 0.75rem;
    border-top: 2px solid var(--line-strong);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }

  .prose :global(figure.project-embed figcaption a) {
    color: var(--accent);
    text-decoration: none;
  }

  .prose :global(figure.project-embed figcaption a:hover) {
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .prose :global(hr) {
    border: none;
    height: 2px;
    background: var(--text-primary);
    opacity: 0.08;
    margin: 2em 0;
  }
</style>
