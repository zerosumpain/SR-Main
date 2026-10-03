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
  import CapabilityMonitor from '$lib/components/landing/CapabilityMonitor.svelte';
  import CapabilityLoop from '$lib/components/landing/CapabilityLoop.svelte';
  import CapabilityGrid from '$lib/components/landing/CapabilityGrid.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { LiveVitals } from '$lib/landing/live-vitals.svelte';
  import { roundPulse } from '$lib/vitals/state';
  import type { VitalsStore } from '$lib/vitals/store.svelte';

  const store = getContext<VitalsStore>('vitals');

  let { data } = $props();

  const live = new LiveVitals();
  let mounted = $state(false);

  // initialVitals is streamed, so it isn't in the SSR HTML. Until the store is
  // seeded AND a real heart-rate source is reporting, the page says so with a
  // dash rather than printing the store's placeholder 60 as if it were live.
  let bpm = $derived(
    mounted && store?.state?.sources?.heartRate && store.state.pulse > 0 ? roundPulse(store.state.pulse) : null,
  );
  let town = $derived(mounted ? store.state.town : undefined);
  // Shipping, read off the release showcase — one loader, several readings.
  let cadence = $derived(data.releases?.cadence ?? []);
  let days = $derived(cadence.map((d) => ({ date: d.date, count: d.count })));
  let dayKey = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
  let deploysToday = $derived(cadence.length ? (cadence.find((d) => d.date === dayKey(0))?.count ?? 0) : null);
  let deploysYesterday = $derived(cadence.length ? (cadence.find((d) => d.date === dayKey(1))?.count ?? 0) : null);
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
    return live.start();
  });
</script>

<PageHeader title="strange ramblings" titleHref="/" />

<!-- Owner-only: an account that has stopped syncing, and work sitting mergeable
     on GitHub. Both null for every visitor, in which case the component renders
     nothing at all. -->
<AccountSyncBanner summary={data.syncAttention} prs={data.mergeablePrs} />

<!-- HERO — the site as a patient on a monitor: one ink band holding the title
     and a live trace per capability. -->
<section class="hero" aria-label="Live">
  <CapabilityMonitor
    meta={`Right now · ${data.dateStr}` + (town ? ` · ${town.toUpperCase()}` : '')}
    v={live.v}
    now={live.now}
    {bpm}
    facts={data.capabilities}
    steps={data.steps}
    releases={totals?.releases || null}
    {days}
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
  <section class="writing" aria-labelledby="writing-h">
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

<footer class="site-foot">
  <p class="brand foot-brand">strange ramblings</p>
  <nav class="foot-links" aria-label="Footer">
    <a href="https://github.com/jkrup" target="_blank" rel="noopener" class="nav-link">GitHub</a>
    <a href="mailto:john@strangeramblings.com" class="nav-link">Email</a>
    <a href="/rss.xml" class="nav-link">RSS</a>
    <a href="https://library.strangeramblings.com" class="nav-link">Library</a>
    {#if data.isOwner}<a href="/admin" class="nav-link">Admin</a>{/if}
    <a href="/privacy" class="nav-link">Privacy</a>
    <a href="/tos" class="nav-link">Terms</a>
  </nav>
</footer>

<style>
  .hero {
    background: var(--text-primary);
    color: var(--bg);
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
