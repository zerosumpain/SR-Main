import { describe, expect, it } from 'vitest';
import {
  FOLLOW_KINDS,
  addressIsCited,
  briefView,
  cleanWatchDescription,
  contactsIn,
  followEntry,
  followStage,
  noteFollow,
  pickHomeEntities,
  readFollow,
  webLinks,
  whatsappLink,
  withFollow,
  type FollowInput,
} from './follow';

// The three notes that prompted this, as production held them on 2026-10-05.
const base: FollowInput = {
  outcome: 'suggest',
  channel: 'research',
  title: '',
  summary: '',
  next: null,
  verdict: null,
  review: null,
  sources: [],
  evidence: [],
  build: null,
  actions: [],
};

const walk: FollowInput = {
  ...base,
  title: 'Book the Dunbar–Barns Ness geology walk on 16 October',
  summary: 'Angus Miller leads a 6 km coastal geology walk on Friday 16 October 2026 at 11:00. Adult tickets are £25, with 12 adult places listed as remaining.',
  next: 'Read the walk listing and book an adult place if the 6 km moderate coastal route suits.',
  evidence: [
    { kind: 'think-card', id: 'fetch_url:[["url","https://www.scottishgeologist.co.uk/store"]]@2026-10-03', note: '{"url":"https://www.scottishgeologist.co.uk/store","title":"Group Tours"}' },
  ],
  sources: [{ label: 'Web page', detail: 'www.scottishgeologist.co.uk', href: 'https://www.scottishgeologist.co.uk/store' }],
};

const watchdog: FollowInput = {
  ...base,
  outcome: 'build',
  channel: 'home',
  title: 'Build a home coverage watchdog for heating and security blind spots',
  summary: 'The downstairs hallway climate control has been unavailable since 26 September, and an Echo Dot motion sensor is unavailable.',
  next: 'Add a home coverage watchdog that flags unavailable heating, door/window and motion devices.',
  build: { slug: 'build-a-home-coverage-watchdog', status: 'open', accepted: false },
};

const physics: FollowInput = {
  ...base,
  channel: 'chat',
  title: 'Try a small physics-based visual prototype, not a graphing app',
  summary: 'Your recent chats lean towards animation and visualisation.',
  next: 'Sketch a physics toy before another graphing tool.',
};

const kinds = (f: ReturnType<typeof noteFollow>) => f.offers.map((o) => `${o.kind}:${o.state}`);

describe('noteFollow — the three notes', () => {
  it('the walk: booking page, dig deeper, an enquiry — and no backlog', () => {
    const f = noteFollow(walk);
    expect(f.bookingUrl).toBe('https://www.scottishgeologist.co.uk/store');
    expect(kinds(f)).toEqual(['research:offer', 'message:offer']);
  });

  it('the watchdog: accept for build, a Watch instead, and a Home Assistant check', () => {
    const f = noteFollow(watchdog);
    expect(kinds(f)).toEqual(['build:offer', 'watch:offer', 'home:offer']);
    expect(f.watchDraft).toMatch(/^Tell me when this needs attention: Add a home coverage watchdog/);
  });

  it('the physics prototype: nothing until he backs it (he refuted the real one)', () => {
    expect(noteFollow(physics).offers).toEqual([]);
    expect(noteFollow({ ...physics, review: { verdict: 'wrong', by: 'check', reasoning: '', lesson: null }, verdict: 'useful' }).offers).toEqual([]);
    const backed = noteFollow({ ...physics, verdict: 'useful' });
    expect(kinds(backed)).toEqual(['promote:offer', 'prototype:offer']);
  });

  it('a note he turned down gets nothing at all', () => {
    expect(noteFollow({ ...walk, verdict: 'not_useful' })).toMatchObject({ bookingUrl: null, offers: [] });
  });
});

