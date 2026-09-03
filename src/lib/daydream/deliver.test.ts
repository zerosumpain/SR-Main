import { describe, it, expect } from 'vitest';
import {
  chooseChannel,
  MAX_PER_DAY,
  MIN_GAP_HOURS,
  PER_KIND_COOLDOWN_HOURS,
  QUIET_HOURS,
  isInterruptingChannel,
  type RateState,
} from './deliver';

// 13:00 UTC is 14:00 BST — mid-afternoon, comfortably inside quiet hours.
const NOW = new Date('2026-08-26T13:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

function state(over: Partial<RateState> = {}): RateState {
  return { todayCount: 0, lastDeliveredAt: null, lastByKind: new Map(), ...over };
}

// `near_offer` is a pattern and patterns wait for the briefing by default, so
// the fixture routes them to WhatsApp — these tests are about the caps.
const opts = { now: NOW, threshold: 0.5, hasPushSubscriber: true, routes: { patterns: 'whatsapp' as const } };
// Every gate below the verdict is only reachable by a thought that passed the
// review, so the shared fixture carries one. A test that wants to exercise the
// review gate itself overrides it explicitly.
const thought = { kind: 'near_offer', score: 0.9, reviewVerdict: 'verified' as const };
const VERIFIED = { reviewVerdict: 'verified' as const };

describe('chooseChannel', () => {
  it('pushes a strong thought when nothing is in the way', () => {
    const d = chooseChannel(thought, state(), opts);
    expect(d.channel).toBe('push');
    expect(d.suppressedReason).toBeNull();
  });

  // The threshold no longer gates delivery. It was a cold-start proxy for "is
  // this any good"; a reviewer that has read the sources answers that directly,
  // so a verified thought is not held back by a score it beat anyway.
  it('holds a verified thought below the bar for the briefing', () => {
    const d = chooseChannel({ ...thought, score: 0.2 }, state(), opts);
    expect(d.channel).toBe('silent');
    expect(d.suppressedReason).toBe('briefing_only');
  });

  it('holds a verified thought of a kind he has rated down for the briefing', () => {
    const d = chooseChannel({ ...thought, kindWeight: 0.8 }, state(), opts);
    expect(d.channel).toBe('silent');
    expect(d.suppressedReason).toBe('briefing_only');
  });

  it('routes a graph link to the briefing however good it is', () => {
    const d = chooseChannel({ kind: 'intel_missing_link', score: 0.99, ...VERIFIED }, state(), opts);
    expect(d.suppressedReason).toBe('briefing_only');
  });

  it('lets an owner override send a family to WhatsApp, and a kind override win over it', () => {
    expect(chooseChannel({ kind: 'free_window', score: 0.9, ...VERIFIED }, state(), { ...opts, routes: {} }).suppressedReason).toBe('briefing_only');
    expect(chooseChannel({ kind: 'free_window', score: 0.9, ...VERIFIED }, state(), { ...opts, routes: { patterns: 'whatsapp', free_window: 'feed' } }).suppressedReason).toBe('feed_only');
  });

  it('shortens the cooldown for a kind he rates up and lengthens it for one he rates down', () => {
    const s = state({ lastByKind: new Map([[thought.kind, hoursAgo(10)]]) });
    expect(chooseChannel(thought, s, opts).suppressedReason).toBe('kind_cooldown');
    expect(chooseChannel(thought, s, { ...opts, kindRelevance: new Map([[thought.kind, 5]]) }).channel).toBe('push');
    const s2 = state({ lastByKind: new Map([[thought.kind, hoursAgo(30)]]) });
    expect(chooseChannel(thought, s2, opts).channel).toBe('push');
    expect(chooseChannel(thought, s2, { ...opts, kindRelevance: new Map([[thought.kind, 1]]) }).suppressedReason).toBe('kind_cooldown');
  });

  it('a verified thought at the bar with a neutral weight goes out', () => {
    const d = chooseChannel({ ...thought, score: 0.5, kindWeight: 1 }, state(), opts);
    expect(d.channel).toBe('push');
    expect(d.suppressedReason).toBeNull();
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
    const d = chooseChannel({ kind: 'free_window', score: 0.9, ...VERIFIED }, s, opts);
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

  it('checks the review before quiet hours, so the reason is the honest one', () => {
    // Same principle the threshold used to carry here: an unreviewed thought at
    // 3am is held back because nobody has checked it, not because of the hour.
    // The ledger has to say which, or the page teaches the wrong lesson — and
    // "quiet_hours" would suggest it is queued to go out in the morning when it
    // is in fact waiting on a verdict.
    const night = new Date('2026-08-26T02:00:00Z');
    const d = chooseChannel({ kind: 'near_offer', score: 0.9 }, state(), { ...opts, now: night });
    expect(d.suppressedReason).toBe('awaiting_review');
  });
});

describe('persisted interruption accounting', () => {
  it('counts every transport that can buzz the owner', () => {
    expect(isInterruptingChannel('whatsapp')).toBe(true);
    expect(isInterruptingChannel('push')).toBe(true);
    expect(isInterruptingChannel('chat')).toBe(true);
    expect(isInterruptingChannel('silent')).toBe(false);
    expect(isInterruptingChannel(null)).toBe(false);
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
    const d = chooseChannel({ kind: 'mail_security', score: 0.9, ...VERIFIED }, wideOpen, opts);
    expect(d.channel).toBe('whatsapp');
  });

  it('keeps money admin in the feed however well it scores', () => {
    const d = chooseChannel({ kind: 'mail_money_admin', score: 0.99, ...VERIFIED }, wideOpen, opts);
    expect(d.channel).toBe('silent');
    expect(d.suppressedReason).toBe('feed_only');
  });

  it('keeps official post and unusual senders in the feed', () => {
    expect(chooseChannel({ kind: 'mail_official', score: 0.99, ...VERIFIED }, wideOpen, opts).suppressedReason).toBe('feed_only');
    expect(chooseChannel({ kind: 'mail_unusual', score: 0.99, ...VERIFIED }, wideOpen, opts).suppressedReason).toBe('feed_only');
  });

  it('does not let a feed-only thought consume an interruption slot', () => {
    // Checked before the daily cap, so a day of price rises cannot crowd out
    // the one security mail that mattered.
    const capped: RateState = { todayCount: 99, lastDeliveredAt: null, lastByKind: new Map() };
    expect(chooseChannel({ kind: 'mail_official', score: 0.9, ...VERIFIED }, capped, opts).suppressedReason).toBe('feed_only');
  });

  it('still holds a feed-only thought, whatever it scored', () => {
    const d = chooseChannel({ kind: 'mail_official', score: 0.1, ...VERIFIED }, wideOpen, opts);
    expect(d.suppressedReason).toBe('feed_only');
  });
});

// ── The review gate ───────────────────────────────────────────────────────
//
// Owner's instruction, 2026-08-31: only a thought a model has checked against
// the sources may interrupt him. Everything upstream checks that a claim is
// well FORMED, never that it is RIGHT — "you were charged twice for Canva" is
// an invoice and a bank line describing one payment, and it passes every one of
// those earlier checks.
describe('only a reviewed thought interrupts him', () => {
  it('says nothing about a thought nobody has checked yet', () => {
    const d = chooseChannel({ kind: 'near_offer', score: 0.99 }, state(), opts);
    expect(d.channel).toBe('silent');
    expect(d.suppressedReason).toBe('awaiting_review');
  });

  it('says nothing about a refuted thought, however high it scored', () => {
    const d = chooseChannel(
      { kind: 'near_offer', score: 0.99, reviewVerdict: 'refuted' },
      state(),
      opts,
    );
    expect(d.channel).toBe('silent');
    expect(d.suppressedReason).toBe('refuted_by_review');
  });

  it('does not interrupt him for a maybe', () => {
    const d = chooseChannel(
      { kind: 'near_offer', score: 0.99, reviewVerdict: 'uncertain' },
      state(),
      opts,
    );
    expect(d.channel).toBe('silent');
    expect(d.suppressedReason).toBe('uncertain_after_review');
  });

  it('treats an unrecognised verdict as unreviewed, never as verified', () => {
    // The failure direction worth being strict about: a wrong "send" costs an
    // interruption about a thing that is not happening.
    const d = chooseChannel(
      { kind: 'near_offer', score: 0.99, reviewVerdict: 'probably?' },
      state(),
      opts,
    );
    expect(d.channel).toBe('silent');
  });

  it('lets a verified thought through the gates that remain', () => {
    // A verdict does not override quiet hours: at the bar and verified, the
    // hour still holds it.
    const night = new Date('2026-08-26T02:00:00Z');
    const d = chooseChannel({ ...thought, score: 0.9 }, state(), { ...opts, now: night });
    expect(d.suppressedReason).toBe('quiet_hours');
  });

  it('a verdict cannot buy a fifth interruption in a day', () => {
    const capped = state({ todayCount: MAX_PER_DAY });
    const d = chooseChannel(thought, capped, opts);
    expect(d.suppressedReason).toBe('daily_cap');
  });
});
