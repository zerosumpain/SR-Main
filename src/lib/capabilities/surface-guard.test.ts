import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CAPABILITIES } from './manifest';
import { COVERED_BY, PAGE_ONLY, surfaceProblems } from './entries/page-only';
import { NOTIFICATION_CATEGORIES } from '$lib/constants/notification-categories';
import { EVENT_CATALOGUE } from '$lib/events/catalogue';

// The surface guard (workflow knit 2026-11-11, slice 6). Every phone route
// family, notification category and platform event type is either covered by
// a capability row or listed page-only with a reason. A new one of any of the
// three turns this red until somebody decides which.

const NATIVE = fileURLToPath(new URL('../../routes/api/native/', import.meta.url));

function surfaces(): string[] {
  const native = readdirSync(NATIVE, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `native:${d.name}`);
  return [...native, ...NOTIFICATION_CATEGORIES.map((c) => `notify:${c.id}`), ...EVENT_CATALOGUE.map((e) => `event:${e.type}`)].sort();
}

describe('surface guard', () => {
  it('finds the three kinds of surface', () => {
    const all = surfaces();
    expect(all.filter((s) => s.startsWith('native:')).length).toBeGreaterThan(10);
    expect(all).toEqual(expect.arrayContaining(['native:family', 'notify:health', 'event:release.live']));
  });

  it('every surface has a capability row or a page-only reason', () => {
    expect(surfaceProblems(surfaces(), CAPABILITIES)).toEqual([]);
  });

  it('bites: a new route family, category or event with no row and no reason', () => {
    for (const fresh of ['native:brand-new', 'notify:brand-new', 'event:brand.new']) {
      expect(surfaceProblems([...surfaces(), fresh], CAPABILITIES)).toEqual([expect.stringContaining(`${fresh}: has neither a live capability row nor a page-only entry`)]);
    }
  });

  it('bites: a reason or a covering row taken away, and a stale or empty entry', () => {
    const all = surfaces();
    const without = PAGE_ONLY.filter((e) => e.key !== 'native:pair');
    expect(surfaceProblems(all, CAPABILITIES, without)).toEqual([expect.stringContaining('native:pair: has neither')]);
    const { 'event:release.live': _gone, ...rest } = COVERED_BY;
    expect(surfaceProblems(all, CAPABILITIES, PAGE_ONLY, rest)).toEqual([expect.stringContaining('event:release.live: has neither')]);
    // A covering tool that is renamed away, or only planned, no longer covers.
    expect(surfaceProblems(all, CAPABILITIES, PAGE_ONLY, { ...COVERED_BY, 'event:release.live': 'no_such_tool' })).toEqual([expect.stringContaining('neither a live capability row nor a tool of a live row')]);
    expect(surfaceProblems(all, CAPABILITIES, PAGE_ONLY, { ...COVERED_BY, 'event:release.live': 'people_location' })).toHaveLength(1);
    expect(surfaceProblems(all, CAPABILITIES.filter((c) => c.id !== 'trips'), PAGE_ONLY).some((p) => p.startsWith('native:trips: has neither'))).toBe(true);
    expect(surfaceProblems(all, CAPABILITIES, [...PAGE_ONLY, { key: 'native:long-gone', reason: 'A reason long enough to count as a sentence.' }])).toEqual([expect.stringContaining('no such surface any more')]);
    expect(surfaceProblems(all, CAPABILITIES, [...without, { key: 'native:pair', reason: 'n/a' }])).toEqual([expect.stringContaining('states its reason')]);
    expect(surfaceProblems(all, CAPABILITIES, [...PAGE_ONLY, { key: 'native:family', reason: 'A reason long enough to count as a sentence.' }])).toEqual([]);
    expect(surfaceProblems(all, CAPABILITIES, [...PAGE_ONLY, { key: 'event:release.live', reason: 'A reason long enough to count as a sentence.' }])).toEqual([expect.stringContaining('both covered by')]);
  });

  it('bites: a planned row covers nothing, by its screen, by its id or as a COVERED_BY target', () => {
    const all = surfaces();
    // The wildmind row exists and names the screen, but it is planned: only the page-only reason decides it.
    expect(CAPABILITIES.find((c) => c.native === 'wildmind')).toMatchObject({ status: 'planned' });
    expect(surfaceProblems(all, CAPABILITIES, PAGE_ONLY.filter((e) => e.key !== 'native:wildmind'))).toEqual([expect.stringContaining('native:wildmind: has neither a live capability row')]);
    // A live row turned planned stops covering its screen.
    const trips = CAPABILITIES.find((c) => c.id === 'trips')!;
    expect(trips.status).not.toBe('planned');
    const planned = CAPABILITIES.map((c) => (c.id === 'trips' ? { ...c, status: 'planned' as const } : c));
    expect(surfaceProblems(all, planned, PAGE_ONLY).some((p) => p.startsWith('native:trips: has neither a live capability row'))).toBe(true);
    // ...and so does one named in COVERED_BY, by row id or by tool.
    expect(surfaceProblems(all, CAPABILITIES, PAGE_ONLY, { ...COVERED_BY, 'event:release.live': 'people-location' })).toEqual([expect.stringContaining('neither a live capability row nor a tool of a live row')]);
    const news = CAPABILITIES.map((c) => (c.id === 'news' ? { ...c, status: 'planned' as const } : c));
    expect(surfaceProblems(all, news, PAGE_ONLY).filter((p) => p.includes('covered by news'))).toHaveLength(2);
  });

  it('holds the decided page-only actions, and none of them has a tool in the manifest', () => {
    const keys = PAGE_ONLY.map((e) => e.key);
    expect(keys).toEqual(expect.arrayContaining(['action:pull-merge', 'action:app-release', 'action:alarm-raise', 'action:share-link-write', 'action:daydream-send', 'action:bank-reconnect', 'action:trip-decision', 'action:people-location']));
    const live = CAPABILITIES.filter((c) => c.status !== 'planned').flatMap((c) => c.tools);
    const held = /^(?:pulls?|pr)_(?:merge|close|revert)|^app_release|alarm_(?:raise|hold)|^share_(?:link_)?(?:create|revoke|password)|^daydream_(?:send|autonomy)|^bank_reconnect|^trip_(?:decide|decision)|^people_/;
    expect(live.filter((n) => held.test(n))).toEqual([]);
    expect(CAPABILITIES.find((c) => c.id === 'people-location')).toMatchObject({ status: 'planned', toolsets: [] });
  });

  it('keeps the page-only list out of the manifest JSON', () => {
    const generated = readFileSync(fileURLToPath(new URL('./capabilities.generated.json', import.meta.url)), 'utf8');
    expect(generated).not.toMatch(/page-?only|action:pull-merge|native:pair/i);
    expect(Object.keys(JSON.parse(generated)).sort()).toEqual(['capabilities', 'version']);
  });
});
