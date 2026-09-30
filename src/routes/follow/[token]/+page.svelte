<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import FollowMap from '$lib/components/home/FollowMap.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const km = (m: number) => (m < 10_000 ? (m / 1000).toFixed(1) : String(Math.round(m / 1000)));
  const fraction = $derived(data.alongM != null && data.totalM > 0 ? Math.min(1, data.alongM / data.totalM) : 0);
  const timeLeft = $derived.by(() => {
    if (data.timeLeftS == null || data.offRoute) return null;
    const m = Math.round(data.timeLeftS / 60);
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
  });
  const seen = $derived.by(() => {
    if (!data.lastFixAt) return 'waiting for the first position';
    const t = new Date(data.lastFixAt);
    return `position at ${t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  });

  // Every 15 s — the rate the walker's phone sends at. A link that has ended
  // turns into the 404 page on the next refresh, which is the point.
  onMount(() => {
    const timer = setInterval(() => void invalidateAll(), 15_000);
    return () => clearInterval(timer);
  });
</script>

<svelte:head>
  <title>{data.name} · {data.routeName}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<PageHeader title="Follow" />

<main class="follow">
  <header class="page-hdr">
    <p class="kicker">Live</p>
    <h1>{data.name} is on {data.routeName}</h1>
    <p class="sub">{seen}. This page updates itself and stops working when the walk ends.</p>
  </header>

  <FollowMap route={data.route} position={data.position} label="{data.name}'s position on {data.routeName}" />

  <section class="figures" aria-label="Progress">
    <div>
      <span class="sr-label-tight">Done</span>
      <strong>{data.alongM != null ? `${km(data.alongM)} km` : '—'}</strong>
    </div>
    <div>
      <span class="sr-label-tight">Left</span>
      <strong>{data.remainingM != null ? `${km(data.remainingM)} km` : `${km(data.totalM)} km`}</strong>
    </div>
    <div>
      <span class="sr-label-tight">Time left</span>
      <strong>{timeLeft ?? '—'}</strong>
    </div>
  </section>
  <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(fraction * 100)}>
    <span style:width="{Math.max(2, fraction * 100)}%"></span>
  </div>
  {#if data.offRoute}
    <p class="off">Off the route — about {Math.round((data.offRouteM ?? 0) / 10) * 10} m from the line.</p>
  {/if}
</main>

<style>
  .follow {
    max-width: 880px;
    margin: 0 auto;
    padding: 24px 16px 48px;
  }
  .page-hdr {
    border-bottom: 2px solid var(--text-primary);
    padding-bottom: 14px;
    margin-bottom: 18px;
  }
  .kicker {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 6px;
  }
  h1 {
    font-family: var(--font-display);
    font-size: clamp(1.5rem, 4vw, 2.2rem);
    line-height: 1.1;
    margin: 0 0 8px;
    overflow-wrap: anywhere;
  }
  .sub {
    font-family: var(--font-body);
    color: var(--text-secondary);
    margin: 0;
  }
  .figures {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    margin: 18px 0 10px;
  }
  .figures div {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .figures strong {
    font-family: var(--font-mono);
    font-size: 1.25rem;
    color: var(--text-primary);
  }
  .bar {
    height: 8px;
    background: var(--line-hair, rgba(26, 16, 8, 0.12));
    border-radius: 100px;
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .off {
    margin: 14px 0 0;
    font-family: var(--font-body);
    color: var(--accent);
  }
</style>
