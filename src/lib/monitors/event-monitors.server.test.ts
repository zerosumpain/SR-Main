import { beforeEach, describe, expect, it, vi } from 'vitest';

// Event monitors (workflow knit 2026-11-11, slice 5): a stored event type and
// filter, a notification when one matches, and the walls that stop a monitor
// hearing its own notification. Fixtures are synthetic.

const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  notified: [] as Array<Record<string, unknown>>,
  raise: true,
  handlers: [] as Array<(e: unknown) => void>,
}));

vi.mock('$lib/server/models/settings', () => ({
  getSetting: async (key: string) => h.store.get(key) ?? null,
  setSetting: async (key: string, value: unknown) => void h.store.set(key, value),
}));
vi.mock('$lib/server/notify', () => ({
  notifyOwner: async (input: Record<string, unknown>) => (h.notified.push(input), { raised: h.raise }),
}));
vi.mock('$lib/events/platform-bus', () => ({
  onAll: (fn: (e: unknown) => void) => {
    h.handlers.push(fn);
    return () => void h.handlers.splice(h.handlers.indexOf(fn), 1);
  },
}));
vi.mock('$lib/workflows-client/event-bus', () => ({ MAX_CHAIN_DEPTH: 5 }));

const m = await import('./event-monitors.server');
const { EVENT_CATALOGUE } = await import('$lib/events/catalogue');

