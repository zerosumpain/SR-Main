// The landing page's one live view choice, lifted out of the hero so the whole
// page can follow it: the hero, the showcase below it, and the writing strip
// and footer that close the page all read the same `view`.
//
// The route builds one PageView from its data (+page.svelte) and hands it to
// HeroViews, which owns the switch, and to ShowcaseViews, which renders the
// chosen view's showcase. A pick swaps both halves at once: each view's hero
// and showcase are their own lazy chunks, fetched together, and the swap is
// one View Transition so nothing shows a new hero over an old showcase.
//
// It lives beside the components rather than in $lib/landing because it loads
// them: $lib/landing must not import $lib/components (the components already
// import it, and the boundaries gate refuses a new mutual import).

import { getContext, setContext, tick, type Component } from 'svelte';
import {
  HERO_VIEWS,
  heroViewCookie,
  parseHeroView,
  storedChoice,
  type HeroView,
  type HeroViewChoice,
} from '$lib/landing/hero-view';
import type { ShowcaseProps } from '$lib/landing/showcase';
import type { HeroViewComponent } from './HeroViews.svelte';

export type ShowcaseViewComponent = Component<ShowcaseProps>;

/** The two halves a view brings: its hero and its showcase. */
export interface ViewParts {
  hero: HeroViewComponent;
  showcase: ShowcaseViewComponent;
}
export type ViewPart = keyof ViewParts;

// Each view's halves are their own chunks: a page loads the pair it shows (the
// route's universal load awaits both, so it hydrates with nothing missing) and
// the others only when the visitor reaches for the switch. Dynamic imports are
// outside the home route's client budget; three views in one bundle are not.
//
// Every component in those chunks (each view's hero and showcase and all their
// children) is compiled with `<svelte:options css="injected" />`. SvelteKit
// links the CSS of a route's dynamic imports in the page head, so extracted
// CSS would make every visit download and block on all three views' styles;
// injected, the server inlines only the view it renders and a swap brings its
// own styles with its chunk. A new component under these views needs it too.
const LOADERS: { [P in ViewPart]: Record<HeroView, () => Promise<{ default: ViewParts[P] }>> } = {
  hero: {
    sentence: () => import('./HeroSentence.svelte'),
    place: () => import('./HeroPlace.svelte'),
    notes: () => import('./HeroNotes.svelte'),
  },
  showcase: {
    sentence: () => import('./showcase/sentence/SentenceShowcase.svelte'),
    place: () => import('./showcase/place/PlaceShowcase.svelte'),
    notes: () => import('./showcase/notes/NotesShowcase.svelte'),
  },
};

const loading = new Map<string, Promise<unknown>>();

/** One half of a view, fetched once and shared by every later ask. */
export function loadViewPart<P extends ViewPart>(view: HeroView, part: P): Promise<ViewParts[P]> {
  const key = `${view}:${part}`;
  let p = loading.get(key) as Promise<ViewParts[P]> | undefined;
  if (!p) {
    p = LOADERS[part][view]().then((m) => m.default);
    // A failed fetch (offline, a deploy moved the chunk) may be tried again.
    p.catch(() => loading.delete(key));
    loading.set(key, p);
  }
  return p;
}

/** Both halves of a view, or a rejection if either failed to arrive. */
export async function loadView(view: HeroView): Promise<ViewParts> {
  const [hero, showcase] = await Promise.all([loadViewPart(view, 'hero'), loadViewPart(view, 'showcase')]);
  return { hero, showcase };
}

/** What the route hands a PageView: the server's choice and that view's loaded halves. */
export interface PageViewInit extends ViewParts {
  choice: HeroViewChoice;
}

type Transition = { finished: Promise<void> };
type ViewTransitionDoc = Document & { startViewTransition?: (update: () => Promise<void>) => Transition };

/** The class on <html> while a swap runs; the transition CSS keys off it. */
export const SWAPPING_CLASS = 'hero-swapping';

export class PageView {
  #init: () => PageViewInit;

