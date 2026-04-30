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

  const latestDate = data.posts[0]?.publishedAt
    ? new Date(data.posts[0].publishedAt)
        .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        .toUpperCase()
    : null;
</script>

<PageHeader title="WRITING" />

<section class="b-hero">
  <div class="b-hero-inner">
    <div class="b-hero-left">
      <p class="b-hero-num">01 / JOURNAL · {data.posts.length} {data.posts.length === 1 ? 'POST' : 'POSTS'}</p>
      <h1 class="b-hero-headline">
        Words.<br /><span class="ghost">Read some here.</span>
      </h1>
      <p class="b-hero-strap">
        The things I'm thinking about, working on, and shipping. Most recent first.
      </p>
    </div>
  </div>

  <div class="b-hero-foot">
    <span class="b-foot-meta">
      WRITING
      {#if latestDate}<span class="b-foot-sep">·</span>LATEST {latestDate}{/if}
      {#if allTags.length}<span class="b-foot-sep">·</span>{allTags.length} {allTags.length === 1 ? 'TAG' : 'TAGS'}{/if}
    </span>
    <a href="#posts" class="b-foot-jump">Browse →</a>
  </div>
</section>

{#if allTags.length > 0}
  <div class="b-tag-strip-wrap">
    <nav class="b-tag-strip" aria-label="Filter by tag">
      <span class="b-tag-link is-active">ALL</span>
      {#each allTags as tag}
        <span class="b-tag-sep">·</span>
        <a href="/blog/tag/{tag}" class="b-tag-link">{tag.toUpperCase()}</a>
      {/each}
    </nav>
  </div>
{/if}

<section id="posts" class="px-6 sm:px-10 md:px-16 py-10 sm:py-12">
  <div class="max-w-4xl mx-auto">
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
  /* --- Hero (modelled on /health) --- */
  .b-hero {
    position: relative;
    padding: 64px 32px 56px;
    overflow: hidden;
    border-bottom: 1px solid var(--divider);
    min-height: 520px;
    display: flex;
    flex-direction: column;
  }
  .b-hero-inner {
    position: relative;
    z-index: 5;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 48px;
    max-width: 1480px;
    margin: 0 auto;
    width: 100%;
    flex: 1;
    align-items: stretch;
  }
  .b-hero-left {
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding-bottom: 56px;
    justify-content: flex-end;
    max-width: 760px;
  }
  .b-hero-num {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.15em;
    color: var(--text-ghost);
    margin: 0 0 8px 0;
    text-transform: uppercase;
  }
  .b-hero-headline {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: clamp(56px, 9vw, 132px);
    line-height: 0.86;
    letter-spacing: -0.03em;
    text-transform: uppercase;
    margin: 0;
    color: var(--text-primary);
  }
  .b-hero-headline .ghost {
    color: var(--text-ghost);
  }
  .b-hero-strap {
    font-size: 16px;
    line-height: 1.5;
    max-width: 480px;
    margin: 0;
    color: var(--text-secondary);
    border-left: 3px solid var(--accent);
    padding-left: 14px;
  }
  .b-hero-foot {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 32px;
    z-index: 4;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-muted);
    border-top: 1px solid var(--divider);
    background: color-mix(in srgb, var(--bg) 80%, transparent);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    flex-wrap: wrap;
    gap: 12px;
  }
  .b-foot-meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .b-foot-sep {
    margin: 0 0.6em;
    color: var(--accent);
  }
  .b-foot-jump {
    color: var(--text-muted);
    transition: color 0.2s ease-out;
  }
  .b-foot-jump:hover {
    color: var(--accent);
  }

  /* --- Tag filter strip (between hero and list) --- */
  .b-tag-strip-wrap {
    border-bottom: 1px solid var(--divider);
    background: var(--bg-section);
    padding: 14px 32px;
  }
  .b-tag-strip {
    max-width: 1480px;
    margin: 0 auto;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-muted);
    line-height: 1.8;
  }
  .b-tag-link {
    transition: color 0.2s ease-out;
  }
  a.b-tag-link:hover {
    color: var(--accent);
  }
  .b-tag-link.is-active {
    color: var(--text-primary);
  }
  .b-tag-sep {
    margin: 0 0.55em;
    opacity: 0.4;
  }

  /* --- Posts list --- */
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

  @media (max-width: 720px) {
    .b-hero {
      padding: 48px 16px 80px;
      min-height: 440px;
    }
    .b-hero-foot {
      padding: 10px 16px;
    }
    .b-tag-strip-wrap {
      padding: 12px 16px;
    }
  }
</style>
