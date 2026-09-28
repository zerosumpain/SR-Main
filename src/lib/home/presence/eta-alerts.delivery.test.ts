import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ value: null as unknown, accepted: true, calls: [] as any[], arrivals: [] as any[],
  apns: false, reached: [] as string[], pushes: [] as any[], recipients: ['sam@example.test'], sharing: true }));
vi.mock('$lib/db', () => {
  const tx = { execute: async () => ({ rows: [] }), select: () => ({ from: () => ({ where: async () => h.value ? [{ value: h.value }] : [] }) }),
    insert: () => ({ values: (v: { value: unknown }) => ({ onConflictDoUpdate: async () => { h.value = v.value; } }) }) };
  return { db: { transaction: async (run: (db: typeof tx) => unknown) => run(tx) } };
});
vi.mock('./members', () => ({ listMembers: async () => [{ subject: 'alex' }, { subject: 'sam', source: 'companion' }] }));
vi.mock('./insights.server', () => ({ insightMembers: async () => h.sharing ? [{ subject: 'alex' }] : [], loadPresenceInsights: async () => ({ arrivals: h.arrivals }) }));
vi.mock('./alerts', () => ({ pilotRecipients: () => h.recipients, localClock: () => '08:40', postToPilot: async (events: any[]) => { h.calls.push(events); return h.accepted ? { accepted: events.map(e => e.id) } : { accepted: [], error: 'offline' }; } }));
vi.mock('$lib/server/apns', () => ({ isApnsConfigured: () => h.apns }));
vi.mock('$lib/server/push-devices', () => ({ pushToEmails: async (emails: string[], message: unknown) => { h.pushes.push({ emails, message }); return { reached: new Set(h.reached) }; } }));
const { deliverArrivalEstimates } = await import('./eta-alerts.server');
beforeEach(() => {
  vi.stubEnv('COMPANION_HOUSEHOLD_TOKEN', 'synthetic-test-only'); h.value = null; h.calls = []; h.accepted = true;
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-28T07:35Z'));
  h.apns = false; h.reached = []; h.pushes = []; h.recipients = ['sam@example.test']; h.sharing = true;
  h.arrivals = [{ id: 'alex:123', subject: 'alex', person: 'Alex', to: 'Home', returningHome: true, samples: 4, observedAt: '2026-09-28T07:35Z', earliest: '2026-09-28T07:38Z', latest: '2026-09-28T07:43Z' }];
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
it('sends once per journey and persists acknowledgement', async () => {
  expect(await deliverArrivalEstimates()).toEqual({ sent: 1 });
  expect(await deliverArrivalEstimates()).toEqual({ sent: 0 }); expect(h.calls).toHaveLength(1);
});
it('retries failures while predictions remain current, but not vanished predictions', async () => {
  h.accepted = false; expect(await deliverArrivalEstimates()).toEqual({ sent: 0 }); expect(h.value).toBeNull();
  h.accepted = true; expect(await deliverArrivalEstimates()).toEqual({ sent: 1 });
  h.arrivals = []; expect(await deliverArrivalEstimates()).toEqual({ sent: 0 }); expect(h.calls).toHaveLength(2);
});
it('does not attempt remote delivery when the app connection is absent', async () => {
  vi.stubEnv('COMPANION_HOUSEHOLD_TOKEN', ''); expect(await deliverArrivalEstimates()).toEqual({ sent: 0 }); expect(h.calls).toHaveLength(0);
});
it('pushes through the current native channel and queues only recipients it did not reach', async () => {
  h.apns = true; h.recipients = ['sam@example.test', 'jo@example.test']; h.reached = ['sam@example.test'];
  expect(await deliverArrivalEstimates()).toEqual({ sent: 1 });
  expect(h.calls[0][0].recipients).toEqual(['jo@example.test']);
  expect(h.pushes[0].message).toMatchObject({ category: 'household', level: 'active', ttlSeconds: 300 });
  expect(await deliverArrivalEstimates()).toEqual({ sent: 0 }); expect(h.pushes).toHaveLength(1);
});
it('persists partial push success across retries without a companion queue', async () => {
  vi.stubEnv('COMPANION_HOUSEHOLD_TOKEN', ''); h.apns = true;
  h.recipients = ['sam@example.test', 'jo@example.test']; h.reached = ['sam@example.test'];
  expect(await deliverArrivalEstimates()).toEqual({ sent: 1 });
  h.reached = ['jo@example.test']; expect(await deliverArrivalEstimates()).toEqual({ sent: 1 });
  expect(h.pushes[1].emails).toEqual(['jo@example.test']); expect(h.calls).toHaveLength(0);
  expect(await deliverArrivalEstimates()).toEqual({ sent: 0 });
});
it('withholds delivery after sharing is revoked even if the prior analysis had an arrival', async () => {
  h.apns = true; h.sharing = false;
  expect(await deliverArrivalEstimates()).toEqual({ sent: 0 }); expect(h.pushes).toHaveLength(0); expect(h.calls).toHaveLength(0);
});
it('does not send an arrival window that has expired', async () => {
  vi.setSystemTime(new Date('2026-09-28T07:44Z'));
  expect(await deliverArrivalEstimates()).toEqual({ sent: 0 }); expect(h.calls).toHaveLength(0);
});
