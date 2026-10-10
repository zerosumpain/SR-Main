<svelte:head>
  <title>Strange Ramblings</title>
  <meta name="description" content="A personal site that thinks, builds and ships on its own, wired to the heartbeat of the person who runs it." />
  <meta property="og:title" content="Strange Ramblings" />
  <meta property="og:description" content="A personal site that thinks, builds and ships on its own, wired to the heartbeat of the person who runs it." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://strangeramblings.com" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="Strange Ramblings" />
  <meta name="twitter:description" content="A personal site that thinks, builds and ships on its own, wired to the heartbeat of the person who runs it." />
</svelte:head>

<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import AccountSyncBanner from '$lib/components/landing/AccountSyncBanner.svelte';
  import HeroViews from '$lib/components/landing/HeroViews.svelte';
  import ShowcaseViews from '$lib/components/landing/ShowcaseViews.svelte';
  import { PageView, setPageView } from '$lib/components/landing/page-view.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Rambler from '$lib/components/landing/Rambler.svelte';
  import { scenery } from '$lib/landing/ramblers/scenery';
  import { rambler, toggleRambler } from '$lib/landing/ramblers/visibility.svelte';
  import { LiveVitals } from '$lib/landing/live-vitals.svelte';
  import { readPulse } from '$lib/landing/sentence';
  import { localToday } from '$lib/constants/health-day';
  import type { VitalsStore } from '$lib/vitals/store.svelte';
  import type { BuildShowcase } from '$lib/landing/showcase';

  const store = getContext<VitalsStore>('vitals');

  let { data } = $props();

  const live = new LiveVitals();

  // The visitor's view (sentence, place or notes), lifted out of the hero so
  // the whole page follows it. It tracks the route's data (the server's
  // choice and that view's loaded hero and showcase) until the visitor picks.
  const page = setPageView(
    new PageView(() => ({ choice: data.heroView, hero: data.heroComponent, showcase: data.showcaseComponent })),
  );
  let mounted = $state(false);

  // initialVitals is streamed, so it isn't in the SSR HTML. Until the store is
  // seeded AND a real heart-rate reading is in, the page says so in words
  // rather than printing the store's placeholder 60 as if it were live.
  // Read the target, not the eased state: the eased one counts up from that
  // placeholder for five seconds, so the first numbers shown are never real.
  // A reading over six hours old is not a pulse either (readPulse), and its
  // age is the heart-rate reading's own, never a WHOOP recovery row's.
  let reading = $derived(mounted ? store?.targetState : undefined);
  let pulse = $derived(readPulse(reading, live.now));
  let town = $derived(mounted ? store.state.town : undefined);
  let temp = $derived(reading?.sources?.weather ? reading.weather.temp : null);
  // Shipping, read off the release showcase — one loader, several readings.
  // Days are London days (localCadence), the same day as the dateline and the
  // steps, so "today" never means yesterday in the hour after midnight BST.
  let days = $derived(data.releases?.localCadence ?? []);
  let dayKey = (offset: number) => localToday(new Date(live.now - offset * 86_400_000));
  let deploysToday = $derived(days.length ? (days.find((d) => d.date === dayKey(0))?.count ?? 0) : null);
  let totals = $derived(data.releases?.totals ?? null);
  let deploysPerDay = $derived(
    totals && totals.days > 0 && totals.releases > 0 ? Math.round((totals.releases / totals.days) * 10) / 10 : null,
  );

  // How it ships itself, for the showcase's build chapter: the same release
  // record the hero reads, so the two never disagree.
  let build = $derived<BuildShowcase>({
    releases: totals && totals.releases > 0 ? totals.releases : null,
    linesWritten: totals?.insertions || null,
    days: totals?.days || null,
    firstDeploy: totals?.firstDeploy ?? null,
    deploysPerDay,
    deploysToday,
    fromDaydream: data.showcase.daydream.impact?.shipped ?? null,
  });

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';

  onMount(() => {
    Promise.resolve(data.initialVitals).then((b) => {
      if (b) store.setState(b);
    });
    mounted = true;
    // The layout's store re-reads every fifteen minutes, sized for a header
    // cell. The landing hero is the one place a pulse is the subject, so it
    // asks again every two minutes while the tab is visible; the endpoint
    // serves a sixty-second cache, so this is one cheap read per visitor.
    const pulse = setInterval(() => {
      if (!document.hidden) void store.fetchState();
    }, 120_000);
    const stop = live.start();
    return () => {
      clearInterval(pulse);
      stop();
    };
  });
</script>

<PageHeader title="strange ramblings" titleHref="/" />

<!-- Owner-only: an account that has stopped syncing, and work sitting mergeable
     on GitHub. Both null for every visitor, in which case the component renders
     nothing at all. -->
<AccountSyncBanner summary={data.syncAttention} prs={data.mergeablePrs} />

