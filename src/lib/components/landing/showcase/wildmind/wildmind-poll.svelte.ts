// wildmind-poll.svelte.ts — keeps a Wildmind chapter current: polls
// /api/landing/wildmind while the map is on screen in a visible tab, and
// walks the people from where they were to where they are now.
//
// Lives in the lazy view chunks (never the home entry). The first answer is
// the one the server rendered, so nothing is fetched until a cadence has
// passed: ten seconds while live, half a minute while resting, paused or
// between lives, a minute while stale or offline (CADENCE). While a reader is
// handling the map or its chapter (a mouse moving on it, a press or a tap,
// keyboard focus or a key inside it: never a page merely scrolled under a
// resting pointer, or a swipe that scrolls) it polls every second while live,
// and more often in the other states too (ENGAGED), until a minute after the
// last such touch (ENGAGED_MS); a pointer resting over it after handling it
// stretches that to two minutes at most (HOVER_HOLD_MS), never for good.
// None at all off screen, in a hidden tab or while the reader asks it to hold
// still. A view mounted again with the page's answer it was first given (a
// reader switching views and back) polls as soon as that answer is a cadence
// old, not a cadence after the switch. A failed poll keeps what is drawn. The map paths come
// back only when the map changed (?have=); an offline answer after a good one
// keeps the last map and says it is stale. The server reads Wildmind at most
// about once a second however many people poll (wildmind.server.ts).
//
// The notes view polls with ?view=notes and gets its map pencilled and its
// words placed by the server (notes-sheet.server.ts); the place view polls
// with ?view=place and gets the model under glass (wildmind-glass.server.ts)
// in place of the map. Each view's drawing comes back only when it changed,
// as the map does. A view holding a drawing made for another kind (after the
// reader switches views) asks for its own at once.
//
// Motion: an answer that moves someone starts a glide from wherever each
// person is drawn now (mid-glide or not) to where the answer puts them, at
// an even pace over as long as their reported places took to change (never
// shorter than the cadence, at most a live cadence), plus half of whatever of
// the last glide is still to run (a backlog is caught up at no more than twice
// the pace). A glide that would end after the quick cadence lapses lasts until
// the first answer on the slower one, so they never stand waiting for it. An
// answer that moves nobody (Wildmind rounds places, so at the quick cadence
// most don't) leaves a running glide running, and walks anyone drawn short of
// it (held mid-glide) the rest of the way. So they never stand still between
// answers, and a change of cadence bends the path without a jump or a
// sprint. Back after a while away (off screen, a hidden tab, held) for more
// than two cadences, they are put where the answer says, not raced there. They walk their reported trail, so nobody is
// drawn crossing a lake they walked round; with no usable trail a short hop
// glides straight and a long one jumps, as everything does when the map moves
// under them (a new valley, or one seen from a new corner). Under
// prefers-reduced-motion the newest frame simply replaces the old. Off screen
// the glide lands and stops; held, it stops where it is.

import { onScreen, prefersReducedMotion } from '$lib/landing/showcase-motion';
import { grownOnly, type WildmindPerson, type WildmindShowcase, type WildmindState } from '$lib/landing/wildmind';

/** When each page answer was first shown by a view (a view mounted again with it knows its age). */
const FIRST_SHOWN = new WeakMap<object, number>();

/** How long to wait between polls in each state. */
export const CADENCE: Record<WildmindState, number> = {
  live: 10_000,
  resting: 30_000,
  paused: 30_000,
  'between-lives': 30_000,
  stale: 60_000,
  offline: 60_000,
};
/** How long to wait between polls while a reader is handling the map or its chapter. */
export const ENGAGED: Record<WildmindState, number> = {
  live: 1_000,
  resting: 5_000,
  paused: 5_000,
  'between-lives': 5_000,
  stale: 10_000,
  offline: 10_000,
};
/** How long the quicker cadence lasts after the reader last touched, pointed at or focused the map. */
export const ENGAGED_MS = 60_000;
/** The longest a pointer resting over the map after handling it keeps the quicker cadence, from the last handling. */
export const HOVER_HOLD_MS = 2 * ENGAGED_MS;
/**
 * The events that count as handling the map or its chapter: a mouse moving
 * on it (not within SCROLL_QUIET_MS of the page scrolling, when it is the page
 * that moved), a press with a mouse or pen, a tap finished (a swipe that
 * scrolls is cancelled instead), focus or a key inside it.
 */
