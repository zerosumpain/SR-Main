import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConnectorReport } from '$lib/connectors/types';
import type { ConnectorMark } from '$lib/connectors/watch-core';

/**
 * The watcher's tick, end to end, with every edge mocked: the probes, the
 * watermark store, the ledger and the event bus. Nothing here reaches
 * `$lib/workflows`, so nothing boots WhatsApp (see
 * reference_test_imports_boot_platform_services).
 */

let reports: ConnectorReport[] = [];
const store = new Map<string, ConnectorMark>();
let setting: boolean | null = null;

const probeAll = vi.fn(async () => reports);
const notifyOwner = vi.fn(async (_input: Record<string, unknown>) => ({ raised: true, id: 'evt-1' }) as {
  raised: boolean;
  id?: string;
  reason?: string;
});
const emit = vi.fn();
const writeSweep = vi.fn(async () => {});

vi.mock('$lib/connectors/probes', () => ({ probeAll: () => probeAll() }));
vi.mock('$lib/server/models/settings', () => ({ getSetting: async () => setting }));
vi.mock('$lib/server/notify', () => ({
  notifyOwner: (input: Record<string, unknown>) => notifyOwner(input),
  routeFor: async () => ({ minIntervalSeconds: 12 * 60 * 60 }),
}));
vi.mock('$lib/events/platform-bus', () => ({ emit: (...a: unknown[]) => emit(...a) }));
vi.mock('$lib/connectors/watch-store', () => ({
  readMarks: async () => new Map([...store].map(([k, v]) => [k, structuredClone(v)])),
  writeMarks: async (marks: ConnectorMark[]) => {
    for (const m of marks) store.set(m.key, structuredClone(m));
  },
  clearMarks: async (keys: string[]) => {
    for (const k of keys) store.delete(k);
  },
  writeSweep: (...a: unknown[]) => writeSweep(...(a as [])),
}));

const { tick } = await import('$lib/connectors/watch');

const HOUR = 60 * 60 * 1000;
const T0 = new Date('2026-09-25T07:40:00.000Z');
const at = (ms: number) => () => new Date(T0.getTime() + ms);

const gmail = (status: ConnectorReport['status']): ConnectorReport => ({
  key: 'gmail:1',
  label: 'Gmail · me@example.com',
  group: 'Email',
  tier: 'account',
  status,
  detail: status === 'broken' ? 'Gmail token refresh failed: invalid_grant' : 'authenticated',
  live: true,
  fixUrl: status === 'broken' ? '/api/gmail/connect' : '/admin/connections/gmail',
  fixHint: status === 'broken' ? 'Re-authorise me@example.com' : undefined,
  checkedAt: T0.toISOString(),
  ms: 5,
});

beforeEach(() => {
  store.clear();
  setting = null;
  reports = [];
  probeAll.mockClear();
  notifyOwner.mockClear();
  notifyOwner.mockResolvedValue({ raised: true, id: 'evt-1' });
  emit.mockClear();
  writeSweep.mockClear();
});

describe('connector watcher tick', () => {
  it('raises exactly one high-severity `connections` notification on the transition', async () => {
    reports = [gmail('broken')];
    const result = await tick(at(0));
    expect(result.notified).toEqual(['gmail:1']);
    expect(notifyOwner).toHaveBeenCalledTimes(1);
    expect(notifyOwner.mock.calls[0][0]).toMatchObject({
      category: 'connections',
      severity: 'alert',
      title: 'Gmail · me@example.com needs re-authorising',
      url: 'https://strangeramblings.com/api/gmail/connect',
      dedupeKey: 'connector:gmail:1',
    });
    expect(String(notifyOwner.mock.calls[0][0].body)).toContain('Re-authorise me@example.com');
    expect(emit).toHaveBeenCalledWith('connector.broken', expect.objectContaining({ key: 'gmail:1', status: 'auth_expired' }), {
      source: 'connector-watch',
    });
    expect(store.get('gmail:1')?.lastNotifiedAt).toBe(T0.toISOString());
    expect(writeSweep).toHaveBeenCalledTimes(1);
  });

  it('does not notify again while still broken inside 12 hours', async () => {
    reports = [gmail('broken')];
    await tick(at(0));
    await tick(at(30 * 60_000));
    await tick(at(11 * HOUR));
    expect(notifyOwner).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('reminds after 12 hours', async () => {
    reports = [gmail('broken')];
    await tick(at(0));
    await tick(at(12 * HOUR));
    expect(notifyOwner).toHaveBeenCalledTimes(2);
    expect(store.get('gmail:1')?.lastNotifiedAt).toBe(new Date(T0.getTime() + 12 * HOUR).toISOString());
    expect(store.get('gmail:1')?.brokenSince).toBe(T0.toISOString());
  });

  it('keeps asking when the ledger calls it a duplicate, without stamping it told', async () => {
    reports = [gmail('broken')];
    notifyOwner.mockResolvedValue({ raised: false, reason: 'duplicate' });
    await tick(at(0));
    expect(store.get('gmail:1')?.lastNotifiedAt).toBeNull();
    notifyOwner.mockResolvedValue({ raised: true, id: 'evt-2' });
    await tick(at(30 * 60_000));
    expect(notifyOwner).toHaveBeenCalledTimes(2);
    expect(store.get('gmail:1')?.lastNotifiedAt).not.toBeNull();
  });

  it('clears the watermark on recovery, sends nothing, emits connector.recovered', async () => {
    reports = [gmail('broken')];
    await tick(at(0));
    notifyOwner.mockClear();
    reports = [gmail('ok')];
    const result = await tick(at(HOUR));
    expect(notifyOwner).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
    expect(result.recovered).toEqual(['gmail:1']);
    expect(emit).toHaveBeenLastCalledWith('connector.recovered', expect.objectContaining({ key: 'gmail:1' }), {
      source: 'connector-watch',
    });
  });

  it('never alerts on unconfigured or degraded', async () => {
    reports = [
      { ...gmail('ok'), key: 'gmail', status: 'unconfigured', detail: 'no account connected' },
      { ...gmail('ok'), key: 'sensors', status: 'degraded', detail: '1 of 4 reporting' },
    ];
    await tick(at(0));
    await tick(at(13 * HOUR));
    expect(notifyOwner).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it('does nothing at all when the kill switch is off', async () => {
    setting = false;
    reports = [gmail('broken')];
    const result = await tick(at(0));
    expect(result.skipped).toBe('disabled');
    expect(probeAll).not.toHaveBeenCalled();
    expect(notifyOwner).not.toHaveBeenCalled();
    expect(writeSweep).not.toHaveBeenCalled();
  });

  it('shares one check between concurrent callers', async () => {
    reports = [gmail('broken')];
    const [a, b] = await Promise.all([tick(at(0)), tick(at(0))]);
    expect(a).toBe(b);
    expect(probeAll).toHaveBeenCalledTimes(1);
    expect(notifyOwner).toHaveBeenCalledTimes(1);
  });

  it('never throws — a failed probe sweep is logged and skipped', async () => {
    probeAll.mockRejectedValueOnce(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await tick(at(0));
    expect(result.skipped).toBe('error');
    spy.mockRestore();
  });
});
