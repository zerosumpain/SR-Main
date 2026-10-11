// /projects' live view choice: which of the three views is on screen, the
// cookie that remembers it, and the swap. The landing page's PageView
// (../landing/page-view.svelte.ts) does the same for a hero AND a showcase;
// this one has a single component per view, so it is the same rules, smaller.
//
// The choice is shared with the landing page on purpose: the same three
// words and the same `sr_hero_view` cookie (Path=/), so a visitor who reads
// the home page as a place finds /projects drawn as a place too, and a pick
// here carries back to the home page.
//
// Each view is its own lazy chunk, like the landing's: +page.ts awaits the
// one the server chose so it renders and hydrates with nothing missing, and
// the others load only when a hand or a focus heads for the switch. Every
// component in those chunks is compiled with `<svelte:options css="injected" />`
// so a visit inlines the styles of the view it shows and no other.

import { tick, type Component } from 'svelte';
import { HERO_VIEWS, heroViewCookie, parseHeroView, storedChoice, type HeroView, type HeroViewChoice } from '$lib/landing/hero-view';
import type { ProjectsViewProps } from '$lib/projects/views';

export type ProjectsViewComponent = Component<ProjectsViewProps>;

const LOADERS: Record<HeroView, () => Promise<{ default: ProjectsViewComponent }>> = {
  sentence: () => import('./sentence/SentenceProjects.svelte'),
  place: () => import('./place/PlaceProjects.svelte'),
  notes: () => import('./notes/NotesProjects.svelte'),
};

const loading = new Map<HeroView, Promise<ProjectsViewComponent>>();

/** A view's component, fetched once and shared by every later ask. */
export function loadProjectsView(view: HeroView): Promise<ProjectsViewComponent> {
  let p = loading.get(view);
  if (!p) {
    p = LOADERS[view]().then((m) => m.default);
    // A failed fetch (offline, a deploy moved the chunk) may be tried again.
    p.catch(() => loading.delete(view));
    loading.set(view, p);
  }
  return p;
}

type Transition = { finished: Promise<void> };
type ViewTransitionDoc = Document & { startViewTransition?: (update: () => Promise<void>) => Transition };

/** The class on <html> while a swap runs; the transition CSS keys off it. */
export const PROJECTS_SWAPPING_CLASS = 'projects-swapping';

export class ProjectsView {
  #init: () => { choice: HeroViewChoice; component: ProjectsViewComponent };

  /** The view on screen now. */
  view: HeroView = $derived(this.#data().choice.view);
  /** Why it is on screen: a link, the visitor's cookie, or the default. */
  source: HeroViewChoice['source'] = $derived(this.#data().choice.source);
  /** The component on screen. */
  component: ProjectsViewComponent = $derived(this.#data().component);

  #asked = 0;

  constructor(init: () => { choice: HeroViewChoice; component: ProjectsViewComponent }) {
    this.#init = init;
  }

  // Read through a method: the deriveds above are lazy, so `#init` is set by
  // the time any of them first runs.
  #data() {
    return this.#init();
  }

  /** The default view, which a pick clears the cookie back to. */
  get auto(): HeroView {
    return this.#init().choice.auto;
  }

  // Fetch every view as soon as a hand heads for the switch, so a pick rarely
  // waits on the network. Nobody who never reaches for it downloads them.
  warm = () => {
    for (const k of HERO_VIEWS) void loadProjectsView(k).catch(() => {});
  };

  #remember(keep: HeroView | null) {
    document.cookie = heroViewCookie(keep, location.protocol === 'https:');
  }

  pick = async (next: HeroView): Promise<void> => {
    // The latest click wins over a pick still fetching its view.
    const ask = ++this.#asked;
    const had = { source: this.source, keep: parseHeroView(document.cookie.match(/(?:^|;\s*)sr_hero_view=([^;]*)/)?.[1]) };
    const keep = storedChoice(next);
    this.#remember(keep);
    this.source = keep ? 'cookie' : 'auto';

    if (next !== this.view) {
      let component: ProjectsViewComponent;
      try {
        component = await loadProjectsView(next);
      } catch {
        if (ask !== this.#asked) return;
        // A release moved a chunk: a full load (without any ?view=, which
        // would outrank the cookie) shows the chosen view. Offline, keep the
        // view on screen and the choice as it was.
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
      const swap = () => {
        this.view = next;
        this.component = component;
      };
      const doc = document as ViewTransitionDoc;
      if (!doc.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        swap();
        await tick();
      } else {
        const html = document.documentElement;
        html.classList.add(PROJECTS_SWAPPING_CLASS);
        const t = doc.startViewTransition(async () => {
          swap();
          await tick();
        });
        await t.finished.catch(() => {});
        html.classList.remove(PROJECTS_SWAPPING_CLASS);
      }
    }

    // A ?view= link is a one-visit override; once the visitor chooses, drop it
    // with a real (replacing) navigation so Back returns to their pick. The
    // router is imported here only, as on the landing page.
    if (ask === this.#asked && new URLSearchParams(location.search).has('view')) {
      const { goto } = await import('$app/navigation');
      const url = new URL(location.href);
      url.searchParams.delete('view');
      await goto(url, { replaceState: true, noScroll: true, keepFocus: true });
    }
  };
}
