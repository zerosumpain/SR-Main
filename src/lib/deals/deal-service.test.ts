import { describe, expect, it } from 'vitest';
import {
	DealError,
	DealService,
	findPriceChanges,
	type CheckoutIntent,
	type CheckoutIntentStore,
	type Deal,
	type DealProvider
} from '$lib/deals/deal-service';

const deal: Deal = {
	provider: 'example',
	providerOfferId: 'offer-1',
	title: 'Weekend stay',
	url: 'https://example.test/offer-1',
	price: { amountMinor: 12000, currency: 'GBP' },
	availableFrom: '2026-10-10T00:00:00.000Z',
	availableTo: '2026-10-12T00:00:00.000Z'
};

class MemoryIntentStore implements CheckoutIntentStore {
	readonly values = new Map<string, CheckoutIntent>();
	async create(intent: CheckoutIntent): Promise<void> { this.values.set(intent.id, intent); }
	async claimPending(input: { id: string; userId: string; confirmationToken: string; now: string }): Promise<CheckoutIntent | null> {
		const intent = this.values.get(input.id);
		if (!intent || intent.status !== 'pending' || intent.userId !== input.userId || intent.confirmationToken !== input.confirmationToken || Date.parse(intent.expiresAt) <= Date.parse(input.now)) return null;
		intent.status = 'consumed';
		return intent;
	}
}

function provider(overrides: Partial<DealProvider> = {}): DealProvider {
	return {
		name: 'example',
		search: async () => [deal],
		checkAvailability: async () => ({ available: true, price: deal.price, expiresAt: '2026-10-01T00:10:00.000Z' }),
		book: async () => ({ status: 'requires_checkout', checkoutUrl: 'https://example.test/checkout' }),
		...overrides
	};
}

describe('DealService', () => {
	it('returns deals while retaining an error from a failed provider', async () => {
		const service = new DealService([provider(), provider({ name: 'broken', search: async () => { throw new Error('offline'); } })], new MemoryIntentStore());
		const result = await service.search({ query: 'stay', from: deal.availableFrom, to: deal.availableTo, adults: 2, currency: 'GBP' });
		expect(result.deals).toEqual([deal]);
		expect(result.providerErrors).toEqual([{ provider: 'broken', message: 'offline' }]);
	});

	it('requires an explicit token and books an intent only once', async () => {
		const store = new MemoryIntentStore();
		const service = new DealService([provider()], store, () => new Date('2026-10-01T00:00:00.000Z'));
		const intent = await service.createCheckoutIntent({
			userId: 'user-1',
			availability: { deal, from: deal.availableFrom, to: deal.availableTo, adults: 1, currency: 'GBP' },
			traveller: { fullName: 'Ada Lovelace', email: 'ada@example.test' }
		});
		await expect(service.confirmCheckout({ intentId: intent.id, userId: 'user-1', confirmationToken: 'wrong' })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' } satisfies Partial<DealError>);
		await expect(service.confirmCheckout({ intentId: intent.id, userId: 'user-1', confirmationToken: intent.confirmationToken })).resolves.toEqual({ status: 'requires_checkout', checkoutUrl: 'https://example.test/checkout' });
		await expect(service.confirmCheckout({ intentId: intent.id, userId: 'user-1', confirmationToken: intent.confirmationToken })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' } satisfies Partial<DealError>);
	});

	it('identifies comparable price movements', () => {
		const changes = findPriceChanges(
			[{ provider: 'example', providerOfferId: 'offer-1', price: { amountMinor: 12000, currency: 'GBP' }, observedAt: '2026-10-01T00:00:00Z' }],
			[{ provider: 'example', providerOfferId: 'offer-1', price: { amountMinor: 9900, currency: 'GBP' }, observedAt: '2026-10-02T00:00:00Z' }]
		);
		expect(changes[0]?.deltaMinor).toBe(-2100);
	});
});
