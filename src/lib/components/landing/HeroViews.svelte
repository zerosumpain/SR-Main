<script module lang="ts">
  import type { Component, ComponentProps } from 'svelte';
  import type { HeroView } from '$lib/landing/hero-view';
  import type HeroSentence from './HeroSentence.svelte';

  /** The props every view takes, identically. */
  export type HeroProps = ComponentProps<typeof HeroSentence>;
  export type HeroViewComponent = Component<HeroProps>;

  // Each view is its own chunk: a page loads the one it shows (the route's
  // universal load awaits it, so it hydrates with nothing missing) and the
  // others only when the visitor reaches for the switch.
  const LOADERS: Record<HeroView, () => Promise<{ default: HeroViewComponent }>> = {
    sentence: () => import('./HeroSentence.svelte'),
    place: () => import('./HeroPlace.svelte'),
    notes: () => import('./HeroNotes.svelte'),
  };
  const loading = new Map<HeroView, Promise<HeroViewComponent>>();

  /** A view's component, fetched once and shared by every later ask. */
  export function loadHeroView(view: HeroView): Promise<HeroViewComponent> {
    let p = loading.get(view);
    if (!p) {
      p = LOADERS[view]().then((m) => m.default);
      // A failed fetch (offline, a deploy moved the chunk) may be tried again.
      p.catch(() => loading.delete(view));
      loading.set(view, p);
    }
    return p;
  }
</script>

<script lang="ts">
  // One hero, three ways to read it: the same live numbers told as a
  // sentence, drawn as a place, or kept as notes. This component owns only the
  // choice: a quiet "read it as" switch in the hero's top corner, the cookie
  // that remembers it, and the swap. Each view renders its own masthead
  // (HeroTitle) and takes the identical props, passed straight through.
  //
  // The server picks the first view ($lib/landing/hero-view: a ?view= link,
  // then the visitor's cookie, then the hour), so the page arrives already
  // showing it and nothing flashes. A click swaps the component in place,
  // crossfading the hero alone for 180ms where the browser can (View
  // Transitions), and not at all under prefers-reduced-motion.
  //
  // The rambler's floors follow on their own: the outgoing view's
  // `use:scenery` elements unregister as it unmounts, the incoming one's
  // register as it mounts, and each change tells the rambler to measure again.
  import { tick } from 'svelte';
  import { scenery } from '$lib/landing/ramblers/scenery';
  import { HERO_VIEWS, defaultHeroView, heroViewCookie, storedChoice, type HeroViewChoice } from '$lib/landing/hero-view';

  let {
    choice,
    component,
    ...hero
  }: {
    /** What the server rendered and why. */
    choice: HeroViewChoice;
    /** That view's component, already loaded by the route. */
    component: HeroViewComponent;
  } & HeroProps = $props();

  let root: HTMLElement;

  // Follows the server's answer until the visitor picks; a fresh load (a new
  // ?view= link, say) resets it.
  let view = $derived(choice.view);
  let source = $derived(choice.source);
  let View = $derived(component);

  // Fetch the other views as soon as a hand or a focus heads for the switch,
  // so a pick rarely waits on the network. Nobody who never reaches for it
  // downloads them.
  function warm() {
    for (const k of HERO_VIEWS) void loadHeroView(k).catch(() => {});
  }

  // Read only through the switch's aria-describedby.
  let how = $derived(
    source === 'cookie'
      ? `Kept as you chose it. Choose ${choice.auto} to go back to the view that suits the hour.`
      : source === 'query'
        ? 'Set by the link you followed, for this visit only.'
        : 'Chosen for the hour in Britain: the place after dark, notes at the weekend, the sentence on weekdays.',
  );

  // A zero-size, hidden scenery mark: it is never a floor (the rambler skips
  // anything with no width), but updating it asks him to measure the page
  // again once the incoming view has settled its own layout.
  let settle = $state(0);
  let asked = 0;

  type Transition = { finished: Promise<void> };
  type ViewTransitionDoc = Document & { startViewTransition?: (update: () => Promise<void>) => Transition };

  async function pick(next: HeroView) {
    // The hour's own view clears the choice, so "auto" needs no button of its own.
    const keep = storedChoice(next, defaultHeroView(new Date()));
    document.cookie = heroViewCookie(keep, location.protocol === 'https:');
    source = keep ? 'cookie' : 'auto';
    // A ?view= link is a one-visit override; once the visitor chooses, the
    // address stops claiming a view they have moved away from.
    if (new URLSearchParams(location.search).has('view')) {
      // The router's own replaceState, fetched only here: the kit's client is
      // already loaded by every page, so this costs nothing, and a static
      // import would charge all of it to the home route's budget. The home
      // page keeps no shallow-routing state, so there is none to carry over.
      const { replaceState } = await import('$app/navigation');
      const url = new URL(location.href);
      url.searchParams.delete('view');
      replaceState(url, {});
    }
    if (next === view) return;

    // The latest pick wins if an earlier one is still fetching its view.
    const ask = ++asked;
    let Next: HeroViewComponent;
    try {
      Next = await loadHeroView(next);
    } catch {
      // Offline, or a release moved the chunk: a full load of the page
      // still shows the chosen view (the cookie, or the hour, now says it).
      location.reload();
      return;
    }
    if (ask !== asked) return;
    const swap = () => {
      view = next;
      View = Next;
    };

    const doc = document as ViewTransitionDoc;
    if (!doc.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      swap();
      await tick();
    } else {
      // Named only while it runs, so the hero is never its own stacking
      // context otherwise; the class keeps the rest of the page still.
      const html = document.documentElement;
      root.style.setProperty('view-transition-name', 'hero-view');
      html.classList.add('hero-swapping');
      const t = doc.startViewTransition(async () => {
        swap();
        await tick();
      });
      await t.finished.catch(() => {});
      root.style.removeProperty('view-transition-name');
      html.classList.remove('hero-swapping');
    }
    requestAnimationFrame(() => requestAnimationFrame(() => (settle += 1)));
  }
