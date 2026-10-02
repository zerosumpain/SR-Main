import { describe, expect, it } from 'vitest';
import { formatLedger, hasLedgerLine, reconcileSpend, sameMerchant, spendSource, type SpendRow } from './ledger';

let seq = 0;
const row = (sourceNoteId: string, merchant: string, pounds: number, day: string): SpendRow => ({
  id: `r${++seq}`,
  sourceNoteId,
  merchant,
  amountMinor: Math.round(pounds * 100),
  currency: 'GBP',
  day,
});
const bank = (merchant: string, pounds: number, day: string) => row(`truelayer:${++seq}`, merchant, pounds, day);
const paypal = (merchant: string, pounds: number, day: string) => row(`paypal:${++seq}`, merchant, pounds, day);
const email = (merchant: string, pounds: number, day: string) => row(`note-${++seq}`, merchant, pounds, day);

describe('spendSource', () => {
  it('reads provenance off the source id', () => {
    expect(spendSource('truelayer:abc')).toBe('bank');
    expect(spendSource('paypal:abc')).toBe('paypal');
    expect(spendSource('5f0c3c1e-0000-4000-8000-000000000000')).toBe('receipt');
  });
});

describe('sameMerchant', () => {
  it('matches the bank descriptor to the email sender', () => {
    expect(sameMerchant('APPLE.COM/BILL', 'Apple Services')).toBe(true);
    expect(sameMerchant('PAYPAL *STEAM', 'Steam Games')).toBe(true);
    expect(sameMerchant('Tesco Stores', 'Apple')).toBe(false);
  });
});

