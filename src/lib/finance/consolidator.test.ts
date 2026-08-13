import { describe, it, expect } from 'vitest';
import { consolidateFinanceData, type FinanceInput } from './consolidator';

describe('consolidateFinanceData', () => {
  const baseInput: FinanceInput = {
    gmailInvoices: [
      { id: 'g1', subject: 'Your receipt from Netflix', date: '2026-08-01T10:00:00Z', amount: 15.99, currency: 'GBP' },
      { id: 'g2', subject: 'Invoice from Spotify', date: '2026-08-02T10:00:00Z', amount: 9.99, currency: 'GBP' },
    ],
    paypalTransactions: [
      { id: 'p1', description: 'Netflix - Subscription', date: '2026-08-01T10:00:00Z', amount: 15.99, currency: 'GBP' },
    ],
    paypalSubscriptions: [
      { id: 's1', name: 'Netflix', status: 'ACTIVE', amount: 15.99, currency: 'GBP' },
    ],
    truelayerAccounts: [
      {
        account_id: 'a1',
        account_name: 'Current',
        transactions: [
          { transaction_id: 't1', description: 'SPOTIFY', amount: 9.99, currency: 'GBP', timestamp: '2026-08-02T10:00:00Z' },
        ],
      },
    ],
  };

  it('flags Gmail subscriptions not in PayPal or bank', () => {
    const result = consolidateFinanceData(baseInput);
    expect(result.flaggedNewSubscriptions).toHaveLength(1);
    expect(result.flaggedNewSubscriptions[0].name).toBe('Spotify');
    expect(result.flaggedNewSubscriptions[0].reason).toContain('not found');
  });

  it('does not flag subscriptions present in PayPal or bank', () => {
    const result = consolidateFinanceData(baseInput);
    const flaggedNames = result.flaggedNewSubscriptions.map(f => f.name);
    expect(flaggedNames).not.toContain('Netflix');
  });

  it('merges subscriptions across sources', () => {
    const result = consolidateFinanceData(baseInput);
    const netflix = result.subscriptions.find(s => s.name === 'Netflix');
    expect(netflix).toBeDefined();
    expect(netflix?.amount).toBe(15.99);
    const spotify = result.subscriptions.find(s => s.name === 'Spotify');
    expect(spotify).toBeDefined();
    expect(spotify?.source).toBe('truelayer');
  });

  it('computes monthly spend', () => {
    const result = consolidateFinanceData(baseInput);
    expect(result.monthlySpend).toHaveLength(1);
    expect(result.monthlySpend[0].month).toBe('2026-08');
    expect(result.monthlySpend[0].total).toBeCloseTo(25.98);
    expect(result.monthlySpend[0].topSubscriptions[0].name).toBe('Netflix');
  });

  it('handles empty input', () => {
    const result = consolidateFinanceData({});
    expect(result.subscriptions).toHaveLength(0);
    expect(result.flaggedNewSubscriptions).toHaveLength(0);
    expect(result.monthlySpend).toHaveLength(0);
    expect(result.summary.totalSubscriptions).toBe(0);
  });

  it('normalizes merchant names case-insensitively', () => {
    const input: FinanceInput = {
      gmailInvoices: [{ subject: 'Receipt from ACME Corp', amount: 10, currency: 'USD' }],
      paypalTransactions: [{ description: 'acme corp - monthly', amount: 10, currency: 'USD' }],
    };
    const result = consolidateFinanceData(input);
    expect(result.flaggedNewSubscriptions).toHaveLength(0);
    expect(result.subscriptions).toHaveLength(1);
  });
});
