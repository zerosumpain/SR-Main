import { describe, expect, it } from 'vitest';
import { LATELY_KEPT, askHref, latelyWith, matchPlaces, placeAt, placesFor } from '$lib/nav/go';
import { ROOMS } from '$lib/nav/site-nav';

const owner = placesFor(true);
const hrefs = (query: string, places = owner) => matchPlaces(query, places).map((p) => p.href);

describe('the places the map can go', () => {
  it('lists home, every room destination and jkai, each once', () => {
    const all = owner.map((p) => p.href);
    expect(all[0]).toBe('/');
    for (const room of ROOMS) for (const item of room.items) expect(all).toContain(item.href);
    expect(all).toContain('/jkai');
    expect(new Set(all).size).toBe(all.length);
  });

  it('adds the pages inside a section, under the section’s name', () => {
    const plan = owner.find((p) => p.href === '/health/plan');
    expect(plan).toMatchObject({ label: 'Plan', context: 'Health' });
  });

  it('keeps a destination’s room name when its section lists it again', () => {
    expect(owner.find((p) => p.href === '/jkai/canvas')).toMatchObject({ label: 'Canvas', context: 'Make' });
  });

  it('offers a visitor only what a visitor can open', () => {
    expect(placesFor(false).map((p) => p.href)).toEqual(['/', '/projects', '/blog', '/health']);
  });

  it('offers a member the pages in their reach', () => {
    const member = placesFor(false, ['/jkai/notes']).map((p) => p.href);
    expect(member).toContain('/jkai/notes');
    expect(member).not.toContain('/admin');
  });
});

describe('a typed line', () => {
  it('names a place by the start of its name', () => {
    expect(hrefs('tri')[0]).toBe('/trips');
    expect(hrefs('WISH')[0]).toBe('/home/wishlist');
  });

  it('puts a name that starts with the line ahead of one that only contains it', () => {
    // "Plan" (Health) starts with it; nothing else should come first.
    expect(hrefs('plan')[0]).toBe('/health/plan');
  });

  it('reaches a page through its section', () => {
    expect(hrefs('health plan')).toEqual(['/health/plan']);
  });

  it('finds a place by its address when the label says something else', () => {
    expect(hrefs('blog')).toContain('/blog');
    expect(hrefs('releases')).toContain('/releases');
  });

  it('is a question, not a place, as soon as one word names nothing', () => {
    expect(hrefs('what should I plan this week')).toEqual([]);
    expect(hrefs('how did I sleep')).toEqual([]);
  });

  it('names nothing when empty', () => {
    expect(hrefs('')).toEqual([]);
    expect(hrefs('   ')).toEqual([]);
  });

  it('never names a place the viewer cannot open', () => {
    expect(hrefs('admin', placesFor(false))).toEqual([]);
  });
});

describe('where a path is', () => {
  it('is the most specific place that claims it', () => {
    expect(placeAt('/health/plan/week', owner)?.href).toBe('/health/plan');
    expect(placeAt('/home/wishlist', owner)?.href).toBe('/home/wishlist');
    expect(placeAt('/jkai/canvas/abc', owner)?.href).toBe('/jkai/canvas');
  });

  it('is home only on the front page', () => {
    expect(placeAt('/', owner)?.href).toBe('/');
    expect(placeAt('/blog/some-post', owner)?.href).toBe('/blog');
  });

  it('is nowhere on a page no row claims', () => {
    expect(placeAt('/login', owner)).toBeUndefined();
  });
});

describe('asking and remembering', () => {
  it('hands a question to jkai, sent on arrival', () => {
    expect(askHref('  how did I sleep? ')).toBe('/jkai?q=how%20did%20I%20sleep%3F&send=1');
  });

  it('moves a revisited place to the front without repeating it', () => {
    expect(latelyWith(['/a', '/b', '/c'], '/b')).toEqual(['/b', '/a', '/c']);
  });

  it('forgets the oldest once full', () => {
    const full = Array.from({ length: LATELY_KEPT }, (_, i) => `/p${i}`);
    const next = latelyWith(full, '/new');
    expect(next).toHaveLength(LATELY_KEPT);
    expect(next[0]).toBe('/new');
    expect(next).not.toContain(`/p${LATELY_KEPT - 1}`);
  });
});
