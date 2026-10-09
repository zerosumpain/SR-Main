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
  import CapabilityLoop from '$lib/components/landing/CapabilityLoop.svelte';
  import CapabilityGrid from '$lib/components/landing/CapabilityGrid.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Rambler from '$lib/components/landing/Rambler.svelte';
  import { scenery } from '$lib/landing/ramblers/scenery';
  import { rambler, toggleRambler } from '$lib/landing/ramblers/visibility.svelte';
  import { LiveVitals } from '$lib/landing/live-vitals.svelte';
  import { readPulse } from '$lib/landing/sentence';
  import { localToday } from '$lib/constants/health-day';
  import type { VitalsStore } from '$lib/vitals/store.svelte';

  const store = getContext<VitalsStore>('vitals');

  let { data } = $props();

  const live = new LiveVitals();
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
  let bpm = $derived(pulse.state === 'fresh' ? pulse.bpm : null);
  let town = $derived(mounted ? store.state.town : undefined);
  let temp = $derived(reading?.sources?.weather ? reading.weather.temp : null);
  // Shipping, read off the release showcase — one loader, several readings.
  // Days are London days (localCadence), the same day as the dateline and the
  // steps, so "today" never means yesterday in the hour after midnight BST.
  let days = $derived(data.releases?.localCadence ?? []);
  let dayKey = (offset: number) => localToday(new Date(live.now - offset * 86_400_000));
  let deploysToday = $derived(days.length ? (days.find((d) => d.date === dayKey(0))?.count ?? 0) : null);
  let deploysYesterday = $derived(days.length ? (days.find((d) => d.date === dayKey(1))?.count ?? 0) : null);
  let totals = $derived(data.releases?.totals ?? null);
  let deploysPerDay = $derived(
    totals && totals.days > 0 && totals.releases > 0 ? Math.round((totals.releases / totals.days) * 10) / 10 : null,
  );

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
       (a ?view= link, the visitor's own choice, or the hour); HeroViews owns
       the switch between them. -->
  <HeroViews
    choice={data.heroView}
    component={data.heroComponent}
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

<CapabilityGrid
  v={live.v}
  now={live.now}
  {bpm}
  facts={data.capabilities}
  {deploysToday}
  {deploysYesterday}
  linesWritten={totals?.insertions || null}
  days={totals?.days || null}
/>

<CapabilityLoop facts={data.capabilities} {deploysPerDay} releases={totals?.releases || null} />

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
  .writing {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 20px 48px;
    max-width: 1312px;
    margin: 72px auto 88px;
    padding: 28px 32px;
    box-sizing: border-box;
    width: calc(100% - 2 * clamp(16px, 4vw, 64px));
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
    margin-left: auto;
    color: var(--accent-on-dark);
    text-decoration: none;
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

  @media (max-width: 900px) {
    .writing-all {
      margin-left: 0;
    }
  }
</style>
