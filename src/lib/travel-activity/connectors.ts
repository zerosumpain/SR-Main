export type JsonRecord = Record<string, unknown>;

export interface PackageDeal {
	id: string;
	title: string;
	price: Price;
	bookingUrl?: string;
	metadata?: JsonRecord;
}

export interface VenueAvailability {
	venueId: string;
	startsAt: string;
	endsAt?: string;
	available: boolean;
	capacityRemaining?: number;
	metadata?: JsonRecord;
}

export interface Price {
	amount: number;
	currency: string;
	display?: string;
	includesTaxes?: boolean;
}

export interface BookingConfirmation {
	bookingReference: string;
	status: 'confirmed' | 'pending';
	providerReference?: string;
	metadata?: JsonRecord;
}

export interface TravelActivityProvider<TDealQuery extends JsonRecord, TAvailabilityQuery extends JsonRecord, TPriceQuery extends JsonRecord, TBookingRequest extends JsonRecord> {
	baseUrl: string;
	headers?: HeadersInit;
	paths: {
		packageDeals: string;
		availability: string;
		price: string;
		booking: string;
	};
	mapPackageDeals: (payload: unknown) => PackageDeal[];
	mapAvailability: (payload: unknown) => VenueAvailability[];
	mapPrice: (payload: unknown) => Price;
	mapBooking: (payload: unknown) => BookingConfirmation;
}

export type FetchImplementation = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface TravelActivityConnector<TDealQuery extends JsonRecord, TAvailabilityQuery extends JsonRecord, TPriceQuery extends JsonRecord, TBookingRequest extends JsonRecord> {
	searchPackageDeals(query: TDealQuery): Promise<PackageDeal[]>;
	checkVenueAvailability(query: TAvailabilityQuery): Promise<VenueAvailability[]>;
	getPrice(query: TPriceQuery): Promise<Price>;
	createBooking(request: TBookingRequest): Promise<BookingConfirmation>;
}

export class ProviderRequestError extends Error {
	constructor(
		public readonly status: number,
		public readonly providerMessage: string,
	) {
		super(`Provider request failed (${status}): ${providerMessage}`);
		this.name = 'ProviderRequestError';
	}
}

function endpoint(baseUrl: string, path: string): string {
	return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

function addQuery(url: string, query: JsonRecord): string {
	const target = new URL(url);
	for (const [key, value] of Object.entries(query)) {
		if (value === undefined || value === null) continue;
		target.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value));
	}
	return target.toString();
}

async function readJson(response: Response): Promise<unknown> {
	const body = await response.text();
	if (!response.ok) {
		throw new ProviderRequestError(response.status, body || response.statusText);
	}
	if (!body) return {};
	try {
		return JSON.parse(body) as unknown;
	} catch {
		throw new ProviderRequestError(response.status, 'Provider returned invalid JSON');
	}
}

export function createTravelActivityConnector<TDealQuery extends JsonRecord, TAvailabilityQuery extends JsonRecord, TPriceQuery extends JsonRecord, TBookingRequest extends JsonRecord>(
	provider: TravelActivityProvider<TDealQuery, TAvailabilityQuery, TPriceQuery, TBookingRequest>,
	fetchImplementation: FetchImplementation = fetch,
): TravelActivityConnector<TDealQuery, TAvailabilityQuery, TPriceQuery, TBookingRequest> {
	const request = async (path: string, method: 'GET' | 'POST', payload: JsonRecord): Promise<unknown> => {
		const url = method === 'GET' ? addQuery(endpoint(provider.baseUrl, path), payload) : endpoint(provider.baseUrl, path);
		const response = await fetchImplementation(url, {
			method,
			headers: {
				accept: 'application/json',
				...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
				...provider.headers,
			},
			...(method === 'POST' ? { body: JSON.stringify(payload) } : {}),
		});
		return readJson(response);
	};

	return {
		async searchPackageDeals(query) {
			return provider.mapPackageDeals(await request(provider.paths.packageDeals, 'GET', query));
		},
		async checkVenueAvailability(query) {
			return provider.mapAvailability(await request(provider.paths.availability, 'GET', query));
		},
		async getPrice(query) {
			return provider.mapPrice(await request(provider.paths.price, 'GET', query));
		},
		async createBooking(requestBody) {
			return provider.mapBooking(await request(provider.paths.booking, 'POST', requestBody));
		},
	};
}
