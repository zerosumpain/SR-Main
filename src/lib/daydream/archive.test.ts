import { describe, expect, it } from 'vitest';
import { PROTECTED_STATUSES } from './thought-store';

/**
 * The one invariant behind the OK button.
 *
 * `archiveThought` writes `status = 'archived'`, and `persistCandidates` runs
 * every ten minutes: it re-derives the same candidate, finds the row by
 * `dedupeKey`, and rewrites it unless its status is protected. So filing a card
 * away is durable ONLY while `archived` is in that list, and the two live in
 * different functions with nothing but this test between them.
 *
 * It was genuinely wrong when the button first shipped — the card came back
 * within ten minutes, which reads as "the button does nothing" rather than as a
 * bug in a list somewhere else.
 *
 * A unit test rather than an integration one on purpose: the persistCandidates
 * suite is `*.integration.test.ts`, which `gate:test` and CI both exclude, so
 * the assertion that actually guards this in CI has to be one that needs no
 * database.
 */
describe('archiving is durable', () => {
  it('protects `archived` from the detect tick', () => {
    expect(PROTECTED_STATUSES).toContain('archived');
    // Auto-filed rows must survive the ten-minute re-detection the same way.
    expect(PROTECTED_STATUSES).toContain('expired');
  });

  it('still protects the three verdicts that predate it', () => {
    for (const s of ['dismissed', 'snoozed', 'actioned']) {
      expect(PROTECTED_STATUSES).toContain(s);
    }
  });

  it('does not protect the two the engine must be free to refresh', () => {
    // A standing proposal is one row, re-scored every tick. Protecting either
    // of these would freeze the feed at whatever the first run happened to say.
    expect(PROTECTED_STATUSES).not.toContain('new');
    expect(PROTECTED_STATUSES).not.toContain('suppressed');
  });
});
