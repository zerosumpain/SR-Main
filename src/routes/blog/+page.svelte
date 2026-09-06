<script lang="ts">
  // Writing — the journal index.
  //
  // Wears the /health editorial system, the same way /research, /news and
  // /drive do: `HealthShell` with `unifiedNav`, an ink cover band carrying the
  // count deck, then paper sections opened by `SectionHead`.
  //
  // The post list is the RANKED-MOVES row, not a card grid: a display numeral,
  // then a column saying what the thing is, then the content, with the one
  // hairline between rows drawn as the container's own ground showing through
  // a `gap: 1px`. Safe here because it is a fixed single column — in an
  // `auto-fit` grid the unfilled tracks would paint as blocks.
  //
  // The posts promise is still STREAMED, so the cover paints before the list
  // resolves and the skeleton holds the rows' shape in the meantime. That is
  // why the counts on the cover sit inside `{#await}` rather than at the top
  // level, and why the deck reserves its space with an em dash rather than
  // collapsing and reflowing the band when the numbers land.
  import HealthShell from '$lib/components/health/hub/HealthShell.svelte';
  import SectionHead from '$lib/components/health/hub/SectionHead.svelte';
  import { fade } from 'svelte/transition';
  import { dur } from '$lib/motion';

  let { data } = $props();

  type Post = Awaited<typeof data.posts>[number];

  function collectTags(posts: Post[]): string[] {
    const seen = new Set<string>();
    for (const p of posts) for (const t of p.tags ?? []) seen.add(t);
    return [...seen].sort();
  }

  const fmtDate = (d: Date | string) =>
    new Date(d)
      .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      .toUpperCase();

  function fmtLatest(posts: Post[]): string | null {
    const d = posts[0]?.publishedAt;
    return d ? fmtDate(d) : null;
  }

  const SKELETON_WIDTHS = [60, 45, 70, 38, 55];
</script>

<svelte:head>
  <title>Writing — Strange Ramblings</title>
  <meta name="description" content="Writing about code, design, and building things." />
  <meta property="og:title" content="Writing — Strange Ramblings" />
  <meta property="og:description" content="Writing about code, design, and building things." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://strangeramblings.com/blog" />
</svelte:head>

<HealthShell
  path="/blog"
  unifiedNav
  footer={['strangeramblings.com/blog · journal', 'Most recent first', 'Written by hand']}
