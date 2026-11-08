<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import PostSheet from '$lib/components/blog/PostSheet.svelte';
  import ReadingProgress from '$lib/components/blog/ReadingProgress.svelte';
  import ReadingBeacon from '$lib/components/blog/ReadingBeacon.svelte';
  import CommentsSection from '$lib/components/blog/CommentsSection.svelte';
  import { snapToRule } from '$lib/components/notes-paper/snap';

  let { data } = $props();

  // Bound to the article element so the progress rail and the beacon measure
  // the ARTICLE rather than the document. A long comment thread underneath
  // would otherwise report 60% at the end of the piece. (The comments are in
  // the article's footer, after the `[data-article-end]` sentinel the beacon
  // watches, so reaching them is still not counted as reading the piece.)
  let articleEl = $state<HTMLElement | null>(null);
</script>

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

<PageHeader title="WRITING" titleHref="/blog" />

<ReadingProgress title={data.post.title} target={articleEl} />

<!-- The author reading their own post is not a reader. -->
<ReadingBeacon slug={data.post.slug} {articleEl} enabled={!data.owner} />

<!-- The desk the page lies on; the ink bar above tears onto it. -->
<main class="np-desk np-tear pp-desk">
  <PostSheet
    post={data.post}
    readingTime={data.readingTime}
    articleHtml={data.articleHtml}
    toc={data.toc}
    references={data.references}
    bodyFontVar={data.bodyFontVar}
    bind:articleEl
  >
    {#snippet foot()}
      {#if data.owner}
        <div class="pp-owner" use:snapToRule>
          <p class="np-sticky">
            You are reading this as the owner — no view is recorded.
            <a href="/admin/content/blog">Post list</a>
            <span aria-hidden="true">·</span>
            <a href="/admin/content/comments">Moderate responses</a>
          </p>
        </div>
      {/if}

      <CommentsSection slug={data.post.slug} comments={data.comments} />

      <a href="/blog" class="pp-turn">← Back to writing</a>
    {/snippet}
  </PostSheet>
</main>

<footer class="pp-page-foot">
  <a href="/" class="nav-link">← Home</a>
  <a href="/admin" class="nav-link">Admin</a>
</footer>
