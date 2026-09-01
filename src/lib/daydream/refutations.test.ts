import { describe, expect, it } from 'vitest';
import { claimRefs, echoOf, isSameClaim, MIN_SHARED_REFS } from './refutations';

/**
 * The eight rows production actually wrote, trimmed to what matters.
 *
 * Eight slugs, eight titles, one pair of spend rows: a £13 Canva invoice and
 * the bank line for the same payment. Six of them cost an xhigh review that
 * reached the same conclusion as the one before. If a change to this module
 * lets these stop matching, that is the bug coming back.
 */
const INVOICE = { kind: 'spend', id: '6b30b2d2-1a0e-451c-976a-eea89a0c8ee8' };
const BANK = { kind: 'spend', id: '406967fa-0b3c-46ee-a75c-b33aaa4be99b' };
const ANNOUNCEMENT = { kind: 'email', id: '6bece32f-b467-49b8-9d65-29bf15fb369a' };
/** The pack's own weekly-spend card. Present on most money musings. */
const AGGREGATE = { kind: 'features', id: 'spend7' };

const refutedCanva = {
  id: 't1',
  dedupeKey: 'musing:canva-duplicate-charge',
  title: 'Canva appears to have charged twice',
  refs: claimRefs([INVOICE, BANK]),
};

describe('claimRefs', () => {
  it('keys a claim on the rows it rests on, not on its prose', () => {
    expect([...claimRefs([INVOICE, BANK])]).toEqual([
      `spend:${INVOICE.id}`,
      `spend:${BANK.id}`,
    ]);
  });

  it('drops the pack aggregates — they identify nothing', () => {
    // `features:spend7` is on every money musing ever written. Counting it
    // would make every money claim the same claim as every other.
    expect(claimRefs([INVOICE, BANK, AGGREGATE]).size).toBe(2);
    expect(claimRefs([AGGREGATE]).size).toBe(0);
  });

  it('survives evidence that is missing, malformed or empty', () => {
    expect(claimRefs(null).size).toBe(0);
    expect(claimRefs('two spend rows').size).toBe(0);
    expect(claimRefs([{ kind: 'spend' }, { id: 'x' }, null, { kind: 'spend', id: '  ' }]).size).toBe(0);
  });
});

describe('isSameClaim', () => {
  it('matches the settled pair however the claim is worded', () => {
    // "Two Canva charges need checking" — the same two rows, a new sentence.
    expect(isSameClaim(claimRefs([INVOICE, BANK]), refutedCanva.refs)).toBe(true);
  });

  it('matches when the new claim adds a source to the settled ones', () => {
    // The eighth musing cited both spend rows plus the email announcing them.
    expect(isSameClaim(claimRefs([INVOICE, BANK, ANNOUNCEMENT]), refutedCanva.refs)).toBe(true);
  });

  it('matches when the new claim is a narrower reading of the same rows', () => {
    const wide = claimRefs([INVOICE, BANK, ANNOUNCEMENT]);
    expect(isSameClaim(claimRefs([INVOICE, BANK]), wide)).toBe(true);
  });

  it('does not match two claims that merely brush past each other', () => {
    // One row in common and one row each of their own is a different question.
    const other = claimRefs([INVOICE, { kind: 'spend', id: 'some-other-payment' }]);
    expect(isSameClaim(other, refutedCanva.refs)).toBe(false);
  });

  it('needs more than a single shared row', () => {
    expect(MIN_SHARED_REFS).toBeGreaterThan(1);
    expect(isSameClaim(claimRefs([INVOICE]), refutedCanva.refs)).toBe(false);
  });

  it('is false against nothing, in both directions', () => {
    expect(isSameClaim(claimRefs([INVOICE, BANK]), new Set())).toBe(false);
    expect(isSameClaim(new Set(), refutedCanva.refs)).toBe(false);
  });
});

describe('echoOf — the rename that used to buy a fresh review', () => {
  it('catches every one of the eight Canva slugs', () => {
    const slugs = [
      'musing:canva-double-debit-aug28',
      'musing:canva-two-charges-same-day',
      'musing:canva-duplicate-aug-28',
      'musing:canva-double-charge-check',
      'musing:duplicate-canva-charge',
      'musing:duplicate-canva-charge-check',
      'musing:canva-double-charge-review',
    ];
    for (const dedupeKey of slugs) {
      const hit = echoOf({ dedupeKey, evidence: [INVOICE, BANK, AGGREGATE] }, [refutedCanva]);
      expect(hit, dedupeKey).not.toBeNull();
      expect(hit?.title).toBe(refutedCanva.title);
    }
  });

  it('skips the refuted row itself — `persistCandidates` already handles that one', () => {
    const hit = echoOf(
      { dedupeKey: refutedCanva.dedupeKey, evidence: [INVOICE, BANK] },
      [refutedCanva],
    );
    expect(hit).toBeNull();
  });

  it('lets an unrelated claim through', () => {
    const hit = echoOf(
      {
        dedupeKey: 'musing:sleep-and-time-out',
        evidence: [
          { kind: 'health', id: 'h1' },
          { kind: 'calendar', id: 'c1' },
        ],
      },
      [refutedCanva],
    );
    expect(hit).toBeNull();
  });

  it('lets a claim with no evidence of its own through — it can be judged on its merits', () => {
    expect(echoOf({ dedupeKey: 'musing:x', evidence: [] }, [refutedCanva])).toBeNull();
    expect(echoOf({ dedupeKey: 'musing:x', evidence: [AGGREGATE] }, [refutedCanva])).toBeNull();
  });

  it('is a no-op when nothing has been refuted yet', () => {
    expect(echoOf({ dedupeKey: 'musing:x', evidence: [INVOICE, BANK] }, [])).toBeNull();
  });
});