>
  <section class="lede">
    <div class="lede-inner">
      <div class="lede-copy">
        <p class="eyebrow">01 / Journal</p>
        <h1>WORDS.<br /><span>READ SOME HERE.</span></h1>
        <p class="standfirst">
          The things I'm thinking about, working on, and shipping. Most recent first.
        </p>
      </div>

      <dl class="journal-summary" aria-label="Journal summary">
        <div>
          <dt>Posts</dt>
          <dd>{#await data.posts}—{:then posts}{String(posts.length).padStart(2, '0')}{/await}</dd>
          <small>Published to date</small>
        </div>
        <div>
          <dt>Tags</dt>
          <dd>
            {#await data.posts}—{:then posts}{String(collectTags(posts).length).padStart(2, '0')}{/await}
          </dd>
          <small>Subjects covered</small>
        </div>
        <div>
          <dt>Latest</dt>
          <dd class="date">{#await data.posts}—{:then posts}{fmtLatest(posts) ?? '—'}{/await}</dd>
          <small>Most recent post</small>
        </div>
      </dl>
    </div>
  </section>

  <section id="posts" class="ledger">
    <div class="ledger-inner">
      <SectionHead
        kicker="02 / The ledger"
        title={['EVERYTHING', 'WRITTEN DOWN']}
        strap="Newest at the top. The number is its place in the run, not a ranking."
      />

      {#await data.posts}
        <div class="rows" aria-hidden="true">
          {#each SKELETON_WIDTHS as w, i (i)}
            <div class="row">
              <span class="sk-num"></span>
              <div class="cell">
                <span class="sk-line title" style="width: {w}%"></span>
                <span class="sk-line" style="width: {Math.min(w + 18, 85)}%"></span>
              </div>
              <span class="sk-line date"></span>
            </div>
          {/each}
        </div>
      {:then posts}
        {#if posts.length === 0}
          <p class="empty">Nothing published yet.</p>
        {:else}
          <div class="rows" in:fade={{ duration: dur(200) }}>
            {#each posts as post, i (post.slug)}
              <a class="row" href="/blog/{post.slug}">
                <span class="num">{String(i + 1).padStart(2, '0')}</span>

                <span class="cell">
                  <span class="title">{post.title}</span>
                  {#if post.excerpt}<span class="excerpt">{post.excerpt}</span>{/if}
                  {#if post.tags?.length}
                    <span class="tags">
                      {#each post.tags as tag, ti (tag)}
                        {#if ti > 0}<span class="dot">·</span>{/if}<span>{tag}</span>
                      {/each}
                    </span>
                  {/if}
                </span>

                <span class="date">
                  {post.publishedAt ? fmtDate(post.publishedAt) : ''}
                  <span class="arrow" aria-hidden="true">→</span>
                </span>
              </a>
            {/each}
          </div>
        {/if}
      {/await}
    </div>
  </section>
</HealthShell>

<style>
  /* --- Cover: the ink band --- */
  .lede {
    padding: clamp(28px, 3.5vw, 48px) clamp(20px, 3vw, 44px);
    background: var(--text-primary);
    color: var(--bg);
    border-bottom: 1px solid rgba(237, 228, 212, 0.16);
  }
  .lede-inner {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(420px, 0.85fr);
    align-items: end;
    gap: clamp(32px, 5vw, 72px);
    width: min(1400px, 100%);
    margin: 0 auto;
  }
  .lede-copy {
    min-width: 0;
  }
  .eyebrow {
    margin: 0 0 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    color: var(--accent-on-dark);
  }
  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(2.7rem, 4.8vw, 4.5rem);
    font-weight: 900;
    line-height: 0.88;
    letter-spacing: -0.04em;
    color: var(--bg);
    text-wrap: balance;
  }
  h1 span {
    color: transparent;
    -webkit-text-stroke: 1.5px var(--bg);
  }
  .standfirst {
    max-width: 56ch;
    margin: 18px 0 0;
    font-size: var(--fs-body);
    line-height: 1.5;
    color: rgba(237, 228, 212, 0.7);
  }

  .journal-summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0;
    margin: 0;
    border-top: 1px solid rgba(237, 228, 212, 0.16);
    border-left: 1px solid rgba(237, 228, 212, 0.16);
  }
  .journal-summary > div {
    min-width: 0;
    padding: 14px;
    border-right: 1px solid rgba(237, 228, 212, 0.16);
    border-bottom: 1px solid rgba(237, 228, 212, 0.16);
    background: rgba(237, 228, 212, 0.04);
  }
  .journal-summary dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.55);
  }
  .journal-summary dd {
    margin: 8px 0 5px;
    font-family: var(--font-display);
    font-size: clamp(1.65rem, 2.4vw, 2.4rem);
    font-weight: 900;
    line-height: 0.9;
    letter-spacing: -0.03em;
    color: var(--bg);
    font-variant-numeric: tabular-nums;
  }
  .journal-summary dd.date {
    font-family: var(--font-mono);
    font-size: var(--fs-body-sm);
    font-weight: 500;
    letter-spacing: 0.02em;
    line-height: 1.25;
    padding-bottom: 4px;
  }
  .journal-summary small {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.3;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--accent-on-dark);
  }

  /* --- The ledger: /health's ranked-moves row --- */
  .ledger {
    padding: clamp(44px, 5vw, 76px) clamp(20px, 3vw, 44px);
    border-bottom: 2px solid rgba(26, 16, 8, 0.12);
  }
  /* The band rule separates one section from the NEXT. The last one is
     followed by the ink footer, which separates itself — left in, it draws a
     stray rule across the empty space a short page leaves above the foot. */
  section:last-of-type {
    border-bottom: none;
  }
  .ledger-inner {
    max-width: 1400px;
    margin: 0 auto;
  }

  /* One hairline between rows, drawn as the container's own background showing
     through a 1px gap. Safe here — a fixed single column, not an `auto-fit`
     grid where unfilled tracks would paint as blocks. */
  .rows {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: var(--card-border);
    border: 1px solid var(--card-border);
  }
  .row {
    background: var(--bg);
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr) 128px;
    gap: clamp(14px, 1.8vw, 28px);
    padding: 22px 24px;
    align-items: start;
    text-decoration: none;
    transition: background var(--t-base) var(--ease-out);
  }
  a.row:hover {
    background: var(--surface-card);
  }

  .num {
    font-family: var(--font-display);
    font-size: 40px;
    line-height: 0.8;
    letter-spacing: -0.03em;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }

  .cell {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .title {
    font-family: var(--font-display);
    font-size: 20px;
    line-height: 1.05;
    letter-spacing: -0.01em;
    text-transform: uppercase;
    color: var(--text-primary);
    margin-bottom: 10px;
  }
  /* The explaining sentence sits in BODY font, the way the tripwire ledger's
     does — a mono excerpt at this length reads as a log line, not as copy. */
  .excerpt {
    font-size: var(--fs-nav);
    line-height: 1.5;
    color: var(--text-secondary);
    text-wrap: pretty;
  }
  .tags {
    margin-top: 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .dot {
    margin: 0 6px;
    color: var(--text-ghost);
  }

  .date {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
    text-align: right;
    white-space: nowrap;
  }
  .arrow {
    display: block;
    margin-top: 10px;
    font-size: var(--fs-nav);
    color: var(--text-ghost);
    transition: color var(--t-base) var(--ease-out);
  }
  a.row:hover .arrow {
    color: var(--accent);
  }

  .empty {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
    padding: 30px 2px;
  }

  /* Skeleton rows hold the ledger's shape while the streamed promise lands. */
  .sk-num,
  .sk-line {
    display: block;
    height: 12px;
    background: var(--bg-section);
  }
  .sk-num {
    height: 32px;
  }
  .sk-line.title {
    height: 18px;
    margin-bottom: 12px;
  }
  .sk-line.date {
    width: 100%;
  }

  @media (prefers-reduced-motion: no-preference) {
    .sk-num,
    .sk-line {
      animation: sk-pulse 1.4s ease-in-out infinite;
    }
  }
  @keyframes sk-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.45;
    }
  }

  @media (max-width: 900px) {
    .lede-inner {
      grid-template-columns: minmax(0, 1fr);
      align-items: start;
    }
  }
  @media (max-width: 640px) {
    .row {
      grid-template-columns: 40px minmax(0, 1fr);
      gap: 14px;
      padding: 18px;
    }
    .num {
      font-size: 28px;
    }
    /* The date leaves the third track and sits under the copy, still mono and
       still right of the numeral gutter. */
    .date {
      grid-column: 2;
      text-align: left;
      margin-top: 12px;
    }
    .arrow {
      display: inline;
      margin: 0 0 0 10px;
    }
    .journal-summary {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
