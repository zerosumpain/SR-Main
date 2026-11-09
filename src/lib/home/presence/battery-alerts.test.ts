import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/server/models/settings', () => ({ getSetting: async () => null, setSetting: async () => {} }));
vi.mock('$lib/server/push-devices', () => ({ pushToEmails: async () => ({ reached: new Set() }) }));

const { batteryStep, recordBatterySent, LOW_PCT, REARM_PCT, FRESH_MINS } = await import('./battery-alerts');

const NOW = new Date('2026-11-09T15:42:00Z');
const at = (minsAgo: number) => new Date(+NOW - minsAgo * 60_000);
const base = { subject: 'rory', name: 'Rory', recipients: ['john@example.test', 'katie@example.test'], now: NOW };

describe('batteryStep', () => {
  it('tells the followers once when a fresh reading reaches the floor', () => {
    const step = batteryStep({ ...base, reading: { pct: 14, at: at(2) }, state: null });
    expect(step.notice?.recipients).toEqual(['john@example.test', 'katie@example.test']);
    expect(step.notice?.push).toMatchObject({
      title: "Rory's phone is on 14%",
      category: 'household',
      level: 'active',
      userInfo: { kind: 'battery', subject: 'rory' },
    });
    expect(step.state.armed).toBe(false);
  });

  it('does not tell again on the next low reading, only after a charge above the re-arm level', () => {
    const first = batteryStep({ ...base, reading: { pct: LOW_PCT, at: at(2) }, state: null });
    const sent = recordBatterySent(first.state, base.recipients);
    expect(batteryStep({ ...base, reading: { pct: 12, at: at(1) }, state: sent }).notice).toBeNull();
    // Hovering under the re-arm level keeps it quiet...
    const hover = batteryStep({ ...base, reading: { pct: REARM_PCT - 1, at: at(1) }, state: { ...sent, until: 0 } });
    expect(hover.notice).toBeNull();
    expect(hover.state.armed).toBe(false);
    // ...a charge re-arms it.
    const charged = batteryStep({ ...base, reading: { pct: 80, at: at(1) }, state: sent });
    expect(charged.state).toEqual({ armed: true });
    expect(batteryStep({ ...base, reading: { pct: 10, at: at(0) }, state: charged.state }).notice).not.toBeNull();
  });

  it('retries the alert to whoever it did not reach, until it lapses', () => {
    const first = batteryStep({ ...base, reading: { pct: 9, at: at(2) }, state: null });
    const half = recordBatterySent(first.state, ['john@example.test']);
    const again = batteryStep({ ...base, reading: { pct: 9, at: at(1) }, state: half });
    expect(again.notice?.recipients).toEqual(['katie@example.test']);
    expect(again.notice?.id).toBe(first.notice?.id);
  });

  it('ignores a stale reading and a phone above the floor', () => {
    expect(batteryStep({ ...base, reading: { pct: 5, at: at(FRESH_MINS + 1) }, state: null }).notice).toBeNull();
    expect(batteryStep({ ...base, reading: { pct: LOW_PCT + 1, at: at(1) }, state: null }).notice).toBeNull();
    expect(batteryStep({ ...base, reading: null, state: null }).notice).toBeNull();
  });

  it('tells nobody when nobody follows', () => {
    expect(batteryStep({ ...base, recipients: [], reading: { pct: 5, at: at(1) }, state: null }).notice).toBeNull();
  });
});
