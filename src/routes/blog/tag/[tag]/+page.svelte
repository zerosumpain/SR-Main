<svelte:head>
  <title>Posts tagged '{data.tag}' — Strange Ramblings</title>
  <meta name="description" content="All posts tagged '{data.tag}'" />
  <meta property="og:title" content="Posts tagged '{data.tag}' — Strange Ramblings" />
  <meta property="og:description" content="All posts tagged '{data.tag}'" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://strangeramblings.com/blog/tag/{data.tag}" />
</svelte:head>

<script lang="ts">
  // One subject's posts: a page torn from the same exercise book as /blog.
  // No cover: the sheet starts straight under the site's ink header bar, with
  // the torn edge over it. The tag is the page's heading, marked with its
  // pencil (the same colour it wears on every row and on the index), its
  // count drawn as a tally, and the rows are the index's own (ContentsRows),
  // here with each post's cover pasted in at the end of its row.
  import PageHeader from '$lib/components/PageHeader.svelte';
  import ContentsSheet from '$lib/components/blog/contents/ContentsSheet.svelte';
  import ContentsBlock from '$lib/components/blog/contents/ContentsBlock.svelte';
  import ContentsRows from '$lib/components/blog/contents/ContentsRows.svelte';
  import { TALLY_LIMIT, postCount } from '$lib/components/blog/contents/contents';
  import PencilDot from '$lib/components/notes-paper/PencilDot.svelte';
  import Tally from '$lib/components/notes-paper/Tally.svelte';

  let { data } = $props();
</script>

<PageHeader title={`#${data.tag.toUpperCase()}`} titleHref="/blog" />

<main class="tag-main">
  <ContentsSheet>
    <ContentsBlock kicker="Subject" top={2} aria-labelledby="tag-h">
      <h1 id="tag-h">
        <span class="h1-a cs-on">Posts tagged</span>
        <span class="h1-b cs-on cs-tall"><PencilDot word={data.tag} size={22} /><span class="h1-tag">{data.tag}</span></span>
      </h1>
      <!-- An empty tag says so once, below; no count line for nothing. -->
      {#if data.posts.length > 0}
        <p class="tally cs-on">
          {#if data.posts.length <= TALLY_LIMIT}<Tally count={data.posts.length} seed={31} height={16} />{/if}
          <span>{postCount(data.posts.length)}</span>
        </p>
      {/if}
      <p class="back cs-on"><a class="cs-more" href="/blog"><span aria-hidden="true">←</span> <span>All writing</span></a></p>
    </ContentsBlock>

    {#if data.posts.length === 0}
      <ContentsBlock bottom={4} as="div">
        <p class="empty np-aside">No posts found with this tag.</p>
      </ContentsBlock>
    {:else}
      <ContentsBlock wide as="div" bottom={3}>
        <ContentsRows posts={data.posts} numbered={false} thumbs yearAs="h2" />
      </ContentsBlock>
    {/if}
  </ContentsSheet>
</main>

<footer class="tag-foot">
  <a href="/" class="nav-link">← Home</a>
  <a href="/admin" class="nav-link">Admin</a>
</footer>

<style>
  .tag-main {
    display: flex;
    flex-direction: column;
    /* A short tag still reaches the foot of the window: the sheet fills it. */
    min-height: calc(100dvh - 48px - 76px);
  }

  h1 {
    margin: 0;
    font-weight: 800;
  }
  .h1-a,
  .h1-b {
    display: block;
  }
  .h1-a {
    --fs: var(--fs-label-xs);
    font-family: var(--font-mono);
    font-weight: 400;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--np-pen-ink);
  }
  .h1-b {
    --fs: clamp(40px, 5vw, 64px);
    --n: 2;
    display: flex;
    align-items: baseline;
    gap: 0.3em;
    font-family: var(--font-display);
    letter-spacing: -0.04em;
    color: var(--np-ink);
    overflow-wrap: anywhere;
  }
  .h1-b :global(.np-dot) {
    align-self: center;
    position: relative;
    top: 0.14em;
  }
  .h1-tag {
    min-width: 0;
  }
  .tally {
    --fs: var(--fs-label-xs);
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-inline: 0;
    font-family: var(--font-mono);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .back {
    --fs: var(--fs-label-xs);
    margin-inline: 0;
  }
  .back :global(.cs-more) {
    min-height: 0;
  }
  /* The link's line is one rule; its target is still 44px. */
  .back a {
    position: relative;
  }
  .back a::after {
    content: '';
    position: absolute;
    inset: -6px -4px;
  }
  .empty {
    margin: 0;
  }

  /* The torn-off last line of the page. */
  .tag-foot {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 24px;
    padding: 16px clamp(16px, 4vw, 64px);
    background: var(--np-desk);
    border-top: 1px dashed var(--text-secondary);
  }
  .tag-foot a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
  .tag-foot a:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 4px;
    border-radius: 2px;
  }

  @media print {
    /* The site's fixed body grain would grey every printed letter. */
    :global(body::after) {
      display: none !important;
    }
    .tag-main {
      min-height: 0;
    }
    .h1-a,
    .h1-b,
    .tally {
      color: #1a1008;
    }
    .back,
    .tag-foot {
      display: none;
    }
  }
</style>
