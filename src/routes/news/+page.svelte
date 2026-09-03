<svelte:head>
  <title>News — Strange Ramblings</title>
  <meta name="description" content="A live reading desk for Hacker News and Lobsters." />
</svelte:head>

<script lang="ts">
  import HealthShell from '$lib/components/health/hub/HealthShell.svelte';
  import type { PageData } from './$types';
  import type { NewsSource } from '$lib/news/types';

  let { data }: { data: PageData } = $props();

  let source = $state<'all' | NewsSource>('all');
  let query = $state('');

  const stories = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return data.feed.stories
      .filter((story) => {
        if (source !== 'all' && story.source !== source) return false;
        if (!q) return true;
        return `${story.title} ${story.domain} ${story.author ?? ''} ${story.tags.join(' ')}`
          .toLowerCase()
          .includes(q);
      })
      .toSorted((a, b) =>
        data.sort === 'points'
          ? b.score - a.score || Date.parse(b.publishedAt) - Date.parse(a.publishedAt)
          : Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || b.score - a.score,
      );
  });

  function feedHref(view: 'top' | 'new' | 'best'): string {
    const sort = view === 'best' ? 'points' : view === 'new' ? 'time' : data.sort;
    return `/news?view=${view}&sort=${sort}&limit=${data.limit}`;
  }

  function sortHref(sort: 'time' | 'points'): string {
    return `/news?view=${data.feed.view}&sort=${sort}&limit=${data.limit}`;
  }

  const nextLimit = $derived(Math.min(data.limit + 25, data.maxLimit));
  const canLoadMore = $derived(
    data.feed.view !== 'favourites' &&
      data.limit < data.maxLimit &&
      data.feed.sources.some((item) => item.ok && item.count >= data.limit),
  );

  function moreHref(): string {
    return `/news?view=${data.feed.view}&sort=${data.sort}&limit=${nextLimit}`;
  }

  function timeAgo(iso: string): string {
    const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  }

  function sourceCode(value: NewsSource): string {
    return value === 'hacker-news' ? 'HN' : 'L';
  }

  function gatheredTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  function gatheredDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  const sourcesLive = $derived(data.feed.sources.every((item) => item.ok));
  const shellMeta = $derived([
    `${data.feed.stories.length} stories`,
    `gathered ${gatheredTime(data.feed.updatedAt)}`,
  ]);
</script>

<HealthShell
  path="/news"
  kicker={data.feed.view === 'favourites' ? 'Saved reading list' : 'Live wire · two communities'}
  nav={[
    { href: feedHref('top'), label: 'Top' },
    { href: feedHref('new'), label: 'New' },
    { href: feedHref('best'), label: 'Best' },
  ]}
  live={sourcesLive ? 'Hacker News · Lobsters' : null}
  meta={shellMeta}
  footer={[
    'strangeramblings.com/news · live reading desk',
    'Hacker News · Lobsters',
    `${data.stats.retainedCount} stories retained`,
    `Desk updated ${gatheredDate(data.feed.updatedAt)} ${gatheredTime(data.feed.updatedAt)}`,
  ]}
