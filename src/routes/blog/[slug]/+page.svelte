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
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { renderContent } from '$lib/blog/renderer';

  let { data } = $props();

  const formattedDate = data.post.publishedAt
    ? new Date(data.post.publishedAt)
        .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        .toUpperCase()
    : null;

  const wordCount = (data.post.content || '').replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  const readingTime = Math.max(1, Math.round(wordCount / 220));
</script>

<PageHeader title="WRITING" titleHref="/blog" />

<article class="min-h-screen px-6 sm:px-10 md:px-16 py-12 sm:py-16">
  <!-- Post -->
  <div class="max-w-2xl mx-auto">
    <!-- Metadata row -->
    <p class="label mb-6">
      {#if formattedDate}<span>{formattedDate}</span>{/if}
      {#if formattedDate}<span class="meta-sep">/</span>{/if}
      <span>{readingTime} MIN READ</span>
      {#if data.post.tags && data.post.tags.length > 0}
        <span class="meta-sep">/</span>
        {#each data.post.tags as tag, i}
          {#if i > 0}<span class="meta-dot">·</span>{/if}
          <a href="/blog/tag/{tag}" class="meta-tag">{tag}</a>
        {/each}
      {/if}
    </p>

    <!-- Title -->
    <h1 class="post-title">{data.post.title}</h1>

    {#if data.post.excerpt}
      <p class="post-lede accent-strip">{data.post.excerpt}</p>
    {/if}

    {#if data.post.coverImageUrl}
      <img src={data.post.coverImageUrl} alt={data.post.title} class="w-full max-h-[400px] object-cover mb-10 mt-8" />
    {:else}
      <hr class="rule mb-10 mt-8" />
    {/if}

    <!-- Content -->
    <ProseContent class="post-prose">{@html renderContent(data.post.content, data.post.contentFormat)}</ProseContent>

    <!-- Back -->
    <div class="mt-16 pt-6" style="border-top: 2px solid var(--line-strong);">
      <a href="/blog" class="nav-link">← Back to writing</a>
    </div>
  </div>
</article>

<style>
  .post-title {
    font-family: var(--font-display);
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: -0.02em;
    line-height: 0.95;
    color: var(--text-primary);
    font-size: clamp(2.25rem, 5.5vw, 3.75rem);
    margin-bottom: 1.5rem;
  }

  .post-lede {
    font-size: 1.125rem;
    line-height: 1.6;
    color: var(--text-primary);
    margin-top: 1.5rem;
  }

  .meta-sep {
    margin: 0 0.6em;
    color: var(--accent);
  }

  .meta-dot {
    margin: 0 0.4em;
    opacity: 0.5;
  }

  .meta-tag {
    color: var(--text-muted);
    transition: color 0.2s ease-out;
  }

  .meta-tag:hover {
    color: var(--accent);
  }

  :global(.post-prose p:first-of-type::first-letter) {
    font-family: var(--font-display);
    font-weight: 900;
    color: var(--accent);
    font-size: 4.25em;
    line-height: 0.85;
    float: left;
    padding: 0.05em 0.12em 0 0;
    margin-right: 0.05em;
  }
</style>

<footer class="px-6 sm:px-10 md:px-16 py-6" style="border-top: 2px solid var(--line-strong);">
  <a href="/" class="nav-link">← Home</a>
  <a href="/admin" class="nav-link">Admin</a>
</footer>
