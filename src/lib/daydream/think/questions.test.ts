import { describe, it, expect } from 'vitest';
import {
  CHANNELS,
  OUTCOMES,
  OUTCOME_SHARE,
  SCHEDULE,
  SKIP,
  THINK_CADENCE_MS,
  VISITS_PER_PERIOD,
  isSkipped,
  questionAt,
  questionForSlot,
  slotAt,
  type Channel,
  type Outcome,
} from './questions';

const WEEK_SLOTS = (7 * 24 * 3_600_000) / THINK_CADENCE_MS;

/** London hour of a slot's start. */
function londonHour(slot: number): number {
  const d = new Date(slot * THINK_CADENCE_MS);
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }).format(d)) % 24;
}

function tally(slots: number[]) {
  const channels = new Map<Channel, number>();
  const outcomes = new Map<Outcome, number>();
  for (const s of slots) {
    const q = questionForSlot(s);
    channels.set(q.channel, (channels.get(q.channel) ?? 0) + 1);
    outcomes.set(q.outcome, (outcomes.get(q.outcome) ?? 0) + 1);
  }
  return { channels, outcomes };
}

describe('the schedule', () => {
  it('gives every channel the same number of visits', () => {
    for (const c of CHANNELS) expect(SCHEDULE[c]).toHaveLength(VISITS_PER_PERIOD);
  });

  it('gives every outcome its pinned share of a period', () => {
    const counts = new Map<Outcome, number>();
    for (const c of CHANNELS) for (const o of SCHEDULE[c]) counts.set(o, (counts.get(o) ?? 0) + 1);
    for (const o of OUTCOMES) expect(counts.get(o), o).toBe(OUTCOME_SHARE[o]);
    const total = Object.values(OUTCOME_SHARE).reduce((a, b) => a + b, 0);
    expect(total).toBe(CHANNELS.length * VISITS_PER_PERIOD);
  });

  it('looks at the week plan about once a day, not four times', () => {
    // One living plan (`subjects.ts`); the home and diary visits that wrote
    // a fresh copy of the same week every few hours were cut.
    expect(OUTCOME_SHARE.health_plan).toBe(3);
    expect(SCHEDULE.home).not.toContain('health_plan');
  });

  it('never schedules a pair the skip table forbids', () => {
    for (const c of CHANNELS) for (const o of SCHEDULE[c]) expect(isSkipped(c, o), `${c} × ${o}`).toBe(false);
  });

  it('keeps research cycles to research and suggestions, and research to research cycles', () => {
    // The injection boundary depends on this: a research cycle reads the web
    // and so may hold nothing private, which leaves it nothing else to do.
    expect(new Set(SCHEDULE.research)).toEqual(new Set(['research', 'suggest']));
    for (const c of CHANNELS) {
      if (c === 'research') continue;
      expect(SCHEDULE[c]).not.toContain('research');
    }
  });

  it('names a reason for every skipped pair', () => {
    for (const [, , why] of SKIP) expect(why.length).toBeGreaterThan(10);
  });

  it('skips build × chat, the pair the spec names', () => {
    expect(isSkipped('chat', 'build')).toBe(true);
  });
});

describe('the rotation', () => {
  it('is determined by the clock alone', () => {
    const now = new Date('2026-09-25T18:10:00Z');
    expect(questionAt(now)).toEqual(questionAt(new Date(now.getTime())));
    // Anywhere inside the same 45-minute slot is the same question.
    const start = new Date(slotAt(now) * THINK_CADENCE_MS);
    expect(questionAt(new Date(start.getTime() + THINK_CADENCE_MS - 1))).toEqual(questionAt(start));
  });

  it('walks to a different channel on the next slot', () => {
    const s = slotAt(new Date('2026-09-25T18:10:00Z'));
    expect(questionForSlot(s + 1).channel).not.toBe(questionForSlot(s).channel);
  });

  it('is exactly even over a week of slots', () => {
    const base = slotAt(new Date('2026-09-21T00:00:00Z'));
    const slots = Array.from({ length: WEEK_SLOTS }, (_, i) => base + i);
    const { channels, outcomes } = tally(slots);
    for (const c of CHANNELS) expect(channels.get(c), c).toBe(WEEK_SLOTS / CHANNELS.length);
    const periods = WEEK_SLOTS / (CHANNELS.length * VISITS_PER_PERIOD);
    for (const o of OUTCOMES) expect(outcomes.get(o), o).toBe(OUTCOME_SHARE[o] * periods);
  });

  it('is even over a week of the 07:00–23:00 window it actually runs in', () => {
    // A day is 32 slots and 32 mod 7 is 4, so each day starts the channel walk
    // four places on and a week covers every phase. Without that, the same
    // channels would own every morning.
    const base = slotAt(new Date('2026-09-21T00:00:00Z'));
    const slots = Array.from({ length: WEEK_SLOTS }, (_, i) => base + i).filter((s) => {
      const h = londonHour(s);
      return h >= 7 && h < 23;
    });
    const { channels, outcomes } = tally(slots);
    const perChannel = slots.length / CHANNELS.length;
    for (const c of CHANNELS) expect(Math.abs((channels.get(c) ?? 0) - perChannel), c).toBeLessThanOrEqual(1);
    for (const o of OUTCOMES) {
      const perOutcome = (slots.length * OUTCOME_SHARE[o]) / (CHANNELS.length * VISITS_PER_PERIOD);
      // Outcomes ride on each channel's visit counter, so the window cuts them
      // less cleanly than channels — within a fifth of an even share.
      expect(Math.abs((outcomes.get(o) ?? 0) - perOutcome) / perOutcome, o).toBeLessThanOrEqual(0.2);
    }
  });

  it('handles a slot before the epoch without an undefined', () => {
    const q = questionForSlot(-5);
    expect(CHANNELS).toContain(q.channel);
    expect(OUTCOMES).toContain(q.outcome);
  });

  it('writes a brief that names the channel and the ask', () => {
    const q = questionForSlot(0);
    expect(q.brief).toMatch(/THIS CYCLE STARTS FROM/);
    expect(q.brief.length).toBeGreaterThan(60);
  });
});
