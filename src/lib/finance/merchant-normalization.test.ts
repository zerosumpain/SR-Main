import { describe, expect, it } from 'vitest';
import {
	buildRecurringPaymentFingerprint,
	normalizeMerchantAlias,
	resolveMerchantIdentity
} from '$lib/finance/merchant-normalization';

describe('normalizeMerchantAlias', () => {
	it('matches processor, bank, and invoice variants of the same merchant', () => {
		const variants = [
			'PAYPAL *Netflix.com 9F83A1',
			'CARD PAYMENT TO NETFLIX 123456',
			'Netflix, Inc.'
		];

		expect(variants.map(normalizeMerchantAlias)).toEqual(['NETFLIX', 'NETFLIX', 'NETFLIX']);
	});

	it('normalizes accents and punctuation without losing merchant words', () => {
		expect(normalizeMerchantAlias('Caf\u00e9 & Co. Ltd')).toBe('CAFE AND CO');
	});

	it('rejects an empty normalized merchant', () => {
		expect(() => normalizeMerchantAlias('***')).toThrow('Merchant name');
	});
});

describe('recurring payment fingerprints', () => {
	it('is stable across source-specific merchant labels', () => {
		const paypalMerchant = resolveMerchantIdentity('PAYPAL *Spotify.com 84729');
		const invoiceMerchant = resolveMerchantIdentity('Spotify AB');

		expect(
		buildRecurringPaymentFingerprint({
			canonicalMerchant: paypalMerchant.canonicalMerchant,
			currency: 'gbp',
			amountMinor: 1099
		})
	).toBe(
		buildRecurringPaymentFingerprint({
			canonicalMerchant: invoiceMerchant.canonicalMerchant,
			currency: 'GBP',
			amountMinor: 1099
		})
	);
	});

	it('rejects malformed fingerprint inputs', () => {
		expect(() =>
			buildRecurringPaymentFingerprint({ canonicalMerchant: 'Netflix', currency: 'UK', amountMinor: 999 })
		).toThrow('Currency');
		expect(() =>
			buildRecurringPaymentFingerprint({ canonicalMerchant: 'Netflix', currency: 'GBP', amountMinor: 10.5 })
		).toThrow('amountMinor');
	});
});
