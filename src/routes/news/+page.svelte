<svelte:head>
  <title>News — Strange Ramblings</title>
  <meta name="description" content="A live reading desk for the technical web and UK public-sector announcements." />
</svelte:head>

<script lang="ts">
  import HealthShell from '$lib/components/shell/HealthShell.svelte';
  import type { PageData } from './$types';
  import type { NewsSource } from '$lib/news/types';
  import { NEWS_SOURCE_DEFS, NEWS_SOURCE_CODES, type NewsLane } from '$lib/constants/news-sources';
  import { matchesNewsQuery, newsQueryTerms } from '$lib/news/search';
  import { navigating } from '$app/state';

  let { data }: { data: PageData } = $props();

  let source = $state<'all' | NewsSource>('all');
  let lane = $state<'all' | NewsLane>('all');
  let query = $state('');

  // The desk carries two halves now. Filtering by lane is what stops twenty
  // government announcements burying the technical wire, or the reverse.
  const laneOf = new Map(NEWS_SOURCE_DEFS.map((def) => [def.id as NewsSource, def.lane]));
  const visibleSources = $derived(
    NEWS_SOURCE_DEFS.filter((def) => lane === 'all' || def.lane === lane),
  );

  const readKeys = $derived(new Set(data.readKeys));
  const keptKeys = $derived(new Set(data.keptKeys));
  const correlatedCount = $derived(Object.keys(data.correlations).length);

  const stories = $derived.by(() => {
    // The SAME matcher the `news_search` tool uses. The page used to run its own
    // `.includes()` over a concatenated string, so the two disagreed about what
    // a search means — and only one of them could see a story's summary.
    const terms = newsQueryTerms(query);
    return data.feed.stories
      .filter((story) => {
        if (source !== 'all' && story.source !== source) return false;
        if (lane !== 'all' && laneOf.get(story.source) !== lane) return false;
        return matchesNewsQuery(story, terms);
      })
      .toSorted((a, b) => {
        // For You is ranked on the server by correlation; re-sorting here would
        // throw that away and leave a tab that does nothing.
        if (data.feed.view === 'for-you') return 0;
        if (data.sort === 'heat') {
          return b.heat - a.heat || Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
        }
        if (data.sort === 'points') {
          return b.score - a.score || Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
        }
        return Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || b.score - a.score;
      });
  });

  function feedHref(view: 'top' | 'new' | 'best' | 'for-you'): string {
    const sort = view === 'best' ? 'heat' : view === 'new' ? 'time' : data.sort;
    return `/news?view=${view}&sort=${sort}&limit=${data.limit}`;
  }

  function sortHref(sort: 'time' | 'points' | 'heat'): string {
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

  /** Does this source have votes at all? A syndicated feed does not. */
  function votes(value: NewsSource): boolean {
    return laneOf.has(value) && NEWS_SOURCE_DEFS.find((def) => def.id === value)?.kind !== 'feed';
  }

  function sourceCode(value: NewsSource): string {
    return NEWS_SOURCE_CODES[value] ?? '?';
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
  const updating = $derived(navigating.to?.url.pathname === '/news');
  const shellMeta = $derived([
    `${data.feed.stories.length} stories`,
    `gathered ${gatheredTime(data.feed.updatedAt)}`,
  ]);
</script>

<div class="news-frame" data-sveltekit-preload-data="hover">
<HealthShell
  path="/news"
  kicker={data.feed.view === 'favourites' ? 'Saved reading list' : `Live wire · ${NEWS_SOURCE_DEFS.length} sources`}
  nav={[]}
  live={sourcesLive ? NEWS_SOURCE_DEFS.map((def) => def.label).join(' · ') : null}
  meta={shellMeta}
  footer={[
    'strangeramblings.com/news · live reading desk',
    NEWS_SOURCE_DEFS.map((def) => def.label).join(' · '),
    `${data.stats.retainedCount} stories retained`,
    `Desk updated ${gatheredDate(data.feed.updatedAt)} ${gatheredTime(data.feed.updatedAt)}`,
  ]}
>
<div class="news-page">
  <section class="news-lede">
    <div class="lede-inner">
      <div class="lede-copy">
        <p class="eyebrow">Live desk · technical and public sector</p>
        <h1>READ FIRST.<br /><span>DECIDE WHAT LASTS.</span></h1>
        <p class="standfirst">
          The technical web, gathered in one place. Read a story, then keep what earns a place in your notes.
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
          <dt>New since last visit</dt>
          <dd>{String(data.feed.newSinceLast).padStart(2, '0')}</dd>
          <small>
            {data.feed.view === 'favourites'
              ? 'Not counted for a saved list'
              : data.newSince.since
                ? `You last looked ${gatheredTime(data.newSince.since)} ${gatheredDate(data.newSince.since)}`
                : 'First visit on this desk'}
          </small>
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

  <section class="desk" aria-labelledby="desk-title" aria-busy={updating}>
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
                : data.feed.view === 'for-you'
                  ? 'AGAINST YOUR GRAPH'
                  : 'FAVOURITES'}
        </h2>
      </div>
      <nav class="view-tabs" aria-label="Feed order" data-sveltekit-noscroll>
        <a href={feedHref('top')} aria-current={data.feed.view === 'top' ? 'page' : undefined}>Top</a>
        <a href={feedHref('new')} aria-current={data.feed.view === 'new' ? 'page' : undefined}>New</a>
        <a href={feedHref('best')} aria-current={data.feed.view === 'best' ? 'page' : undefined}>Best</a>
        <a href={feedHref('for-you')} aria-current={data.feed.view === 'for-you' ? 'page' : undefined}>For you</a>
        <a href="/news?view=favourites&sort=time" aria-current={data.feed.view === 'favourites' ? 'page' : undefined}>Saved {data.stats.favouriteCount}</a>
      </nav>
    </header>

    <div class="desk-tools" data-sveltekit-noscroll>
      <div class="lanes" role="group" aria-label="Filter lane">
        {#each [['all', 'Everything'], ['tech', 'Technical'], ['public', 'Public sector']] as const as [value, label] (value)}
          <button
            type="button"
            aria-pressed={lane === value}
            class:active={lane === value}
            onclick={() => { lane = value; source = 'all'; }}
          >{label}</button>
        {/each}
      </div>
      <div class="filters" role="group" aria-label="Filter source">
        <button type="button" aria-pressed={source === 'all'} class:active={source === 'all'} onclick={() => (source = 'all')}>All</button>
        {#each visibleSources as def (def.id)}
          <button
            type="button"
            aria-pressed={source === def.id}
            class:active={source === def.id}
            onclick={() => (source = def.id)}
          >{def.label}</button>
        {/each}
      </div>
      <nav class="sort-tabs" aria-label="Order stories">
        <span>Order</span>
        <a href={sortHref('time')} aria-current={data.sort === 'time' ? 'page' : undefined}>Time</a>
        <a href={sortHref('heat')} aria-current={data.sort === 'heat' ? 'page' : undefined} title="Standing within each wire, blended with recency — comparable across sources">Heat</a>
        <a href={sortHref('points')} aria-current={data.sort === 'points' ? 'page' : undefined} title="Raw votes. Ars Technica reports none.">Points</a>
      </nav>
      <label class="search">
        <span>Find</span>
        <input type="search" bind:value={query} placeholder="title, tag, source…" />
      </label>
      <a class="refresh" data-sveltekit-preload-data="off" href="/news?view={data.feed.view}&sort={data.sort}&limit={data.limit}&fresh=1" aria-label="Refresh news sources">Refresh ↻</a>
    </div>

    {#if data.feed.view === 'for-you'}
      <p class="foryou-note">
        {#if data.anchorCount === 0}
          <strong>Nothing to rank against.</strong> The knowledge graph has no entities,
          research topics or memories to match headlines on, so this order is the wire's own.
        {:else if correlatedCount === 0}
          <strong>No story on the desk matches your graph right now.</strong>
          Ranked against {data.anchorCount} elements; the wire's own order stands below.
        {:else}
          <strong>{correlatedCount} of {data.feed.stories.length}</strong> match something
          your knowledge base holds, ranked against {data.anchorCount} elements. Everything
          else follows in the wire's own order — nothing is hidden.
        {/if}
      </p>
    {/if}

    <p class="desk-status" role="status">{updating ? 'Updating stories…' : `${stories.length} stories shown`}{#if source !== 'all' && !votes(source)} · Latest articles{data.feed.view === 'best' ? ' from 24h' : ''}; no voting scores{/if}{#if !updating && !sourcesLive} · Some sources are unavailable{/if}</p>

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
                  {#if story.tags[0]}
                    <span class="story-category">{story.tags[0]}</span>
                  {/if}
                  {#if story.alsoOn.length > 0}
                    <span class="story-also">Also on {story.alsoOn.map((a) => a.sourceLabel).join(' · ')}</span>
                  {/if}
                  {#if readKeys.has(story.key)}
                    <span class="story-read">Read</span>
                  {/if}
                  {#if keptKeys.has(story.key)}
                    <span class="story-kept">In graph</span>
                  {/if}
                </span>
                {#if data.correlations[story.key]}
                  <span class="story-why" title={data.correlations[story.key].why}>
                    <span class="why-label">Tracks</span>
                    {data.correlations[story.key].names.join(' · ')}
                    {#if data.correlations[story.key].evidence?.notes}
                      <span class="why-evidence"
                        >{data.correlations[story.key].evidence?.notes} note{data.correlations[story.key].evidence?.notes === 1 ? '' : 's'} already</span
                      >
                    {/if}
                  </span>
                {/if}
              </span>
              <span class="story-signal">
                <span>{#if !votes(story.source)}Unscored{:else}<b>{story.score}</b> points{/if}</span>
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
        <div class="more-stories" data-sveltekit-noscroll>
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
</div>

<style>
  /* 100vh flat, NOT `calc(100vh - var(--site-nav-height))`. This page wears
     HealthShell, not `.site-nav-bar`, so there was never a 48px strip above it
     to subtract — the old arithmetic just shortened the page by a header that
     is not on it. HealthShell's head is sticky and in normal flow, so it takes
     its own height out of the viewport without being told. */
  .news-page { min-height: 100vh; background: var(--bg); }
  .news-lede { padding: clamp(24px, 3vw, 40px) clamp(20px, 3vw, 44px); border-bottom: 1px solid rgba(237, 228, 212, 0.16); background: var(--text-primary); color: var(--bg); }
  .lede-inner { display: grid; grid-template-columns: 1.3fr 1fr; align-items: center; gap: 36px; width: min(1280px, 100%); margin: 0 auto; }
  .lede-copy { min-width: 0; }
  .eyebrow, .section-no { margin: 0 0 18px; font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 500; letter-spacing: var(--tracking-label-wide); text-transform: uppercase; color: var(--accent); }
  .news-lede .eyebrow { color: var(--accent-on-dark); }
  h1 { margin: 0; max-width: 18ch; font-family: var(--font-display); font-size: clamp(2.75rem, 4.3vw, 4.5rem); font-weight: 900; line-height: 0.95; letter-spacing: -0.045em; color: var(--bg); }
  h1 span { color: transparent; -webkit-text-stroke: 1.5px var(--bg); }
  .standfirst { max-width: 55ch; margin: 18px 0 0; font-size: var(--fs-body); line-height: 1.55; color: rgba(237, 228, 212, 0.7); }
  .desk-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0; margin: 0; border-top: 1px solid rgba(237, 228, 212, 0.16); border-left: 1px solid rgba(237, 228, 212, 0.16); }
  .desk-summary > div { min-width: 0; padding: 14px; border-right: 1px solid rgba(237, 228, 212, 0.16); border-bottom: 1px solid rgba(237, 228, 212, 0.16); }
  .desk-summary dt { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 500; letter-spacing: 0.15em; text-transform: uppercase; color: rgba(237, 228, 212, 0.55); }
  .desk-summary dd { margin: 10px 0 8px; font-family: var(--font-display); font-size: 32px; font-weight: 800; line-height: 0.9; letter-spacing: -0.02em; color: var(--bg); font-variant-numeric: tabular-nums; }
  .desk-summary small { display: block; overflow: hidden; font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1.35; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent-on-dark); text-overflow: ellipsis; }
  .desk { box-sizing: border-box; width: min(1368px, 100%); margin: 0 auto; padding: 28px clamp(20px, 3vw, 44px) 64px; }
  .desk-status { min-height: 1.5em; margin: 0; padding: 8px 0; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }
  .desk :is(a, button, input):focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .desk-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; padding-bottom: 16px; border-bottom: 2px solid var(--text-primary); }
  .desk-head .section-no { margin-bottom: 7px; }
  h2 { margin: 0; font-family: var(--font-display); font-size: clamp(2rem, 4vw, 3.25rem); line-height: 0.95; }
  .view-tabs { display: flex; align-items: stretch; border: 1px solid var(--line-strong); }
  .view-tabs a { padding: 9px 16px; border-right: 1px solid var(--line-strong); font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--text-muted); text-decoration: none; }
  .view-tabs a:last-child { border-right: 0; }
  .view-tabs a[aria-current='page'] { background: var(--accent); color: var(--bg); }
  /* TWO rows at every width, and the single desktop row is not coming back.
     The toolbar's cells are what the desk filters ON — three lanes, then one
     button per registered source — followed by how it is ORDERED. With six
     sources that row's own minimum is ~1490px against a `.desk` capped at
     1368, so the five-track version overflowed at EVERY desktop width and
     `.hs`'s `overflow-x: hidden` clipped the search box and Refresh off the
     right-hand edge rather than scrolling to them. Below 1200 it reflowed and
     looked fine, which is why this only ever reported as a desktop bug.
     `max-content` is what made it unfixable by shrinking: a wrappable
     `.filters` still reports its UNWRAPPED width to a max-content track, so
     the cells could never fold. A source is a row in `NEWS_SOURCE_DEFS` and
     that list is meant to grow, so the layout must not encode its length.

     Column 1 holds `.lanes` over `.sort-tabs`, so its `max-content` is the
     wider of the two and one hairline runs down both rows; `.filters` spans
     the rest of row one and wraps inside its own cell as sources are added. */
  .desk-tools { display: grid; grid-template-columns: max-content minmax(180px, 1fr) max-content; align-items: stretch; border-bottom: 1px solid var(--line-strong); }
  .filters { display: flex; flex-wrap: wrap; align-items: stretch; min-width: 0; grid-column: 2 / -1; border-bottom: 1px solid var(--line-strong); }
  .lanes { display: flex; align-items: stretch; border-right: 1px solid var(--line-strong); border-bottom: 1px solid var(--line-strong); }
  .lanes button { padding: 13px 15px; border: 0; border-right: 1px solid var(--line-strong); background: transparent; color: var(--text-muted); font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em; text-transform: uppercase; white-space: nowrap; cursor: pointer; }
  .lanes button:last-child { border-right: 0; }
  .lanes button:hover, .lanes button.active { color: var(--accent-ink); background: var(--accent-tint-04); }
  .filters button, .refresh, .sort-tabs a, .sort-tabs > span { padding: 13px 15px; border: 0; border-right: 1px solid var(--line-strong); background: transparent; color: var(--text-muted); font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em; text-transform: uppercase; white-space: nowrap; cursor: pointer; text-decoration: none; }
  .filters button:hover, .filters button.active, .refresh:hover, .sort-tabs a:hover, .sort-tabs a[aria-current='page'] { color: var(--accent); background: var(--accent-tint-04); }
  /* The seam between column one and the search cell is drawn ONCE, here, so it
     lands on the column edge directly under `.lanes`' own right border. Left to
     `.search` it would have sat at the end of `Points` instead, leaving two
     hairlines a cell-width apart on a row that is meant to read as one band. */
  .sort-tabs { display: flex; align-items: stretch; border-right: 1px solid var(--line-strong); }
  .sort-tabs a:last-child { border-right: 0; }
  .sort-tabs > span { display: flex; align-items: center; color: var(--text-ghost); cursor: default; }
  .search { display: flex; align-items: center; gap: 9px; padding: 0 12px; border-right: 1px solid var(--line-strong); }
  .search span { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-ghost); }
  .search input { width: 100%; min-width: 0; padding: 11px 0; border: 0; outline: 0; background: transparent; color: var(--text-primary); font-family: var(--font-body); font-size: var(--fs-body); }
  .refresh { display: flex; align-items: center; border-right: 0; }
  .story-list { margin: 0; padding: 0; list-style: none; }
  .story { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: stretch; border-bottom: 1px solid var(--line-hair); transition: background var(--t-fast) var(--ease-out); }
  .story:hover { background: var(--accent-tint-04); }
  .story-reader { display: grid; grid-template-columns: 28px 32px minmax(0, 1fr) 90px; align-items: center; gap: 12px; min-width: 0; min-height: 64px; padding: 8px; color: var(--text-primary); text-decoration: none; }
  .story-reader:focus-visible, .story-action:focus-visible, .more-stories a:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .story-index { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); font-variant-numeric: tabular-nums; }
  .story-source { display: grid; place-items: center; width: 34px; height: 34px; border: 1px solid currentColor; font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 700; color: var(--accent); }
  .story-source.source-lobsters { color: var(--accent-ink); }
  .story-main { display: grid; gap: 5px; min-width: 0; }
  .story-main strong { font-size: var(--fs-body-lg); line-height: 1.3; font-weight: 600; }
  .story-byline { display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap; font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1.35; color: var(--text-muted); }
  .story-category { color: var(--accent-ink); text-transform: uppercase; letter-spacing: 0.06em; }
  .story-category::before { content: '· '; color: var(--text-ghost); }
  .story-also { color: var(--text-secondary); }
  .story-also::before { content: '· '; color: var(--text-ghost); }
  .story-read { color: var(--text-ghost); text-transform: uppercase; letter-spacing: 0.06em; }
  .story-read::before { content: '· '; }
  .story-kept { color: var(--success); text-transform: uppercase; letter-spacing: 0.06em; }
  .story-kept::before { content: '· '; color: var(--text-ghost); }
  .why-evidence { color: var(--text-muted); }
  .why-evidence::before { content: '· '; color: var(--text-ghost); }
  .foryou-note { margin: 0; padding: 12px 8px; border-bottom: 1px solid var(--line-hair); font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1.5; color: var(--text-muted); }
  .foryou-note strong { color: var(--accent-ink); font-weight: 600; }
  /* The correlation line is the one thing on the row that is OURS rather than
     the wire's, so it gets the counter-accent and its own line — a reader
     scanning for it should not have to find it inside the byline. */
  .story-why {
    display: flex; align-items: baseline; gap: 7px; min-width: 0;
    font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1.35;
    color: var(--accent-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .why-label {
    flex: none; padding: 1px 5px; border: 1px solid currentColor;
    text-transform: uppercase; letter-spacing: 0.08em;
  }
  .story-signal { display: grid; grid-template-columns: 1fr; gap: 4px; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }
  .story-signal b { color: var(--text-primary); font-weight: 600; font-variant-numeric: tabular-nums; }
  .story-actions { display: grid; grid-template-columns: 1fr; align-content: center; gap: 4px; padding: 8px 0 8px 8px; }
  .story-action { display: flex; align-items: center; justify-content: center; gap: 7px; padding: 5px 8px; border: 1px solid transparent; background: transparent; color: var(--text-muted); font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.06em; text-transform: uppercase; text-decoration: none; white-space: nowrap; }
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
    .lanes, .filters { grid-column: 1 / -1; }
    .lanes { border-right: 0; }
  }
  @media (max-width: 780px) {
    /* The search cell is the only elastic one on this row, so its FLOOR decides
       whether the row fits at all: `Order Time Heat Points` is 280 fixed pixels
       and Refresh another 104, which against a 180px floor needs 564 in a band
       that is only 560 wide at a 600px window. Those four pixels were clipped,
       never scrolled — the same `overflow-x: hidden` that hid the desktop
       toolbar. 110 is under the 137 the narrowest window using this row can
       spare, so the floor never binds and the cell simply flexes. */
    .desk-tools { grid-template-columns: auto minmax(110px, 1fr) auto; }
    .lede-inner { grid-template-columns: 1fr; gap: 24px; }
    .story { grid-template-columns: 1fr; }
    .story-reader { grid-template-columns: 32px 34px minmax(0, 1fr); gap: 10px; padding: 11px 4px 7px; }
    .story-signal { grid-column: 3; display: flex; gap: 14px; }
    .story-actions { grid-template-columns: repeat(2, max-content); justify-content: end; padding: 0 4px 11px 78px; }
    .story-action { min-height: 36px; }
  }
  @media (max-width: 560px) {
    .desk-tools { grid-template-columns: minmax(0, 1fr) auto; }
    .filters button { padding-inline: 8px; }
    .filters > :last-child { border-right: 0; }
    .lanes button { flex: 1; padding-inline: 8px; }
    /* Full-bleed here, so the column seam it draws above would be a stray tick
       against the right-hand edge of the band — the same reason `.lanes` drops
       its own right border at 1200. */
    .sort-tabs { grid-column: 1 / -1; border-right: 0; border-bottom: 1px solid var(--line-strong); }
    .search { border-right: 1px solid var(--line-strong); }
  }
  /* The title and the five feed tabs stop sharing a line at 620, not 520, and
     the deciding word is FAVOURITES. Every other heading here is two or three
     words and wraps, so its min-content is one short word — but FAVOURITES is a
     single unbreakable 225px token at the 2rem floor, and beside a 322px tab
     strip that needs 571px of band. Between 521 and 603 it did not have it, so
     the tabs hung up to 71px off the right of a page that clips. */
  @media (max-width: 620px) {
    .desk-head { align-items: stretch; flex-direction: column; gap: 16px; }
    .view-tabs a { flex: 1; padding-inline: 10px; text-align: center; }
  }
  @media (max-width: 520px) {
    .news-frame :global(.hs-kicker), .news-frame :global(.hs-head-right) { display: none; }
    h1 { font-size: clamp(2.5rem, 10vw, 3.25rem); }
    .standfirst { font-size: var(--fs-body); }
    .desk-summary small { display: none; }
    .desk-summary dd { margin-top: 6px; }
    .desk { padding-top: 24px; }
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
