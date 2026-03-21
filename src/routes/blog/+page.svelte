<svelte:head>
  <title>Writing — Strange Ramblings</title>
  <meta name="description" content="Writing about code, design, and building things." />
  <meta property="og:title" content="Writing — Strange Ramblings" />
  <meta property="og:description" content="Writing about code, design, and building things." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://strangeramblings.com/blog" />
</svelte:head>

<script lang="ts">
  let { data } = $props();
</script>

<section class="min-h-screen px-6 sm:px-10 md:px-16 py-8">
  <!-- Header -->
  <div class="flex justify-between items-start mb-12">
    <a href="/" class="display text-[20px] sm:text-[24px] leading-none">SR</a>
    <nav class="flex gap-6 pt-1">
      <a href="/" class="nav-link">Home</a>
      <a href="/projects" class="nav-link">Projects</a>
      <a href="/health" class="nav-link">Health</a>
    </nav>
  </div>

  <!-- Title -->
  <div class="max-w-4xl mb-8">
    <h1 class="display text-[36px] sm:text-[48px] mb-2" style="color: var(--text-primary);">WRITING</h1>
    <p class="label">All posts</p>
  </div>

  <hr class="rule mb-0" />

  <!-- Posts list -->
  <div class="max-w-4xl">
    {#if data.posts.length === 0}
      <p class="text-sm py-8" style="color: var(--text-muted);">Nothing published yet.</p>
    {:else}
      {#each data.posts as post}
        <a
          href="/blog/{post.slug}"
          class="block py-5 group transition-colors hover:bg-[rgba(196,87,10,0.04)]"
          style="border-bottom: 1px solid var(--divider);"
        >
          <div class="flex justify-between items-baseline gap-4">
            <div>
              <span class="text-base sm:text-lg font-medium group-hover:text-[var(--accent)] transition-colors" style="color: var(--text-primary);">
                {post.title}
              </span>
              {#if post.excerpt}
                <p class="text-sm mt-1" style="color: var(--text-muted);">{post.excerpt}</p>
              {/if}
            </div>
            <span class="label shrink-0" style="font-size: 10px;">
              {post.publishedAt ? new Date(post.publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
            </span>
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
