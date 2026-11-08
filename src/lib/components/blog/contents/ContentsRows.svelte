<script lang="ts">
  // The contents of the notebook: one row per post, on the rules, grouped by
  // year. Used by /blog (every post, numbered) and /blog/tag/[tag] (a tag's
  // posts, with their pasted-in cover thumbnails).
  //
  // A row reads like a contents page: the date in the margin against the red
  // rule, the title in Inter on the first line, a dotted leader out from the
  // title's last word to the post's number in the run, then the excerpt in
  // Fraunces and the subjects in pencil. Every line is one rule tall, so a
  // row is always a whole number of rules and the next one starts on a line.
  //
  // The leader is an inline box glued to the title's last word with no width
  // of its own (its negative margin cancels it), so it never moves a line
  // break; it runs on to the right and the title's box clips it just short
  // of the number, wherever that last word ends.
  //
  // The TITLE is the link, and its `::after` is stretched over the row so the
  // whole row still takes a click; the subject links sit above that layer, so
  // the row is never an interactive element nested in another.
  import PencilDot from '$lib/components/notes-paper/PencilDot.svelte';
  import { byYear, isoDay, marginDate, type ContentsPost } from './contents';

  let {
    posts,
    numbered = true,
    thumbs = false,
    yearAs = 'h3',
  }: {
    posts: ContentsPost[];
    /** Show each post's place in the run, after a dotted leader. */
    numbered?: boolean;
    /** Show cover thumbnails, pasted in at the end of the row (wide screens). */
    thumbs?: boolean;
    /** The year headings' level, one under the heading that opens the list. */
    yearAs?: 'h2' | 'h3';
  } = $props();

  let groups = $derived(byYear(posts));
  // In a list where any post has a photo, every row keeps the photo's column,
  // so the excerpts all share one measure.
  let reserve = $derived(thumbs && posts.some((p) => p.coverImageUrl));
</script>

