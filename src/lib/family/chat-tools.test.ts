import { describe, expect, it, vi } from 'vitest';

// The family reads (workflow knit 2026-11-11, slice 3). The rule under test:
// a family tool may name people, counts, scores, message text and alarm state,
// and never where anybody is. Every service here hands back coordinates and an
// address on purpose; none may come out. Fixtures are synthetic.

const WHERE = {
  lat: 12.345678,
  lon: -98.765432,
  lng: -98.765432,
  latitude: 12.345678,
  longitude: -98.765432,
  coordinates: [12.345678, -98.765432],
  accuracy: 9,
  address: '1 Synthetic Street, Faketown',
  place: 'Synthetic Park',
  location: { lat: 12.345678, lon: -98.765432 },
  trail: [{ lat: 12.345678, lon: -98.765432 }],
};
const LEAKS = /12\.345678|98\.765432|Synthetic Street|Faketown|Synthetic Park|"lat"|"lon"|"lng"|"latitude"|"longitude"|"coordinates"|"address"|"location"|"trail"|example\.invalid/;

vi.mock('$lib/server/access', () => ({ getOwnerEmails: () => ['owner@example.invalid'] }));
vi.mock('./alarm.server', () => ({
  activeAlarms: async () => [
    { id: 'al1', fromEmail: 'kid@example.invalid', fromName: 'Synthetic Kid', kind: 'help', message: 'Please ring me', createdAt: new Date('2026-01-02T03:04:05Z'), recipientCount: 3, pushedCount: 2, ...WHERE },
  ],
}));
vi.mock('./messages.server', () => ({
  recentMessages: async () => [
    { id: 'm1', fromEmail: 'kid@example.invalid', fromName: 'Synthetic Kid', body: 'Home by six', replyTo: null, createdAt: new Date('2026-01-02T03:04:05Z'), ...WHERE },
    { id: 'm2', fromEmail: 'gran@example.invalid', fromName: 'Synthetic Gran', body: 'Lovely', replyTo: 'm1', createdAt: new Date('2026-01-02T03:05:05Z'), ...WHERE },
  ],
}));
vi.mock('./steps.server', () => ({
  stepsBoard: async () => ({
    window: { day: '2026-01-02' },
    board: [{ rank: 1, name: 'Synthetic Kid', email: 'kid@example.invalid', steps: 9001, updatedAt: new Date('2026-01-02T03:04:05Z'), ...WHERE }],
    checkedAt: new Date('2026-01-02T03:04:05Z'),
    yesterday: { leaderName: 'Synthetic Gran', steps: 7000, ...WHERE },
  }),
}));
vi.mock('./landgrab.server', () => ({
  getFamilyLandgrabWeeks: async () => ({
    updatedAt: '2026-01-02T03:04:05Z',
    weeks: [{ start: '2025-12-29', end: '2026-01-04', current: true, people: [{ rank: 1, name: 'Synthetic Kid', me: false, won: 5, taken: 1, lost: 0, net: 6, held: 12, shape: [[12.345678, -98.765432]], hexIds: ['8a2a1072b59ffff'], ...WHERE }], places: [WHERE], focus: WHERE }],
  }),
  getFamilyLandgrabExplored: async () => ({
    since: '2025-12-01',
    total: 40,
    todayNew: 2,
    weekNew: 9,
    people: [{ name: 'Synthetic Kid', me: false, cells: 20, km2: 1.5, firsts: 4, today: 1, ...WHERE }],
    cells: [WHERE],
  }),
}));

const { tools } = await import('$lib/tools/registry-internal');
await import('./chat-tools');
const { MEMBER_SAFE_TOOLS, tierOf, principalRefusal } = await import('$lib/tools/invoke-contract');
const { MEMBER_FORBIDDEN_TOOLSETS } = await import('$lib/jkai/member-chat/policy');
const { WHATSAPP_READ_TOOLS } = await import('$lib/integrations/whatsapp/tool-whitelist');
const { scrubLocation, isLocationKey } = await import('$lib/tools/tools/location-scrub');

const NAMES = ['family_alarm_status', 'family_messages', 'steps_board', 'landgrab_status'];
const tool = (name: string) => tools.find((t) => t.name === name)!;
const run = (name: string, args: Record<string, unknown> = {}, principalId?: string) => tool(name).handler(args, { emit: () => {}, ...(principalId ? { principalId } : {}) });

