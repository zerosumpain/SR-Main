<script lang="ts">
  // Writing — the journal index, as the contents page of an exercise book.
  //
  // It wears the landing page's NOTES theme: an ink cover, ruled like the
  // landing hero, with the counts drawn as hand marks (a tally, a ringed
  // figure, and the year the run began, rubber-stamped); then the torn edge,
  // and one sheet of ruled cream paper with the double red margin rule. On
  // the sheet: the newest post as an index card pinned to the page (it wears
  // the page's one dated stamp), the subjects the run covers, and the
  // contents themselves, a row per post with its date in the margin and a
  // dotted leader out to its place in the run. Every line of type sits on a
  // rule (ContentsSheet / ContentsBlock / `.cs-on`).
  //
  // On a wide sheet the subjects sit beside the card; at 1000px and under
  // they move to after the contents (a second copy of the list, only one of
  // which is ever displayed), so the contents start in the same place before
  // and after the posts land, with nothing pushing them down.
  //
  // `HealthShell` still supplies the site's header, the <main> landmark and
  // the ink footer (the notebook's back cover); everything between is ours.
  //
  // The posts promise is still STREAMED, so the cover paints before the list
  // resolves and pencil-stroke skeleton rows hold the contents' shape in the
  // meantime. That is why the counts on the cover sit inside `{#await}`
  // rather than at the top level, and why each count reserves its room with
  // an em dash rather than collapsing and reflowing the band when the
  // numbers land.
  import HealthShell from '$lib/components/shell/HealthShell.svelte';
  import ContentsSheet from '$lib/components/blog/contents/ContentsSheet.svelte';
  import ContentsBlock from '$lib/components/blog/contents/ContentsBlock.svelte';
  import ContentsRows from '$lib/components/blog/contents/ContentsRows.svelte';
  import LatestCard from '$lib/components/blog/contents/LatestCard.svelte';
  import { TALLY_LIMIT, firstYear, postCount, subjects, type Subject } from '$lib/components/blog/contents/contents';
  import DateStamp from '$lib/components/notes-paper/DateStamp.svelte';
  import InkRing from '$lib/components/notes-paper/InkRing.svelte';
  import PencilDot from '$lib/components/notes-paper/PencilDot.svelte';
  import Tally from '$lib/components/notes-paper/Tally.svelte';
  import { fade } from 'svelte/transition';
  import { dur } from '$lib/motion';

  let { data } = $props();

  // Widths of the pencil strokes standing in for titles and excerpts.
  const SKELETON_WIDTHS = [58, 44, 66, 38, 52];
</script>

<svelte:head>
  <title>Writing — Strange Ramblings</title>
  <meta name="description" content="Writing about code, design, and building things." />
  <meta property="og:title" content="Writing — Strange Ramblings" />
  <meta property="og:description" content="Writing about code, design, and building things." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://strangeramblings.com/blog" />
</svelte:head>

