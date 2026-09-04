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
    <!-- Inside the ink `.site-nav-bar`: the accent has to be its on-dark
         partner or the chip sits at 2.6:1 on #1a1008. -->
    <span class="uppercase tracking-[0.2em] px-2 py-0.5 rounded-[var(--radius-round)]" style="font-size: var(--fs-label-xs); font-family: var(--font-mono); background: rgba(232, 134, 58, 0.14); color: var(--accent-on-dark); border: 1px solid var(--accent-on-dark);">
      Draft
    </span>
  {/snippet}
</PageHeader>

<article class="min-h-screen px-6 sm:px-10 md:px-16 py-8">
  <!-- Draft banner -->
  <div class="max-w-3xl mb-8 px-4 py-3 rounded-[var(--radius-round)]" style="background: var(--accent-tint-14); border: 1px solid var(--accent);">
    <p class="text-sm font-medium" style="color: var(--accent);">
      Draft preview — this post has not been published
    </p>
  </div>

  <!-- Post -->
  <!-- Full width, not max-w-3xl: the editorial grid sets its own measure and
       needs room either side of it for margin notes and bleed figures. -->
  <div class="preview-body">
    {#if formattedDate}
      <p class="label mb-4">{formattedDate.toUpperCase()}</p>
    {/if}

    {#if data.post.tags && data.post.tags.length > 0}
      <div class="flex flex-wrap gap-1.5 mb-6">
        {#each data.post.tags as tag}
          <span
            class="inline-block uppercase tracking-wider px-2 py-0.5 rounded-[var(--radius-pill)]"
            style="font-size: var(--fs-label-xs); background: var(--card-bg); border: 1px solid var(--line-strong); color: var(--text-muted);"
          >
            {tag}
          </span>
        {/each}
      </div>
    {/if}

    {#if data.post.coverImageUrl}
      <img src={data.post.coverImageUrl} alt={data.post.title} class="w-full max-h-[400px] object-cover rounded-[var(--radius-round)] mb-8" />
    {/if}

    <hr class="rule mb-8" />

    <!-- Content -->
    <!-- Identical to /blog/[slug]: same class, same editorial layout, same
         reading face. What the author sees here is what publishes. -->
    <ProseContent class="post-prose" editorial bodyFont={data.bodyFontVar}>
      {@html data.articleHtml}
    </ProseContent>

    {#if data.references}
      <!-- Sources, in the footer and quiet — the same treatment /blog/[slug]
           gives them, for the same reason. -->
      <section class="art-sources" aria-labelledby="pv-sources-h">
        <h2 class="art-sources-h" id="pv-sources-h">Sources</h2>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html data.references}
      </section>
    {/if}

    <!-- Back -->
    <div class="mt-12 pt-6" style="border-top: 2px solid var(--line-strong);">
      <a href="/blog" class="nav-link">← Back to writing</a>
    </div>
  </div>
</article>

<footer class="px-6 sm:px-10 md:px-16 py-6" style="border-top: 2px solid var(--line-strong);">
  <a href="/" class="nav-link">← Home</a>
  <a href="/admin" class="nav-link">Admin</a>
</footer>

<style>
  .preview-body {
    max-width: 78rem;
  }

  /* Deliberately the same values as /blog/[slug]'s own .art-sources rules.
     They are restated rather than shared because the two pages have different
     containers and Svelte scopes CSS per component — a shared class in app.css
     would lose to ProseContent's `:global` specificity on one of them and not
     the other, which is the kind of divergence this preview exists to catch. */
  .art-sources {
    margin: 2.5rem 0 0;
    padding-top: 1rem;
    border-top: 1px solid var(--line);
  }

  .art-sources-h {
    margin: 0 0 0.5rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }

  .art-sources :global(ol.footnotes) {
    margin: 0;
    padding-left: 1.4rem;
    font-size: var(--fs-label);
    line-height: 1.7;
    color: var(--text-muted);
  }

  .art-sources :global(ol.footnotes li) {
    margin-bottom: 0.3rem;
  }

  .art-sources :global(ol.footnotes a) {
    color: var(--text-secondary);
    text-decoration: underline;
    text-underline-offset: 2px;
    word-break: break-word;
  }
</style>