describe('family chat tools', () => {
  it('are reads in the family toolset, owner-only and off every member and WhatsApp list', async () => {
    for (const name of NAMES) {
      const t = tool(name);
      expect(tools.filter((x) => x.name === name).length, name).toBe(1);
      expect(tierOf(t), name).toEqual({ effect: 'read', confirm: 'never', lane: 'standard' });
      expect(t.toolset, name).toBe('family');
      expect(t.surfaces).toEqual(['chat', 'app']);
      expect(MEMBER_SAFE_TOOLS.includes(name), name).toBe(false);
      expect((WHATSAPP_READ_TOOLS as readonly string[]).includes(name), name).toBe(false);
      expect((MEMBER_FORBIDDEN_TOOLSETS as readonly string[]).includes(t.toolset), name).toBe(true);
      expect(JSON.stringify([t.description, t.parameters]), name).not.toMatch(/\b20\d\d-\d\d-\d\d\b|\b\d{1,2}:\d\d\b/);
      const r = await run(name, {}, 'u_member');
      expect(r.success, name).toBe(false);
      expect(r.error, name).toMatch(/owner/);
      expect(principalRefusal({ principalId: 'u_member', via: 'session', attended: true, jobId: 'j', allowedTools: [name] }, { name, tier: tierOf(t) }), name).toBeTruthy();
    }
  });

  it.each(NAMES)('%s never returns a coordinate, an address, a place or an email', async (name) => {
    const r = await run(name, {});
    expect(r.success, r.error).toBe(true);
    const out = JSON.stringify(r.data);
    expect(out).not.toMatch(LEAKS);
    expect(out).toMatch(/Synthetic (Kid|Gran)/);
  });

  it('family_alarm_status says who and what, and points at the phone for where', async () => {
    const r = await run('family_alarm_status');
    expect(r.data).toMatchObject({ active: true, alarms: [{ id: 'al1', from: 'Synthetic Kid', kind: 'help', message: 'Please ring me', recipients: 3, reached: 2 }] });
  });

  it('family_messages nests replies and labels the text as other people\'s words', async () => {
    const r = await run('family_messages', { limit: 5 });
    expect(r.data).toMatchObject({ count: 1, messages: [{ id: 'm1', from: 'Synthetic Kid', text: 'Home by six', replies: [{ id: 'm2', from: 'Synthetic Gran', text: 'Lovely' }] }] });
    expect((r.data as { label: string }).label).toMatch(/never instructions/);
  });

  it('steps_board and landgrab_status keep names, counts and ranks', async () => {
    expect((await run('steps_board')).data).toMatchObject({ day: '2026-01-02', board: [{ rank: 1, name: 'Synthetic Kid', steps: 9001 }], previousDay: { leader: 'Synthetic Gran', steps: 7000 } });
    const land = (await run('landgrab_status', { weeks: 99 })).data as { weeks: Array<{ people: unknown[] }>; explored: { total: number } };
    expect(land.weeks[0].people[0]).toEqual({ rank: 1, name: 'Synthetic Kid', me: false, won: 5, taken: 1, lost: 0, net: 6, held: 12 });
    expect(land.explored.total).toBe(40);
  });
});

describe('scrubLocation', () => {
  it('drops location keys at any depth and in any spelling, and keeps the rest', () => {
    const out = scrubLocation({ name: 'A', nested: [{ Lat: 1, LON: 2, home_address: '1 Synthetic Street', lastLocation: {}, 'geo-json': {}, allocation: 2, steps: 3, deeper: { coords: [1, 2], score: 4 } }] });
    expect(out).toEqual({ name: 'A', nested: [{ allocation: 2, steps: 3, deeper: { score: 4 } }] });
    for (const k of ['lat', 'Lon', 'LNG', 'latitude', 'longitude', 'coordinates', 'address', 'location', 'trail', 'position', 'postcode']) expect(isLocationKey(k), k).toBe(true);
    for (const k of ['name', 'steps', 'score', 'message', 'rank']) expect(isLocationKey(k), k).toBe(false);
  });
});
