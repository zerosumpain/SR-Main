import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ people: [] as Array<{ subject: string; displayName: string }>, value: null as unknown, apns: true, reached: [] as string[], pushes: [] as any[], notices: [] as any[] }));
vi.mock('$lib/db', () => {
  const rows = (list: unknown[]) => Object.assign(Promise.resolve(list), { orderBy: () => ({ limit: async () => [] }) });
  const tx = { execute: async () => ({ rows: [] }), select: () => ({ from: () => ({ where: async () => (h.value ? [{ value: h.value }] : []) }) }),
    insert: () => ({ values: (v: { value: unknown }) => ({ onConflictDoUpdate: async () => { h.value = v.value; } }) }) };
  return { db: { transaction: async (run: (db: typeof tx) => unknown) => run(tx), select: () => ({ from: () => ({ where: () => rows([]) }) }) } };
});
vi.mock('./members', () => ({ listMembers: async () => [
  { subject: 'john', email: 'john@example.test', guardianOf: ['rory'] }, { subject: 'katie', email: 'katie@example.test', guardianOf: ['rory'] },
  { subject: 'rory', email: 'rory@example.test' }] }));
vi.mock('./forecast.server', () => ({ loadForecast: async () => ({ forecast: { routines: [] }, insights: { people: h.people, routes: [], live: [] }, cal: {} }) }));
vi.mock('./parent-alerts', async (original) => ({ ...(await original<typeof import('./parent-alerts')>()),
  stopNotices: () => h.notices, schoolLateNotices: () => [] }));
vi.mock('$lib/server/apns', () => ({ isApnsConfigured: () => h.apns }));
vi.mock('$lib/server/push-devices', () => ({ pushToEmails: async (emails: string[], message: unknown) => {
  h.pushes.push({ emails, message }); return { reached: new Set(h.reached.filter((r) => emails.includes(r))) }; } }));
const { deliverParentAlerts } = await import('./parent-alerts.server');

const now = new Date('2026-11-04T09:00:00Z');
const notice = { id: 'stop-rory-1', kind: 'stopped', subject: 'rory', recipients: ['john@example.test', 'katie@example.test'],
  until: +now + 30 * 60_000, eventTitle: 'Rory stopped at School', push: { title: 'Rory stopped at School', body: 'Since 08:44.', category: 'household', level: 'active', ttlSeconds: 2700 } };

beforeEach(() => { h.people.length = 0; h.value = null; h.apns = true; h.reached = []; h.pushes = []; h.notices = [notice]; });
afterEach(() => vi.restoreAllMocks());

it('pushes each guardian once, however many runs see the stop', async () => {
  h.reached = ['john@example.test', 'katie@example.test'];
  expect(await deliverParentAlerts(now)).toEqual({ sent: 1, owed: 0 });
  expect(await deliverParentAlerts(new Date(+now + 120_000))).toEqual({ sent: 0, owed: 0 });
  expect(h.pushes).toHaveLength(1);
  expect(h.pushes[0].emails).toEqual(['john@example.test', 'katie@example.test']);
});
it('retries only the guardian a phone did not take, and caps the TTL at what is left', async () => {
  h.reached = ['john@example.test'];
  expect(await deliverParentAlerts(now)).toEqual({ sent: 1, owed: 1 });
  expect(h.pushes[0].message.ttlSeconds).toBe(1800);
  h.reached = ['katie@example.test'];
  expect(await deliverParentAlerts(new Date(+now + 120_000))).toEqual({ sent: 1, owed: 0 });
  expect(h.pushes[1].emails).toEqual(['katie@example.test']);
});
it('records nothing when nobody was reached, and gives up after `until`', async () => {
  expect(await deliverParentAlerts(now)).toEqual({ sent: 0, owed: 1 });
  expect(h.value).toBeNull();
  h.pushes = [];
  expect(await deliverParentAlerts(new Date(notice.until + 1))).toEqual({ sent: 0, owed: 0 });
  expect(h.pushes).toHaveLength(0);
});
it('does nothing without APNs', async () => {
  h.apns = false;
  expect(await deliverParentAlerts(now)).toEqual({ sent: 0, owed: 0 });
  expect(h.pushes).toHaveLength(0);
});
it('raises family.alert once for a notice, with the place as a name and no position', async () => {
  const { on } = await import('$lib/events/platform-bus');
  const said: Array<Record<string, unknown> | undefined> = [];
  const off = on('family.alert', (e) => said.push(e.payload));
  h.people.push({ subject: 'kid', displayName: 'Kid' });
  h.notices = [
    { ...notice, id: 'stop-kid-1', subject: 'kid', place: 'School', eventTitle: 'Kid stopped at School', push: { ...notice.push, title: 'Kid stopped at School' } },
    { ...notice, id: 'stop-kid-2', subject: 'kid', place: '12 Example Road', eventTitle: 'Kid stopped at 12 Example Road', push: { ...notice.push, title: 'Kid stopped at 12 Example Road' } },
    // A looked-up label the address patterns do not catch: it is in the push
    // title for the family's phones, and nowhere in the event.
    { ...notice, id: 'stop-kid-4', subject: 'kid', eventTitle: 'Kid stopped somewhere', push: { ...notice.push, title: 'Kid stopped at Synthetic Rise' } },
  ];
  h.reached = ['john@example.test'];
  await deliverParentAlerts(now);
  // The second guardian is reached on a later run: the same alert, not a new one.
  h.reached = ['katie@example.test'];
  await deliverParentAlerts(new Date(+now + 120_000));
  off();
  expect(said).toEqual([
    { kind: 'stopped', person: 'Kid', place: 'School', title: 'Kid stopped at School' },
    { kind: 'stopped', person: 'Kid', title: 'Kid stopped at a place' },
    { kind: 'stopped', person: 'Kid', title: 'Kid stopped somewhere' },
  ]);
  expect(JSON.stringify(said)).not.toMatch(/Synthetic Rise/);
  expect(h.pushes.some((p) => p.message.title === 'Kid stopped at Synthetic Rise')).toBe(true);
});
it('raises nothing when no phone took the notice', async () => {
  const { on } = await import('$lib/events/platform-bus');
  const said: unknown[] = [];
  const off = on('family.alert', (e) => said.push(e.payload));
  h.people.push({ subject: 'kid', displayName: 'Kid' });
  h.notices = [{ ...notice, id: 'stop-kid-3', subject: 'kid', place: 'School' }];
  await deliverParentAlerts(now);
  off();
  expect(said).toEqual([]);
});
