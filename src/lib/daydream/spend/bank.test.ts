import { describe, it, expect } from 'vitest';
import { fromTrueLayer, fromPayPal, pullWindow } from './bank';

describe('fromTrueLayer', () => {
  const base = {
    transaction_id: 'tx-1',
    timestamp: '2026-08-26T14:30:00Z',
    description: 'TESCO STORES 3297',
    amount: -12.5,
    currency: 'GBP',
    transaction_type: 'DEBIT',
    merchant_name: 'Tesco',
  };

  it('maps a debit to minor units on the local day, verified by construction', () => {
    expect(fromTrueLayer(base)).toEqual({
      sourceNoteId: 'truelayer:tx-1',
      merchant: 'Tesco',
      amountMinor: 1250,
      currency: 'GBP',
      day: '2026-08-26',
      evidence: 'TESCO STORES 3297 -12.5 GBP',
    });
  });

  it('drops credits — salary is not spend', () => {
    expect(fromTrueLayer({ ...base, transaction_type: 'CREDIT', amount: 2500 })).toBeNull();
  });

  it('drops a row with no id or unparseable timestamp', () => {
    expect(fromTrueLayer({ ...base, transaction_id: undefined })).toBeNull();
    expect(fromTrueLayer({ ...base, timestamp: 'not-a-date' })).toBeNull();
  });

  it('falls back to the description when there is no merchant name', () => {
    expect(fromTrueLayer({ ...base, merchant_name: undefined })?.merchant).toBe('TESCO STORES 3297');
  });
});

describe('fromPayPal', () => {
  const detail = {
    transaction_info: {
      transaction_id: 'pp-9',
      transaction_initiation_date: '2026-08-25T20:00:00+0100',
      transaction_amount: { currency_code: 'GBP', value: '-6.99' },
      transaction_subject: 'Discogs order',
    },
  };

  it('keeps only money going out', () => {
    expect(fromPayPal(detail)).toEqual({
      sourceNoteId: 'paypal:pp-9',
      merchant: 'Discogs order',
      amountMinor: 699,
      currency: 'GBP',
      day: '2026-08-25',
      evidence: 'Discogs order -6.99 GBP',
    });
    expect(
      fromPayPal({
        transaction_info: { ...detail.transaction_info, transaction_amount: { currency_code: 'GBP', value: '6.99' } },
      }),
    ).toBeNull();
  });
});

describe('pullWindow', () => {
  it('spans days back to today in local YYYY-MM-DD', () => {
    expect(pullWindow(new Date('2026-08-27T10:00:00Z'), 7)).toEqual({
      from: '2026-08-20',
      to: '2026-08-27',
    });
  });
});
