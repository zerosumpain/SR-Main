import { describe, it, expect } from 'vitest';
import {
  chooseChannel,
  MAX_PER_DAY,
  MIN_GAP_HOURS,
  PER_KIND_COOLDOWN_HOURS,
  QUIET_HOURS,
  type RateState,
} from './deliver';

// 13:00 UTC is 14:00 BST — mid-afternoon, comfortably inside quiet hours.
const NOW = new Date('2026-08-26T13:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

function state(over: Partial<RateState> = {}): RateState {
  return { todayCount: 0, lastDeliveredAt: null, lastByKind: new Map(), ...over };
}

const opts = { now: NOW, threshold: 0.5, hasPushSubscriber: true };
const thought = { kind: 'near_offer', score: 0.9 };

describe('chooseChannel', () => {
  it('pushes a strong thought when nothing is in the way', () => {
    const d = chooseChannel(thought, state(), opts);
    expect(d.channel).toBe('push');
    expect(d.suppressedReason).toBeNull();
  });

  it('holds back anything below the threshold', () => {
    const d = chooseChannel({ ...thought, score: 0.2 }, state(), opts);
    expect(d.channel).toBe('silent');
    expect(d.suppressedReason).toContain('below_threshold');
  });

  it('never buzzes outside quiet hours, however high it scored', () => {
    // 06:00 UTC is 07:00 BST — before the 08:00 open.
    const early = new Date('2026-08-26T06:00:00Z');
    const d = chooseChannel({ ...thought, score: 1 }, state(), { ...opts, now: early });
    expect(d.channel).toBe('silent');
    expect(d.suppressedReason).toBe('quiet_hours');
  });

  it('will not let one kind interrupt twice in a day', () => {
    const s = state({ lastByKind: new Map([['near_offer', hoursAgo(2)]]) });
    const d = chooseChannel(thought, s, opts);
    expect(d.channel).toBe('silent');
    expect(d.suppressedReason).toBe('kind_cooldown');
  });

  it('lets a DIFFERENT kind through the same cooldown', () => {
    const s = state({ lastByKind: new Map([['near_offer', hoursAgo(2)]]) });
    const d = chooseChannel({ kind: 'free_window', score: 0.9 }, s, opts);
    expect(d.channel).toBe('push');
  });

  it('stops at the daily cap', () => {
    const s = state({ todayCount: MAX_PER_DAY, lastDeliveredAt: hoursAgo(9) });
    const d = chooseChannel(thought, s, opts);
    expect(d.channel).toBe('silent');
    expect(d.suppressedReason).toBe('daily_cap');
  });

  it('enforces a minimum gap between interruptions', () => {
    const s = state({ todayCount: 1, lastDeliveredAt: hoursAgo(MIN_GAP_HOURS - 1) });
    const d = chooseChannel(thought, s, opts);
    expect(d.channel).toBe('silent');
    expect(d.suppressedReason).toBe('min_gap');
  });

  it('allows the next one once the gap has passed', () => {
    const s = state({ todayCount: 1, lastDeliveredAt: hoursAgo(MIN_GAP_HOURS + 0.5) });
    expect(chooseChannel(thought, s, opts).channel).toBe('push');
  });

  it('falls back to chat when there is nowhere to push', () => {
    const d = chooseChannel(thought, state(), { ...opts, hasPushSubscriber: false });
    expect(d.channel).toBe('chat');
    expect(d.suppressedReason).toBeNull();
  });

  it('checks the threshold before quiet hours, so the reason is the honest one', () => {
    // A weak thought at 3am is held back for being weak, not for the hour —
    // the ledger has to say which, or the page teaches the wrong lesson.
    const night = new Date('2026-08-26T02:00:00Z');
    const d = chooseChannel({ ...thought, score: 0.1 }, state(), { ...opts, now: night });
    expect(d.suppressedReason).toContain('below_threshold');
  });
});

describe('the limits themselves', () => {
  it('are the ones that make push-forward survivable', () => {
    // These numbers are the feature, not administrative trim. A proactive
    // assistant that fires thirty times a day gets muted permanently, and
    // then none of the rest of this exists.
    expect(MAX_PER_DAY).toBeLessThanOrEqual(4);
    expect(MIN_GAP_HOURS).toBeGreaterThanOrEqual(3);
    expect(PER_KIND_COOLDOWN_HOURS).toBeGreaterThanOrEqual(12);
    expect(QUIET_HOURS.start).toBeGreaterThanOrEqual(7);
    expect(QUIET_HOURS.end).toBeLessThanOrEqual(22);
  });
});

describe('feed-only kinds', () => {
  // The owner's call (2026-08-28): security mail earns a buzz, money admin and
  // official post do not. Routing, not scoring — so a quiet week cannot
  // promote a tax code into an interruption for want of competition.
  const wideOpen: RateState = {
    todayCount: 0,
    lastDeliveredAt: null,
    lastByKind: new Map(),
  };
  const opts = {
    now: new Date('2026-08-28T10:00:00Z'),
    threshold: 0.5,
    hasPushSubscriber: true,
    hasWhatsApp: true,
  };

  it('pushes account security', () => {
    const d = chooseChannel({ kind: 'mail_security', score: 0.9 }, wideOpen, opts);
    expect(d.channel).toBe('whatsapp');
  });

  it('keeps money admin in the feed however well it scores', () => {
    const d = chooseChannel({ kind: 'mail_money_admin', score: 0.99 }, wideOpen, opts);
    expect(d.channel).toBe('silent');
    expect(d.suppressedReason).toBe('feed_only');
  });

  it('keeps official post and unusual senders in the feed', () => {
    expect(chooseChannel({ kind: 'mail_official', score: 0.99 }, wideOpen, opts).suppressedReason).toBe('feed_only');
    expect(chooseChannel({ kind: 'mail_unusual', score: 0.99 }, wideOpen, opts).suppressedReason).toBe('feed_only');
  });

  it('does not let a feed-only thought consume an interruption slot', () => {
    // Checked before the daily cap, so a day of price rises cannot crowd out
    // the one security mail that mattered.
    const capped: RateState = { todayCount: 99, lastDeliveredAt: null, lastByKind: new Map() };
    expect(chooseChannel({ kind: 'mail_official', score: 0.9 }, capped, opts).suppressedReason).toBe('feed_only');
  });

  it('still holds a feed-only thought below the threshold for the usual reason', () => {
    const d = chooseChannel({ kind: 'mail_official', score: 0.1 }, wideOpen, opts);
    expect(d.suppressedReason).toContain('below_threshold');
  });
});
