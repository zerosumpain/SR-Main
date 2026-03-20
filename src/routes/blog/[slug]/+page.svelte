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

<article class="min-h-screen p-6 sm:p-8 md:p-12 lg:p-16">
  <!-- Header -->
  <div class="flex justify-between items-start mb-16">
    <a href="/" class="group flex items-baseline no-underline select-none">
      <span
        class="text-[36px] sm:text-[42px] font-thin tracking-[0.15em] leading-none"
        style="color: var(--text-primary); font-family: var(--font-sans);"
      >S</span><span
        class="text-[36px] sm:text-[42px] font-thin tracking-[0.15em] leading-none transition-opacity duration-500"
        style="color: var(--accent); font-family: var(--font-sans); opacity: 0.55;"
      >R</span>
    </a>

    <nav class="flex gap-5 sm:gap-8 pt-2">
      <a href="/blog" class="nav-link text-[10px] sm:text-[11px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">
        All writing
      </a>
    </nav>
  </div>

  <!-- Post -->
  <div class="max-w-2xl mx-auto">
    <!-- Meta -->
    {#if formattedDate}
      <p
        class="text-[10px] uppercase tracking-[0.3em] mb-4"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >{formattedDate}</p>
    {/if}

    <!-- Title -->
    <h1
      class="text-2xl sm:text-3xl font-light leading-snug tracking-wide mb-8"
      style="color: var(--text-primary);"
    >{data.post.title}</h1>

    <!-- Content -->
    <div class="prose" style="color: var(--text-secondary);">
      {@html data.post.content}
    </div>

    <!-- Back -->
    <div class="mt-16 pt-8" style="border-top: 1px solid var(--card-border);">
      <a
        href="/blog"
        class="nav-link text-[10px] uppercase tracking-[0.2em]"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >← Back to writing</a>
    </div>
  </div>
</article>

<style>
  .prose :global(h1),
  .prose :global(h2),
  .prose :global(h3) {
    color: var(--text-primary);
    font-weight: 300;
    margin-top: 2em;
    margin-bottom: 0.5em;
  }

  .prose :global(h2) {
    font-size: 1.375rem;
  }

  .prose :global(h3) {
    font-size: 1.125rem;
  }

  .prose :global(p) {
    margin-bottom: 1.25em;
    line-height: 1.75;
    font-size: 0.9375rem;
  }

  .prose :global(a) {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .prose :global(a:hover) {
    opacity: 0.8;
  }

  .prose :global(code) {
    font-family: var(--font-mono);
    font-size: 0.875em;
    padding: 0.15em 0.4em;
    border-radius: 4px;
    background: var(--card-bg);
  }

  .prose :global(pre) {
    padding: 1em 1.25em;
    border-radius: 0.75rem;
    overflow-x: auto;
    margin: 1.5em 0;
    font-size: 0.875rem;
    line-height: 1.6;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
  }

  .prose :global(pre code) {
    padding: 0;
    background: none;
  }

  .prose :global(blockquote) {
    border-left: 2px solid var(--accent);
    padding-left: 1em;
    margin: 1.5em 0;
    font-style: italic;
    color: var(--text-ghost);
  }

  .prose :global(ul),
  .prose :global(ol) {
    padding-left: 1.5em;
    margin-bottom: 1.25em;
  }

  .prose :global(li) {
    margin-bottom: 0.5em;
    line-height: 1.75;
    font-size: 0.9375rem;
  }

  .prose :global(img) {
    max-width: 100%;
    border-radius: 0.5rem;
    margin: 1.5em 0;
  }

  .prose :global(hr) {
    border: none;
    border-top: 1px solid var(--card-border);
    margin: 2em 0;
  }
</style>