  // Follow the route's data until the visitor picks; a fresh load (a new
  // ?view= link, the reload after the address drops one) resets them.
  /** The view on screen now. */
  view: HeroView = $derived(this.#data().choice.view);
  /** Why it is on screen: a link, the visitor's cookie, or the default. */
  source: HeroViewChoice['source'] = $derived(this.#data().choice.source);
  /** The hero component on screen. */
  hero: HeroViewComponent = $derived(this.#data().hero);
  /** The showcase component on screen. */
  showcase: ShowcaseViewComponent = $derived(this.#data().showcase);
  /**
   * Bumped two frames after every swap, once the incoming view has laid
   * itself out: a hidden scenery mark keyed on it asks the rambler to
   * measure the page again.
   */
  settle = $state(0);
  /** True while a swap's transition runs. */
  swapping = $state(false);

  #asked = 0;

  /** `init` is read lazily and re-read whenever the data behind it changes. */
  constructor(init: () => PageViewInit) {
    this.#init = init;
  }

  // Read through a method: the deriveds above are lazy, so `#init` is set by
  // the time any of them first runs.
  #data(): PageViewInit {
    return this.#init();
  }

  /** What the server rendered and why, including the default view (`auto`). */
  get choice(): HeroViewChoice {
    return this.#init().choice;
  }

  // Fetch every view's halves as soon as a hand or a focus heads for the
  // switch, so a pick rarely waits on the network. Nobody who never reaches
  // for it downloads them.
  warm = () => {
    for (const k of HERO_VIEWS) void loadView(k).catch(() => {});
  };

  // Writes the remembered choice, or clears it when there is none to keep.
  #remember(keep: HeroView | null) {
    document.cookie = heroViewCookie(keep, location.protocol === 'https:');
  }

  pick = async (next: HeroView): Promise<void> => {
    // Every click, even one back to the view on screen, outdates a pick that
    // is still fetching its view: the latest one wins.
    const ask = ++this.#asked;
    // The default view clears the choice, so "auto" needs no button of its own.
    const had = { source: this.source, keep: parseHeroView(document.cookie.match(/(?:^|;\s*)sr_hero_view=([^;]*)/)?.[1]) };
    const keep = storedChoice(next);
    this.#remember(keep);
    this.source = keep ? 'cookie' : 'auto';

    if (next !== this.view) {
      let parts: ViewParts;
      try {
        parts = await loadView(next);
      } catch {
        if (ask !== this.#asked) return;
        // A release moved a chunk: a full load shows the chosen view (the
        // cookie, or the default, now says it). Offline, a reload would only
        // trade the page for the browser's error screen, so keep the view on
        // screen and the choice as it was; the next click tries again. A
        // ?view= in the address would outrank the cookie on the reload, so
        // the reload goes to the address without it.
        if (navigator.onLine) {
          const url = new URL(location.href);
          if (url.searchParams.has('view')) {
            url.searchParams.delete('view');
            location.replace(url.href);
          } else location.reload();
        } else {
          this.#remember(had.keep);
          this.source = had.source;
        }
        return;
      }
      if (ask !== this.#asked) return;
      // Both halves at once, so the hero and the showcase never disagree.
      const swap = () => {
        this.view = next;
        this.hero = parts.hero;
        this.showcase = parts.showcase;
      };

      const doc = document as ViewTransitionDoc;
      if (!doc.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        swap();
        await tick();
      } else {
        // The class names the hero and the showcase only while it runs (see
        // HeroViews and ShowcaseViews), so neither is its own stacking
        // context otherwise, and it keeps the rest of the page still.
        const html = document.documentElement;
        html.classList.add(SWAPPING_CLASS);
        this.swapping = true;
        const t = doc.startViewTransition(async () => {
          swap();
          await tick();
        });
        await t.finished.catch(() => {});
        html.classList.remove(SWAPPING_CLASS);
        this.swapping = false;
      }
      requestAnimationFrame(() => requestAnimationFrame(() => (this.settle += 1)));
    }

    // A ?view= link is a one-visit override; once the visitor chooses, the
    // address stops claiming a view they have moved away from. A real
    // (replacing) navigation, not a shallow one, so the router's own URL and
    // the history entry lose it too and Back returns to the visitor's pick.
    // The reload's data asks the cookie just written, so it names the view
    // already on screen and the components are the ones already loaded. The
    // router is fetched only here: every page loads it anyway, and a static
    // import would charge it to the home route's budget.
    if (ask === this.#asked && new URLSearchParams(location.search).has('view')) {
      const { goto } = await import('$app/navigation');
      const url = new URL(location.href);
      url.searchParams.delete('view');
      await goto(url, { replaceState: true, noScroll: true, keepFocus: true });
    }
  };
}

const KEY = Symbol('landing-page-view');

/** Shares the page's PageView with everything below the route. */
export function setPageView(pv: PageView): PageView {
  return setContext(KEY, pv);
}

/** The page's PageView, or undefined outside the landing page. */
export function getPageView(): PageView | undefined {
  return getContext<PageView | undefined>(KEY);
}