export const ENGAGE_EVENTS = ['pointermove', 'pointerdown', 'pointerup', 'focusin', 'keydown'] as const;
/** A pointer move this soon after the page scrolled is the page moving under a resting pointer. */
export const SCROLL_QUIET_MS = 150;
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

export interface WildmindPollOptions {
  /** Where to poll; default /api/landing/wildmind. */
  url?: string;
  /** 'notes' for the notes view's drawing (pencilled map, placed words), 'place' for the model under glass; unset for the traced map. */
  view?: 'notes' | 'place';
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
  #engagedUntil = -Infinity;
  /** The pointer is over the map, and the reader has handled it since it came: engaged until it leaves, or HOVER_HOLD_MS after the last handling. */
  #hovering = false;
  #hoverHeld = false;
  #handledAt = -Infinity;
  /** Stopped polling a while (off screen, hidden, held): a first answer long after the last is put straight, not raced to. */
  #away = false;
  #acceptedAt: number;
  /** What was left of the glide when the reader held it still: carrying on walks it. */
  #heldLeft = 0;
  #scrolledAt = -Infinity;
  #destroyed = false;
  /** Where the running glide ends (the last answer's people), and when their places last changed. */
  #target: WildmindPerson[] = [];
  #changedAt: number;
  #glideEnds = 0;
  #view: 'notes' | 'place' | null;
  /** The people the running glide walks (their news replaced in place by an answer that moves nobody). */
  #glideNext: WildmindPerson[] = [];

  constructor(initial: WildmindShowcase | null, opts: WildmindPollOptions = {}) {
    this.#view = opts.view ?? null;
    // A drawing made for another kind of view is no drawing here: the first poll asks for this view's, straight away.
    const fits = !initial || initial.mapVersion == null || this.fits(initial);
    this.data = fits ? initial : initial && { ...initial, map: null, notes: null, glass: null };
    this.people = initial?.people ?? [];
    const base = opts.url ?? '/api/landing/wildmind';
    this.#url = this.#view ? `${base}?view=${this.#view}` : base;
    this.#fetch = opts.fetch ?? ((...a) => fetch(...a));
    this.#now = opts.now ?? (() => Date.now());
    this.#needMap = !fits;
    // An answer a view was given before (the page's, when a reader switches back) is as old as when it was first shown.
    const t = this.#now();
    const shown = initial ? FIRST_SHOWN.get(initial) : undefined;
    if (initial && shown == null) FIRST_SHOWN.set(initial, t);
    this.#last = fits ? (shown ?? t) : -Infinity;
    this.#target = this.people;
    this.#changedAt = shown ?? t;
    this.#acceptedAt = shown ?? t;
  }

  /**
   * Whether an answer carries this view's drawing: the pencilled map with its
   * sheet for the notes, the model for the place, the traced map for the others.
   */
  fits(w: Pick<WildmindShowcase, 'map' | 'notes' | 'glass'>): boolean {
    if (this.#view === 'notes') return !!w.map?.pencil && !!w.notes;
    if (this.#view === 'place') return !!w.glass;
    return !!w.map && !w.map.pencil;
  }

  /** This view's drawing in an answer, and its version: the model for the place, the map for the others. */
  #drawing(w: WildmindShowcase | null): { version: string } | null {
    if (!w) return null;
    return this.#view === 'place' ? (w.glass ?? null) : (w.map ?? null);
  }

  /** Whether a reader has handled the map or its chapter within the last ENGAGED_MS. */
  get engaged(): boolean {
    return this.#engagedAt(this.#now());
  }

  /** Whether the quicker cadence still applies at `t`, if nobody touches the map again. */
  #engagedAt(t: number): boolean {
    return t < this.#lapse();
  }

