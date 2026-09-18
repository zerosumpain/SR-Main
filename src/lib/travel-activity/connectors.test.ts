import { describe, expect, it, vi } from 'vitest';
import {
	ProviderRequestError,
	createTravelActivityConnector,
	type TravelActivityProvider,
} from '$lib/travel-activity/connectors';

interface DealQuery { destination: string }
interface AvailabilityQuery { venueId: string; date: string }
interface PriceQuery { productId: string }
interface BookingRequest { productId: string; guests: number }

const provider: TravelActivityProvider<DealQuery, AvailabilityQuery, PriceQuery, BookingRequest> = {
	baseUrl: 'https://provider.example/api',
	headers: { authorization: 'Bearer server-side-secret' },
	paths: {
		packageDeals: 'deals',
		availability: 'availability',
		price: 'prices',
		booking: 'bookings',
	},
	mapPackageDeals: (payload) => (payload as { deals: Array<{ id: string; title: string; amount: number }> }).deals.map((deal) => ({
		id: deal.id,
		title: deal.title,
		price: { amount: deal.amount, currency: 'GBP' },
	})),
	mapAvailability: (payload) => (payload as { slots: Array<{ venue: string; starts: string; available: boolean }> }).slots.map((slot) => ({
		venueId: slot.venue,
		startsAt: slot.starts,
		available: slot.available,
	})),
	mapPrice: (payload) => payload as { amount: number; currency: string },
	mapBooking: (payload) => payload as { bookingReference: string; status: 'confirmed' | 'pending' },
};

describe('createTravelActivityConnector', () => {
	it('sends deal queries and normalizes the live response', async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({
			deals: [{ id: 'holiday-1', title: 'Coastal break', amount: 799 }],
		})));
		const connector = createTravelActivityConnector(provider, fetchImplementation);

		await expect(connector.searchPackageDeals({ destination: 'Lisbon' })).resolves.toEqual([{
			id: 'holiday-1',
			title: 'Coastal break',
			price: { amount: 799, currency: 'GBP' },
		}]);
		expect(fetchImplementation).toHaveBeenCalledWith(
			'https://provider.example/api/deals?destination=Lisbon',
			expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ authorization: 'Bearer server-side-secret' }) }),
		);
	});

	it('posts booking data and returns the provider confirmation', async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({
			bookingReference: 'BK-123',
			status: 'pending',
		})));
		const connector = createTravelActivityConnector(provider, fetchImplementation);

		await expect(connector.createBooking({ productId: 'activity-9', guests: 2 })).resolves.toEqual({
			bookingReference: 'BK-123',
			status: 'pending',
		});
		expect(fetchImplementation).toHaveBeenCalledWith(
			'https://provider.example/api/bookings',
			expect.objectContaining({ method: 'POST', body: '{"productId":"activity-9","guests":2}' }),
		);
	});

	it('exposes provider HTTP failures without attempting to map them', async () => {
		const connector = createTravelActivityConnector(provider, vi.fn().mockResolvedValue(new Response('No inventory', { status: 409 })));

		await expect(connector.getPrice({ productId: 'sold-out' })).rejects.toEqual(
			expect.objectContaining({ name: 'ProviderRequestError', status: 409, providerMessage: 'No inventory' }),
		);
		expect(ProviderRequestError).toBeTypeOf('function');
	});
});
