import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import WildmindMap from './WildmindMap.svelte';
import HoldStill from './HoldStill.svelte';
import { CADENCE, ENGAGED, ENGAGED_MS, WildmindPoll, along, route } from './wildmind-poll.svelte';
import { fixtureGlass, wildmindFixture } from '$lib/landing/wildmind.fixture';
import { offlineShowcase, type WildmindShowcase } from '$lib/landing/wildmind';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const live = () => wildmindFixture(NOW);
/** Something the actions can listen on, outside a browser. */
const el = () => new EventTarget() as unknown as Element;

describe('WildmindMap', () => {
  it('draws the traced ground, the markers and the night wash, hidden from assistive tech', () => {
    const w = live();
    const { body } = render(WildmindMap, {
      props: { map: w.map, id: 'ss-wm', people: w.people, animals: w.animals, structures: w.structures, fires: w.fires, species: w.species, night: 0.5 },
    });
    expect(body).toMatch(/<svg[^>]*viewBox="0 0 141 93"[^>]*aria-hidden="true"/);
    expect(body).toContain('aspect-ratio: 141 / 93');
    for (const l of w.map!.layers) expect(body).toContain(`data-cls="${l.cls}"`);
    expect(body).toContain('class="wm-seen ');
    expect(body).toContain('class="wm-relief ');
    expect(body).toContain('class="wm-night ');
    expect(body).toContain('data-who="main"');
    expect(body).toContain('data-who="companion"');
    expect(body).toContain('data-species="wolf"');
    expect((body.match(/class="wm-built /g) ?? []).length).toBe(w.structures.length);
    // No words inside the drawing, ever.
    expect(body).not.toMatch(/<text|<tspan/);
    for (const l of w.map!.labels) expect(body).not.toContain(l.name);
  });

  it('places HTML labels over the frame by percentage', () => {
    const w = live();
    const overlay = createRawSnippet((o: () => { map: NonNullable<WildmindShowcase['map']>; place: (x: number, y: number) => string }) => ({
      render: () => `<span style="${o().place(o().map.w / 2, o().map.h)}">${o().map.labels[0].name}</span>`,
    }));
    const { body } = render(WildmindMap, { props: { map: w.map, id: 'sn-wm', overlay } });
    expect(body).toContain('<div class="wm-over');
    expect(body).toContain('left:50%;top:100%');
    expect(body).toContain('Mirror Mere');
  });

  it('prefixes pattern fills with its own instance id', () => {
    const w = live();
    const defs = createRawSnippet((l: () => { uid: string }) => ({ render: () => `<pattern id="${l().uid}-hatch"></pattern>` }));
    const { body } = render(WildmindMap, { props: { map: w.map, id: 'ss-wm', patterns: { wood: 'hatch' }, defs } });
    const id = /<pattern id="(ss-wm-[^"]+-hatch)"/.exec(body)?.[1];
    expect(id).toBeTruthy();
    expect(body).toContain(`fill: url(#${id})`);
  });

  it('draws the empty snippet in a frame when there is no map', () => {
    const empty = createRawSnippet(() => ({ render: () => '<p>no map</p>' }));
    const { body } = render(WildmindMap, { props: { map: null, id: 'ss-wm', empty } });
    expect(body).toContain('data-empty=""');
    expect(body).toContain('<p>no map</p>');
    expect(body).not.toContain('<svg');
  });

  it('draws a dead person as a ring with no heading', () => {
    const w = wildmindFixture(NOW, 'between-lives');
    const { body } = render(WildmindMap, { props: { map: w.map, id: 'ss-wm', people: w.people } });
    expect(body).toMatch(/data-who="main" data-alive="no"/);
    expect((body.match(/class="wm-tick /g) ?? []).length).toBe(1);
  });
});

describe('HoldStill', () => {
  it('says what pressing it does', () => {
    const go = render(HoldStill, { props: { held: false, onhold: () => {} } }).body;
    const stop = render(HoldStill, { props: { held: true, onhold: () => {}, controls: 'ss-wm-map' } }).body;
    expect(go).toContain('hold still');
    expect(stop).toContain('carry on');
    expect(stop).toContain('aria-controls="ss-wm-map"');
    expect(go).toContain('type="button"');
  });
});

describe('route and along', () => {
  const p = (x: number, y: number, trail: Array<[number, number]>) => ({ x, y, trail });

  it('follows the trail from the point nearest where they were', () => {
    expect(route([0, 0], p(3, 3, [[-5, -5], [0, 0.5], [3, 0], [3, 3]]))).toEqual([[0, 0], [3, 0], [3, 3], [3, 3]]);
  });
  it('glides a short hop straight and jumps a long one', () => {
    expect(route([0, 0], p(2, 0, []))).toEqual([[0, 0], [2, 0]]);
    expect(route([0, 0], p(20, 0, []))).toBeNull();
    expect(route([0, 0], p(0, 0, []))).toBeNull();
  });
  it('measures along the polyline', () => {
    const pts: Array<[number, number]> = [[0, 0], [4, 0], [4, 4]];
    expect(along(pts, 0)).toMatchObject({ x: 0, y: 0 });
    expect(along(pts, 0.5)).toMatchObject({ x: 4, y: 0 });
    expect(along(pts, 0.75)).toMatchObject({ x: 4, y: 2, heading: 0 });
    expect(along(pts, 1)).toMatchObject({ x: 4, y: 4 });
  });
});

describe('WildmindPoll', () => {
  afterEach(() => vi.useRealTimers());

  const answer = (w: WildmindShowcase) => new Response(JSON.stringify(w), { headers: { 'content-type': 'application/json' } });

  it('keeps the map when the answer leaves it out, and swaps it when the version changes', () => {
    const first = live();
    const poll = new WildmindPoll(first);
    poll.accept({ ...first, map: null, day: 17 });
    expect(poll.data?.map).toBe(first.map);
    expect(poll.data?.day).toBe(17);
    const next = { ...first, map: { ...first.map!, version: 'v2' }, mapVersion: 'v2' };
    poll.accept(next);
    expect(poll.data?.map?.version).toBe('v2');
  });

  it('says stale and keeps the last picture when Wildmind goes quiet', () => {
    const first = live();
    const poll = new WildmindPoll(first);
    poll.accept(offlineShowcase());
    expect(poll.data?.state).toBe('stale');
    expect(poll.data?.map).toBe(first.map);
    expect(poll.data?.day).toBe(first.day);
  });

  it('moves the people to the newest frame when it cannot animate', () => {
    const first = live();
    const poll = new WildmindPoll(first);
    const moved = { ...first, people: first.people.map((p) => ({ ...p, x: p.x + 1 })) };
    poll.accept(moved);
    expect(poll.people.map((p) => p.x)).toEqual(moved.people.map((p) => p.x));
  });

  it('polls on its cadence while on screen, with ?have=, and keeps the picture on failure', async () => {
    vi.useFakeTimers();
    let t = NOW;
    const first = live();
    const fetcher = vi.fn(async (_url: string) => answer({ ...first, map: null }));
    const poll = new WildmindPoll(first, { fetch: fetcher as unknown as typeof fetch, now: () => t });
    const watch = poll.watch(el());
    expect(fetcher).not.toHaveBeenCalled();
    t += CADENCE.live;
    await vi.advanceTimersByTimeAsync(CADENCE.live);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toBe(`/api/landing/wildmind?have=${encodeURIComponent(first.mapVersion!)}`);
    // Never answered from the browser's own cache of the last poll.
    expect((fetcher.mock.calls[0] as unknown[])[1]).toMatchObject({ cache: 'no-cache' });
    expect(poll.data?.map).toBe(first.map);

    fetcher.mockImplementationOnce(async () => {
      throw new Error('offline');
    });
    t += CADENCE.live;
    await vi.advanceTimersByTimeAsync(CADENCE.live);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(poll.data?.map).toBe(first.map);

    poll.hold(true);
    t += CADENCE.live * 4;
    await vi.advanceTimersByTimeAsync(CADENCE.live * 4);
    expect(fetcher).toHaveBeenCalledTimes(2);
    poll.hold(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(3);

    watch.destroy();
    t += CADENCE.live * 4;
    await vi.advanceTimersByTimeAsync(CADENCE.live * 4);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  describe('for the notes view', () => {
    const notes = (w: WildmindShowcase): WildmindShowcase => ({
      ...w,
      map: w.map && { ...w.map, pencil: true },
      notes: { words: null, camp: '', camps: 0, huts: 0, mark: 1 },
    });

    it('asks with ?view=notes and keeps its pencilled map, taking the fresh words', async () => {
      vi.useFakeTimers();
      let t = NOW;
      const first = notes(live());
      const fresh = { ...first.notes!, huts: 3 };
      const fetcher = vi.fn(async (_url: string) => answer({ ...first, map: null, notes: fresh }));
      const poll = new WildmindPoll(first, { view: 'notes', fetch: fetcher as unknown as typeof fetch, now: () => t });
      const watch = poll.watch(el());
      t += CADENCE.live;
      await vi.advanceTimersByTimeAsync(CADENCE.live);
      expect(String(fetcher.mock.calls[0][0])).toBe(`/api/landing/wildmind?view=notes&have=${encodeURIComponent(first.mapVersion!)}`);
      expect(poll.data?.map).toBe(first.map);
      expect(poll.data?.notes?.huts).toBe(3);
      watch.destroy();
    });

    it('asks for its own map at once when it starts with one drawn for another view', async () => {
      vi.useFakeTimers();
      const traced = live();
      const fetcher = vi.fn(async (_url: string) => answer(notes(traced)));
      const poll = new WildmindPoll(traced, { view: 'notes', fetch: fetcher as unknown as typeof fetch, now: () => NOW });
      // Until then it draws no map rather than the wrong one.
      expect(poll.data?.map).toBeNull();
      const watch = poll.watch(el());
      await vi.advanceTimersByTimeAsync(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(String(fetcher.mock.calls[0][0])).toBe('/api/landing/wildmind?view=notes');
      expect(poll.data?.map?.pencil).toBe(true);
      watch.destroy();
    });

    it('lets the other views refuse a pencilled map and ask again in full', async () => {
      vi.useFakeTimers();
      const drawn = notes(live());
      const fetcher = vi.fn(async (_url: string) => answer(live()));
      const poll = new WildmindPoll(drawn, { fetch: fetcher as unknown as typeof fetch, now: () => NOW });
      expect(poll.data?.map).toBeNull();
      const watch = poll.watch(el());
      await vi.advanceTimersByTimeAsync(0);
      expect(String(fetcher.mock.calls[0][0])).toBe('/api/landing/wildmind');
      expect(poll.data?.map?.pencil).toBeUndefined();
      expect(poll.data?.map?.layers.length).toBeGreaterThan(0);
      watch.destroy();
    });
  });

  describe('for the place view', () => {
    const place = (w: WildmindShowcase): WildmindShowcase => ({ ...w, map: null, glass: fixtureGlass() });

    it('asks with ?view=place, keeps its model across answers that leave it out, and swaps it for a new version', async () => {
      vi.useFakeTimers();
      let t = NOW;
      const first = place(live());
      const fetcher = vi.fn(async (_url: string) => answer({ ...first, glass: null, day: 19 }));
      const poll = new WildmindPoll(first, { view: 'place', fetch: fetcher as unknown as typeof fetch, now: () => t });
      const watch = poll.watch(el());
      expect(fetcher).not.toHaveBeenCalled();
      t += CADENCE.live;
      await vi.advanceTimersByTimeAsync(CADENCE.live);
      expect(String(fetcher.mock.calls[0][0])).toBe(`/api/landing/wildmind?view=place&have=${encodeURIComponent(first.mapVersion!)}`);
      expect(poll.data?.glass).toBe(first.glass);
      expect(poll.data?.day).toBe(19);
      const grown = { ...first.glass!, version: 'v2' };
      poll.accept({ ...first, mapVersion: 'v2', glass: grown });
      expect(poll.data?.glass).toBe(grown);
      watch.destroy();
    });

    it('keeps the last model and says stale when Wildmind goes quiet', () => {
      const first = place(live());
      const poll = new WildmindPoll(first, { view: 'place' });
      poll.accept(offlineShowcase());
      expect(poll.data?.state).toBe('stale');
      expect(poll.data?.glass).toBe(first.glass);
    });

    it('asks for its model at once when it starts with an answer drawn for another view, and the others refuse its answer', async () => {
      vi.useFakeTimers();
      const fetcher = vi.fn(async (_url: string) => answer(place(live())));
      const poll = new WildmindPoll(live(), { view: 'place', fetch: fetcher as unknown as typeof fetch, now: () => NOW });
      expect(poll.data?.map).toBeNull();
      expect(poll.data?.glass ?? null).toBeNull();
      const watch = poll.watch(el());
      await vi.advanceTimersByTimeAsync(0);
      expect(String(fetcher.mock.calls[0][0])).toBe('/api/landing/wildmind?view=place');
      expect(poll.data?.glass?.cards.length).toBeGreaterThan(2);
      watch.destroy();
      // A view that draws the map, handed the place's answer, asks for its map at once.
      const traced = vi.fn(async (_url: string) => answer(live()));
      const sentence = new WildmindPoll(place(live()), { fetch: traced as unknown as typeof fetch, now: () => NOW });
      const w2 = sentence.watch(el());
      await vi.advanceTimersByTimeAsync(0);
      expect(String(traced.mock.calls[0][0])).toBe('/api/landing/wildmind');
      expect(sentence.data?.map?.layers.length).toBeGreaterThan(0);
      w2.destroy();
    });
  });

  it('waits longer when the valley is resting or not answering', () => {
    expect(new WildmindPoll({ ...live(), state: 'resting' }).cadence).toBe(30_000);
    expect(new WildmindPoll(offlineShowcase()).cadence).toBe(60_000);
    expect(new WildmindPoll(live()).cadence).toBe(10_000);
  });

  describe('while a reader handles the map', () => {
    it('polls every second from the first touch until a minute after the last, then every ten', async () => {
      vi.useFakeTimers();
      let t = NOW;
      const first = live();
      const fetcher = vi.fn(async (_url: string) => answer({ ...first, map: null }));
      const poll = new WildmindPoll(first, { fetch: fetcher as unknown as typeof fetch, now: () => t });
      const node = el();
      const watch = poll.watch(node);
      expect(poll.cadence).toBe(CADENCE.live);
      expect(ENGAGED.live).toBe(1_000);

      // A pointer moving over the map, three seconds in: a quicker poll is already due, so it asks at once.
      t += 3_000;
      await vi.advanceTimersByTimeAsync(3_000);
      expect(fetcher).not.toHaveBeenCalled();
      node.dispatchEvent(new Event('pointermove'));
      expect(poll.engaged).toBe(true);
      expect(poll.cadence).toBe(ENGAGED.live);
      await vi.advanceTimersByTimeAsync(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
      // The map is never sent again on the quick cadence.
      expect(String(fetcher.mock.calls[0][0])).toContain(`have=${encodeURIComponent(first.mapVersion!)}`);

      // Then once a second.
      for (let i = 0; i < 5; i++) {
        t += 1_000;
        await vi.advanceTimersByTimeAsync(1_000);
      }
      expect(fetcher).toHaveBeenCalledTimes(6);

      // Focus or a touch keeps it going; each moves the minute on.
      node.dispatchEvent(new Event('focusin'));
      const touched = t;
      while (t < touched + ENGAGED_MS - 1_000) {
        t += 1_000;
        await vi.advanceTimersByTimeAsync(1_000);
      }
      expect(poll.engaged).toBe(true);
      const quick = fetcher.mock.calls.length;
      expect(quick).toBeGreaterThanOrEqual(6 + ENGAGED_MS / 1_000 - 2);

      // A minute after the last, back to every ten seconds.
      t += 2_000;
      await vi.advanceTimersByTimeAsync(2_000);
      expect(poll.engaged).toBe(false);
      const settled = fetcher.mock.calls.length;
      t += CADENCE.live - 1;
      await vi.advanceTimersByTimeAsync(CADENCE.live - 1);
      expect(fetcher.mock.calls.length).toBeLessThanOrEqual(settled + 1);
      t += CADENCE.live;
      await vi.advanceTimersByTimeAsync(CADENCE.live);
      expect(fetcher.mock.calls.length).toBeLessThanOrEqual(settled + 2);
      watch.destroy();

      // Gone: handling the old element does nothing.
      node.dispatchEvent(new Event('pointerenter'));
      t += 5_000;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(fetcher.mock.calls.length).toBeLessThanOrEqual(settled + 2);
    });

    it('still stops off screen, in a hidden tab and while held, however busy the reader', async () => {
      vi.useFakeTimers();
      let seen: ((e: Array<{ isIntersecting: boolean }>) => void) | null = null;
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          constructor(cb: (e: Array<{ isIntersecting: boolean }>) => void) {
            seen = cb;
          }
          observe() {}
          disconnect() {}
        },
      );
      let t = NOW;
      const first = live();
      const fetcher = vi.fn(async (_url: string) => answer({ ...first, map: null }));
      const poll = new WildmindPoll(first, { fetch: fetcher as unknown as typeof fetch, now: () => t });
      const node = el();
      const watch = poll.watch(node);
      seen!([{ isIntersecting: true }]);
      t += 2_000;
      node.dispatchEvent(new Event('touchstart'));
      await vi.advanceTimersByTimeAsync(0);
      expect(fetcher).toHaveBeenCalledTimes(1);

      seen!([{ isIntersecting: false }]);
      for (let i = 0; i < 5; i++) {
        node.dispatchEvent(new Event('pointermove'));
        t += 1_000;
        await vi.advanceTimersByTimeAsync(1_000);
      }
      expect(fetcher).toHaveBeenCalledTimes(1);

      seen!([{ isIntersecting: true }]);
      await vi.advanceTimersByTimeAsync(0);
      expect(fetcher).toHaveBeenCalledTimes(2);
      poll.hold(true);
      for (let i = 0; i < 5; i++) {
        node.dispatchEvent(new Event('keydown'));
        t += 1_000;
        await vi.advanceTimersByTimeAsync(1_000);
      }
      expect(fetcher).toHaveBeenCalledTimes(2);
      watch.destroy();
      vi.unstubAllGlobals();
    });
  });

  describe('the glide', () => {
    let frames: FrameRequestCallback[] = [];
    const flush = () => frames.splice(0).forEach((cb) => cb(0));
    const step = (p: WildmindShowcase['people'][number], dx: number) => ({ ...p, x: p.x + dx, trail: [] });
    afterEach(() => vi.unstubAllGlobals());
    const animate = () => {
      frames = [];
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
      vi.stubGlobal('cancelAnimationFrame', () => (frames = []));
    };

    it('walks at an even pace over the whole wait for the next answer, and never stands still between', () => {
      animate();
      let t = NOW;
      const first = live();
      const poll = new WildmindPoll(first, { now: () => t });
      const x0 = poll.people[0].x;
      poll.accept({ ...first, map: null, people: first.people.map((p) => step(p, 2)) });
      flush();
      expect(poll.people[0].x).toBeCloseTo(x0, 2);
      t += CADENCE.live / 4;
      flush();
      expect(poll.people[0].x).toBeCloseTo(x0 + 0.5, 2);
      t += CADENCE.live / 4;
      flush();
      expect(poll.people[0].x).toBeCloseTo(x0 + 1, 2);
      t += CADENCE.live / 2;
      flush();
      expect(poll.people[0].x).toBeCloseTo(x0 + 2, 2);
      expect(frames).toHaveLength(0);
    });

    it('bends into the quick cadence from where everyone is drawn, without a jump', () => {
      animate();
      let t = NOW;
      const first = live();
      const poll = new WildmindPoll(first, { now: () => t });
      const x0 = poll.people[0].x;
      poll.accept({ ...first, map: null, people: first.people.map((p) => step(p, 2)) });
      t += CADENCE.live / 2;
      flush();
      const mid = poll.people[0].x;
      expect(mid).toBeCloseTo(x0 + 1, 2);

      // The reader puts a pointer on the map; the next answer comes a second later on the quick cadence.
      poll.engage();
      poll.accept({ ...first, map: null, people: first.people.map((p) => step(p, 2.4)) });
      expect(poll.people[0].x).toBeCloseTo(mid, 2);
      flush();
      expect(poll.people[0].x).toBeCloseTo(mid, 2);
      t += ENGAGED.live / 2;
      flush();
      expect(poll.people[0].x).toBeCloseTo((mid + x0 + 2.4) / 2, 2);
      t += ENGAGED.live / 2;
      flush();
      expect(poll.people[0].x).toBeCloseTo(x0 + 2.4, 2);
    });

    it('takes the answer’s other news at once, mid-glide', () => {
      animate();
      const first = live();
      const poll = new WildmindPoll(first, { now: () => NOW });
      poll.accept({ ...first, map: null, people: first.people.map((p) => ({ ...step(p, 1), doing: 'talking' })) });
      expect(poll.people.map((p) => p.doing)).toEqual(first.people.map(() => 'talking'));
      expect(poll.people[0].x).toBeCloseTo(first.people[0].x, 2);
    });

    it('jumps instead under prefers-reduced-motion', () => {
      animate();
      vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }));
      const first = live();
      const poll = new WildmindPoll(first, { now: () => NOW });
      const moved = first.people.map((p) => step(p, 2));
      poll.accept({ ...first, map: null, people: moved });
      expect(poll.people.map((p) => p.x)).toEqual(moved.map((p) => p.x));
      expect(frames).toHaveLength(0);
    });

    it('lands and stops when held', () => {
      animate();
      let t = NOW;
      const first = live();
      const poll = new WildmindPoll(first, { now: () => t });
      const moved = first.people.map((p) => step(p, 2));
      poll.accept({ ...first, map: null, people: moved });
      t += 1_000;
      flush();
      poll.hold(true);
      expect(poll.people.map((p) => p.x)).toEqual(moved.map((p) => p.x));
      t += 1_000;
      flush();
      expect(frames).toHaveLength(0);
    });
  });
});
