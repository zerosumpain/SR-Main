import { describe, expect, it } from 'vitest';
import { DELIVERY_COALESCE_MINUTES, DELIVERY_PUSH_BUDGET_LINE, JKAI_PUSH_DAILY_CAP, deliveryCollapseKey, deliveryPushDecision } from './delivery-push';
import { NOTIFICATION_CATEGORIES } from '$lib/constants/notification-categories';

/** The jkai push budget (decision 16): a visible daily cap and per-build coalescing. */
const NOW = new Date('2026-10-28T12:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe('deliveryPushDecision', () => {
  it('rings while under the cap and outside the window', () => {
    expect(deliveryPushDecision({ sentToday: 0, lastForBuildAt: null, now: NOW })).toBe('sent');
    expect(deliveryPushDecision({ sentToday: JKAI_PUSH_DAILY_CAP - 1, lastForBuildAt: minutesAgo(DELIVERY_COALESCE_MINUTES + 1), now: NOW })).toBe('sent');
  });

  it('holds the sixth of the day', () => {
    expect(JKAI_PUSH_DAILY_CAP).toBe(5);
    expect(deliveryPushDecision({ sentToday: 5, lastForBuildAt: null, now: NOW })).toBe('daily_cap');
  });

  it('coalesces a second push for the same build inside the window', () => {
    expect(deliveryPushDecision({ sentToday: 1, lastForBuildAt: minutesAgo(3), now: NOW })).toBe('coalesced');
  });
});

describe('deliveryCollapseKey', () => {
  it('folds progress per build, but keeps each blocking or terminal stage its own', () => {
    expect(deliveryCollapseKey('b1', 'Building', 'progress')).toBe(deliveryCollapseKey('b1', 'Review', 'progress'));
    expect(deliveryCollapseKey('b1', 'Ready for you', 'blocking')).not.toBe(deliveryCollapseKey('b1', 'Pull request needs you', 'blocking'));
    expect(deliveryCollapseKey('b1', 'Shipped', 'terminal')).not.toBe(deliveryCollapseKey('b1', 'Ready for you', 'blocking'));
    // The very same stage again is still a duplicate.
    expect(deliveryCollapseKey('b1', 'Autopilot needs you', 'blocking')).toBe(deliveryCollapseKey('b1', 'autopilot needs you ', 'blocking'));
    expect(deliveryCollapseKey('b1', 'Shipped', 'terminal')).not.toBe(deliveryCollapseKey('b2', 'Shipped', 'terminal'));
  });
});

describe('the cap is visible', () => {
  it('is stated on the Builds category the phone settings show', () => {
    const build = NOTIFICATION_CATEGORIES.find((c) => c.id === 'build')!;
    expect(build.description).toContain(DELIVERY_PUSH_BUDGET_LINE);
  });
});
