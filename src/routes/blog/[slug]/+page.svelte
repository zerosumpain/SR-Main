<svelte:head>
  <title>{data.post.title} — Strange Ramblings</title>
  <meta name="description" content={data.post.excerpt} />
  <meta property="og:title" content={data.post.title} />
  <meta property="og:description" content={data.post.excerpt} />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://strangeramblings.com/blog/{data.post.slug}" />
  {#if data.post.coverImageUrl}
    <meta property="og:image" content={data.post.coverImageUrl} />
  {/if}
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content={data.post.title} />
  <meta name="twitter:description" content={data.post.excerpt} />
</svelte:head>

<script lang="ts">
  import ProseContent from '$lib/components/ProseContent.svelte';
  import { renderContent } from '$lib/blog/renderer';

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
      <a href="/projects" class="nav-link">Projects</a>
      <a href="/" class="nav-link">Home</a>
      <a href="/jkai" class="nav-link">jkai</a>
    </nav>
  </div>

  <!-- Post -->
  <div class="max-w-3xl">
    {#if formattedDate}
      <p class="label mb-4">{formattedDate.toUpperCase()}</p>
    {/if}

    <h1 class="display text-[28px] sm:text-[36px] md:text-[42px] mb-4" style="color: var(--text-primary);">
      {data.post.title.toUpperCase()}
    </h1>

    {#if data.post.tags && data.post.tags.length > 0}
      <div class="flex flex-wrap gap-1.5 mb-6">
        {#each data.post.tags as tag}
          <a
            href="/blog/tag/{tag}"
            class="inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full transition-colors hover:border-[var(--accent)]"
            style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-muted);"
          >
            {tag}
          </a>
        {/each}
      </div>
    {/if}

    {#if data.post.coverImageUrl}
      <img src={data.post.coverImageUrl} alt={data.post.title} class="w-full max-h-[400px] object-cover rounded-lg mb-8" />
    {/if}

    <hr class="rule mb-8" />

    <!-- Content -->
    <ProseContent>{@html renderContent(data.post.content, data.post.contentFormat)}</ProseContent>

    <!-- Back -->
    <div class="mt-12 pt-6" style="border-top: 2px solid var(--card-border);">
      <a href="/blog" class="nav-link">← Back to writing</a>
    </div>
  </div>
</article>

<footer class="px-6 sm:px-10 md:px-16 py-6" style="border-top: 2px solid var(--card-border);">
  <a href="/" class="nav-link">← Home</a>
  <a href="/admin" class="nav-link">Admin</a>
</footer>
