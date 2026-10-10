// wildmind-poll.svelte.ts — keeps a Wildmind chapter current: polls
// /api/landing/wildmind while the map is on screen in a visible tab, and
// walks the people from where they were to where they are now.
//
// Lives in the lazy view chunks (never the home entry). The first answer is
// the one the server rendered, so nothing is fetched until a cadence has
// passed: thirty seconds while live, a minute while resting, paused or between
// lives, two while stale or offline, none at all off screen, in a hidden tab
// or while the reader asks it to hold still. A failed poll keeps what is
// drawn. The map paths come back only when the map changed (?have=); an
// offline answer after a good one keeps the last map and says it is stale.
//
// The notes view polls with ?view=notes and gets its map pencilled and its
// words placed by the server (notes-sheet.server.ts). A view holding a map
// drawn for the other kind (after the reader switches views) asks for its
// own at once.
//
// Motion: each person glides along their reported trail over about two
// seconds (eased out), so nobody is drawn crossing a lake they walked round.
// With no usable trail a short hop glides straight and a long one jumps.
// Under prefers-reduced-motion the newest frame simply replaces the old.

import { onScreen, prefersReducedMotion } from '$lib/landing/showcase-motion';
import type { WildmindPerson, WildmindShowcase, WildmindState } from '$lib/landing/wildmind';

/** How long to wait between polls in each state. */
export const CADENCE: Record<WildmindState, number> = {
  live: 30_000,
  resting: 60_000,
  paused: 60_000,
  'between-lives': 60_000,
  stale: 120_000,
  offline: 120_000,
};
/** How long a glide takes. */
export const GLIDE_MS = 2000;
/** The longest straight hop (map units) that glides without a trail; longer ones jump. */
export const HOP = 3;

type Pt = [number, number];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * The way from `from` to `p`: along the trail after the point nearest `from`
 * when the trail passes close by, straight when the hop is short, else null (jump).
 */
export function route(from: Pt, p: Pick<WildmindPerson, 'x' | 'y' | 'trail'>): Pt[] | null {
  const to: Pt = [p.x, p.y];
  if (dist(from, to) < 0.01) return null;
  let k = -1;
  let best = Infinity;
  p.trail.forEach((t, i) => {
    const d = dist(from, t);
    if (d <= best) {
      best = d;
      k = i;
    }
  });
  if (k >= 0 && best <= HOP) return [from, ...p.trail.slice(k + 1), to];
  return dist(from, to) <= HOP ? [from, to] : null;
}

/** The point a fraction `f` (0–1) of the way along a polyline, and the heading there. */
export function along(pts: Pt[], f: number): { x: number; y: number; heading: number } {
  const lens = pts.slice(1).map((q, i) => dist(pts[i], q));
  const total = lens.reduce((s, l) => s + l, 0);
  let left = Math.max(0, Math.min(1, f)) * total;
  for (let i = 0; i < lens.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    if (left <= lens[i] || i === lens.length - 1) {
      const t = lens[i] > 0 ? Math.min(1, left / lens[i]) : 1;
      return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, heading: Math.atan2(bx - ax, by - ay) };
    }
    left -= lens[i];
  }
  const [x, y] = pts[pts.length - 1];
  return { x, y, heading: 0 };
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

export interface WildmindPollOptions {
  /** Where to poll; default /api/landing/wildmind. */
  url?: string;
  /** 'notes' for the notes view's drawing (pencilled map, placed words); unset for the traced map. */
  view?: 'notes';
  /** Injectable for tests. */
  fetch?: typeof fetch;
  now?: () => number;
}

export class WildmindPoll {
  /** The latest answer, with the last map kept across answers that leave it out. */
  data = $state<WildmindShowcase | null>(null);
  /** The people where they are drawn right now (between answers, mid-glide). */
  people = $state<WildmindPerson[]>([]);
  /** The reader asked it to hold still: no polls, no glides. */
  held = $state(false);

  #url: string;
  #fetch: typeof fetch;
  #now: () => number;
  #visible = false;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #last: number;
  #frame = 0;
  #inflight = false;
  #needMap = false;
  #notes: boolean;

  constructor(initial: WildmindShowcase | null, opts: WildmindPollOptions = {}) {
    this.#notes = opts.view === 'notes';
    // A map drawn for the other kind of view is no map here: the first poll asks for this view's, straight away.
    const fits = !initial?.map || this.fits(initial);
    this.data = fits ? initial : initial && { ...initial, map: null, notes: null };
    this.people = initial?.people ?? [];
    const base = opts.url ?? '/api/landing/wildmind';
    this.#url = this.#notes ? `${base}?view=notes` : base;
    this.#fetch = opts.fetch ?? ((...a) => fetch(...a));
    this.#now = opts.now ?? (() => Date.now());
    this.#needMap = !fits;
    this.#last = fits ? this.#now() : -Infinity;
  }

