<script lang="ts">
  /**
   * The site header, as the 58 pages that already call this component see it.
   *
   * It is now a thin adapter over `SiteHeader.svelte` — the one bar — and keeps
   * its old prop shape so no caller had to change. What each prop means now:
   *
   *  * `title`   — the section cell. Callers that pass the WORDMARK ("Strange
   *                Ramblings") are asking for the default, and get the
   *                manifest's name for the section they are actually in, which
   *                is why /health/plan now says "Health" instead of the site's
   *                name repeated on every child page.
   *  * `items`   — still an override, still wins. Callers that pass nothing get
   *                their section's own sub-nav from `$lib/nav/site-nav`.
   *  * `titleHref` — accepted and IGNORED. It existed to make the title cell
   *                double as a back link; the back link is its own cell now,
   *                and where it points is computed, not passed. Kept in the
   *                signature so the 14 callers still type-check.
   *  * `meta` / `before` — unchanged, passed straight through.
   *
   * The live bpm/°C cell moves into SiteHeader's `right` slot; it is the same
   * biome context read, on the same terms (null until mounted, null when the
   * health source is not reporting, so the strip never carries a stale number).
   */
  import type { Snippet } from 'svelte';
  import { getContext, onMount } from 'svelte';
  import { currentIsOwner } from '$lib/nav/page-path';
  import SiteHeader from './SiteHeader.svelte';
  import { roundPulse } from '$lib/biome/state';
  import type { BiomeStore } from '$lib/biome/store.svelte';
  import type { NavItem } from '$lib/nav/site-nav';

  let {
    title,
    items,
    meta,
    before,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    titleHref: _titleHref,
  }: {
    title?: string;
    items?: NavItem[];
    meta?: Snippet;
    before?: Snippet;
    /** @deprecated the back cell is computed — see $lib/nav/site-nav. */
    titleHref?: string;
  } = $props();

  /** The wordmark is not a section name; it means "use the default". */
  const WORDMARK = /^strange\s*ramblings$/i;
  const sectionTitle = $derived(title && !WORDMARK.test(title.trim()) ? title : undefined);

  const isOwner = $derived(currentIsOwner());

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

<SiteHeader title={sectionTitle} {items} {isOwner} {meta} {before}>
  {#snippet right()}
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
  {/snippet}
</SiteHeader>

<style>
  /* Written for the INK strip — see the .site-nav-bar rule in the root layout.
     --text-muted is ink on ink here, so the cream alpha is the muted step. */
  .hdr-live {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    flex: none;
    font-family: var(--font-code);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.62);
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
    background: var(--accent-on-dark);
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

  /* The live cell is the first thing to go — the strip's job on a phone is the
     home icon, the way back and where you are. */
  @media (max-width: 640px) {
    .hdr-live {
      display: none;
    }
  }
</style>
