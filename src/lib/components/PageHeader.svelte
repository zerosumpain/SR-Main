<script lang="ts">
  import type { Snippet } from 'svelte';
  import { getContext, onMount } from 'svelte';
  import { page } from '$app/state';
  import SiteNav from './SiteNav.svelte';
  import { roundPulse } from '$lib/biome/state';
  import type { BiomeStore } from '$lib/biome/store.svelte';

  type NavItem = { href: string; label: string };

  let {
    title,
    items,
    meta,
    before,
    titleHref,
  }: {
    title: string;
    /** Optional nav item override; defaults to context-derived site nav */
    items?: NavItem[];
    /** Slot for small metadata beside the title (counts, status, etc.) */
    meta?: Snippet;
    /** Slot rendered before the title (e.g. mobile menu toggle) */
    before?: Snippet;
    /** Optional href to wrap the title (e.g. parent/hub link). */
    titleHref?: string;
  } = $props();

  const SITE_ITEMS: NavItem[] = [
    { href: '/', label: 'Home' },
    { href: '/projects', label: 'Projects' },
    { href: '/decks', label: 'Decks' },
    { href: '/blog', label: 'Writing' },
    { href: '/health', label: 'Health' },
    { href: '/live', label: 'Live' },
    { href: '/jkai', label: 'jkai' },
    { href: '/drive', label: 'Drive' },
  ];
  const JKAI_ITEMS: NavItem[] = [
    { href: '/', label: 'Home' },
    { href: '/jkai', label: 'Chat' },
    { href: '/jkai/intel', label: 'Intel' },
    { href: '/jkai/research', label: 'Research' },
    { href: '/jkai/builds', label: 'Builds' },
    { href: '/jkai/canvas', label: 'Canvases' },
    { href: '/jkai/briefing', label: 'Briefing' },
    { href: '/jkai/improvement', label: 'Improvement' },
    { href: '/jkai/doctor', label: 'Doctor' },
    { href: '/jkai/prompts', label: 'Prompts' },
  ];

  let resolvedItems = $derived.by(() => {
    if (items) return items;
    const path = page.url.pathname;
    if (path.startsWith('/jkai')) return JKAI_ITEMS;
    return SITE_ITEMS;
  });

  // The strip's right-hand cell is the site's pulse: the same public biome state
  // the hero reads, so every page carries the live signal the homepage does.
  // Null until mounted (the store's default is a placeholder, never shown live)
  // and null again when no page-level meta is supplied on top of it.
  const store = getContext<BiomeStore>('biome');
  let mounted = $state(false);
  onMount(() => {
    mounted = true;
  });
  const live = $derived.by(() => {
    if (!mounted || !store?.state) return null;
    const hasHr = !!store.state.sources?.heartRate && store.state.pulse > 0;
    const temp = store.state.weather?.temp;
    if (!hasHr && typeof temp !== 'number') return null;
    return {
      bpm: hasHr ? roundPulse(store.state.pulse) : null,
      temp: typeof temp === 'number' ? Math.round(temp) : null,
    };
  });
</script>

<header class="site-nav-bar">
  {#if before}
    <div class="hdr-before">{@render before()}</div>
  {/if}

  {#if titleHref}
    <a href={titleHref} title={title} class="brand hdr-title">{title}</a>
  {:else}
    <h1 title={title} class="brand hdr-title">{title}</h1>
  {/if}

  {#if meta}
    <div class="hdr-meta">{@render meta()}</div>
  {/if}

  <SiteNav variant="compact" showBrand={false} items={resolvedItems} />

  {#if live}
    <div class="hdr-live" aria-label="Live signal">
      <span class="live-dot" aria-hidden="true"></span>
      <span class="live-txt">
        {#if live.bpm !== null}{live.bpm} bpm{/if}
        {#if live.bpm !== null && live.temp !== null}<span class="live-sep" aria-hidden="true"
            >/</span
          >{/if}
        {#if live.temp !== null}{live.temp}°C{/if}
      </span>
    </div>
  {/if}
</header>

<style>
  .hdr-before {
    display: inline-flex;
    align-items: center;
    padding: 0 12px;
    border-right: 1px solid var(--line-hair);
    flex: none;
  }

  /* The first cell of the strip. It carries the wordmark on the site pages and
     the surface name on the sub-pages, and always owns the left edge. */
  .hdr-title {
    display: inline-flex;
    align-items: center;
    flex: none;
    min-width: 0;
    max-width: min(55vw, 520px);
    margin: 0;
    padding: 0 20px;
    border-right: 1px solid var(--line-hair);
    font-size: 15px;
    line-height: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: color 0.2s var(--ease-out);
  }
  a.hdr-title:hover {
    color: var(--accent);
  }

  .hdr-meta {
    display: none;
    align-items: center;
    padding: 0 16px;
    border-right: 1px solid var(--line-hair);
    min-width: 0;
    flex: none;
  }

  /* Pushed to the far edge by SiteNav's own flex:1, so it sits against the
     right of the strip whatever the nav does. */
  .hdr-live {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    flex: none;
    padding: 0 20px;
    border-left: 1px solid var(--line-hair);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .live-txt {
    font-variant-numeric: tabular-nums;
  }
  .live-sep {
    opacity: 0.4;
    margin: 0 0.4ch;
  }
  .live-dot {
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: var(--radius-pill);
    background: var(--accent);
    animation: nav-pulse 1.5s ease-in-out infinite;
  }
  @keyframes nav-pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.45;
      transform: scale(0.82);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .live-dot {
      animation: none;
    }
  }

  @media (min-width: 768px) {
    .hdr-meta {
      display: flex;
    }
  }
  /* The live cell is the first thing to go — the strip's job on a phone is the
     brand and a way into the menu. */
  @media (max-width: 640px) {
    .hdr-live {
      display: none;
    }
    .hdr-title {
      padding: 0 14px;
    }
  }
</style>