describe('reconcileSpend', () => {
  it('the owner’s case: a £79 Apple bank line and a £79 Apple receipt the next day are ONE payment', () => {
    const lines = reconcileSpend(
      [bank('APPLE.COM/BILL', 79, '2026-09-14'), email('Apple', 79, '2026-09-15')],
      { paypalConnected: true },
    );
    const charges = lines.filter((l) => l.role === 'charge');
    expect(charges).toHaveLength(1);
    expect(lines.find((l) => l.source === 'receipt')).toMatchObject({ role: 'receipt_confirms', counts: false, confirmed: true });
    const text = formatLedger(lines, { days: 30, since: '2026-09-01' });
    expect(text).toContain('APPLE.COM/BILL: 1× £79.00');
    expect(text).toContain('The same payment, not another.');
  });

  it('two real charges with two receipts stay two charges', () => {
    const lines = reconcileSpend(
      [
        bank('APPLE.COM/BILL', 79, '2026-09-14'),
        bank('APPLE.COM/BILL', 79, '2026-09-15'),
        email('Apple', 79, '2026-09-14'),
        email('Apple', 79, '2026-09-15'),
      ],
      { paypalConnected: true },
    );
    expect(lines.filter((l) => l.role === 'charge')).toHaveLength(2);
    expect(lines.filter((l) => l.role === 'receipt_confirms')).toHaveLength(2);
    // One receipt each, never both on one line.
    for (const c of lines.filter((l) => l.role === 'charge')) expect(c.pairedWith).toHaveLength(1);
  });

  it('an invoice AND a receipt for one payment are both paperwork', () => {
    const lines = reconcileSpend(
      [bank('Canva', 13, '2026-08-28'), email('Canva invoice', 13, '2026-08-28'), email('Canva receipt', 13, '2026-08-28')],
      { paypalConnected: true },
    );
    expect(lines.filter((l) => l.counts)).toHaveLength(1);
    expect(lines.filter((l) => l.role === 'receipt_confirms')).toHaveLength(2);
  });

  it('a receipt with no ledger line is unconfirmed but still the only record of that spend', () => {
    const [r] = reconcileSpend([email('Netflix', 10.99, '2026-09-20')], { paypalConnected: true });
    expect(r).toMatchObject({ role: 'receipt_unmatched', counts: true, confirmed: false });
  });

  it('a receipt too far from the bank line does not pair', () => {
    const lines = reconcileSpend([bank('Apple', 79, '2026-09-01'), email('Apple', 79, '2026-09-20')], { paypalConnected: true });
    expect(lines.find((l) => l.source === 'receipt')?.role).toBe('receipt_unmatched');
  });

  it('PayPal roll-up: four PayPal payments and one bank top-up covering them count four times, not five', () => {
    const lines = reconcileSpend(
      [
        paypal('Steam', 12, '2026-09-02'),
        paypal('eBay seller', 20.5, '2026-09-03'),
        paypal('Etsy shop', 7.25, '2026-09-05'),
        paypal('Ko-fi', 3, '2026-09-06'),
        bank('PAYPAL PAYMENT', 42.75, '2026-09-08'),
      ],
      { paypalConnected: true },
    );
    const topup = lines.find((l) => l.role === 'paypal_topup')!;
    expect(topup.counts).toBe(false);
    expect(topup.pairedWith).toHaveLength(4);
    expect(lines.filter((l) => l.counts)).toHaveLength(4);
    expect(lines.filter((l) => l.counts).reduce((s, l) => s + l.amountMinor, 0)).toBe(4275);
    const text = formatLedger(lines, { days: 30, since: '2026-09-01' });
    expect(text).toContain('funds 4 PayPal payments');
    expect(text).toContain('Funded by the bank top-up on 2026-09-08');
  });

  it('a roll-up finds a non-adjacent subset and leaves the other payment alone', () => {
    const lines = reconcileSpend(
      [
        paypal('Steam', 12, '2026-09-02'),
        paypal('Spotify', 9.99, '2026-09-03'),
        paypal('Etsy shop', 8, '2026-09-04'),
        bank('PAYPAL PAYMENT', 20, '2026-09-06'),
      ],
      { paypalConnected: true },
    );
    const topup = lines.find((l) => l.role === 'paypal_topup')!;
    const covered = topup.pairedWith.map((id) => lines.find((l) => l.id === id)!.merchant).sort();
    expect(covered).toEqual(['Etsy shop', 'Steam']);
    expect(lines.find((l) => l.merchant === 'Spotify')?.pairedWith).toEqual([]);
  });

  it('a per-purchase PayPal bank line pairs with its one PayPal payment, and the receipt with the payment', () => {
    const lines = reconcileSpend(
      [paypal('Apple', 79, '2026-09-14'), bank('PAYPAL *APPLE', 79, '2026-09-15'), email('Apple', 79, '2026-09-14')],
      { paypalConnected: true },
    );
    expect(lines.filter((l) => l.counts)).toHaveLength(1);
    const receipt = lines.find((l) => l.source === 'receipt')!;
    // The merchant's own payment, not the top-up.
    expect(lines.find((l) => l.id === receipt.pairedWith[0])?.source).toBe('paypal');
  });

  it('without the PayPal feed, the bank line to PayPal IS the purchase', () => {
    const [l] = reconcileSpend([bank('PAYPAL *APPLE', 79, '2026-09-15')], { paypalConnected: false });
    expect(l).toMatchObject({ role: 'charge', counts: true });
    expect(formatLedger([l], { days: 30, since: '2026-09-01' })).toContain('Paid through PayPal');
  });

  it('an unmatched top-up is still not a purchase when the PayPal feed is connected', () => {
    const [l] = reconcileSpend([bank('PAYPAL PAYMENT', 30, '2026-09-15')], { paypalConnected: true });
    expect(l).toMatchObject({ role: 'paypal_topup', counts: false });
  });
});

describe('formatLedger', () => {
  it('a merchant filter still shows the paperwork paired with a matching line', () => {
    const lines = reconcileSpend([bank('APPLE.COM/BILL', 79, '2026-09-14'), email('iTunes receipt', 79, '2026-09-15')], { paypalConnected: true });
    const text = formatLedger(lines, { days: 30, since: '2026-09-01', filter: (l) => /apple/i.test(l.merchant) });
    expect(text).toContain('iTunes receipt');
  });

  it('says loudly when there is no ledger at all', () => {
    const lines = reconcileSpend([email('Apple', 79, '2026-09-14')], { paypalConnected: false });
    expect(formatLedger(lines, { days: 30, since: '2026-09-01' })).toContain('NOTHING below is confirmed');
  });

  it('tags ledger lines so the double-check can tell one was read', () => {
    const lines = reconcileSpend([bank('Apple', 79, '2026-09-14')], { paypalConnected: true });
    expect(hasLedgerLine(formatLedger(lines, { days: 30, since: '2026-09-01' }))).toBe(true);
    const emailOnly = reconcileSpend([email('Apple', 79, '2026-09-14')], { paypalConnected: true });
    expect(hasLedgerLine(formatLedger(emailOnly, { days: 30, since: '2026-09-01' }))).toBe(false);
  });
});
