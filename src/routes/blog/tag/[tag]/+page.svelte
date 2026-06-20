<svelte:head>
  <title>Posts tagged '{data.tag}' — Strange Ramblings</title>
  <meta name="description" content="All posts tagged '{data.tag}'" />
  <meta property="og:title" content="Posts tagged '{data.tag}' — Strange Ramblings" />
  <meta property="og:description" content="All posts tagged '{data.tag}'" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://strangeramblings.com/blog/tag/{data.tag}" />
</svelte:head>

<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  let { data } = $props();
</script>

<PageHeader title={`#${data.tag.toUpperCase()}`} titleHref="/blog" />

<section class="min-h-screen px-6 sm:px-10 md:px-16 py-8">
  <!-- Title -->
  <div class="max-w-4xl mb-8">
    <p class="label">Posts tagged '{data.tag}'</p>
  </div>

  <hr class="rule mb-0" />

  <!-- Posts list -->
  <div class="max-w-4xl">
    {#if data.posts.length === 0}
      <p class="text-sm py-8" style="color: var(--text-muted);">No posts found with this tag.</p>
    {:else}
      {#each data.posts as post}
        <a
          href="/blog/{post.slug}"
          class="block py-5 group transition-colors hover:bg-[var(--accent-tint-04)]"
          style="border-bottom: 1px solid var(--divider);"
        >
          <div class="flex gap-5">
            {#if post.coverImageUrl}
              <img
                src={post.coverImageUrl}
                alt={post.title}
                class="w-20 h-20 sm:w-24 sm:h-24 object-cover rounded-[var(--radius-round)] shrink-0 hidden sm:block"
              />
            {/if}
            <div class="flex-1 min-w-0">
              <div class="flex justify-between items-baseline gap-4">
                <div class="min-w-0">
                  <span class="text-base sm:text-lg font-medium group-hover:text-[var(--accent)] transition-colors" style="color: var(--text-primary);">
                    {post.title}
                  </span>
                  {#if post.excerpt}
                    <p class="text-sm mt-1 line-clamp-2" style="color: var(--text-muted);">{post.excerpt}</p>
                  {/if}
                </div>
                <span class="label shrink-0" style="font-size: 10px;">
                  {post.publishedAt ? new Date(post.publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                </span>
              </div>
              {#if post.tags && post.tags.length > 0}
                <div class="flex flex-wrap gap-1.5 mt-2">
                  {#each post.tags as tag}
                    <span
                      class="inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-[var(--radius-pill)]"
                      style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-muted);"
                    >
                      {tag}
                    </span>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        </a>
      {/each}
    {/if}
  </div>
</section>

<footer class="px-6 sm:px-10 md:px-16 py-6" style="border-top: 2px solid var(--card-border);">
  <a href="/" class="nav-link">← Home</a>
  <a href="/admin" class="nav-link">Admin</a>
</footer>
