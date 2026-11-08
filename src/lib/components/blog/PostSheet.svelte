<script lang="ts">
  /**
   * One blog post, written on the landing page's notes paper.
   *
   * Both /blog/[slug] and the share-link preview render THIS, so the preview
   * cannot drift from what publishes (the reason the preview exists). Each
   * route keeps its own data contract and passes what it has; the page-only
   * things (the reading beacon, the progress bar, comments, the owner's strip)
   * stay in the route and arrive through `foot`.
   *
   * The sheet is a ruled exercise-book page: a double red margin rule with the
   * date stamp, reading time and contents in the margin, the post in a measured
   * column on the rules, and margin notes in the right-hand column. Every
   * text block is set on the rules (see post-paper.css), so the lines sit
   * under the writing at every text size the reader can choose.
   */
  import type { Snippet } from 'svelte';
  import type { TocEntry } from '$lib/blog/renderer';
  import ProseContent from '$lib/components/ProseContent.svelte';
  import SectionRail from './SectionRail.svelte';
  import ReaderControls from './ReaderControls.svelte';
  import DateStamp from '$lib/components/notes-paper/DateStamp.svelte';
  import Tally from '$lib/components/notes-paper/Tally.svelte';
  import PencilDot from '$lib/components/notes-paper/PencilDot.svelte';
  import EndMark from '$lib/components/notes-paper/EndMark.svelte';
  import { npFont, seedFor } from '$lib/components/notes-paper/paper';
  import { snapToRule } from '$lib/components/notes-paper/snap';
  import { snapBlocks } from './snap-blocks';
  // The body's rules first: the sheet's width and print rules override them.
  import './post-prose.css';
  import './post-paper.css';

  type PostLike = {
    slug?: string;
    title: string;
    excerpt?: string | null;
    publishedAt?: string | Date | null;
    tags?: string[] | null;
    coverImageUrl?: string | null;
    coverImageAlt?: string | null;
    bodyFont?: string | null;
  };

  let {
    post,
    readingTime,
    articleHtml,
    toc,
    references = null,
    bodyFontVar,
    preview = false,
    articleEl = $bindable(null),
    banner,
    foot,
  }: {
    post: PostLike;
    /** Minutes, rounded; at least one. */
    readingTime: number;
    articleHtml: string;
    toc: TocEntry[];
    references?: string | null;
    /** The `--font-*` reference for the body face, from $lib/blog/fonts. */
    bodyFontVar: string;
    /** A share-link preview: stamped as a draft, no completion sentinel role. */
    preview?: boolean;
    /** The article element, for the progress bar and the reading beacon. */
    articleEl?: HTMLElement | null;
    /** A note pinned above the title (the preview's draft banner). */
    banner?: Snippet;
    /** After the sources: the owner's strip, comments, the way back. */
    foot?: Snippet;
  } = $props();

  // The reader's size and column, written up by ReaderControls. They are set
  // on the ARTICLE so the ruling, the type and the measure all follow them.
  let scale = $state(1);
  let column = $state<'narrow' | 'default' | 'wide'>('default');

  const font = $derived(npFont(post.bodyFont));

  // The measure, per face. A proportional face at 18px runs about eighty
  // characters to a 39rem line, past the comfortable range, so its three
  // columns are narrower; the monospaced face runs wide per character, so
  // it keeps the wider set for the same number of characters. The measure is
  // in rems at the middle size and grows and shrinks with the reader's text
  // size, so a column holds the same number of characters at every size (the
  // grid caps it at the room there is).
  const MEASURES = {
    proportional: { narrow: 30, default: 35, wide: 41 },
    mono: { narrow: 34, default: 39, wide: 46 },
  } as const;
  const measureRem = $derived(MEASURES[font === 'mono' ? 'mono' : 'proportional'][column]);

  const published = $derived(post.publishedAt ? new Date(post.publishedAt) : null);
  const London = { timeZone: 'Europe/London' } as const;
  const stampDate = $derived(
    published
      ? published.toLocaleDateString('en-GB', { ...London, day: 'numeric', month: 'short', year: 'numeric' })
      : null,
  );
  const stampDay = $derived(published ? published.toLocaleDateString('en-GB', { ...London, weekday: 'long' }) : null);
  const isoDate = $derived(published ? published.toISOString() : null);

  // A long read is said in figures alone: past six gates a tally stops being
  // something the eye can count and becomes a texture.
  const TALLY_MAX = 30;
  const tags = $derived(post.tags ?? []);
