import { describe, expect, it } from 'vitest';
import { consolidateSubscriptions, normaliseMerchant } from '$lib/subscriptions/consolidation';

describe('normaliseMerchant', () => {
	it('removes payment-provider and legal-entity noise', () => {
		expect(normaliseMerchant('PAYPAL *Nétflix.com Ltd.')).toBe('netflix');
	});
});

describe('consolidateSubscriptions', () => {
	it('links Gmail evidence and identifies a regular recurring charge', () => {
		const [subscription] = consolidateSubscriptions({
			now: '2026-08-20T00:00:00Z',
			transactions: [
				{ id: 'one', merchant: 'PAYPAL *Netflix.com', amount: 10.99, currency: 'gbp', occurredAt: '2026-06-01T00:00:00Z' },
				{ id: 'two', merchant: 'Netflix', amount: 10.99, currency: 'gbp', occurredAt: '2026-07-01T00:00:00Z' },
				{ id: 'three', merchant: 'NETFLIX.COM', amount: 10.99, currency: 'gbp', occurredAt: '2026-08-01T00:00:00Z' }
			],
			invoices: [{ id: 'invoice-1', sender: 'receipts@netflix.com', subject: 'Your Netflix receipt', receivedAt: '2026-08-01T01:00:00Z' }]
		});

		expect(subscription.merchantKey).toBe('netflix');
		expect(subscription.invoiceEvidence).toHaveLength(1);
		expect(subscription.recurrenceIntervalDays).toBe(30.5);
		expect(subscription.recurringConfidence).toBeGreaterThanOrEqual(0.65);
		expect(subscription.isRecurring).toBe(true);
		expect(subscription.isNewCharge).toBe(false);
	});

	it('marks a recent first charge as new unless the merchant is already known', () => {
		const input = {
			now: '2026-08-20T00:00:00Z',
			transactions: [{ id: 'one', merchant: 'Adobe Inc', amount: 19.99, currency: 'USD', occurredAt: '2026-08-10T00:00:00Z' }]
		};

		expect(consolidateSubscriptions(input)[0].isNewCharge).toBe(true);
		expect(consolidateSubscriptions({ ...input, knownMerchantKeys: ['adobe'] })[0].isNewCharge).toBe(false);
	});
});
