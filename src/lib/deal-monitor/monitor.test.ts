import { describe, expect, it } from 'vitest';
import { dealFingerprint, evaluateDealCandidate } from '$lib/deal-monitor/monitor';

const requirement = {
	id: 'requirement-1',
	currency: 'GBP',
	notificationThresholdMinor: 100_000
};

const candidate = {
	retailerSourceId: 'source-1',
	externalId: 'SKU-123',
	title: 'Gaming laptop',
	url: 'https://example.test/products/SKU-123',
	priceMinor: 95_000,
	currency: 'GBP',
	observedAt: new Date('2026-08-23T12:00:00.000Z')
};

describe('deal monitor', () => {
	it('normalizes a stable retailer listing fingerprint', () => {
		expect(dealFingerprint(' Source-1 ', ' SKU-123 ')).toBe('source-1:sku-123');
	});

	it('records and notifies for a new deal under its threshold', () => {
		const result = evaluateDealCandidate(requirement, candidate, null);

		expect(result.isNewListing).toBe(true);
		expect(result.recordPriceHistory).toBe(true);
		expect(result.notification).toEqual({ shouldNotify: true, reason: 'new-under-threshold' });
	});

	it('only notifies an existing listing when its price crosses the threshold', () => {
		const result = evaluateDealCandidate(requirement, candidate, {
			id: 'listing-1',
			fingerprint: 'source-1:sku-123',
			priceMinor: 120_000,
			currency: 'GBP'
		});

		expect(result.priceChanged).toBe(true);
		expect(result.notification).toEqual({ shouldNotify: true, reason: 'crossed-threshold' });
	});

	it('deduplicates unchanged observations without another history point or alert', () => {
		const result = evaluateDealCandidate(requirement, candidate, {
			id: 'listing-1',
			fingerprint: 'source-1:sku-123',
			priceMinor: 95_000,
			currency: 'GBP'
		});

		expect(result.priceChanged).toBe(false);
		expect(result.recordPriceHistory).toBe(false);
		expect(result.notification.shouldNotify).toBe(false);
	});
});
