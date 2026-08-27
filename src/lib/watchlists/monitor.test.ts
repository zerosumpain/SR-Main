import { describe, expect, it } from 'vitest';
import { evaluateObservation, listingDeduplicationKey, matchesWatchCriteria } from './monitor';

const observation = {
	sourceId: 'source-1',
	externalId: 'offer-99',
	canonicalUrl: 'https://example.test/offers/99',
	title: 'Seven nights in Mallorca',
	retailerName: 'Holiday Co',
	kind: 'package_holiday' as const,
	currency: 'GBP',
	priceMinor: 60000,
	originalPriceMinor: 100000,
	attributes: { destination: 'Mallorca', departureAirport: 'Newcastle' }
};

describe('deal watchlist monitor', () => {
	it('uses a source-scoped provider ID as the listing deduplication key', () => {
		expect(listingDeduplicationKey(observation)).toBe('source-1:offer-99');
	});

	it('matches saved holiday criteria and identifies an exceptional price', () => {
		const criteria = {
			destination: 'mallorca',
			maxPriceMinor: 70000,
			minDiscountPercent: 35,
			exceptionalBelowMedianPercent: 20,
			currency: 'GBP'
		};
		expect(matchesWatchCriteria(observation, criteria)).toBe(true);

		const alert = evaluateObservation('watch-1', observation, criteria, [
			{ priceMinor: 100000, observedAt: new Date('2026-01-01') },
			{ priceMinor: 90000, observedAt: new Date('2026-01-02') },
			{ priceMinor: 110000, observedAt: new Date('2026-01-03') }
		]);
		expect(alert?.reason).toContain('discount is 40%');
		expect(alert?.reason).toContain('below its observed median');
		expect(alert?.medianPriceMinor).toBe(100000);
	});

	it('does not alert for a listing outside saved criteria', () => {
		expect(evaluateObservation('watch-1', observation, { destination: 'Tenerife', maxPriceMinor: 70000 }, [])).toBeUndefined();
	});

	it('makes alert fingerprints stable for repeat monitor runs at the same price', () => {
		const criteria = { maxPriceMinor: 70000 };
		const first = evaluateObservation('watch-1', observation, criteria, []);
		const second = evaluateObservation('watch-1', observation, criteria, []);
		expect(first?.fingerprint).toBe(second?.fingerprint);
	});
});
