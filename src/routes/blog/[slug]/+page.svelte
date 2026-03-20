<svelte:head>
  <title>{data.post.title} — Strange Ramblings</title>
  <meta name="description" content={data.post.excerpt} />
</svelte:head>

<script lang="ts">
  let { data } = $props();

  const formattedDate = data.post.publishedAt
    ? new Date(data.post.publishedAt).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;
</script>

<article class="min-h-screen px-6 sm:px-10 md:px-16 py-8">
  <!-- Header -->
  <div class="flex justify-between items-start mb-12">
    <a href="/" class="display text-[20px] sm:text-[24px] leading-none">SR</a>
    <nav class="flex gap-6 pt-1">
      <a href="/blog" class="nav-link">All writing</a>
      <a href="/" class="nav-link">Home</a>
    </nav>
  </div>

  <!-- Post -->
  <div class="max-w-3xl">
    {#if formattedDate}
      <p class="label mb-4">{formattedDate.toUpperCase()}</p>
    {/if}

    <h1 class="display text-[28px] sm:text-[36px] md:text-[42px] mb-8" style="color: var(--text-primary);">
      {data.post.title.toUpperCase()}
    </h1>

    <hr class="rule mb-8" />

    <!-- Content -->
    <div class="prose">
      {@html data.post.content}
    </div>

    <!-- Back -->
    <div class="mt-12 pt-6" style="border-top: 2px solid var(--card-border);">
      <a href="/blog" class="nav-link">← Back to writing</a>
    </div>
  </div>
</article>

<footer class="px-6 sm:px-10 md:px-16 py-6" style="border-top: 2px solid var(--card-border);">
  <a href="/" class="nav-link">← Home</a>
</footer>

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
    margin-bottom: 1.25em;
    line-height: 1.8;
    font-size: 1rem;
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
    line-height: 1.8;
    font-size: 1rem;
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
