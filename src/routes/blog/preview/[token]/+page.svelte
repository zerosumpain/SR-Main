<svelte:head>
  <title>{data.post.title} (Draft) — Strange Ramblings</title>
  <meta name="description" content={data.post.excerpt} />
  <meta name="robots" content="noindex" />
  <meta property="og:title" content={data.post.title} />
  <meta property="og:description" content={data.post.excerpt} />
  <meta property="og:type" content="article" />
  {#if data.post.coverImageUrl}
    <meta property="og:image" content={data.post.coverImageUrl} />
  {/if}
</svelte:head>

<script lang="ts">
  import ProseContent from '$lib/components/ProseContent.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
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

<PageHeader title={data.post.title.toUpperCase()} titleHref="/blog">
  {#snippet meta()}
    <span class="text-[10px] uppercase tracking-[0.2em] px-2 py-0.5 rounded" style="font-family: var(--font-mono); background: rgba(196, 87, 10, 0.12); color: var(--accent); border: 1px solid var(--accent);">
      Draft
    </span>
  {/snippet}
</PageHeader>

<article class="min-h-screen px-6 sm:px-10 md:px-16 py-8">
  <!-- Draft banner -->
  <div class="max-w-3xl mb-8 px-4 py-3 rounded-lg" style="background: rgba(196, 87, 10, 0.12); border: 1px solid var(--accent);">
    <p class="text-sm font-medium" style="color: var(--accent);">
      Draft preview — this post has not been published
    </p>
  </div>

  <!-- Post -->
  <div class="max-w-3xl">
    {#if formattedDate}
      <p class="label mb-4">{formattedDate.toUpperCase()}</p>
    {/if}

    {#if data.post.tags && data.post.tags.length > 0}
      <div class="flex flex-wrap gap-1.5 mb-6">
        {#each data.post.tags as tag}
          <span
            class="inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full"
            style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-muted);"
          >
            {tag}
          </span>
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
