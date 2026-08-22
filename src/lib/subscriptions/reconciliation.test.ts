import { describe, expect, it } from 'vitest';
import {
	confirmCancellation,
	createCancellationRequest,
	normalizeMerchant,
	reconcileSubscriptions,
	type SubscriptionEvidence
} from '$lib/subscriptions/reconciliation';

const evidence: SubscriptionEvidence[] = [
	{ id: 'bank-1', source: 'bank', merchant: 'Stream Flix Ltd.', occurredAt: '2026-06-01T10:00:00Z', amount: 12.99, currency: 'GBP' },
	{ id: 'paypal-1', source: 'paypal', merchant: 'StreamFlix', occurredAt: '2026-07-01T10:00:00Z', amount: 12.99, currency: 'GBP', paypalSubscriptionId: 'I-STREAMFLIX' },
	{ id: 'email-1', source: 'email', merchant: 'StreamFlix', occurredAt: '2026-07-01T11:00:00Z', description: 'Your monthly receipt' },
	{ id: 'bank-2', source: 'bank', merchant: 'Known Gym', occurredAt: '2026-06-03T10:00:00Z', amount: 30, currency: 'GBP' },
	{ id: 'bank-3', source: 'bank', merchant: 'Known Gym', occurredAt: '2026-07-03T10:00:00Z', amount: 30, currency: 'GBP' }
];

describe('reconcileSubscriptions', () => {
	it('groups cross-source evidence and identifies a new monthly charge', () => {
		const review = reconcileSubscriptions({ evidence, knownSubscriptionKeys: ['known gym'] });
		const streamFlix = review.groups.find((group) => group.merchantKey === 'stream flix')!;

		expect(review.newRecurringCount).toBe(1);
		expect(streamFlix.sources).toEqual(['bank', 'email', 'paypal']);
		expect(streamFlix.paymentCount).toBe(2);
		expect(streamFlix.cadenceDays).toBe(30);
		expect(streamFlix.isNew).toBe(true);
		expect(streamFlix.paypalSubscriptionId).toBe('I-STREAMFLIX');
	});

	it('does not flag one-off payments as recurring', () => {
		const review = reconcileSubscriptions({
			evidence: [{ id: 'one-off', source: 'bank', merchant: 'Book Shop', occurredAt: '2026-07-01T10:00:00Z', amount: 18, currency: 'GBP' }]
		});

		expect(review.groups[0].isRecurring).toBe(false);
		expect(review.groups[0].isNew).toBe(false);
	});

	it('requires confirmation before creating a PayPal cancellation request', () => {
		const review = reconcileSubscriptions({ evidence });
		const groupId = 'stream flix';

		expect(() => createCancellationRequest(review, groupId)).toThrow('Cancellation must be confirmed');
		expect(createCancellationRequest(confirmCancellation(review, groupId), groupId)).toEqual({
			groupId,
			merchant: 'Stream Flix Ltd.',
			paypalSubscriptionId: 'I-STREAMFLIX'
		});
	});

	it('normalizes merchant formatting deterministically', () => {
		expect(normalizeMerchant('  ACME, INC.  ')).toBe('acme inc');
	});
});