describe('noteFollow — after the tap', () => {
  const now = new Date('2026-10-05T18:00:00Z');

  it('reads each stored follow-up back as done, with where it lives', () => {
    const actions = [
      followEntry('research', 'Research started', { sessionId: 'r1' }, now),
      followEntry('watch', 'Watching', { workflowId: 'w1', description: 'x', stoppedAt: null }, now),
    ];
    const f = noteFollow({ ...watchdog, channel: 'home', actions, sources: walk.sources, evidence: walk.evidence });
    expect(f.offers.find((o) => o.kind === 'research')).toMatchObject({ state: 'done', href: '/research/r1' });
    expect(f.offers.find((o) => o.kind === 'watch')).toMatchObject({ state: 'done', label: 'Watching' });
    expect(followStage(f, now.getTime())).toBe('motion');
  });

  it('a drafted brief waits on him, and shows what he would accept', () => {
    const grooming = { outcome: 'Flag unavailable heating and security devices by room', acceptanceCriteria: ['Lists each unavailable device'], effort: 'S', risk: 'low', readiness: { status: 'ready', reason: 'clear' } };
    const actions = [followEntry('build', 'Brief drafted', { slug: watchdog.build!.slug, grooming, brief: briefView(grooming), title: 't', detail: 'd', kind: 'feature', priority: 3, acceptedAt: null }, now)];
    const f = noteFollow({ ...watchdog, actions });
    expect(f.offers.find((o) => o.kind === 'build')?.state).toBe('drafted');
    expect(f.brief).toMatchObject({ outcome: 'Flag unavailable heating and security devices by room', effort: 'S', readiness: 'ready — clear', acceptedAt: null });
    expect(followStage(f, now.getTime())).toBe('decide');
  });

  it('an accepted build is done, whether accepted here or on the board', () => {
    expect(noteFollow({ ...watchdog, build: { ...watchdog.build!, accepted: true } }).offers[0]).toMatchObject({ kind: 'build', state: 'done' });
  });

  it('a research run stops counting as in motion after a day', () => {
    const f = noteFollow({ ...walk, actions: [followEntry('research', 'Research started', { sessionId: 'r1' }, now)] });
    expect(followStage(f, now.getTime() + 2 * 86_400_000)).toBeNull();
  });

  it('keeps every other entry when one is replaced', () => {
    const a = followEntry('research', 'x', { sessionId: 'a' }, now);
    const b = followEntry('research', 'y', { sessionId: 'b' }, now);
    const plan = { kind: 'calendar_event', label: 'Add', payload: '{}' };
    const out = withFollow([plan, a], b);
    expect(out).toEqual([plan, b]);
    expect(readFollow(out).research?.data).toEqual({ sessionId: 'b' });
  });
});

describe('contacts come from source text, by code', () => {
  it('finds UK numbers and addresses in the forms a page writes them', () => {
    const t = 'Call 07700 900123 or +44 (0)131 496 0000, or email Bookings@ScottishGeologist.co.uk. logo@2x.png';
    expect(contactsIn(t)).toEqual({ phones: ['447700900123', '441314960000'], emails: ['bookings@scottishgeologist.co.uk'] });
  });

  it('builds WhatsApp links with and without a number', () => {
    expect(whatsappLink('Hi there', '447700900123')).toBe('https://wa.me/447700900123?text=Hi%20there');
    expect(whatsappLink('Hi', null)).toBe('https://wa.me/?text=Hi');
  });

  it('only drafts to an address a source shows', () => {
    expect(addressIsCited('bookings@x.co.uk', 'write to bookings@x.co.uk')).toBe(true);
    expect(addressIsCited('owner@x.co.uk', 'write to bookings@x.co.uk')).toBe(false);
    expect(addressIsCited('bad', 'bad')).toBe(false);
  });
});

describe('the server-side checks', () => {
  it('takes a watch description of sensible length', () => {
    expect(cleanWatchDescription('too short')).toBeNull();
    expect(cleanWatchDescription('  Tell me when   the hallway thermostat drops out  ')).toBe('Tell me when the hallway thermostat drops out');
    expect(cleanWatchDescription('x'.repeat(401))).toBeNull();
  });

  it('refreshes only devices the check found, at most five', () => {
    const found = ['climate.hall', 'binary_sensor.door', 'sensor.a', 'sensor.b', 'sensor.c', 'sensor.d'].map((id) => ({ id }));
    expect(pickHomeEntities(['lock.front_door', 'climate.hall'], found)).toEqual(['climate.hall']);
    expect(pickHomeEntities(found.map((f) => f.id), found)).toHaveLength(5);
    expect(pickHomeEntities('climate.hall', found)).toEqual([]);
  });

  it('collects web addresses from fetched pages and search results', () => {
    const ev = [{ note: '{"results":[{"url":"https://example.org/walks?id=4","title":"x"}]}' }];
    expect(webLinks(ev, [{ label: 'Web page', detail: '', href: 'https://a.example/page' }])).toEqual(['https://a.example/page', 'https://example.org/walks?id=4']);
  });

  it('every follow kind has a cost line', async () => {
    const { FOLLOW_COST } = await import('./follow');
    for (const k of FOLLOW_KINDS) expect(FOLLOW_COST[k].length).toBeGreaterThan(20);
  });
});
