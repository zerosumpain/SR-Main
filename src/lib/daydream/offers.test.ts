import { describe, it, expect } from 'vitest';
import {
  MIN_OFFER_SCORE,
  offerDedupeKey,
  parseExtraction,
  scoreOfferSubject,
} from './offers';

const NOW = new Date('2026-08-26T12:00:00Z');

describe('scoreOfferSubject', () => {
  // Real subject lines pulled from the production mailbox, so the filter is
  // tuned against what actually arrives rather than what I imagined would.
  it('clears the bar for a real voucher', () => {
    const s = scoreOfferSubject('Final call: Your £10 Hotels.comCash is expiring');
    expect(s.score).toBeGreaterThanOrEqual(MIN_OFFER_SCORE);
    expect(s.matched).toContain('currency_amount');
    expect(s.matched).toContain('expiry');
  });

  it('clears the bar for a percentage plus a code', () => {
    const s = scoreOfferSubject('20% off everything — use code AUTUMN20');
    expect(s.score).toBeGreaterThanOrEqual(MIN_OFFER_SCORE);
    expect(s.matched).toContain('percent_off');
    expect(s.matched).toContain('code');
  });

  it('rejects ordinary marketing with no offer in it', () => {
    for (const subject of [
      'Thanks for dropping by!',
      "It's time to think about winter!",
      'Built for Golfers in the 1930s. Rebuilt for Today.',
      'Your booking window is now open!',
      '4 new indie games added to help Venezuelan relief efforts!',
    ]) {
      expect(scoreOfferSubject(subject).score).toBeLessThan(MIN_OFFER_SCORE);
    }
  });

  it('rejects a receipt, which is a transaction and not an offer', () => {
    const s = scoreOfferSubject('Your order confirmation — 20% saved');
    expect(s.blocked).toContain('transactional');
    expect(s.score).toBeLessThan(MIN_OFFER_SCORE);
  });

  it('rejects a deals digest — a list of deals is not a deal you hold', () => {
    const s = scoreOfferSubject('Your weekly newsletter: the best sale picks');
    expect(s.score).toBeLessThan(MIN_OFFER_SCORE);
  });

  it('lets a strong voucher survive being inside a marketing blast', () => {
    // Anti-signals cost points rather than vetoing, precisely so this case —
    // a real voucher in a promotional mailshot — still gets through.
    const s = scoreOfferSubject('Weekly deals: £15 off your next order, use code SAVE15, ends Friday');
    expect(s.blocked.length).toBeGreaterThan(0);
    expect(s.score).toBeGreaterThanOrEqual(MIN_OFFER_SCORE);
  });

  it('does not fire on a bare price with nothing else', () => {
    // A currency amount alone is a price, not an offer.
    expect(scoreOfferSubject('Your £12.99 subscription renews soon').score).toBeLessThan(
      MIN_OFFER_SCORE,
    );
  });

  it('handles an empty or missing subject', () => {
    expect(scoreOfferSubject('').score).toBe(0);
    expect(scoreOfferSubject(null).score).toBe(0);
    expect(scoreOfferSubject(undefined).score).toBe(0);
  });
});

describe('parseExtraction', () => {
  it('reads a clean extraction', () => {
    const o = parseExtraction(
      '{"isOffer":true,"merchant":"Sports Direct","summary":"£20 off orders over £100","code":"SD20","expiresAt":"2026-09-10","confidence":"high"}',
      NOW,
    );
    expect(o).not.toBeNull();
    expect(o!.merchant).toBe('Sports Direct');
    expect(o!.code).toBe('SD20');
    expect(o!.expiresAt?.toISOString().slice(0, 10)).toBe('2026-09-10');
  });

  it('survives a fenced code block', () => {
    const o = parseExtraction(
      '```json\n{"isOffer":true,"merchant":"Nike","summary":"10% off","confidence":"medium"}\n```',
      NOW,
    );
    expect(o?.merchant).toBe('Nike');
  });

  it('returns null when the model says there is no offer', () => {
    expect(parseExtraction('{"isOffer":false}', NOW)).toBeNull();
  });

  it('returns null for prose instead of JSON', () => {
    expect(parseExtraction('This looks like a sale email about shoes.', NOW)).toBeNull();
  });

  it('drops an offer with no merchant — nothing could ever match it to a place', () => {
    expect(parseExtraction('{"isOffer":true,"summary":"20% off","merchant":""}', NOW)).toBeNull();
  });

  it('treats an absurd far-future expiry as no date at all', () => {
    // A model defaulting to a far-future date rather than reading one is the
    // failure that would keep a dead voucher live forever.
    const o = parseExtraction(
      '{"isOffer":true,"merchant":"Acme","summary":"£5 off","expiresAt":"2099-01-01"}',
      NOW,
    );
    expect(o?.expiresAt).toBeNull();
  });

  it('treats an unparseable date as no date rather than throwing', () => {
    const o = parseExtraction(
      '{"isOffer":true,"merchant":"Acme","summary":"£5 off","expiresAt":"whenever"}',
      NOW,
    );
    expect(o?.expiresAt).toBeNull();
  });

  it('defaults an unknown confidence to medium rather than high', () => {
    const o = parseExtraction('{"isOffer":true,"merchant":"Acme","summary":"£5 off"}', NOW);
    expect(o?.confidence).toBe('medium');
    const weird = parseExtraction(
      '{"isOffer":true,"merchant":"Acme","summary":"£5 off","confidence":"certain"}',
      NOW,
    );
    expect(weird?.confidence).toBe('medium');
  });
});

describe('offerDedupeKey', () => {
  it('collapses a re-send of the same voucher', () => {
    const a = { merchant: 'Sports Direct', code: 'SD20', expiresAt: new Date('2026-09-10T09:00:00Z') };
    const b = { merchant: 'sports  direct', code: 'sd20', expiresAt: new Date('2026-09-10T21:30:00Z') };
    expect(offerDedupeKey(a)).toBe(offerDedupeKey(b));
  });

  it('keeps two different vouchers apart', () => {
    const a = { merchant: 'Sports Direct', code: 'SD20', expiresAt: null };
    const b = { merchant: 'Sports Direct', code: 'SD50', expiresAt: null };
    expect(offerDedupeKey(a)).not.toBe(offerDedupeKey(b));
  });

  it('distinguishes a dated voucher from an undated one', () => {
    expect(offerDedupeKey({ merchant: 'X', expiresAt: null })).toContain('nodate');
    expect(
      offerDedupeKey({ merchant: 'X', expiresAt: new Date('2026-09-10T00:00:00Z') }),
    ).not.toContain('nodate');
  });
});