describe('event monitors', () => {
  beforeEach(() => {
    h.store.clear();
    h.notified = [];
    h.raise = true;
    m.stopEventMonitors();
  });

  it('parses an event type from the catalogue, a filter and a clamped gap', () => {
    expect(m.parseEventMonitor({ eventType: 'not.an.event' })).toMatchObject({ ok: false });
    expect(m.parseEventMonitor({ eventType: '' })).toMatchObject({ ok: false });
    expect(m.parseEventMonitor({ eventType: 'release.live', filter: 'nonsense' })).toMatchObject({ ok: false });
    const plain = m.parseEventMonitor({ eventType: ' release.live ' });
    expect(plain).toMatchObject({ ok: true, monitor: { eventType: 'release.live', filter: [], minMinutes: m.DEFAULT_INTERVAL_MINUTES } });
    expect(plain.ok && plain.monitor.label.length).toBeGreaterThan(0);
    const full = m.parseEventMonitor({ eventType: 'release.live', filter: [{ key: 'repo', op: 'contains', value: 'synthetic' }], label: ` ${'L'.repeat(200)} `, minMinutes: 0 });
    expect(full.ok && full.monitor.filter).toHaveLength(1);
    expect(full.ok && full.monitor.label.length).toBe(120);
    expect(full.ok && full.monitor.minMinutes).toBe(m.MIN_INTERVAL_MINUTES);
    const long = m.parseEventMonitor({ eventType: 'release.live', minMinutes: 999999 });
    expect(long.ok && long.monitor.minMinutes).toBe(m.MAX_INTERVAL_MINUTES);
    for (const e of EVENT_CATALOGUE) expect(m.parseEventMonitor({ eventType: e.type }).ok, e.type).toBe(true);
  });

  it('keeps the monitors in one setting, capped, and removes by id', async () => {
    const made = await m.createEventMonitor({ eventType: 'release.live' }, new Date('2026-01-02T03:04:05Z'));
    expect(made.ok && made.monitor.id).toMatch(/^em_[a-f0-9]{12}$/);
    expect(made.ok && made.monitor.createdAt).toBe('2026-01-02T03:04:05.000Z');
    expect([...h.store.keys()]).toEqual([m.EVENT_MONITORS_KEY]);
    for (let i = 1; i < m.MAX_EVENT_MONITORS; i++) expect((await m.createEventMonitor({ eventType: 'capture.ready' })).ok).toBe(true);
    expect(await m.createEventMonitor({ eventType: 'capture.ready' })).toMatchObject({ ok: false });
    expect(await m.listEventMonitors()).toHaveLength(m.MAX_EVENT_MONITORS);
    const id = made.ok ? made.monitor.id : '';
    expect((await m.removeEventMonitor(id))?.id).toBe(id);
    expect(await m.removeEventMonitor(id)).toBeNull();
    expect(await m.listEventMonitors()).toHaveLength(m.MAX_EVENT_MONITORS - 1);
    h.store.set(m.EVENT_MONITORS_KEY, 'corrupt');
    expect(await m.listEventMonitors()).toEqual([]);
  });

  it('notifies for a matching event only, under the monitor\'s own dedupe key and gap', async () => {
    const made = await m.createEventMonitor({ eventType: 'release.live', filter: [{ key: 'repo', op: 'contains', value: 'synthetic' }], label: 'Synthetic release', minMinutes: 30 });
    const id = made.ok ? made.monitor.id : '';
    expect(await m.handleEvent({ type: 'release.live', payload: { repo: 'other/app' } })).toEqual([]);
    expect(await m.handleEvent({ type: 'capture.ready', payload: { repo: 'synthetic/app' } })).toEqual([]);
    expect(h.notified).toEqual([]);
    expect(await m.handleEvent({ id: 'ev1', type: 'release.live', payload: { repo: 'synthetic/app', title: 'Version one is live' } })).toEqual([id]);
    expect(h.notified).toHaveLength(1);
    expect(h.notified[0]).toMatchObject({
      category: m.EVENT_MONITOR_CATEGORY, title: 'Synthetic release', body: 'Version one is live',
      dedupeKey: `event-monitor:${id}`, minIntervalSeconds: 1800, data: { monitorId: id, eventType: 'release.live', eventId: 'ev1' },
    });
    expect(typeof h.notified[0].eventId).toBe('string');
    // The rate limit is notifyOwner's: when it declines, the monitor did not raise.
    h.raise = false;
    expect(await m.handleEvent({ type: 'release.live', payload: { repo: 'synthetic/app' } })).toEqual([]);
    expect(h.notified).toHaveLength(2);
  });

  it('never fires on a notification it raised itself, but does on anyone else\'s', async () => {
    await m.createEventMonitor({ eventType: 'notification.raised', minMinutes: 1 });
    expect(await m.handleEvent({ type: 'notification.raised', payload: { id: 'someone-elses', title: 'Synthetic' } })).toHaveLength(1);
    const own = h.notified[0].eventId as string;
    expect(m.monitorable({ type: 'notification.raised', payload: { id: own } })).toBe(false);
    expect(await m.handleEvent({ type: 'notification.raised', payload: { id: own, title: 'Synthetic' } })).toEqual([]);
    expect(h.notified).toHaveLength(1);
    expect(m.monitorable({ type: 'notification.raised', payload: { id: 'another' } })).toBe(true);
  });

  it('never fires on an event at the chain depth limit', async () => {
    await m.createEventMonitor({ eventType: 'workflow.completed' });
    expect(m.monitorable({ type: 'workflow.completed', chainDepth: 5 })).toBe(false);
    expect(await m.handleEvent({ type: 'workflow.completed', chainDepth: 5, payload: {} })).toEqual([]);
    expect(await m.handleEvent({ type: 'workflow.completed', chainDepth: 4, payload: {} })).toHaveLength(1);
  });

  it('eventLine prefers a title and falls back to the catalogue', () => {
    expect(m.eventLine({ type: 'release.live', payload: { summary: 's', title: 't' } })).toBe('t');
    expect(m.eventLine({ type: 'release.live', payload: { status: 'x'.repeat(500) } })).toHaveLength(160);
    expect(m.eventLine({ type: 'release.live', payload: {} }).length).toBeGreaterThan(0);
  });

  it('subscribes once and unsubscribes', async () => {
    m.startEventMonitors();
    m.startEventMonitors();
    expect(h.handlers).toHaveLength(1);
    m.stopEventMonitors();
    expect(h.handlers).toHaveLength(0);
  });
});
