import { describe, expect, it } from 'vitest';
import {
  budgetLine,
  commissionRefusal,
  deliveryFacts,
  deliveryLine,
  deliveryTerminal,
  liveCapRefusal,
  quoteCard,
  quotaRefusal,
} from './commission';
import type { DeliveryState } from '$lib/constants/development';
import type { ToolPrincipal } from '$lib/tools/invoke-contract';

/** The rules of commissioning a build, without the database (slice 6b). */
const OWNER: ToolPrincipal = { principalId: 'owner', via: 'session', attended: true, jobId: 'j' };
const BUDGET = { maxIterations: 25, maxTotalMinutes: 120, maxCostUsd: 2 };

function state(over: Partial<DeliveryState> = {}): DeliveryState {
  return {
    version: 1, area: 'Platform', stage: 'building',
    brief: { revision: 1, outcome: 'x', constraints: '', routes: [], acceptedAt: 'a' },
    criteria: [
      { id: 'c1', text: 'a', verdict: 'passed', evidence: 'seen', revision: 'r1' },
      { id: 'c2', text: 'b', verdict: 'unverified', evidence: '', revision: null },
    ],
    decisions: [], session: { engine: 'pi', id: null, file: null, recovery: null },
    candidate: 'r1', gate: null, preview: { url: null, status: 'unavailable', detail: '' },
    batch: null, acceptedAt: null, releasePolicy: 'preview_only',
    ...over,
  } as DeliveryState;
}