  /** When the quicker cadence lapses if nobody touches the map again. */
  #lapse(): number {
    const resting = this.#hovering && this.#hoverHeld ? this.#handledAt + HOVER_HOLD_MS : -Infinity;
    return Math.max(this.#engagedUntil, resting);
  }

  /** The current cadence (ms): quicker while a reader is handling the map. */
  get cadence(): number {
    const state = this.data?.state ?? 'offline';
    return (this.engaged ? ENGAGED : CADENCE)[state];
  }

  /**
   * A reader is handling the map or its chapter: poll at the quicker cadence
   * until ENGAGED_MS after the last call. Coming into it polls at once when a
   * quicker poll is already due; staying in it only moves the deadline on.
   */
  engage = () => {
    const was = this.engaged;
    this.#handledAt = this.#now();
    this.#engagedUntil = this.#handledAt + ENGAGED_MS;
    if (this.#hovering) this.#hoverHeld = true;
    if (!was && this.#timer) this.#schedule();
  };

  /** Whether an event is the reader handling the map, rather than the page moving under a still pointer. */
  #deliberate(e: Event): boolean {
    const p = e as Partial<PointerEvent>;
    if (e.type === 'pointermove') {
      if (p.pointerType && p.pointerType !== 'mouse' && p.pointerType !== 'pen') return false;
      if (p.movementX === 0 && p.movementY === 0) return false;
      return this.#now() - this.#scrolledAt > SCROLL_QUIET_MS;
    }
    // A touch counts once it is a tap (pointerup); its pointerdown may yet turn into a scroll.
    if (e.type === 'pointerdown') return p.pointerType !== 'touch';
    if (e.type === 'pointerup') return p.pointerType === 'touch';
    return true;
  }

  /**
   * An action for an element whose handling counts as engagement (a mouse
   * moving on it, a press, a tap, keyboard focus or a key inside it); the
   * quicker cadence then lasts while the pointer stays over it, and a minute
   * after it last did.
   *   <div use:poll.interact>
   */
  interact = (node: Element) => {
    const on = (e: Event) => {
      if (this.#deliberate(e)) this.engage();
    };
    const enter = (e: Event) => {
      if ((e as Partial<PointerEvent>).pointerType !== 'touch') this.#hovering = true;
    };
    const leave = () => {
      // A mouse taken off the map is handling it (a page scrolled from under a resting one is not), while still engaged.
      const now = this.#now();
      if (this.#hoverHeld && this.engaged && now - this.#scrolledAt > SCROLL_QUIET_MS) this.#engagedUntil = Math.max(this.#engagedUntil, now + ENGAGED_MS);
      this.#hovering = false;
      this.#hoverHeld = false;
    };
    const scrolled = () => (this.#scrolledAt = this.#now());
    for (const e of ENGAGE_EVENTS) node.addEventListener(e, on, { passive: true });
    node.addEventListener('pointerenter', enter, { passive: true });
    node.addEventListener('pointerleave', leave, { passive: true });
    if (typeof window !== 'undefined') window.addEventListener('scroll', scrolled, { passive: true, capture: true });
    return {
      destroy: () => {
        for (const e of ENGAGE_EVENTS) node.removeEventListener(e, on);
        node.removeEventListener('pointerenter', enter);
        node.removeEventListener('pointerleave', leave);
        if (typeof window !== 'undefined') window.removeEventListener('scroll', scrolled, { capture: true });
      },
    };
  };

  /**
   * An action for the element that holds the map: polls only while it is on
   * screen in a visible tab, quicker while a reader handles it (interact),
   * and stops for good when it is destroyed.
   *   <div use:poll.watch>
   */
  watch = (node: Element) => {
    const seen = onScreen(node, (v) => this.#setVisible(v));
    const handled = this.interact(node);
    return {
      destroy: () => {
        seen.destroy();
        handled.destroy();
        this.destroy();
      },
    };
  };

  /** Hold still (true): everyone stops where they are drawn; carry on (false), or toggle. Carrying on polls at once if one is due. */
  hold = (on: boolean = !this.held) => {
    if (on === this.held) return;
    this.held = on;
    if (on) {
      this.#clear();
      this.#heldLeft = this.#frame ? Math.max(0, this.#glideEnds - this.#now()) : 0;
      this.#stopGlide(false);
      this.#away = true;
    } else {
      // Walk the rest of the glide that was held, from where they stand, in the time it had left.
      const left = this.#heldLeft;
      this.#heldLeft = 0;
      if (left > 0) this.#glide(this.#glideNext, this.#routesTo(this.#glideNext, false), left, this.#now());
      this.#schedule();
    }
  };

  /** Stop everything for good (also called by watch's destroy): an answer still on its way is dropped. */
  destroy(): void {
    this.#destroyed = true;
    this.#visible = false;
    this.#clear();
    this.#stopGlide(true);
  }

  /** One poll now. Keeps what is drawn on any failure. */
  async poll(): Promise<void> {
    if (this.#inflight || this.#destroyed) return;
    this.#inflight = true;
    this.#last = this.#now();
    try {
      const have = !this.#needMap && this.#drawing(this.data) ? this.data!.mapVersion : null;
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

  /** Take a new answer: keep the held drawing when it is left out, and move the people. */
  accept(next: WildmindShowcase): void {
    if (this.#destroyed || this.held || !next || typeof next !== 'object' || !next.state) return;
    // An answer drawn for another kind of view (it should not happen) is not drawn here.
    if ((next.map || next.glass) && !this.fits(next)) return;
    const prev = this.data;
    const had = this.#drawing(prev);
    let merged: WildmindShowcase;
    if (next.state === 'offline' && had) {
      // Silent after a good answer: keep the last picture and say so.
      merged = { ...prev!, state: 'stale' };
    } else if (!this.#drawing(next) && had && next.mapVersion === prev!.mapVersion) {
      merged = this.#view === 'place' ? { ...next, glass: prev!.glass } : { ...next, map: prev!.map };
    } else {
      merged = next;
      // The server left the drawing out for a version this page does not hold: ask in full next time.
      this.#needMap = !this.#drawing(next) && next.mapVersion !== null;
    }
    const now = this.#drawing(merged);
    if (now) this.#needMap = false;
    // A new drawing moves the ground under them unless it is the same valley, grown, in the same frame.
    const moved = !!had && !!now && now.version !== had.version && !(grownOnly(had.version, now.version) && !!prev?.frame && prev.frame === merged.frame);
    // Back after a while away: whatever they did meanwhile is not raced through.
    const t = this.#now();
    const away = this.#away && t - this.#acceptedAt > 2 * CADENCE[merged.state];
    this.#away = false;
    this.#acceptedAt = t;
    this.data = merged;
    this.#move(merged.people, moved || away);
  }

  /** The people `t` ms into a glide of `ms` along `routes` (linear: an even pace the whole way). */
  static at(next: WildmindPerson[], routes: Array<Pt[] | null>, t: number, ms: number): WildmindPerson[] {
    const f = ms > 0 ? Math.min(1, Math.max(0, t / ms)) : 1;
    return next.map((p, i) => {
      const r = routes[i];
      if (!r || f >= 1) return p;
      const at = along(r, f);
      return { ...p, x: Math.round(at.x * 100) / 100, y: Math.round(at.y * 100) / 100, heading: at.heading };
    });
  }

  /** Whether an answer puts everyone where the last one did (the running glide's end). */
  #same(next: WildmindPerson[]): boolean {
    const was = this.#target;
    return next.length === was.length && next.every((p, i) => p.id === was[i].id && p.x === was[i].x && p.y === was[i].y && p.alive === was[i].alive);
  }

  /** Whether everyone is drawn where `next` puts them. */
  #drawnAt(next: WildmindPerson[]): boolean {
    const drawn = new Map(this.people.map((p) => [p.id, p]));
    return next.every((p) => {
      const d = drawn.get(p.id);
      return !d || (Math.abs(d.x - p.x) < 0.01 && Math.abs(d.y - p.y) < 0.01);
    });
  }

  /** Each person's way from where they are drawn now to where `next` puts them (null: put straight there). */
  #routesTo(next: WildmindPerson[], jump: boolean): Array<Pt[] | null> {
    const from = new Map(this.people.map((p) => [p.id, [p.x, p.y] as Pt]));
    return next.map((p) => {
      const f = from.get(p.id);
      return f && !jump && p.alive ? route(f, p) : null;
    });
  }

  #move(next: WildmindPerson[], jump: boolean): void {
    const t0 = this.#now();
    const same = !jump && this.#same(next);
    if (same && (this.#frame !== 0 || this.#drawnAt(next))) {
      // Nobody moved: the glide runs on to where it was going, and the rest of the news is taken where they stand.
      const drawn = new Map(this.people.map((p) => [p.id, p]));
      this.#target = next;
      this.#glideNext = next;
      this.people = next.map((p) => {
        const d = drawn.get(p.id);
        return d ? { ...p, x: d.x, y: d.y, heading: d.heading } : p;
      });
      return;
    }
    // As long as their places took to change (at least a cadence, at most a live one), plus half what is left of the
    // last glide (a backlog caught up at no more than twice the pace). Nobody drawn short of an unchanged answer
    // (a glide cut off) changed place since: they walk the rest at the same reckoning.
    const cad = this.cadence;
    const since = Math.min(Math.max(t0 - this.#changedAt, cad), Math.max(cad, CADENCE.live));
    const left = this.#frame ? Math.max(0, this.#glideEnds - t0) : 0;
    let ms = since + left / 2;
    // Ending after the quicker cadence lapses: last until the first answer on the slower one, never standing to wait for it.
    if (this.#engagedAt(t0) && !this.#engagedAt(t0 + ms)) ms = Math.max(ms, this.#lapse() - t0 + CADENCE[this.data?.state ?? 'offline']);
    this.#target = next;
    if (!same) this.#changedAt = t0;
    // From where each person is drawn now, mid-glide or not, so a new answer never jumps anyone.
    const routes = this.#routesTo(next, jump);
    this.#stopGlide(false);
    this.#glide(next, routes, ms, t0);
  }

  /** Walk everyone along `routes` to `next` over `ms` from `start` (or put them there, when nothing can or need move). */
  #glide(next: WildmindPerson[], routes: Array<Pt[] | null>, ms: number, start: number): void {
    this.#glideNext = next;
    if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function' || routes.every((r) => !r)) {
      this.people = next;
      return;
    }
    this.#glideEnds = start + ms;
    // The answer's other news (what they are doing, who is alive) at once, where they stand now.
    this.people = WildmindPoll.at(next, routes, 0, ms);
    const step = () => {
      const t = this.#now() - start;
      const drawn = WildmindPoll.at(this.#glideNext, routes, t, ms);
      // Only when someone has moved a drawn step: a slow walk redraws a few times a second, not every frame.
      const moved = drawn.some((p, i) => p.x !== this.people[i]?.x || p.y !== this.people[i]?.y);
      if (moved || t >= ms) this.people = drawn;
      this.#frame = t < ms ? requestAnimationFrame(step) : 0;
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
    else {
      this.#clear();
      this.#away = true;
      // Nobody watches a glide off screen: land it, and the next answer starts from there.
      this.#stopGlide(true);
    }
  }

  #clear(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  #schedule(): void {
    this.#clear();
    if (this.#destroyed || !this.#visible || this.held || this.#inflight) return;
    const wait = Math.max(0, this.cadence - (this.#now() - this.#last));
    this.#timer = setTimeout(() => void this.poll(), wait);
  }
}