{#snippet subjectList(tags: Subject[])}
  <ul class="subject-list" role="list">
    {#each tags as s (s.tag)}
      <li class="subject cs-on">
        <a href="/blog/tag/{encodeURIComponent(s.tag)}"><PencilDot word={s.tag} size={13} />{s.tag}</a>
        {#if s.count <= TALLY_LIMIT}<Tally count={s.count} seed={s.count * 7 + 3} tone="pencil" height={14} />{/if}
        <span class="subject-n"><span class="vh">,</span> {postCount(s.count)}</span>
      </li>
    {/each}
  </ul>
{/snippet}

<HealthShell
  path="/blog"
  unifiedNav
  footer={['strangeramblings.com/blog · journal', 'Most recent first', 'Written by hand']}
>
  <ContentsSheet>
    {#snippet cover()}
      <section class="cover" aria-labelledby="journal-h">
        <div class="cover-in">
          <p class="cover-k cs-on" aria-hidden="true">Journal</p>
          <div class="cover-copy">
            <h1 id="journal-h">
              <span class="h1-a cs-on cs-tall">Words.</span>
              <span class="h1-b cs-on cs-tall">Read some here.</span>
            </h1>
            <p class="standfirst cs-on">The things I'm thinking about, working on, and shipping. Most recent first.</p>
          </div>

          <dl class="counts" aria-label="Journal summary">
            <div class="count">
              <dt class="cs-on">Posts</dt>
              <dd class="count-fig">
                {#await data.posts}<span class="fig cs-on">—</span>{:then posts}
                  <span class="fig cs-on">{posts.length}</span>
                  {#if posts.length <= TALLY_LIMIT}<Tally count={posts.length} seed={29} height={18} />{/if}
                {/await}
              </dd>
              <dd class="count-note cs-on">Published to date</dd>
            </div>
            <div class="count">
              <dt class="cs-on">Tags</dt>
              <dd class="count-fig">
                {#await data.posts}<span class="fig cs-on">—</span>{:then posts}
                  <span class="fig cs-on"><InkRing seed={53} pad={0.32}>{subjects(posts).length}</InkRing></span>
                {/await}
              </dd>
              <dd class="count-note cs-on">Subjects covered</dd>
            </div>
            <div class="count count-since">
              <dt class="cs-on">Since</dt>
              <dd class="count-fig">
                {#await data.posts}<span class="fig cs-on">—</span>{:then posts}
                  {@const since = firstYear(posts)}
                  {#if since}
                    <DateStamp date={since} datetime={since} tilt={-4} seed={43} />
                  {:else}<span class="fig cs-on">—</span>{/if}
                {/await}
              </dd>
              <dd class="count-note cs-on">First entry</dd>
            </div>
          </dl>
        </div>
      </section>
    {/snippet}

    {#await data.posts}
      <!-- The pinned card's place, held blank, so the ledger does not jump
           down the page when the newest post lands on it. -->
      <ContentsBlock kicker="Latest" top={2} bottom={2} as="div">
        <div class="sk-card" aria-hidden="true">
          <span class="sk-line" style:width="34%"></span>
          <span class="sk-line" style:width="62%"></span>
          <span class="sk-line sk-x" style:width="88%"></span>
          <span class="sk-line sk-x" style:width="54%"></span>
        </div>
      </ContentsBlock>
      <ContentsBlock kicker="The ledger" aria-labelledby="ledger-h">
        <h2 class="ledger-h cs-on cs-tall" id="ledger-h">Everything written down</h2>
        <p class="strap cs-on">Newest at the top. The number is its place in the run, not a ranking.</p>
      </ContentsBlock>
      <ContentsBlock wide as="div" bottom={2}>
        <div class="sk" aria-hidden="true">
          {#each SKELETON_WIDTHS as w, i (i)}
            <div class="sk-row">
              <span class="sk-date"></span>
              <span class="sk-line sk-title" style:width="{w}%"></span>
              <span class="sk-line sk-x" style:width="{Math.min(w + 20, 84)}%"></span>
            </div>
          {/each}
        </div>
      </ContentsBlock>
    {:then posts}
      {#if posts.length === 0}
        <ContentsBlock kicker="The ledger" top={2} bottom={4} aria-labelledby="ledger-h">
          <h2 class="ledger-h cs-on cs-tall" id="ledger-h">Everything written down</h2>
          <p class="empty np-aside">Nothing published yet.</p>
        </ContentsBlock>
      {:else}
        {@const tags = subjects(posts)}
        <ContentsBlock kicker="Latest" kickerAs="h2" top={2} bottom={2} data-cs-print="hide">
          <div class="first" class:with-subjects={tags.length > 0}>
            <LatestCard post={posts[0]} />
            {#if tags.length}
              <nav class="subjects subjects-wide" aria-labelledby="subjects-h">
                <h3 class="subjects-h np-label" id="subjects-h">Subjects covered</h3>
                {@render subjectList(tags)}
              </nav>
            {/if}
          </div>
        </ContentsBlock>

        <ContentsBlock kicker="The ledger" aria-labelledby="ledger-h">
          <h2 class="ledger-h cs-on cs-tall" id="ledger-h">Everything written down</h2>
          <p class="strap cs-on">Newest at the top. The number is its place in the run, not a ranking.</p>
        </ContentsBlock>
        <ContentsBlock wide as="div" bottom={3} data-cs-rows="">
          <div in:fade={{ duration: dur(200) }}>
            <ContentsRows {posts} />
          </div>
        </ContentsBlock>
        {#if tags.length}
          <ContentsBlock
            as="nav"
            kicker="Subjects"
            bottom={3}
            aria-labelledby="subjects-h-n"
            data-cs-subjects-narrow=""
          >
            <h2 class="subjects-h np-label" id="subjects-h-n">Subjects covered</h2>
            {@render subjectList(tags)}
          </ContentsBlock>
        {/if}
      {/if}
    {/await}
  </ContentsSheet>
</HealthShell>

<style>
  /* --- The cover: the landing hero's ink, ruled on the page's pitch --- */
  .cover {
    background-color: var(--text-primary);
    background-image: repeating-linear-gradient(
      to bottom,
      transparent 0 var(--np-y),
      var(--on-ink-05) var(--np-y) calc(var(--np-y) + 1px),
      transparent calc(var(--np-y) + 1px) var(--np-l)
    );
    color: var(--bg);
    /* A tall line's band is ink, ruled as the cover is, and reaches left
       over the margin (the counts to the right stand on their own rules). */
    --cs-ground: var(--text-primary);
    --cs-feint: color-mix(in srgb, var(--bg) 5%, var(--text-primary));
    --cs-out: 0 0 0 100vw;
    /* Two rules of ink above, two below: the tear eats into the last. */
    padding: calc(2 * var(--np-l)) 0 calc(2 * var(--np-l));
  }
  .cover-in {
    display: grid;
    grid-template-columns: var(--cs-mg) minmax(0, 1fr) auto;
    align-items: end;
    max-width: 1312px;
    margin: 0 auto;
    padding: 0 var(--cs-gut);
    box-sizing: border-box;
  }
  .cover-k {
    --fs: var(--fs-label-xs);
    align-self: start;
    /* On the headline's writing line, two rules down. */
    margin-top: calc(var(--cs-shift) + 2 * var(--np-l));
    padding-right: 22px;
    /* Above the headline's band, which reaches left across the margin (a
       grid item paints whole, so the later column would cover it). */
    position: relative;
    z-index: 1;
    font-family: var(--font-mono);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    text-align: right;
    color: var(--accent-on-dark);
  }
  .cover-copy {
    min-width: 0;
    padding-left: var(--cs-pad);
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
    --fs: clamp(56px, 6.4vw, 88px);
    --n: 3;
    font-family: var(--font-display);
    letter-spacing: -0.045em;
    color: var(--bg);
  }
  .h1-b {
    --fs: clamp(28px, 2.8vw, 38px);
    --n: 2;
    font-family: var(--fs-serif);
    font-optical-sizing: auto;
    font-style: italic;
    font-weight: 400;
    letter-spacing: -0.01em;
    color: var(--accent-on-dark);
  }
  .standfirst {
    --fs: var(--fs-body-lg);
    --kf: 0.34;
    max-width: 56ch;
    margin-inline: 0;
    font-family: var(--font-body);
    color: var(--on-ink-80);
    text-wrap: pretty;
  }

  /* The counts: hand marks on the ink, each three rules tall. */
  .counts {
    display: grid;
    grid-template-columns: repeat(3, auto);
    column-gap: clamp(28px, 3.4vw, 56px);
    margin: 0;
    padding-left: var(--cs-pad);
  }
  .count {
    min-width: 0;
  }
  .count dt,
  .count-note {
    --fs: var(--fs-label-xs);
    font-family: var(--font-mono);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .count dt {
    color: var(--on-ink-70);
  }
  .count-note {
    color: var(--accent-on-dark);
  }
  .count-fig {
    display: flex;
    align-items: flex-end;
    gap: 14px;
    height: var(--np-l);
    margin: 0;
    color: var(--bg);
  }
  .fig {
    --fs: 34px;
    font-family: var(--font-display);
    font-weight: 800;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
  }
  /* A tally sits on the writing line, a stroke short of the rule. */
  .count-fig :global(.np-tally) {
    margin-bottom: calc(var(--np-l) - var(--np-y) + 3px);
  }
  .counts :global(.np-tally) {
    --tone: var(--on-ink-80);
  }
  /* A ring the height of the figure, so it never reaches the label above. */
  .counts :global(.np-ring svg) {
    top: calc(50% - 0.6em);
    height: 1.2em;
  }
  .counts :global(.np-ring path) {
    stroke: var(--accent-on-dark);
  }
  /* The stamp, re-inked for the cover. */
  .counts .count-since :global(.np-stamp) {
    color: var(--accent-on-dark);
    margin-bottom: 2px;
  }
  .counts .count-since :global(.np-stamp path) {
    stroke: var(--accent-on-dark);
  }

  /* --- The sheet --- */
  .ledger-h {
    --fs: clamp(30px, 3.4vw, 46px);
    --n: 2;
    margin-inline: 0;
    font-family: var(--font-display);
    font-weight: 800;
    letter-spacing: -0.035em;
    color: var(--np-ink);
    text-wrap: balance;
  }
  .strap,
  .empty {
    margin-inline: 0;
  }
  .strap {
    --fs: 17px;
    max-width: 60ch;
    font-family: var(--fs-serif);
    font-optical-sizing: auto;
    font-style: italic;
    color: var(--np-ink-soft);
  }

  /* The latest card and, beside it on a wide sheet, the subjects. */
  .first {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    row-gap: var(--np-l);
  }
  .first.with-subjects {
    grid-template-columns: minmax(0, 38rem) minmax(0, 22rem);
    column-gap: clamp(32px, 6vw, 112px);
    align-items: start;
  }
  .subjects {
    min-width: 0;
  }
  .subjects-h {
    /* One rule tall, and a kicker's tracking: it labels the list under it. */
    line-height: var(--np-l);
  }
  /* A blank rule between subjects: each link's 44px target then has a
     rule and a half to itself and never overlaps the next one's. */
  .subject-list {
    display: grid;
    row-gap: var(--np-l);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  /* Centred, not baseline-aligned: mixed faces on one baseline would grow
     the line box past the pitch. Every item is one rule tall or less. */
  .subject {
    --fs: 17px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: 12px;
    font-family: var(--fs-serif);
    font-optical-sizing: auto;
    font-style: italic;
  }
  .subject a {
    position: relative;
    display: inline-flex;
    height: var(--np-l);
    align-items: center;
    gap: 9px;
    color: var(--np-ink);
    text-decoration: none;
  }
  .subject a::after {
    content: '';
    position: absolute;
    inset: -6px -4px;
  }
  .subject a:hover {
    color: var(--np-pen-ink);
    text-decoration: underline;
    text-underline-offset: 4px;
  }
  .subject-n {
    font-family: var(--font-mono);
    font-style: normal;
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .vh {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  /* --- Skeleton: faint pencil strokes on the rules while the list lands --- */
  .sk-row {
    display: grid;
    grid-template-columns: var(--cs-mg) var(--cs-pad) minmax(0, 1fr);
    grid-template-rows: var(--np-l) var(--np-l);
    padding-bottom: var(--np-l);
  }
  .sk-date,
  .sk-line {
    display: block;
    height: var(--np-l);
    /* A soft pencil stroke resting on the rule. */
    background: linear-gradient(var(--line-strong), var(--line-strong)) 0 calc(var(--np-y) - 9px) / 100% 7px
      no-repeat;
  }
  .sk-card {
    display: grid;
    grid-template-rows: repeat(4, var(--np-l));
    max-width: 38rem;
    /* The pinned card lands seven rules tall with its pin's room above;
       this holds the same, whether or not snapToRule has run yet. */
    height: calc(7 * var(--np-l) - 6px);
    margin-top: 6px;
    padding: 0 clamp(16px, 2.2vw, 28px);
    box-sizing: border-box;
    background: var(--np-card);
    border: 1px solid var(--line-strong);
  }
  .sk-card .sk-line {
    grid-column: auto;
  }
  .sk-date {
    grid-column: 1;
    grid-row: 1;
    width: 52px;
    justify-self: end;
    margin-right: 18px;
  }
  .sk-line {
    grid-column: 3;
  }
  .sk-x {
    opacity: 0.6;
  }
  @media (prefers-reduced-motion: no-preference) {
    .sk-date,
    .sk-line {
      animation: sk-pulse 1.6s ease-in-out infinite;
    }
  }
  @keyframes sk-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  @media (max-width: 1100px) {
    .cover-in {
      grid-template-columns: var(--cs-mg) minmax(0, 1fr);
    }
    .counts {
      grid-column: 2;
      margin-top: var(--np-l);
    }
  }
  /* The subjects: beside the card on a wide sheet, after the contents on a
     narrow one (the other copy is not displayed, so it is not read out). */
  :global(.cs-sheet > [data-cs-subjects-narrow]) {
    display: none;
  }
  @media (min-width: 1001px) {
    /* The narrow copy is the sheet's hidden last child here, so the rows
       take the rest of a short sheet themselves. */
    :global(.cs-sheet > [data-cs-rows]:nth-last-child(2)) {
      flex: 1 0 auto;
    }
  }
  @media (max-width: 1000px) {
    .first.with-subjects {
      grid-template-columns: minmax(0, 38rem);
    }
    .subjects-wide {
      display: none;
    }
    :global(.cs-sheet > [data-cs-subjects-narrow]) {
      display: block;
    }
  }
  /* A phone's card runs its excerpt to three lines: one rule more to hold. */
  @media (max-width: 420px) {
    .sk-card {
      height: calc(8 * var(--np-l) - 6px);
    }
  }
  @media (max-width: 760px) {
    .cover-k {
      align-self: start;
      padding: 4px 0 0;
      line-height: 1.4;
      margin: 0;
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      justify-self: center;
    }
    .h1-a {
      --n: 2;
    }
    .ledger-h {
      --n: 1;
    }
    .counts {
      grid-template-columns: repeat(2, auto);
      justify-content: start;
      row-gap: var(--np-l);
    }
    .count-since {
      grid-column: 1 / -1;
    }
    .sk-date {
      display: none;
    }
  }

  @media print {
    /* The shell's fixed grain would print over every page (blank), the
       site's body grain greys every letter, and the ink footer prints cream
       on white; none belongs on paper. Local to this page, so the shell and
       app.css are untouched. */
    :global(.hs-grain),
    :global(.hs-foot),
    :global(body::after) {
      display: none !important;
    }
    :global(.hs) {
      background: none;
    }
    /* The pinned card repeats the first row; the contents say it all. */
    :global(.cs-sheet > [data-cs-print='hide']),
    :global(.cs-sheet > [data-cs-subjects-narrow]) {
      display: none !important;
    }
    .cover-copy {
      padding: 0;
    }
    .cover {
      background: none;
      color: #1a1008;
      padding: 0 0 12px;
    }
    .cover-in,
    .counts {
      display: block;
      padding: 0;
    }
    .cover-k,
    .counts,
    .subjects {
      display: none;
    }
    .h1-a,
    .h1-b,
    .standfirst,
    .ledger-h,
    .strap {
      color: #1a1008;
    }
  }
</style>