</script>

<div class="hv" bind:this={root}>
  <div class="hv-bar">
    <div
      class="hv-switch"
      role="group"
      aria-label="Read the live numbers as"
      aria-describedby="hv-how"
      onpointerenter={warm}
      onfocusin={warm}
      ontouchstart={warm}
    >
      <span class="hv-k" aria-hidden="true">read it as:</span>
      {#each HERO_VIEWS as k, i (k)}
        {#if i}<span class="hv-dot" aria-hidden="true">·</span>{/if}
        <button type="button" class="hv-b" aria-pressed={view === k} onclick={() => pick(k)}>{k}</button>
      {/each}
    </div>
    <span id="hv-how" hidden>{how}</span>
  </div>

  <View {...hero} />
  <span class="hv-settle" hidden use:scenery={{ at: settle }}></span>
</div>

<style>
  .hv {
    --gut: clamp(16px, 4vw, 64px);
    position: relative;
  }

  /* The switch hangs in the hero's top corner, inside the page's 1312px
     measure, in the band of ink above the title's first line. It takes no
     room of its own on a desktop, so every view keeps its height. */
  .hv-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    /* Over the view, under the rambler's canvas (20). */
    z-index: 1;
    display: flex;
    justify-content: flex-end;
    max-width: 1312px;
    margin: 0 auto;
    padding: 6px var(--gut) 0;
    box-sizing: border-box;
    pointer-events: none;
  }
  .hv-switch {
    display: flex;
    align-items: baseline;
    gap: 0 2px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.6;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    pointer-events: auto;
  }
  .hv-k {
    margin-right: 6px;
    color: var(--on-ink-55);
  }
  .hv-dot {
    padding: 0 4px;
    color: var(--on-ink-55);
  }
  .hv-b {
    position: relative;
    min-width: 44px;
    margin: 0;
    padding: 2px 0;
    border: 0;
    background: none;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    color: var(--on-ink-80);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  /* A finger-sized target without spacing the words apart. */
  .hv-b::after {
    content: '';
    position: absolute;
    inset: -10px -4px;
  }
  .hv-b:hover {
    color: var(--bg);
  }
  /* Pressed reads by colour and by its underline, never by colour alone. */
  .hv-b[aria-pressed='true'] {
    color: var(--accent-on-dark);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 4px;
  }
  .hv-b:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: 4px;
    border-radius: 2px;
  }

  /* A phone has no spare ink above the title: the switch takes its own short
     row, right-aligned, with full-height targets, and lets the view's top
     padding tuck under it. */
  @media (max-width: 760px) {
    .hv-bar {
      position: relative;
      padding-top: 0;
      margin-bottom: -10px;
    }
    .hv-b {
      min-height: 44px;
    }
    .hv-b::after {
      inset: 0 -4px;
    }
  }

  @media print {
    .hv-bar {
      display: none;
    }
  }

  /* The swap: only the hero crossfades. The rest of the page settles at once
     rather than fading through itself, and the rambler stays live and on top
     instead of being frozen into the page's snapshot under the hero. */
  :global(html.hero-swapping::view-transition-old(root)),
  :global(html.hero-swapping::view-transition-new(root)) {
    animation: none;
  }
  :global(html.hero-swapping canvas.rambler) {
    view-transition-name: hero-rambler;
  }
  :global(html.hero-swapping::view-transition-old(hero-rambler)) {
    display: none;
  }
  :global(html.hero-swapping::view-transition-new(hero-rambler)) {
    animation: none;
  }
  /* Every view sets the same masthead, a few pixels apart at most: the name
     and its subtitle slide to their new places as one piece each instead of
     fading through a double. */
  :global(html.hero-swapping .ht-title) {
    view-transition-name: hero-title;
  }
  :global(html.hero-swapping .ht-lede) {
    view-transition-name: hero-lede;
  }
  :global(html.hero-swapping::view-transition-group(hero-title)),
  :global(html.hero-swapping::view-transition-group(hero-lede)),
  :global(html.hero-swapping::view-transition-group(hero-view)),
  :global(html.hero-swapping::view-transition-old(hero-view)),
  :global(html.hero-swapping::view-transition-new(hero-view)) {
    animation-duration: 180ms;
    animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  }
</style>
