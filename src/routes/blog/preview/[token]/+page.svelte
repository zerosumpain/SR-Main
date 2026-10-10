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
  import PageHeader from '$lib/components/PageHeader.svelte';
  import PostSheet from '$lib/components/blog/PostSheet.svelte';
  import { stripReferences } from '$lib/blog/references';

  let { data } = $props();

  // The preview's payload carries no reading time; it is the published
  // page's sum exactly (blog/[slug]/+page.server.ts): the stored source with
  // its sources stripped, tags out, words over 220 a minute, at least one.
  const readingTime = $derived(
    Math.max(
      1,
      Math.round(
        stripReferences(data.post.content)
          .replace(/<[^>]+>/g, ' ')
          .trim()
          .split(/\s+/)
          .filter(Boolean).length / 220,
      ),
    ),
  );
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

<!-- The same sheet /blog/[slug] renders, so what the author reviews here is
     what publishes: same body, same faces, same sources. A preview adds the
     draft stamp and note, and has no reading beacon and no responses. -->
<main class="np-desk np-tear pp-desk">
  <PostSheet
    post={data.post}
    {readingTime}
    articleHtml={data.articleHtml}
    toc={data.toc}
    references={data.references}
    bodyFontVar={data.bodyFontVar}
    preview
  >
    {#snippet banner()}
      <p class="pp-draft-note">Draft preview — this post has not been published</p>
    {/snippet}
    {#snippet foot()}
      <a href="/blog" class="pp-turn">← Back to writing</a>
    {/snippet}
  </PostSheet>
</main>

<footer class="pp-page-foot">
  <a href="/" class="nav-link">← Home</a>
  <a href="/admin" class="nav-link">Admin</a>
</footer>

<style>
  .pp-draft-note {
    margin: 0;
  }
</style>
