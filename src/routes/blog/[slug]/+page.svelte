<script lang="ts">
  import ProseContent from '$lib/components/ProseContent.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import ReadingProgress from '$lib/components/blog/ReadingProgress.svelte';
  import SectionRail from '$lib/components/blog/SectionRail.svelte';
  import ReaderControls from '$lib/components/blog/ReaderControls.svelte';
  import ReadingBeacon from '$lib/components/blog/ReadingBeacon.svelte';
  import CommentsSection from '$lib/components/blog/CommentsSection.svelte';

  let { data } = $props();

  // Bound to the article element so the progress rail and the beacon measure
  // the ARTICLE rather than the document. A long comment thread underneath
  // would otherwise report 60% at the end of the piece.
  let articleEl = $state<HTMLElement | null>(null);

  const formattedDate = $derived(
    data.post.publishedAt
      ? new Date(data.post.publishedAt)
          .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
          .toUpperCase()
      : null,
  );

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

<article class="article" bind:this={articleEl}>
  <header class="art-head">
    <p class="art-meta">
      {#if formattedDate}<span>{formattedDate}</span><span class="meta-sep">/</span>{/if}
      <span>{data.readingTime} MIN READ</span>
      {#if data.post.tags && data.post.tags.length > 0}
        <span class="meta-sep">/</span>
        {#each data.post.tags as tag, i (tag)}
          {#if i > 0}<span class="meta-dot">·</span>{/if}
          <a href="/blog/tag/{tag}" class="meta-tag">{tag}</a>
        {/each}
      {/if}
    </p>

    <h1 class="art-title">{data.post.title}</h1>

    {#if data.post.excerpt}
      <p class="art-lede">{data.post.excerpt}</p>
    {/if}

    <div class="art-controls">
      <ReaderControls />
    </div>
  </header>

  {#if data.post.coverImageUrl}
    <figure class="art-cover">
      <img src={data.post.coverImageUrl} alt={data.post.coverImageAlt || data.post.title} />
    </figure>
  {:else}
    <hr class="art-rule" />
  {/if}

  <div class="art-body">
    {#if data.toc.length > 1}
      <div class="art-rail">
        <SectionRail toc={data.toc} />
      </div>
    {/if}

    <ProseContent class="post-prose" editorial bodyFont={data.bodyFontVar}>
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html data.articleHtml}
    </ProseContent>
  </div>

  <!-- The completion sentinel the beacon observes. Placed at the end of the
       PROSE, before comments — reaching the responses is not reading the piece. -->
  <div data-article-end aria-hidden="true"></div>

  <div class="art-foot">
    {#if data.references}
      <!-- Sources, in the footer and quiet. They used to sit at the end of the
           prose behind an <h3> the size of a section break, which made the
           bibliography the most prominent thing on the finished page. -->
      <section class="art-sources" aria-labelledby="art-sources-h">
        <h2 class="art-sources-h" id="art-sources-h">Sources</h2>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html data.references}
      </section>
    {/if}

    {#if data.owner}
      <p class="art-owner">
        You are reading this as the owner — no view is recorded.
        <a href="/admin/content/blog">Post list</a>
        <span class="meta-dot">·</span>
        <a href="/admin/content/comments">Moderate responses</a>
      </p>
    {/if}

    <CommentsSection slug={data.post.slug} comments={data.comments} />

    <div class="art-back">
      <a href="/blog" class="nav-link">← Back to writing</a>
    </div>
  </div>
</article>

<footer class="art-page-foot">
  <a href="/" class="nav-link">← Home</a>
  <a href="/admin" class="nav-link">Admin</a>
</footer>

<style>
  /* Sources. Everything here is chosen to be QUIET — the mono label at label
     size, muted colour, no rule above it competing with the article's own. A
     reader who wants to check a claim finds them; a reader who does not is
     never made to scroll past a heading in the display face. */
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

  .art-sources :global(ol.footnotes li::marker) {
    font-family: var(--font-mono);
    color: var(--text-muted);
  }

  /* A raw URL is long and not the point; the source's title is. Wrap rather
     than overflow, and never widen the measure. */
  .art-sources :global(ol.footnotes a) {
    color: var(--text-secondary);
    text-decoration: underline;
    text-underline-offset: 2px;
    word-break: break-word;
  }

  .art-sources :global(ol.footnotes a:hover) {
    color: var(--accent);
  }

  /* The article is one grid; the header, cover, body and footer are all rows
     in it, so a full-bleed cover and a measure-width paragraph line up on the
     same column definition rather than on two sets of paddings. */
  .article {
    --measure: var(--reader-measure, 39rem);
    --note-col: 15rem;
    --rail-col: 13rem;
    --col-gap: 2.75rem;

    display: grid;
    grid-template-columns:
      [bleed-start] minmax(1.25rem, 1fr)
      [rail-start] minmax(0, var(--rail-col))
      [rail-end] var(--col-gap)
      [main-start] minmax(0, var(--measure))
      [main-end] var(--col-gap)
      [note-start] minmax(0, var(--note-col))
      [note-end] minmax(1.25rem, 1fr)
      [bleed-end];
    min-height: 100vh;
    padding: 3.5rem 0 4rem;
  }

  .art-rule,
  .art-foot {
    grid-column: main;
  }

  /* The masthead spans the WHOLE editorial width — rail through margin — not
     just the reading column. Confined to `main` it sat hard left with the
     reserved margin column empty beside it, which reads as a layout bug rather
     than as a measure. The lede keeps its own max-width below, because a
     standfirst set to 67rem is not a standfirst. */
  .art-head {
    grid-column: rail-start / note-end;
  }

  .art-cover {
    grid-column: bleed;
    margin: 2.5rem 0 3rem;
  }

  .art-cover img {
    display: block;
    width: 100%;
    max-height: 60vh;
    object-fit: cover;
  }

  /* The body spans the whole grid so ProseContent — itself a grid with the
     same column names — can place bleed figures and margin notes. */
  /* The same column definition as .article, not `subgrid`. Both read the same
     custom properties, so the tracks line up exactly — and this works in every
     browser rather than needing a @supports fallback that would have to repeat
     the template anyway. */
  .art-body {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns:
      [bleed-start] minmax(1.25rem, 1fr)
      [rail-start] minmax(0, var(--rail-col))
      [rail-end] var(--col-gap)
      [main-start] minmax(0, var(--measure))
      [main-end] var(--col-gap)
      [note-start] minmax(0, var(--note-col))
      [note-end] minmax(1.25rem, 1fr)
      [bleed-end];
  }

  .art-rail {
    grid-column: rail;
    grid-row: 1;
    /* The prose spans the full width on the same row so its figures can bleed,
       which means a bleed image scrolls UNDER this column. The ground and the
       stacking context are what keep the outline readable when it does. */
    position: relative;
    z-index: 2;
  }

  .art-rail :global(.section-rail) {
    background: var(--bg);
    padding: 0.5rem 0.5rem 0.75rem;
  }

  .art-body :global(.post-prose) {
    grid-column: 1 / -1;
    grid-row: 1;
  }

  .art-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
    margin-bottom: 1.5rem;
  }

  .art-title {
    font-family: var(--font-display);
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: -0.025em;
    line-height: 0.92;
    color: var(--text-primary);
    /* Wider than the old page allowed: the headline is the one element that
       earns the extra size in an editorial layout. */
    font-size: clamp(2.5rem, 6vw, 4.25rem);
    margin-bottom: 1.5rem;
  }

  .art-lede {
    max-width: 34rem;
    font-family: var(--font-read);
    font-size: clamp(1.125rem, 2vw, 1.375rem);
    line-height: 1.5;
    color: var(--text-primary);
    margin-top: 1.5rem;
    padding-left: 1rem;
    border-left: 3px solid var(--accent);
  }

  .art-controls {
    display: flex;
    justify-content: flex-end;
    margin-top: 2rem;
  }

  .art-rule {
    border: none;
    height: 2px;
    background: var(--text-primary);
    opacity: 0.12;
    margin: 2.5rem 0 3rem;
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

  .art-owner {
    margin: 2.5rem 0 0;
    padding: 0.6rem 0.9rem;
    background: var(--card-bg);
    border-left: 3px solid var(--accent-ink);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
  }

  .art-owner a {
    color: var(--accent);
  }

  .art-back {
    margin-top: 3rem;
    padding-top: 1.5rem;
    border-top: 2px solid var(--line-strong);
  }

  .art-page-foot {
    display: flex;
    gap: 1.5rem;
    padding: 1.5rem;
    border-top: 2px solid var(--line-strong);
  }

  /* The drop cap.
     Scoped to a DIRECT child paragraph of the prose root. The old selector was
     `.post-prose p:first-of-type::first-letter`, which matches the first <p>
     of every parent — so each aside, callout, blockquote and figure caption in
     an editorial layout would have grown its own 4.25em orange initial. */
  .art-body :global(.post-prose > p:first-of-type::first-letter) {
    font-family: var(--font-display);
    font-weight: 900;
    color: var(--accent);
    font-size: 4.25em;
    line-height: 0.85;
    float: left;
    padding: 0.05em 0.12em 0 0;
    margin-right: 0.05em;
  }

  @media (max-width: 1180px) {
    .article {
      grid-template-columns:
        [bleed-start] minmax(1.25rem, 1fr)
        [main-start] minmax(0, var(--measure))
        [main-end] minmax(1.25rem, 1fr)
        [bleed-end];
      padding-top: 2.5rem;
    }

    /* `rail-start` and `note-end` do not exist in the narrow template above,
       so the masthead must be re-placed by a name that does — otherwise it
       falls back to auto placement and lands in the gutter. */
    .art-head {
      grid-column: main;
    }

    .art-body {
      display: block;
    }

    .art-rail,
    .art-body :global(.post-prose) {
      grid-column: main;
    }

    .art-body {
      grid-column: main;
    }
  }

  @media print {
    .art-controls,
    .art-page-foot,
    .art-back,
    .art-owner {
      display: none;
    }

    .article {
      display: block;
      padding: 0;
    }
  }
</style>