</script>

<article
  class="np-sheet np-ruled pp-sheet"
  class:pp-preview={preview}
  data-np-font={font}
  style:--reader-scale={scale}
  style:--reader-measure="calc({measureRem}rem * var(--reader-scale, 1))"
  bind:this={articleEl}
>
  <header class="pp-head">
    <div class="pp-title-block">
      {#if banner}
        <!-- Snapped on an upright wrapper: the note itself is turned, and a
             turned box measures taller than it is. -->
        <div class="pp-banner" use:snapToRule><div class="np-sticky">{@render banner()}</div></div>
      {/if}

      <h1 class="pp-title pp-set">{post.title}</h1>

      {#if post.excerpt}
        <p class="pp-lede pp-set">{post.excerpt}</p>
      {/if}

      {#if tags.length > 0}
        <ul class="pp-tags pp-band" aria-label="Tags">
          {#each tags as tag (tag)}
            <li>
              <a href="/blog/tag/{tag}" class="pp-tag"><PencilDot word={tag} />{tag}</a>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <!-- The margin: the stamp, the reading time, the reader's controls. After
         the title in the source so a screen reader meets the title first; the
         grid puts it in the margin. -->
    <div class="pp-meta">
      <div class="pp-stamp">
        {#if preview}
          <DateStamp date="Draft" sub={stampDate} tilt={-3} seed={seedFor(post.title)} />
        {:else if stampDate}
          <DateStamp date={stampDate} sub={stampDay} datetime={isoDate} tilt={-3} seed={seedFor(post.title)} />
        {/if}
      </div>
      <p class="pp-read">
        {#if readingTime <= TALLY_MAX}<Tally count={readingTime} seed={seedFor(post.title) + 3} height={15} />{/if}
        <span class="pp-read-n">{readingTime}</span>
        <span class="pp-read-u">min read</span>
      </p>
      <div class="pp-ctl">
        <ReaderControls bind:scale bind:column />
      </div>
    </div>

    <p class="pp-kicker np-kicker" aria-hidden="true">{preview ? 'Preview' : 'Writing'}</p>
  </header>

  {#if post.coverImageUrl}
    <figure class="pp-cover" use:snapToRule>
      <img src={post.coverImageUrl} alt={post.coverImageAlt || post.title} />
    </figure>
  {/if}

  <div class="pp-body">
    {#if toc.length > 1}
      <div class="pp-rail">
        <SectionRail {toc} />
      </div>
    {/if}

    <div class="pp-prose-wrap" use:snapBlocks={articleHtml}>
      <ProseContent class="post-prose pp-prose" bodyFont={bodyFontVar}>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html articleHtml}
      </ProseContent>
    </div>
  </div>

  <!-- The completion sentinel the beacon observes, at the end of the PROSE and
       before the sources and responses: reaching those is not reading the
       piece. It must stay directly after the body. -->
  <div class="pp-end-sentinel" data-article-end aria-hidden="true"></div>

  <footer class="pp-foot">
    <div class="pp-endmark"><EndMark seed={seedFor(post.title) + 7} /></div>

    {#if references}
      <!-- Sources, quiet, at the foot of the sheet: a margin kicker and a
           muted list on the rules. A reader who wants to check a claim finds
           them; a reader who does not is never made to scroll past a heading
           in the display face. -->
      <section class="pp-sources" aria-labelledby="pp-sources-h">
        <h2 class="pp-sources-h np-kicker" id="pp-sources-h">Sources</h2>
        <div class="pp-sources-list pp-band">
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          {@html references}
        </div>
      </section>
    {/if}

    {#if foot}
      <div class="pp-foot-main">{@render foot()}</div>
    {/if}
  </footer>
</article>