describe('commissionRefusal', () => {
  it('lets the attended owner in a browser commission a preview or a draft pull request', () => {
    for (const releasePolicy of ['preview_only', 'pull_request'] as const) {
      expect(commissionRefusal({ source: 'chat', principal: OWNER, releasePolicy, target: 'sr-main' })).toBeNull();
    }
  });

  it('refuses unattended callers, by name', () => {
    expect(commissionRefusal({ source: 'chat', principal: { principalId: 'owner', via: 'whatsapp', attended: false }, releasePolicy: 'preview_only', target: 'sr-main' })).toMatch(/Not from WhatsApp/);
    expect(commissionRefusal({ source: 'chat', principal: { principalId: 'owner', via: 'heartbeat', attended: false }, releasePolicy: 'preview_only', target: 'sr-main' })).toMatch(/background check-in/);
    expect(commissionRefusal({ source: 'daydream', principal: { principalId: 'owner', via: 'service', attended: false, purpose: 'daydream-think' }, releasePolicy: 'preview_only', target: 'sr-main' })).toMatch(/Not from/);
    expect(commissionRefusal({ source: 'chat', principal: undefined, releasePolicy: 'preview_only', target: 'sr-main' })).toMatch(/Not from/);
  });

  it('refuses a paired phone from chat, even attended', () => {
    expect(commissionRefusal({ source: 'chat', principal: { ...OWNER, via: 'device' }, releasePolicy: 'preview_only', target: 'sr-main' })).toMatch(/phone/);
  });

  it('refuses a member', () => {
    expect(commissionRefusal({ source: 'chat', principal: { ...OWNER, principalId: 'u_kid' }, releasePolicy: 'preview_only', target: 'sr-main' })).toMatch(/Not from/);
  });

  it('lets the nightly lane through unattended', () => {
    expect(commissionRefusal({ source: 'selfimprove', principal: undefined, releasePolicy: 'pull_request', target: 'sr-main' })).toBeNull();
  });

  it("refuses 'production' from chat and the phone, and keeps it on the web form", () => {
    expect(commissionRefusal({ source: 'chat', principal: OWNER, releasePolicy: 'production', target: 'sr-main' })).toMatch(/production is only on the New feature form/);
    expect(commissionRefusal({ source: 'phone', principal: OWNER, releasePolicy: 'production', target: 'sr-main' })).toMatch(/production/);
    expect(commissionRefusal({ source: 'web', principal: OWNER, releasePolicy: 'production', target: 'sr-main' })).toBeNull();
  });

  it('targets SR-Main only (decision 7)', () => {
    expect(commissionRefusal({ source: 'chat', principal: OWNER, releasePolicy: 'preview_only', target: 'sr-appleapp' })).toMatch(/isn't buildable here yet/);
  });
});

describe('the cost guards', () => {
  it('refuses over the ChatGPT ceiling, plainly', () => {
    expect(quotaRefusal({ fiveHourPct: 82, weeklyPct: 10 })).toBe("The ChatGPT window is 82% used, so I won't start a build now. Try after it resets.");
    expect(quotaRefusal({ fiveHourPct: 10, weeklyPct: 91 })).toMatch(/week is 91%/);
    expect(quotaRefusal({ fiveHourPct: 79, weeklyPct: 89 })).toBeNull();
    expect(quotaRefusal(null)).toBeNull();
  });

  it('allows two live commissions and refuses the third', () => {
    expect(liveCapRefusal(1)).toBeNull();
    expect(liveCapRefusal(2)).toMatch(/2 commissioned builds are already running/);
  });
});

describe('the quote card', () => {
  it('says the four things in the plan, with the budget in dollars', () => {
    const q = quoteCard({ outcome: 'Add X to the backlog page\nmore', releasePolicy: 'pull_request', budget: BUDGET, mark: { fiveHourPct: 34, weeklyPct: 12 }, live: 0 });
    expect(q.lines).toEqual([
      'Commission a build on SR-Main: Add X to the backlog page',
      'Stops at: Draft pull request',
      'Spend: up to 25 rounds, 2 hours, $2',
      'Quota now: ChatGPT 34% of the 5-hour window, 12% of the week',
    ]);
    expect(q.refusal).toBeNull();
  });

  it('carries the refusal so the card is never shown for something refused', () => {
    expect(quoteCard({ releasePolicy: 'preview_only', budget: BUDGET, mark: { fiveHourPct: 90, weeklyPct: 1 }, live: 0 }).refusal).toMatch(/90% used/);
    expect(quoteCard({ releasePolicy: 'preview_only', budget: BUDGET, mark: null, live: 2 }).refusal).toMatch(/already running/);
    expect(quoteCard({ releasePolicy: 'preview_only', budget: BUDGET, mark: null, live: 0 }).lines[3]).toMatch(/could not be read/);
  });

  it('reads minutes that are not whole hours as minutes', () => {
    expect(budgetLine({ maxIterations: 6, maxTotalMinutes: 45, maxCostUsd: 1 })).toBe('up to 6 rounds, 45 minutes, $1');
  });
});

describe('a delivery, as the thread reads it', () => {
  it('is terminal at a pull request, shipped, waiting on the owner, or stopped', () => {
    expect(deliveryTerminal(state(), null)).toBe(false);
    expect(deliveryTerminal(state({ stage: 'pr_open' }), null)).toBe(true);
    expect(deliveryTerminal(state({ stage: 'deployed' }), null)).toBe(true);
    expect(deliveryTerminal(state({ release: { revision: 'r', awaitingOwner: 'Mark it ready' } }), null)).toBe(true);
    expect(deliveryTerminal(state({ autopilot: { enabled: true, rounds: 6, maxRounds: 6, startedAt: 's', stopReason: 'Out of rounds' } }), null)).toBe(true);
    expect(deliveryTerminal(state(), 'stopped_by_user')).toBe(true);
  });

  it('counts criteria the way acceptance does and says the links', () => {
    const f = deliveryFacts(
      state({ stage: 'pr_open', preview: { url: 'https://p.example', status: 'ready', detail: '' }, release: { revision: 'r1', prUrl: 'https://github.com/x/pull/9' } }),
      null,
    );
    expect(f.criteria).toEqual({ met: 1, total: 2 });
    expect(deliveryLine(f)).toBe('Pull request open · 1 of 2 criteria met · preview https://p.example · pull request https://github.com/x/pull/9');
  });

  it('does not change with cost or time, only with the stage', () => {
    const a = deliveryLine(deliveryFacts(state(), null));
    expect(deliveryLine(deliveryFacts(state({ cycle: { startedAt: 'later', repairAttempts: 3, modelMs: 9, previewMs: 0, verificationMs: 0 } }), null))).toBe(a);
    expect(deliveryLine(deliveryFacts(state({ stage: 'review' }), null))).not.toBe(a);
  });
});
