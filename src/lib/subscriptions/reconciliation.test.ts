import { describe, expect, it } from 'vitest';
import {
	buildDashboard,
	reconcileEvidence,
	recordCancellationResult,
	requestCancellation,
	type SubscriptionRecord
} from '$lib/subscriptions/reconciliation';

describe('subscription reconciliation', () => {
	it('joins source evidence by normalised merchant and infers a monthly cadence', () => {
		const drafts = reconcileEvidence('user-1', [
			{ id: 'bank-1', source: 'truelayer', merchant: 'NETFLIX.COM Payment', amountMinor: 1099, currency: 'GBP', occurredAt: '2026-01-01T12:00:00Z' },
			{ id: 'mail-1', source: 'gmail', merchant: 'Netflix', amountMinor: 1099, currency: 'GBP', occurredAt: '2026-02-01T12:00:00Z' },
			{ id: 'detect-1', source: 'detector', merchant: 'Netflix', confidence: 0.9 }
		]);

		expect(drafts).toHaveLength(1);
		expect(drafts[0]).toMatchObject({ merchantKey: 'netflix com', amountMinor: 1099, cadence: 'monthly' });
		expect(drafts[0].confidence).toBeGreaterThanOrEqual(90);
	});

	it('keeps currencies separate and calculates a single-currency monthly estimate', () => {
		const draft = reconcileEvidence('user-1', [
			{ id: 'a', source: 'paypal', merchant: 'Music Co', amountMinor: 1200, currency: 'GBP', cadence: 'monthly', externalSubscriptionId: 'I-123' }
		])[0];
		const record: SubscriptionRecord = { ...draft, id: 'record-1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
		const dashboard = buildDashboard([record]);
		expect(dashboard.activeMonthlyEstimateMinor).toBe(1200);
		expect(dashboard.currency).toBe('GBP');
	});

	it('only creates cancellation requests for a PayPal billing agreement', () => {
		const draft = reconcileEvidence('user-1', [
			{ id: 'paypal', source: 'paypal', merchant: 'Music Co', externalSubscriptionId: 'I-123' }
		])[0];
		const record: SubscriptionRecord = { ...draft, id: 'record-1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
		const request = requestCancellation(record, '2026-03-01T00:00:00Z');
		expect(request).toMatchObject({ provider: 'paypal', subscriptionId: 'I-123' });
		expect(recordCancellationResult(request, false, '2026-03-02T00:00:00Z', 'Provider timeout').error).toBe('Provider timeout');
	});
});
