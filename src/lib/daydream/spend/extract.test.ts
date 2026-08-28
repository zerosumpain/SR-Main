import { describe, it, expect } from 'vitest';
import {
  findAmounts,
  formatAmount,
  shortlist,
  spendDensity,
  verifyAmount,
  MIN_RECEIPTS_PER_WEEK_FOR_SWEEP,
} from './extract';

// Every subject line below is a real one from production.
describe('shortlist', () => {
  it('accepts a genuine receipt', () => {
    expect(shortlist('Your order #10482 has been confirmed').isCandidate).toBe(true);
    expect(shortlist('Receipt for your payment').isCandidate).toBe(true);
  });

  // The whole point. 605 emails carry an amount and only 34 are receipts; the
  // rest advertise prices. A spend series built from the other 571 would track
  // marketing volume and be false in every particular.
  it('rejects the marketing that mentions money', () => {
    for (const s of [
      '💵 Price reduced by £34.30 💵 for Dell Optiplex 7060',
      'Luxury Escapes From £879pp? Yes, Really 💫',
      'Virgin Money: Up to 12 months at 0% and a 0% transfer fee',
      "Final call: Your £10 Hotels.comCash is expiring",
      "John, here's your health insurance quote",
      'We found something you might like',
    ]) {
      expect(shortlist(s).isCandidate, s).toBe(false);
    }
  });

  // A promotional subject that happens to say "order" is far commoner than a
  // receipt that happens to say "sale", so the veto wins.
  it('lets an advert veto a receipt word', () => {
    const r = shortlist('Order now and save 20% in our summer sale');
    expect(r.isCandidate).toBe(false);
    expect(r.vetoed).toContain('promotion');
  });
});

describe('findAmounts', () => {
  it('reads pounds, dollars and euros as integer minor units', () => {
    expect(findAmounts('Total: £12.99')[0]).toMatchObject({ amountMinor: 1299, currency: 'GBP' });
    expect(findAmounts('$5')[0]).toMatchObject({ amountMinor: 500, currency: 'USD' });
    expect(findAmounts('€1.50')[0]).toMatchObject({ amountMinor: 150, currency: 'EUR' });
  });

  it('handles thousands separators', () => {
    expect(findAmounts('£1,234.56')[0].amountMinor).toBe(123456);
  });

  it('keeps the exact text it read from', () => {
    expect(findAmounts('Paid £8.40 today')[0].evidence).toBe('£8.40');
  });

  it('finds nothing in text with no money', () => {
    expect(findAmounts('your parcel is on its way')).toEqual([]);
  });
});

describe('verifyAmount', () => {
  const body = 'Order total £42.50 including £3.99 delivery.';

  it('accepts an amount that is really there', () => {
    const v = verifyAmount(body, { amountMinor: 4250, currency: 'GBP' });
    expect(v.ok).toBe(true);
    expect(v.evidence).toBe('£42.50');
  });

  // The most likely and most dangerous model error: computing a total nobody
  // wrote down. £42.50 + £3.99 = £46.49, which appears nowhere.
  it('rejects a total the model worked out for itself', () => {
    expect(verifyAmount(body, { amountMinor: 4649, currency: 'GBP' }).ok).toBe(false);
  });

  it('rejects the right number in the wrong currency', () => {
    expect(verifyAmount(body, { amountMinor: 4250, currency: 'USD' }).ok).toBe(false);
  });
});

describe('formatAmount', () => {
  it('renders minor units back to money', () => {
    expect(formatAmount(4250)).toBe('£42.50');
    expect(formatAmount(500, 'USD')).toBe('$5.00');
  });
});

describe('spendDensity', () => {
  // The measured state at build time: 34 receipts over 56 days is ~4.25/week,
  // which is nulls on most days. Letting that into a correlation sweep would
  // produce underpowered verdicts at best and spurious ones at worst.
  it('reports the real density as not ready', () => {
    const d = spendDensity(34, 56);
    expect(d.perWeek).toBeCloseTo(4.3, 1);
    expect(d.readyForSweep).toBe(false);
    expect(d.needed).toBe(MIN_RECEIPTS_PER_WEEK_FOR_SWEEP);
  });

  it('lets a dense enough series through', () => {
    expect(spendDensity(120, 56).readyForSweep).toBe(true);
  });

  it('does not divide by zero on an empty window', () => {
    expect(spendDensity(0, 0).perWeek).toBe(0);
  });
});
