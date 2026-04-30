<svelte:head>
  <title>Writing — Strange Ramblings</title>
  <meta name="description" content="Writing about code, design, and building things." />
  <meta property="og:title" content="Writing — Strange Ramblings" />
  <meta property="og:description" content="Writing about code, design, and building things." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://strangeramblings.com/blog" />
</svelte:head>

<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  let { data } = $props();

  const allTags = (() => {
    const seen = new Set<string>();
    for (const p of data.posts) for (const t of p.tags ?? []) seen.add(t);
    return [...seen].sort();
  })();
</script>

<PageHeader title="WRITING" />

<section class="min-h-screen px-6 sm:px-10 md:px-16 py-12 sm:py-16">
  <div class="max-w-4xl mx-auto">

    <!-- Hero -->
    <header class="mb-12 sm:mb-16">
      <p class="label mb-4">Journal</p>
      <h1 class="page-title">Writing</h1>
      <p class="page-lede accent-strip">
        The things I'm thinking about, working on, and shipping. {data.posts.length}
        {data.posts.length === 1 ? 'post' : 'posts'}.
      </p>

      {#if allTags.length > 0}
        <nav class="tag-strip mt-8">
          <span class="tag-strip-link is-active">ALL</span>
          {#each allTags as tag}
            <span class="tag-sep">·</span>
            <a href="/blog/tag/{tag}" class="tag-strip-link">{tag.toUpperCase()}</a>
          {/each}
        </nav>
      {/if}
    </header>

    <hr class="rule mb-0" />

    <!-- Posts list -->
    {#if data.posts.length === 0}
      <p class="text-sm py-8" style="color: var(--text-muted);">Nothing published yet.</p>
    {:else}
      {#each data.posts as post, i}
        <a
          href="/blog/{post.slug}"
          class="post-row group"
          style="border-bottom: 1px solid var(--divider);"
        >
          <span class="post-num">{String(i + 1).padStart(2, '0')}</span>

          <div class="flex-1 min-w-0">
            <div class="flex justify-between items-baseline gap-4">
              <div class="min-w-0">
                <span class="post-title-text">{post.title}</span>
                {#if post.excerpt}
                  <p class="post-excerpt">{post.excerpt}</p>
                {/if}
                {#if post.tags && post.tags.length > 0}
                  <p class="post-meta label">
                    {#each post.tags as tag, ti}
                      {#if ti > 0}<span class="meta-dot">·</span>{/if}<span>{tag}</span>
                    {/each}
                  </p>
                {/if}
              </div>
              <span class="post-date label">
                {post.publishedAt ? new Date(post.publishedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase() : ''}
              </span>
            </div>
          </div>

          <span class="post-arrow" aria-hidden="true">→</span>
        </a>
      {/each}
    {/if}

  </div>
</section>

<footer class="px-6 sm:px-10 md:px-16 py-6" style="border-top: 2px solid var(--card-border);">
  <a href="/" class="nav-link">← Home</a>
  <a href="/admin" class="nav-link">Admin</a>
</footer>

<style>
  .page-title {
    font-family: var(--font-display);
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: -0.02em;
    line-height: 0.9;
    color: var(--text-primary);
    font-size: clamp(2.75rem, 7vw, 5rem);
    margin-bottom: 1.5rem;
  }

  .page-lede {
    font-size: 1.125rem;
    line-height: 1.6;
    color: var(--text-primary);
    max-width: 38em;
  }

  .tag-strip {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-muted);
    line-height: 1.8;
  }

  .tag-strip-link {
    transition: color 0.2s ease-out;
  }

  a.tag-strip-link:hover {
    color: var(--accent);
  }

  .tag-strip-link.is-active {
    color: var(--text-primary);
  }

  .tag-sep {
    margin: 0 0.55em;
    opacity: 0.4;
  }

  .post-row {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    padding: 1.5rem 0;
    transition: background-color 0.2s ease-out;
  }

  .post-row:hover {
    background-color: rgba(196, 87, 10, 0.04);
  }

  .post-num {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.15em;
    color: var(--text-muted);
    padding-top: 0.4rem;
    width: 2.25rem;
    flex-shrink: 0;
    transition: color 0.2s ease-out;
  }

  .post-row:hover .post-num {
    color: var(--accent);
  }

  .post-title-text {
    font-size: 1.125rem;
    font-weight: 500;
    color: var(--text-primary);
    transition: color 0.2s ease-out;
  }

  @media (min-width: 640px) {
    .post-title-text {
      font-size: 1.25rem;
    }
  }

  .post-row:hover .post-title-text {
    color: var(--accent);
  }

  .post-excerpt {
    font-size: 0.9375rem;
    margin-top: 0.4rem;
    color: var(--text-muted);
    line-height: 1.55;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .post-meta {
    margin-top: 0.6rem;
    font-size: 10px !important;
  }

  .meta-dot {
    margin: 0 0.5em;
    opacity: 0.5;
  }

  .post-date {
    font-size: 10px !important;
    flex-shrink: 0;
    color: var(--text-muted);
    padding-top: 0.25rem;
  }

  .post-arrow {
    font-family: var(--font-mono);
    color: var(--text-muted);
    padding-top: 0.4rem;
    width: 1.5rem;
    flex-shrink: 0;
    text-align: right;
    opacity: 0;
    transform: translateX(-4px);
    transition: opacity 0.2s ease-out, transform 0.2s ease-out, color 0.2s ease-out;
  }

  .post-row:hover .post-arrow {
    opacity: 1;
    transform: translateX(0);
    color: var(--accent);
  }
</style>
