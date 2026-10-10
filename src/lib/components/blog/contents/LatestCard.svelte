<script lang="ts">
  // The newest post as an index card pinned to the top of the contents page:
  // a mono label on the card's head line above its red rule, the date
  // rubber-stamped across the corner, then the title, the excerpt and its
  // subjects written on the card's lines. The card's lines are the page's own
  // pitch, so type sizes and nudges are the sheet's (`.cs-on`).
  //
  // The title is the one link; its `::after` covers the card so the whole
  // card takes the click, and the subject links sit above that layer.
  import DateStamp from '$lib/components/notes-paper/DateStamp.svelte';
  import IndexCard from '$lib/components/notes-paper/IndexCard.svelte';
  import PencilDot from '$lib/components/notes-paper/PencilDot.svelte';
  import { seedFor } from '$lib/components/notes-paper/paper';
  import { snapToRule } from '$lib/components/notes-paper/snap';
  import { isoDay, longDate, type ContentsPost } from './contents';

  let { post, label = 'Most recent post' }: { post: ContentsPost; label?: string } = $props();

  // A title long enough to take three lines at the card's full size is set a
  // size down, so it keeps some air between its lines on the card's rules.
  const LONG_TITLE = 44;
  let long = $derived(post.title.length > LONG_TITLE);
</script>

<!-- Snapped, so whatever is set under the card on a narrow sheet starts on a rule. -->
<div class="lc-wrap" use:snapToRule>
  <IndexCard as="article" class="lc" tilt={1.2} pin aria-labelledby="lc-title">
    <p class="lc-label cs-on">{label}</p>
    {#if post.publishedAt}
      <span class="lc-stamp">
        <DateStamp
          date={longDate(post.publishedAt)}
          datetime={isoDay(post.publishedAt)}
          tilt={-5}
          seed={seedFor(post.slug)}
        />
      </span>
    {/if}
    <h3 class="lc-title cs-on" class:long id="lc-title"><a class="lc-link" href="/blog/{post.slug}">{post.title}</a></h3>
    {#if post.excerpt}<p class="lc-x cs-on">{post.excerpt}</p>{/if}
    {#if post.tags?.length}
      <ul class="lc-tags cs-on" role="list" aria-label="Tags">
        {#each post.tags as tag (tag)}
          <li><a class="lc-tag" href="/blog/tag/{encodeURIComponent(tag)}"><PencilDot word={tag} />{tag}</a></li>
        {/each}
      </ul>
    {/if}
    <p class="lc-more cs-on" aria-hidden="true"><span class="cs-more"><span>Read it</span> →</span></p>
  </IndexCard>
</div>

<style>
  .lc-wrap {
    /* The card's own lines: the page's pitch, with the double red head rule
       closing the first (label) line, clear of the title's capitals. */
    max-width: 38rem;
    padding-top: 6px;
    padding-bottom: var(--np-snap, 0px);
  }
  .lc-wrap :global(.lc) {
    padding: 0 clamp(16px, 2.2vw, 28px) 4px;
    background-image:
      linear-gradient(var(--np-margin-a), var(--np-margin-a)),
      linear-gradient(var(--np-margin-b), var(--np-margin-b)),
      var(--np-lines);
    background-size:
      100% 1px,
      100% 1px,
      100% calc(100% - var(--np-l));
    background-position:
      0 calc(var(--np-l) - 4px),
      0 calc(var(--np-l) - 1px),
      0 var(--np-l);
    background-repeat: no-repeat;
  }

  .lc-label {
    --fs: var(--fs-label-xs);
    padding-right: 9rem;
    font-family: var(--font-mono);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--np-pen-ink);
  }
  .lc-stamp {
    position: absolute;
    top: -10px;
    right: 14px;
    z-index: 1;
    background: var(--np-card);
  }

  .lc-title {
    --fs: clamp(24px, 2.4vw, 30px);
    margin-inline: 0;
    font-family: var(--font-display);
    font-weight: 800;
    letter-spacing: -0.03em;
    color: var(--np-ink);
    text-wrap: balance;
    overflow-wrap: anywhere;
  }
  .lc-title.long {
    --fs: clamp(22px, 1.9vw, 25px);
    letter-spacing: -0.025em;
  }
  .lc-link {
    color: inherit;
    text-decoration: none;
  }
  .lc-link::after {
    content: '';
    position: absolute;
    inset: 0;
  }
  .lc-wrap:hover .lc-link,
  .lc-link:focus-visible {
    color: var(--np-pen-ink);
    text-decoration: underline;
    text-decoration-thickness: 2px;
    text-decoration-color: var(--np-pen);
    text-underline-offset: 0.16em;
  }

  .lc-x {
    --fs: 17px;
    margin-inline: 0;
    font-family: var(--fs-serif);
    font-optical-sizing: auto;
    color: var(--np-ink-soft);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    overflow: hidden;
  }

  .lc-tags {
    --fs: var(--fs-label-xs);
    display: flex;
    flex-wrap: wrap;
    column-gap: 20px;
    margin-inline: 0;
    padding: 0;
    list-style: none;
    font-family: var(--font-mono);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  /* A flex box exactly one rule tall: an inline box here would let the
     pencil dot's synthesised baseline grow the line past the pitch. */
  .lc-tag {
    position: relative;
    z-index: 1;
    display: flex;
    height: var(--np-l);
    align-items: center;
    gap: 7px;
    color: var(--text-muted);
    text-decoration: none;
  }
  .lc-tag::after {
    content: '';
    position: absolute;
    inset: -6px -4px;
  }
  .lc-tag:hover {
    color: var(--np-pen-ink);
    text-decoration: underline;
    text-underline-offset: 4px;
  }

  .lc-more {
    --fs: var(--fs-label-xs);
    margin-inline: 0;
  }
  .lc-more :global(.cs-more) {
    min-height: 0;
  }
  .lc-wrap:hover .lc-more :global(.cs-more) {
    color: var(--np-pen-ink);
  }

  /* A phone's card is too narrow to turn without clipping its lines. */
  @media (max-width: 420px) {
    .lc-wrap :global(.lc) {
      transform: none;
    }
    .lc-label {
      padding-right: 0;
    }
    .lc-stamp {
      top: auto;
      bottom: 10px;
      right: 10px;
    }
  }

  @media print {
    .lc-wrap :global(.lc) {
      padding: 8px 0;
      background: none;
      border: 0;
    }
    .lc-stamp,
    .lc-more {
      display: none;
    }
    .lc-title,
    .lc-x,
    .lc-label,
    .lc-tag {
      color: #1a1008;
    }
    .lc-x {
      display: block;
    }
  }
</style>
