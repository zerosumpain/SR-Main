import { describe, it, expect } from 'vitest';
import { assessLink, STALE_DAYS } from './provenance';

// `assessLink` is the function that must never flatter the data. Every other
// part of the panel is a query; this is the part that decides whether a link
// gets to call itself connected, and a provenance surface that says "flowing"
// about a starved path is worse than no surface at all.

describe('assessLink', () => {
  it('calls a path with nothing on it waiting, not flowing', () => {
    const l = assessLink({ to: 'Sweep', have: 0, flowingDetail: 'x' });
    expect(l.state).toBe('waiting');
    expect(l.detail).not.toContain('x');
  });

  it('reports have-vs-need when a minimum support is not met', () => {
    // The real case: 185 Home Assistant sensors registered, none with the 14
    // observed days a correlation needs.
    const l = assessLink({
      to: 'Sweep',
      have: 0,
      need: 1,
      flowingDetail: 'should not appear',
      waitingDetail: 'None yet — the best has 2 of the 14 days needed.',
    });
    expect(l.state).toBe('waiting');
    expect(l.have).toBe(0);
    expect(l.need).toBe(1);
    expect(l.detail).toContain('2 of the 14');
  });

  it('does not call something flowing just because it is wired', () => {
    const l = assessLink({ to: 'Hypotheses', have: 0, need: 5, flowingDetail: 'connected!' });
    expect(l.state).not.toBe('flowing');
  });

  it('calls a live path flowing, and carries the count that proves it', () => {
    const l = assessLink({
      to: 'Thoughts',
      have: 70,
      ageDays: 0,
      flowingDetail: '70 emails cited as evidence.',
    });
    expect(l.state).toBe('flowing');
    expect(l.detail).toContain('70');
  });

  it('calls a path that has gone quiet stalled, not flowing', () => {
    const l = assessLink({
      to: 'Thoughts',
      have: 5,
      ageDays: STALE_DAYS + 1,
      flowingDetail: '5 cited',
    });
    expect(l.state).toBe('stalled');
    expect(l.detail).toContain(`${STALE_DAYS + 1} days`);
  });

  it('does not call something stalled while it is still fresh', () => {
    expect(
      assessLink({ to: 'Thoughts', have: 5, ageDays: STALE_DAYS, flowingDetail: 'x' }).state,
    ).toBe('flowing');
  });

  it('treats unknown freshness as not-stalled rather than guessing', () => {
    // A source with no timestamp is not evidence of staleness. Inventing one
    // would put a warning on a path that may be perfectly healthy.
    expect(
      assessLink({ to: 'Thoughts', have: 5, ageDays: null, flowingDetail: 'x' }).state,
    ).toBe('flowing');
  });

  it('checks the minimum support BEFORE freshness', () => {
    // Otherwise a starved path that also happens to be old reports as merely
    // stale, and the actionable fact — it needs more days — is lost.
    const l = assessLink({
      to: 'Sweep',
      have: 2,
      need: 14,
      ageDays: 30,
      flowingDetail: 'x',
    });
    expect(l.state).toBe('waiting');
    expect(l.need).toBe(14);
  });
});