>
<div class="news-page">
  <section class="news-lede">
    <div class="lede-inner">
      <div class="lede-copy">
        <p class="eyebrow">Live desk · two communities</p>
        <h1>READ FIRST.<br /><span>DECIDE WHAT LASTS.</span></h1>
        <p class="standfirst">
          A quiet front page for the technical web. Open the story here, then keep only what earns a
          place in your notes, research, or knowledge graph.
        </p>
      </div>

      <dl class="desk-summary" aria-label="News desk summary">
        <div>
          <dt>{data.feed.view === 'favourites' ? 'List loaded' : 'Last gathered'}</dt>
          <dd><time datetime={data.feed.updatedAt}>{gatheredTime(data.feed.updatedAt)}</time></dd>
          <small>
            {data.feed.view === 'favourites'
              ? `${data.stats.favouriteCount} saved stories`
              : `${gatheredDate(data.feed.updatedAt)}${data.feed.cached ? ' · cached' : ' · live pull'}`}
          </small>
        </div>
        <div>
          <dt>New since last</dt>
          <dd>{String(data.feed.newSinceLast).padStart(2, '0')}</dd>
          <small>Compared with the previous gather</small>
        </div>
        <div>
          <dt>Kept in graph</dt>
          <dd>{String(data.stats.retainedCount).padStart(2, '0')}</dd>
          <small>Stories deliberately retained</small>
        </div>
        <div>
          <dt>On the desk</dt>
          <dd>{String(data.feed.stories.length).padStart(2, '0')}</dd>
          <small>
            {data.feed.sources.map((item) => `${item.label} ${item.ok ? item.count : 'down'}`).join(' · ')}
          </small>
        </div>
      </dl>
    </div>
  </section>

  <section class="desk" aria-labelledby="desk-title">
    <header class="desk-head">
      <div>
        <p class="section-no">01 / The wire</p>
        <h2 id="desk-title">
          {data.feed.view === 'top'
            ? 'FRONT PAGES'
            : data.feed.view === 'new'
              ? 'JUST IN'
              : data.feed.view === 'best'
                ? 'BEST OF 24H'
                : 'FAVOURITES'}
        </h2>
      </div>
      <nav class="view-tabs" aria-label="Feed order">
        <a href={feedHref('top')} aria-current={data.feed.view === 'top' ? 'page' : undefined}>Top</a>
        <a href={feedHref('new')} aria-current={data.feed.view === 'new' ? 'page' : undefined}>New</a>
        <a href={feedHref('best')} aria-current={data.feed.view === 'best' ? 'page' : undefined}>Best</a>
      </nav>
    </header>

    <div class="desk-tools">
      <div class="filters" role="group" aria-label="Filter source">
        <button type="button" class:active={source === 'all'} onclick={() => (source = 'all')}>All</button>
        <button type="button" class:active={source === 'hacker-news'} onclick={() => (source = 'hacker-news')}>Hacker News</button>
        <button type="button" class:active={source === 'lobsters'} onclick={() => (source = 'lobsters')}>Lobsters</button>
        <a
          class:active={data.feed.view === 'favourites'}
          href="/news?view=favourites&sort=time"
          aria-current={data.feed.view === 'favourites' ? 'page' : undefined}
        >Favourites {data.stats.favouriteCount}</a>
      </div>
      <nav class="sort-tabs" aria-label="Order stories">
        <span>Order</span>
        <a href={sortHref('time')} aria-current={data.sort === 'time' ? 'page' : undefined}>Time</a>
        <a href={sortHref('points')} aria-current={data.sort === 'points' ? 'page' : undefined}>Points</a>
      </nav>
      <label class="search">
        <span>Find</span>
        <input type="search" bind:value={query} placeholder="title, tag, source…" />
      </label>
      <a class="refresh" href="/news?view={data.feed.view}&sort={data.sort}&limit={data.limit}&fresh=1" aria-label="Refresh news sources">Refresh ↻</a>
    </div>

    {#if stories.length === 0}
      <div class="empty">
        {data.feed.view === 'favourites' && source === 'all' && !query
          ? 'No favourite stories yet. Add one from the reading view.'
          : 'No stories match this view.'}
      </div>
    {:else}
      <ol class="story-list">
        {#each stories as story, index (story.key)}
          <li class="story">
            <a
              class="story-reader"
              href="/news/{story.source}/{story.id}"
              aria-label="Read and summarise: {story.title}"
            >
              <span class="story-index">{String(index + 1).padStart(2, '0')}</span>
              <span class="story-source source-{story.source}">{sourceCode(story.source)}</span>
              <span class="story-main">
                <strong>{story.title}</strong>
                <span class="story-byline">
                  {story.domain} · {timeAgo(story.publishedAt)}{#if story.author} · {story.author}{/if}
                  {#if story.source === 'lobsters' && story.tags[0]}
                    <span class="story-category">{story.tags[0]}</span>
                  {/if}
                </span>
              </span>
              <span class="story-signal">
                <span><b>{story.score}</b> points</span>
                <span><b>{story.commentCount}</b> replies</span>
              </span>
            </a>
            <span class="story-actions">
              <a
                class="story-action"
                href={story.url}
                target="_blank"
                rel="noopener"
                aria-label="Open original article: {story.title}"
              >Article <span aria-hidden="true">↗</span></a>
              <a
                class="story-action"
                href={story.discussionUrl}
                target="_blank"
                rel="noopener"
                aria-label="Open comments for: {story.title}"
              >Comments <span aria-hidden="true">↗</span></a>
            </span>
          </li>
        {/each}
      </ol>
      {#if canLoadMore}
        <div class="more-stories">
          <span>Showing up to {data.limit} stories from each source</span>
          <a href={moreHref()}>Show 25 more from each →</a>
        </div>
      {:else if data.feed.view !== 'favourites' && data.limit > 25}
        <p class="more-stories complete">All available stories in this view are loaded.</p>
      {/if}
    {/if}
  </section>
</div>
</HealthShell>

<style>
  .news-page { min-height: calc(100vh - var(--site-nav-height)); background: var(--bg); }
  .news-lede { padding: clamp(32px, 4vw, 56px) clamp(20px, 3vw, 44px); border-bottom: 1px solid rgba(237, 228, 212, 0.16); background: var(--text-primary); color: var(--bg); }
  .lede-inner { width: min(1400px, 100%); margin: 0 auto; }
  .lede-copy { padding-bottom: clamp(38px, 6vw, 68px); }
  .eyebrow, .section-no { margin: 0 0 18px; font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 500; letter-spacing: var(--tracking-label-wide); text-transform: uppercase; color: var(--accent); }
  .news-lede .eyebrow { color: var(--accent-on-dark); }
  h1 { margin: 0; max-width: 11ch; font-family: var(--font-display); font-size: clamp(3.25rem, 7vw, 7rem); font-weight: 900; line-height: 0.87; letter-spacing: -0.045em; color: var(--bg); }
  h1 span { color: transparent; -webkit-text-stroke: 1.5px var(--bg); }
  .standfirst { max-width: 61ch; margin: 28px 0 0; font-size: var(--fs-body-lg); line-height: 1.55; color: rgba(237, 228, 212, 0.7); }
  .desk-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin: 0; }
  .desk-summary > div { min-width: 0; padding: 18px; border: 1px solid rgba(237, 228, 212, 0.16); background: rgba(237, 228, 212, 0.05); }
  .desk-summary dt { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 500; letter-spacing: 0.15em; text-transform: uppercase; color: rgba(237, 228, 212, 0.55); }
  .desk-summary dd { margin: 10px 0 8px; font-family: var(--font-display); font-size: 32px; font-weight: 800; line-height: 0.9; letter-spacing: -0.02em; color: var(--bg); font-variant-numeric: tabular-nums; }
  .desk-summary small { display: block; overflow: hidden; font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1.35; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent-on-dark); text-overflow: ellipsis; }
  .desk { width: min(1180px, 100%); margin: 0 auto; padding: 54px clamp(20px, 5vw, 64px) 90px; }
  .desk-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; padding-bottom: 16px; border-bottom: 2px solid var(--text-primary); }
  .desk-head .section-no { margin-bottom: 7px; }
  h2 { margin: 0; font-family: var(--font-display); font-size: clamp(2rem, 4vw, 3.25rem); line-height: 0.95; }
  .view-tabs { display: flex; align-items: stretch; border: 1px solid var(--line-strong); }
  .view-tabs a { padding: 9px 16px; border-right: 1px solid var(--line-strong); font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--text-muted); text-decoration: none; }
  .view-tabs a:last-child { border-right: 0; }
  .view-tabs a[aria-current='page'] { background: var(--accent); color: var(--bg); }
  .desk-tools { display: grid; grid-template-columns: max-content auto minmax(180px, 1fr) auto; align-items: stretch; border-bottom: 1px solid var(--line-strong); }
  .filters { display: grid; grid-template-columns: repeat(4, max-content); align-items: stretch; min-width: 0; }
  .filters button, .filters a, .refresh, .sort-tabs a, .sort-tabs > span { padding: 13px 15px; border: 0; border-right: 1px solid var(--line-strong); background: transparent; color: var(--text-muted); font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em; text-transform: uppercase; white-space: nowrap; cursor: pointer; text-decoration: none; }
  .filters a { display: flex; align-items: center; }
  .filters button:hover, .filters button.active, .filters a:hover, .filters a.active, .refresh:hover, .sort-tabs a:hover, .sort-tabs a[aria-current='page'] { color: var(--accent); background: var(--accent-tint-04); }
  .sort-tabs { display: flex; align-items: stretch; border-left: 1px solid var(--line-strong); }
  .sort-tabs > span { display: flex; align-items: center; color: var(--text-ghost); cursor: default; }
  .search { display: flex; align-items: center; gap: 9px; padding: 0 12px; border-left: 1px solid var(--line-strong); border-right: 1px solid var(--line-strong); }
  .search span { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-ghost); }
  .search input { width: 100%; min-width: 0; padding: 11px 0; border: 0; outline: 0; background: transparent; color: var(--text-primary); font-family: var(--font-body); font-size: var(--fs-body); }
  .refresh { display: flex; align-items: center; border-right: 0; }
  .story-list { margin: 0; padding: 0; list-style: none; }
  .story { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: stretch; border-bottom: 1px solid var(--line-hair); transition: background var(--t-fast) var(--ease-out); }
  .story:hover { background: var(--accent-tint-04); }
  .story-reader { display: grid; grid-template-columns: 38px 38px minmax(0, 1fr) 132px; align-items: center; gap: 14px; min-width: 0; min-height: 72px; padding: 10px 8px; color: var(--text-primary); text-decoration: none; }
  .story-reader:focus-visible, .story-action:focus-visible, .more-stories a:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .story-index { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); font-variant-numeric: tabular-nums; }
  .story-source { display: grid; place-items: center; width: 34px; height: 34px; border: 1px solid currentColor; font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 700; color: var(--accent); }
  .story-source.source-lobsters { color: var(--accent-ink); }
  .story-main { display: grid; gap: 5px; min-width: 0; }
  .story-main strong { font-size: var(--fs-body-lg); line-height: 1.25; font-weight: 600; text-wrap: balance; }
  .story-byline { display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap; font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1.35; color: var(--text-muted); }
  .story-category { color: var(--accent-ink); text-transform: uppercase; letter-spacing: 0.06em; }
  .story-category::before { content: '· '; color: var(--text-ghost); }
  .story-signal { display: grid; grid-template-columns: 1fr; gap: 4px; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }
  .story-signal b { color: var(--text-primary); font-weight: 600; font-variant-numeric: tabular-nums; }
  .story-actions { display: grid; grid-template-columns: repeat(2, minmax(86px, auto)); align-items: stretch; gap: 7px; padding: 12px 8px 12px 0; }
  .story-action { display: flex; align-items: center; justify-content: center; gap: 7px; padding: 0 12px; border: 1px solid var(--line-strong); background: var(--surface-card); color: var(--text-muted); font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.06em; text-transform: uppercase; text-decoration: none; white-space: nowrap; }
  .story-action span { color: var(--accent); }
  .story-action:hover { border-color: var(--accent); background: var(--accent-tint-08); color: var(--accent-ink); }
  .more-stories { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 20px 8px; border-bottom: 1px solid var(--line-strong); font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-ghost); }
  .more-stories a { padding: 11px 14px; border: 1px solid var(--line-strong); color: var(--accent-ink); text-decoration: none; }
  .more-stories a:hover { border-color: var(--accent); background: var(--accent-tint-08); }
  .more-stories.complete { display: block; margin: 0; }
  .empty { padding: 54px 12px; border-bottom: 1px solid var(--line-strong); font-size: var(--fs-body); color: var(--text-muted); }
  @media (max-width: 1200px) {
    .desk-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .desk-tools { grid-template-columns: auto minmax(180px, 1fr) auto; }
    .filters { grid-column: 1 / -1; border-bottom: 1px solid var(--line-strong); }
    .sort-tabs { border-left: 0; }
  }
  @media (max-width: 780px) {
    .search { border-left: 0; }
    .story { grid-template-columns: 1fr; }
    .story-reader { grid-template-columns: 32px 34px minmax(0, 1fr); gap: 10px; padding: 11px 4px 7px; }
    .story-signal { grid-column: 3; display: flex; gap: 14px; }
    .story-actions { grid-template-columns: repeat(2, max-content); justify-content: end; padding: 0 4px 11px 78px; }
    .story-action { min-height: 36px; }
  }
  @media (max-width: 560px) {
    .desk-tools { grid-template-columns: minmax(0, 1fr) auto; }
    .filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .filters button, .filters a { justify-content: center; }
    .filters > :nth-child(-n + 2) { border-bottom: 1px solid var(--line-strong); }
    .filters > :nth-child(2n) { border-right: 0; }
    .sort-tabs { grid-column: 1 / -1; border-bottom: 1px solid var(--line-strong); }
    .search { border-right: 1px solid var(--line-strong); }
  }
  @media (max-width: 520px) {
    h1 { font-size: clamp(2.75rem, 14vw, 4.1rem); }
    .standfirst { font-size: var(--fs-body); }
    .desk-summary { grid-template-columns: 1fr; }
    .desk-summary dd { margin-top: 6px; }
    .desk { padding-top: 38px; }
    .desk-head { align-items: center; }
    .story-reader { grid-template-columns: 30px minmax(0, 1fr); }
    .story-index { display: none; }
    .story-main { grid-column: 2; }
    .story-signal { grid-column: 2; }
    .story-actions { justify-content: stretch; padding-left: 44px; }
    .story-action { padding-inline: 10px; }
    .more-stories { align-items: stretch; flex-direction: column; }
    .more-stories a { text-align: center; }
  }
</style>