  /** Whether an answer's map is drawn for this view: pencilled with its sheet for the notes, traced for the others. */
  fits(w: Pick<WildmindShowcase, 'map' | 'notes'>): boolean {
    return this.#notes ? !!w.map?.pencil && !!w.notes : !w.map?.pencil;
  }

  /** The current cadence (ms). */
  get cadence(): number {
    return CADENCE[this.data?.state ?? 'offline'];
  }

  /**
   * An action for the element that holds the map: polls only while it is on
   * screen in a visible tab, and stops for good when it is destroyed.
   *   <div use:poll.watch>
   */
  watch = (node: Element) => {
    const seen = onScreen(node, (v) => this.#setVisible(v));
    return {
      destroy: () => {
        seen.destroy();
        this.destroy();
      },
    };
  };

  /** Hold still (true), carry on (false), or toggle. Carrying on polls at once if one is due. */
  hold = (on: boolean = !this.held) => {
    this.held = on;
    if (on) {
      this.#clear();
      this.#stopGlide(true);
    } else this.#schedule();
  };

  /** Stop everything (also called by watch's destroy). */
  destroy(): void {
    this.#visible = false;
    this.#clear();
    this.#stopGlide(true);
  }

  /** One poll now. Keeps what is drawn on any failure. */
  async poll(): Promise<void> {
    if (this.#inflight) return;
    this.#inflight = true;
    this.#last = this.#now();
    try {
      const have = !this.#needMap && this.data?.map ? this.data.mapVersion : null;
      const url = have ? `${this.#url}${this.#url.includes('?') ? '&' : '?'}have=${encodeURIComponent(have)}` : this.#url;
      // no-cache: the route's max-age lets a browser answer a poll from its own
      // copy of the last one (and revalidate behind it, a second request);
      // the server's memo already coalesces, so every poll asks it afresh.
      const r = await this.#fetch(url, { cache: 'no-cache', headers: { accept: 'application/json' } });
      if (r.ok) this.accept((await r.json()) as WildmindShowcase);
    } catch {
      /* keep last-known; the landing page never errors on a reading */
    } finally {
      this.#inflight = false;
      this.#schedule();
    }
  }

  /** Take a new answer: keep the held map when it is left out, and move the people. */
  accept(next: WildmindShowcase): void {
    if (this.held || !next || typeof next !== 'object' || !next.state) return;
    // An answer drawn for another kind of view (it should not happen) is not drawn here.
    if (next.map && !this.fits(next)) return;
    const prev = this.data;
    let merged: WildmindShowcase;
    if (next.state === 'offline' && prev?.map) {
      // Silent after a good answer: keep the last picture and say so.
      merged = { ...prev, state: 'stale' };
    } else if (!next.map && prev?.map && next.mapVersion === prev.mapVersion) {
      merged = { ...next, map: prev.map };
    } else {
      merged = next;
      // The server left the map out for a version this page does not hold: ask in full next time.
      this.#needMap = !next.map && next.mapVersion !== null;
    }
    if (merged.map) this.#needMap = false;
    const mapChanged = !!prev?.map && merged.map?.version !== prev.map.version;
    this.data = merged;
    this.#move(merged.people, mapChanged);
  }

  #move(next: WildmindPerson[], jump: boolean): void {
    this.#stopGlide(false);
    const from = new Map(this.people.map((p) => [p.id, [p.x, p.y] as Pt]));
    const routes = next.map((p) => {
      const f = from.get(p.id);
      return f && !jump && p.alive ? route(f, p) : null;
    });
    if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function' || routes.every((r) => !r)) {
      this.people = next;
      return;
    }
    const start = this.#now();
    const step = () => {
      const t = Math.min(1, (this.#now() - start) / GLIDE_MS);
      const e = easeOut(t);
      this.people = next.map((p, i) => {
        const r = routes[i];
        if (!r || t >= 1) return p;
        const at = along(r, e);
        return { ...p, x: Math.round(at.x * 100) / 100, y: Math.round(at.y * 100) / 100, heading: at.heading };
      });
      this.#frame = t < 1 ? requestAnimationFrame(step) : 0;
    };
    this.#frame = requestAnimationFrame(step);
  }

  #stopGlide(land: boolean): void {
    if (this.#frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    if (land && this.data) this.people = this.data.people;
  }

  #setVisible(v: boolean): void {
    this.#visible = v;
    if (v) this.#schedule();
    else this.#clear();
  }

  #clear(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  #schedule(): void {
    this.#clear();
    if (!this.#visible || this.held || this.#inflight) return;
    const wait = Math.max(0, this.cadence - (this.#now() - this.#last));
    this.#timer = setTimeout(() => void this.poll(), wait);
  }
}
