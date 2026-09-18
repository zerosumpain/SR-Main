import { describe, expect, it } from 'vitest';

import { reconcileSubscriptions, type SubscriptionEvidence } from '$lib/subscriptions/subscription-review';

const evidence: SubscriptionEvidence[] = [
	{
		id: 'pp-charge-1',
		source: 'paypal',
		kind: 'charge',
		merchant: 'Stream Co',
		merchantKey: 'stream',
		occurredAt: '2026-01-05T10:00:00.000Z',
		amountMinor: 999,
		currency: 'GBP',
		paypalSubscriptionId: 'I-STREAM',
		paypalSubscriptionStatus: 'active'
	},
	{
		id: 'bank-charge-2',
		source: 'truelayer',
		kind: 'charge',
		merchant: 'STREAM*MONTHLY',
		merchantKey: 'stream',
		occurredAt: '2026-02-05T10:00:00.000Z',
		amountMinor: 999,
		currency: 'GBP'
	},
	{
		id: 'gmail-receipt',
		source: 'gmail',
		kind: 'invoice',
		merchant: 'Stream Company',
		merchantKey: 'stream',
		occurredAt: '2026-02-05T10:01:00.000Z'
	}
];

describe('reconcileSubscriptions', () => {
	it('reconciles source evidence, charge range, and a high confidence score', () => {
		const [review] = reconcileSubscriptions(evidence);

		expect(review.merchantKey).toBe('stream');
		expect(review.firstChargeAt).toBe('2026-01-05T10:00:00.000Z');
		expect(review.lastChargeAt).toBe('2026-02-05T10:00:00.000Z');
		expect(review.lastChargeAmountMinor).toBe(999);
		expect(review.confidence).toBe('high');
		expect(review.confidenceScore).toBe(100);
		expect(review.evidence.paypal).toHaveLength(1);
		expect(review.evidence.truelayer).toHaveLength(1);
		expect(review.evidence.gmail).toHaveLength(1);
	});

	it('offers only a confirmation-gated handoff for one active PayPal subscription', () => {
		const [review] = reconcileSubscriptions(evidence);

		expect(review.cancellation).toEqual({
			status: 'ready',
			confirmationRequired: true,
			paypalSubscriptionId: 'I-STREAM',
			reason: 'An active PayPal subscription was matched. Cancellation must be explicitly confirmed by the user.'
		});
	});

	it('withholds cancellation when multiple active PayPal subscriptions match', () => {
		const [review] = reconcileSubscriptions([
			...evidence,
			{
				id: 'pp-second-subscription',
				source: 'paypal',
				kind: 'subscription',
				merchant: 'Stream Co',
				merchantKey: 'stream',
				occurredAt: '2026-02-06T10:00:00.000Z',
				paypalSubscriptionId: 'I-OTHER',
				paypalSubscriptionStatus: 'active'
			}
		]);

		expect(review.cancellation.status).toBe('unavailable');
		expect(review.cancellation.paypalSubscriptionId).toBeUndefined();
	});
});