<!-- HERO — the title and the site's live numbers, read as a sentence, a place
     or notes. Its lower edge is also the rambler's ground. -->
<section class="hero" aria-label="Live" use:scenery={{ edge: 'bottom' }}>
  <!-- One hero, three readings of the same numbers. The server picked which
       (a ?view= link, the visitor's own choice, or the notes); HeroViews owns
       the switch between them. -->
  <HeroViews
    {page}
    date={data.dateline}
    {town}
    {temp}
    {pulse}
    v={live.v}
    now={live.now}
    facts={data.capabilities}
    steps={data.steps}
    cadence={days}
    releases={totals && totals.releases > 0
      ? { total: totals.releases, firstDeploy: totals.firstDeploy, days: totals.days }
      : null}
  />
</section>

<!-- Everything below the hero follows its view: the showcase is told in the
     same style (each view's own chunk, swapped with the hero), and the
     writing strip and footer take a light coat of it. -->
<div class="below" data-view={page.view}>
  <ShowcaseViews
    {page}
    data={data.showcase}
    {build}
    v={live.v}
    now={live.now}
    {pulse}
    steps={data.steps}
    cadence={days}
    facts={data.capabilities}
  />

  {#if data.posts.length}
    <section class="writing" aria-labelledby="writing-h" use:scenery={{ spot: 'bed', at: 0.1 }}>
      <h2 id="writing-h" class="writing-k">Also written down</h2>
      {#each data.posts as p (p.slug)}
        <a class="writing-post" href="/blog/{p.slug}">
          <span class="writing-title">{p.title}</span>
          {#if p.publishedAt}<span class="writing-date">{fmtDate(p.publishedAt)}</span>{/if}
        </a>
      {/each}
      <a class="writing-all" href="/blog">All writing <span aria-hidden="true">→</span></a>
    </section>
  {/if}

  <footer class="site-foot" use:scenery={{ spot: 'garage', at: 0.88 }}>
    <p class="brand foot-brand">strange ramblings</p>
    <nav class="foot-links" aria-label="Footer">
      <a href="https://github.com/jkrup" target="_blank" rel="noopener" class="nav-link">GitHub</a>
      <a href="mailto:john@strangeramblings.com" class="nav-link">Email</a>
      <a href="/rss.xml" class="nav-link">RSS</a>
      <a href="https://library.strangeramblings.com" class="nav-link">Library</a>
      {#if data.isOwner}<a href="/admin" class="nav-link">Admin</a>{/if}
      <a href="/privacy" class="nav-link">Privacy</a>
      <a href="/tos" class="nav-link">Terms</a>
      <button type="button" class="nav-link rambler-toggle" onclick={toggleRambler}>
        {rambler.hidden ? 'Bring back the rambler' : 'Tuck in the rambler'}
      </button>
      <a href="/rambler" class="nav-link">How he works</a>
    </nav>
  </footer>
</div>

<Rambler day={data.day} />

<style>
  .hero {
    background: var(--text-primary);
    color: var(--bg);
  }
  /* Browsers drop the ink band in print; the hero then prints ink on paper. */
  @media print {
    .hero {
      background: none;
      color: var(--text-primary);
    }
  }
  /* Everything below the hero, in the hero's view. The default (and the
     sentence) is the paper page; the place carries the night on down; the
     notes turn the paper into a ruled notebook. Backgrounds run full-bleed,
     content keeps the 1312px measure. */
  .below {
    --gut: clamp(16px, 4vw, 64px);
    background: var(--bg);
    color: var(--text-primary);
  }
  .below[data-view='place'] {
    background: var(--place-night);
    color: var(--bg);
  }
  .below[data-view='notes'] {
    background: var(--bg) repeating-linear-gradient(transparent 0 31px, var(--line-hair) 31px 32px);
  }

  .writing {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 20px 48px;
    max-width: 1312px;
    margin: 72px auto 88px;
    padding: 28px 32px;
    box-sizing: border-box;
    width: calc(100% - 2 * var(--gut));
    background: var(--text-primary);
    color: var(--bg);
  }
  .writing-k,
  .writing-date,
  .writing-all {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .writing-k {
    font-weight: 400;
    color: var(--accent-on-dark);
  }
  .writing-post {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-height: 44px;
    color: var(--bg);
    text-decoration: none;
  }
  .writing-post:hover .writing-title {
    color: var(--accent-on-dark);
  }
  .writing-title {
    font-family: var(--font-display);
    font-size: var(--fs-display-xs);
    text-transform: uppercase;
    letter-spacing: -0.02em;
  }
  .writing-date {
    color: rgba(237, 228, 212, 0.6);
  }
  .writing-all {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    margin-left: auto;
    color: var(--accent-on-dark);
    text-decoration: none;
  }
  .writing-post:focus-visible,
  .writing-all:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: 4px;
  }

  /* The sentence: an editorial page. The strip is set on the paper between
     two rules, the titles in the hero's serif. */
  .below[data-view='sentence'] .writing {
    padding: 24px 0;
    background: none;
    color: var(--text-primary);
    border-top: 2px solid var(--text-primary);
    border-bottom: 1px solid var(--line-strong);
  }
  .below[data-view='sentence'] .writing-k,
  .below[data-view='sentence'] .writing-all {
    color: var(--accent-hover);
  }
  .below[data-view='sentence'] .writing-post {
    color: var(--text-primary);
  }
  .below[data-view='sentence'] .writing-title {
    font-family: var(--fs-serif);
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
  }
  .below[data-view='sentence'] .writing-post:hover .writing-title {
    color: var(--accent-hover);
  }
  .below[data-view='sentence'] .writing-date {
    color: var(--text-muted);
  }
  .below[data-view='sentence'] .writing-post:focus-visible,
  .below[data-view='sentence'] .writing-all:focus-visible {
    outline-color: var(--accent-hover);
  }

  /* The place: the strip is a lit sign on the night shore, petrol-edged like
     the ridge's crest. */
  .below[data-view='place'] .writing {
    background: none;
    border: 1px solid rgba(127, 184, 192, 0.45);
  }
  .below[data-view='place'] .writing-k {
    color: var(--accent-ink-on-dark);
  }
  .below[data-view='place'] .writing-date {
    color: var(--on-ink-70);
  }

  /* The notes: an index card pinned to the notebook. */
  .below[data-view='notes'] .writing {
    background: var(--surface-card);
    color: var(--text-primary);
    border: 1px solid var(--line-strong);
    border-left: 3px solid var(--accent-ink);
  }
  .below[data-view='notes'] .writing-k,
  .below[data-view='notes'] .writing-all {
    color: var(--accent-ink);
  }
  .below[data-view='notes'] .writing-post {
    color: var(--text-primary);
  }
  .below[data-view='notes'] .writing-title {
    font-family: var(--fs-serif);
    font-style: italic;
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
  }
  .below[data-view='notes'] .writing-post:hover .writing-title {
    color: var(--accent-ink);
  }
  .below[data-view='notes'] .writing-date {
    color: var(--text-muted);
  }
  .below[data-view='notes'] .writing-post:focus-visible,
  .below[data-view='notes'] .writing-all:focus-visible {
    outline-color: var(--accent-ink);
  }

  /* The footer is a rail band, like the nav strip that opens the page. */
  .site-foot {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 18px clamp(24px, 5vw, 64px);
    border-top: 1px solid var(--line-strong);
    background: var(--surface-rail);
  }
  .foot-brand {
    margin: 0;
    font-size: var(--fs-nav);
    color: var(--text-muted);
  }
  /* A button dressed as the footer links around it. */
  .rambler-toggle {
    background: none;
    cursor: pointer;
  }
  .foot-links {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 24px;
  }
  .foot-links > :global(.nav-link) {
    min-height: 44px;
    align-items: center;
  }

  /* The sentence ends on a hairline, like the foot of a printed page. */
  .below[data-view='sentence'] .site-foot {
    background: none;
    border-top: 2px solid var(--text-primary);
  }
  /* The place: the shore at night, the links lit like the town's windows. */
  .below[data-view='place'] .site-foot {
    background: none;
    border-top-color: var(--on-ink-16);
  }
  .below[data-view='place'] .foot-brand {
    color: var(--on-ink-70);
  }
  .below[data-view='place'] .foot-brand::before {
    color: var(--accent-on-dark);
  }
  .below[data-view='place'] .foot-links > :global(.nav-link) {
    color: var(--on-ink-80);
  }
  .below[data-view='place'] .foot-links > :global(.nav-link:hover) {
    color: var(--accent-on-dark);
    border-color: var(--on-ink-30);
  }
  .below[data-view='place'] .foot-links > :global(.nav-link:focus-visible) {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: 4px;
  }
  /* The notes: the last ruled line, torn off with a dashed edge. */
  .below[data-view='notes'] .site-foot {
    border-top: 1px dashed var(--text-secondary);
  }

  @media (max-width: 900px) {
    .writing-all {
      margin-left: 0;
    }
  }

  @media print {
    .below,
    .below[data-view] {
      background: none;
      color: #1a1008;
    }
    .below[data-view] .writing {
      background: none;
      color: #1a1008;
      border: 1px solid #1a1008;
    }
    .below[data-view] .writing-k,
    .below[data-view] .writing-post,
    .below[data-view] .writing-date,
    .below[data-view] .writing-all,
    .below[data-view] .foot-brand,
    .below[data-view] .foot-links > :global(.nav-link) {
      color: #1a1008;
    }
    .below[data-view] .site-foot {
      background: none;
      border-top: 1px solid #1a1008;
    }
  }
</style>