{#each groups as group (group.start)}
  <div class="cr-year">
    {#if group.year}
      <svelte:element this={yearAs} class="np-kicker cr-y">{group.year}</svelte:element>
    {/if}
    <ol class="cr-list" start={group.start} role="list">
      {#each group.posts as post, i (post.slug)}
        {@const thumb = thumbs && post.coverImageUrl ? post.coverImageUrl : null}
        <li class="cr-row" class:numbered class:has-thumb={reserve}>
          {#if post.publishedAt}
            <time class="cr-date cs-on" datetime={isoDay(post.publishedAt)}>{marginDate(post.publishedAt)}</time>
          {/if}
          <p class="cr-title cs-on">
            <a class="cr-link" href="/blog/{post.slug}">{post.title}</a>{#if numbered}<span
                class="cr-lead"
                aria-hidden="true"
              ></span>{/if}
          </p>
          {#if numbered}
            <span class="cr-num cs-on" aria-hidden="true">{group.start + i}</span>
          {/if}
          {#if post.excerpt}<p class="cr-x cs-on">{post.excerpt}</p>{/if}
          {#if post.tags?.length}
            <ul class="cr-tags cs-on" role="list" aria-label="Tags">
              {#each post.tags as tag (tag)}
                <li>
                  <a class="cr-tag" href="/blog/tag/{encodeURIComponent(tag)}"><PencilDot word={tag} />{tag}</a>
                </li>
              {/each}
            </ul>
          {/if}
          {#if thumb}
            <span class="cr-thumb" aria-hidden="true"><img src={thumb} alt="" loading="lazy" decoding="async" /></span>
          {/if}
        </li>
      {/each}
    </ol>
  </div>
{/each}

<style>
  /* A year: its numerals in the margin on a rule of their own, then its rows. */
  .cr-year + .cr-year {
    padding-top: var(--np-l);
  }
  .cr-y {
    width: var(--cs-mg);
    box-sizing: border-box;
  }
  .cr-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .cr-row {
    position: relative;
    display: grid;
    grid-template-columns: var(--cs-mg) var(--cs-pad) minmax(0, 1fr) auto;
    grid-template-areas:
      'date . title num'
      '. . x x'
      '. . tags tags';
    align-content: start;
    /* One blank rule under every entry. */
    padding-bottom: var(--np-l);
  }
  .cr-row:not(.numbered) {
    grid-template-columns: var(--cs-mg) var(--cs-pad) minmax(0, 1fr);
    grid-template-areas:
      'date . title'
      '. . x'
      '. . tags';
  }
  .cr-row.has-thumb {
    /* Room for a photo three rules tall at the end of the row; min-height
       (not a spanning grid item) so the text tracks keep their rule height.
       The row stops at the excerpt's measure, so the photo sits at the edge
       of the text rather than out across the page. */
    min-height: calc(3 * var(--np-l));
    max-width: calc(var(--cs-mg) + 2 * var(--cs-pad) + 44rem + 3 * var(--np-l));
    box-sizing: border-box;
    padding-right: calc(3 * var(--np-l) + var(--cs-pad));
  }

  /* The date, in the margin against the red rule, where a kicker goes. */
  .cr-date {
    --fs: var(--fs-label-xs);
    grid-area: date;
    /* Flush with the year kicker above it. */
    padding-right: 22px;
    font-family: var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    text-align: right;
    white-space: nowrap;
    color: var(--np-pen-text);
  }

  .cr-title {
    --fs: clamp(20px, 1.8vw, 24px);
    grid-area: title;
    font-family: var(--font-display);
    font-weight: 800;
    letter-spacing: -0.02em;
    color: var(--np-ink);
    text-wrap: balance;
    overflow-wrap: anywhere;
    /* A title wraps at a comfortable measure; the room to its right is the
       leader's (at least enough for a run of dots), and the box clips it. */
    padding-right: max(0px, 100% - 38rem);
    overflow: hidden;
  }
  .cr-row.numbered .cr-title {
    padding-right: max(72px, 100% - 38rem);
  }
  .cr-link {
    color: inherit;
    text-decoration: none;
  }
  /* The whole row takes the title's click. */
  .cr-link::after {
    content: '';
    position: absolute;
    inset: 0;
  }
  .cr-row:hover .cr-link,
  .cr-link:focus-visible {
    color: var(--np-pen-ink);
    text-decoration: underline;
    text-decoration-thickness: 2px;
    text-decoration-color: var(--np-pen);
    text-underline-offset: 0.18em;
  }
  /* The title's box clips (for the leader), so the ring goes round the row
     the link stands for, where nothing can cut it. */
  @supports selector(:has(*)) {
    .cr-link:focus-visible {
      outline: none;
    }
    .cr-row:has(.cr-link:focus-visible) {
      outline: 2px solid var(--accent-hover);
      outline-offset: 4px;
      border-radius: 2px;
    }
  }

  /* A contents page's dotted leader, out from the title's last word to the
     number, on the writing line. No width of its own: see the note above. */
  .cr-lead {
    display: inline-block;
    width: 100vw;
    height: 4px;
    margin-right: -100vw;
    padding-left: 14px;
    box-sizing: border-box;
    vertical-align: 1px;
    background: radial-gradient(circle, var(--text-muted) 0 1px, transparent 1.5px) 0 0 / 9px 4px repeat-x;
    background-origin: content-box;
    background-clip: content-box;
    opacity: 0.7;
  }
  .cr-num {
    --fs: 20px;
    grid-area: num;
    align-self: end;
    padding-left: 12px;
    font-family: var(--font-display);
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
    color: var(--np-pen-text);
  }

  .cr-x {
    --fs: 17px;
    grid-area: x;
    max-width: 44rem;
    font-family: var(--fs-serif);
    font-optical-sizing: auto;
    color: var(--np-ink-soft);
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }

  .cr-tags {
    --fs: var(--fs-label-xs);
    grid-area: tags;
    display: flex;
    flex-wrap: wrap;
    column-gap: 20px;
    padding: 0;
    list-style: none;
    font-family: var(--font-mono);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  /* A flex box exactly one rule tall: an inline box here would let the
     pencil dot's synthesised baseline grow the line past the pitch. */
  .cr-tag {
    position: relative;
    z-index: 1;
    display: flex;
    height: var(--np-l);
    align-items: center;
    gap: 7px;
    color: var(--text-muted);
    text-decoration: none;
  }
  /* A 44px target from a 32px line, without moving the line. */
  .cr-tag::after {
    content: '';
    position: absolute;
    inset: -6px -4px;
  }
  .cr-tag:hover {
    color: var(--np-pen-ink);
    text-decoration: underline;
    text-underline-offset: 4px;
  }

  /* A cover photo pasted in at the end of the row, taped at the top. */
  .cr-thumb {
    position: absolute;
    top: 0;
    right: 0;
    width: calc(3 * var(--np-l));
    height: calc(3 * var(--np-l) - 8px);
    padding: 4px;
    box-sizing: border-box;
    background: var(--np-card);
    border: 1px solid var(--line-strong);
    transform: rotate(1.4deg);
  }
  .cr-thumb::before {
    content: '';
    position: absolute;
    top: -8px;
    left: 50%;
    width: 44px;
    height: 16px;
    margin-left: -22px;
    background: var(--np-tape);
    transform: rotate(-3deg);
  }
  .cr-thumb img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  @media (max-width: 760px) {
    /* The margin is a strip now: the year goes over its rows, and the date
       goes on its own rule above the title, in petrol, with the number at
       the other end of it. */
    .cr-y {
      width: auto;
      margin-left: calc(var(--cs-mg) + var(--cs-pad));
      padding: 0;
      writing-mode: horizontal-tb;
      transform: none;
      /* The kit centres a phone kicker in the margin; this one is not in it. */
      justify-self: start;
      text-align: left;
      line-height: var(--np-l);
    }
    .cr-row,
    .cr-row:not(.numbered) {
      grid-template-columns: var(--cs-mg) var(--cs-pad) minmax(0, 1fr) auto;
      grid-template-areas:
        '. . date num'
        '. . title title'
        '. . x x'
        '. . tags tags';
    }
    .cr-row.has-thumb {
      min-height: 0;
      max-width: none;
      padding-right: 0;
    }
    .cr-title,
    .cr-row.numbered .cr-title {
      padding-right: 0;
    }
    /* A phone has room for a third line of the excerpt, and needs it. */
    .cr-x {
      -webkit-line-clamp: 3;
      line-clamp: 3;
    }
    .cr-date {
      padding-right: 0;
      text-align: left;
      color: var(--np-pen-ink);
    }
    .cr-lead {
      display: none;
    }
    .cr-num {
      --fs: 17px;
      align-self: start;
    }
    .cr-thumb {
      display: none;
    }
  }

  @media print {
    .cr-row,
    .cr-row:not(.numbered),
    .cr-row.has-thumb {
      display: block;
      max-width: none;
      padding: 0 0 10px;
      break-inside: avoid;
    }
    .cr-title,
    .cr-row.numbered .cr-title {
      padding-right: 0;
      overflow: visible;
    }
    .cr-y {
      width: auto;
      margin: 12px 0 4px;
      /* A year never ends a page without its first entry under it. */
      break-after: avoid;
      text-align: left;
      color: #1a1008;
    }
    .cr-date,
    .cr-title,
    .cr-x,
    .cr-tag {
      color: #1a1008;
    }
    .cr-lead,
    .cr-num,
    .cr-thumb {
      display: none;
    }
    .cr-x {
      display: block;
    }
  }
</style>
