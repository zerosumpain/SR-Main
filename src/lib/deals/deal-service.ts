import { randomUUID } from 'node:crypto';

export type CurrencyCode = string;

export interface Money {
	amountMinor: number;
	currency: CurrencyCode;
}

export interface Deal {
	provider: string;
	providerOfferId: string;
	title: string;
	url: string;
	price: Money;
	availableFrom: string;
	availableTo: string;
	metadata?: Record<string, string>;
}

export interface DealSearchInput {
	query: string;
	from: string;
	to: string;
	adults: number;
	children?: number;
	currency: CurrencyCode;
}

export interface AvailabilityRequest {
	deal: Deal;
	from: string;
	to: string;
	adults: number;
	children?: number;
	currency: CurrencyCode;
}

export interface AvailabilityQuote {
	available: boolean;
	price: Money;
	expiresAt: string;
	bookingReference?: string;
}

export interface Traveller {
	fullName: string;
	email: string;
}

export interface ProviderBookingRequest {
	deal: Deal;
	quote: AvailabilityQuote;
	traveller: Traveller;
	idempotencyKey: string;
}

export interface BookingResult {
	status: 'confirmed' | 'requires_checkout';
	providerBookingId?: string;
	checkoutUrl?: string;
}

/** Implement this interface per provider; keep API credentials inside server-only connector code. */
export interface DealProvider {
	readonly name: string;
	search(input: DealSearchInput): Promise<Deal[]>;
	checkAvailability(input: AvailabilityRequest): Promise<AvailabilityQuote>;
	book(input: ProviderBookingRequest): Promise<BookingResult>;
}

export type CheckoutIntentStatus = 'pending' | 'consumed';

export interface CheckoutIntent {
	id: string;
	userId: string;
	deal: Deal;
	traveller: Traveller;
	quote: AvailabilityQuote;
	confirmationToken: string;
	expiresAt: string;
	status: CheckoutIntentStatus;
}

/** claimPending must atomically transition a valid pending intent to consumed. */
export interface CheckoutIntentStore {
	create(intent: CheckoutIntent): Promise<void>;
	claimPending(input: {
		id: string;
		userId: string;
		confirmationToken: string;
		now: string;
	}): Promise<CheckoutIntent | null>;
}

export class DealError extends Error {
	constructor(
		public readonly code:
			| 'INVALID_INPUT'
			| 'UNKNOWN_PROVIDER'
			| 'UNAVAILABLE'
			| 'QUOTE_EXPIRED'
			| 'PRICE_CHANGED'
			| 'CONFIRMATION_REQUIRED'
			| 'BOOKING_FAILED',
		message: string
	) {
		super(message);
		this.name = 'DealError';
	}
}

export interface SearchResult {
	deals: Deal[];
	providerErrors: Array<{ provider: string; message: string }>;
}

export interface PriceObservation {
	provider: string;
	providerOfferId: string;
	price: Money;
	observedAt: string;
}

export interface PriceChange {
	provider: string;
	providerOfferId: string;
	previous: PriceObservation;
	current: PriceObservation;
	deltaMinor: number;
}

export function findPriceChanges(
	previous: readonly PriceObservation[],
	current: readonly PriceObservation[]
): PriceChange[] {
	const priorByOffer = new Map(previous.map((item) => [`${item.provider}:${item.providerOfferId}`, item]));
	const changes: PriceChange[] = [];

	for (const item of current) {
		const prior = priorByOffer.get(`${item.provider}:${item.providerOfferId}`);
		if (prior && prior.price.currency === item.price.currency && prior.price.amountMinor !== item.price.amountMinor) {
			changes.push({
				provider: item.provider,
				providerOfferId: item.providerOfferId,
				previous: prior,
				current: item,
				deltaMinor: item.price.amountMinor - prior.price.amountMinor
			});
		}
	}

	return changes;
}

export class DealService {
	private readonly providers = new Map<string, DealProvider>();

	constructor(
		providers: readonly DealProvider[],
		private readonly intents: CheckoutIntentStore,
		private readonly now: () => Date = () => new Date(),
		private readonly intentLifetimeMs = 10 * 60 * 1000
	) {
		for (const provider of providers) {
			if (this.providers.has(provider.name)) throw new Error(`Duplicate deal provider: ${provider.name}`);
			this.providers.set(provider.name, provider);
		}
	}

	async search(input: DealSearchInput): Promise<SearchResult> {
		validateSearch(input);
		const results = await Promise.allSettled(
			[...this.providers.values()].map(async (provider) => ({ provider: provider.name, deals: await provider.search(input) }))
		);
		const deals: Deal[] = [];
		const providerErrors: SearchResult['providerErrors'] = [];
		const seen = new Set<string>();

		for (let index = 0; index < results.length; index += 1) {
			const result = results[index];
			const provider = [...this.providers.values()][index];
			if (result.status === 'rejected') {
				providerErrors.push({ provider: provider.name, message: errorMessage(result.reason) });
				continue;
			}
			for (const deal of result.value.deals) {
				validateDeal(deal);
				const key = `${deal.provider}:${deal.providerOfferId}`;
				if (!seen.has(key)) {
					seen.add(key);
					deals.push(deal);
				}
			}
		}

		return { deals: deals.sort((left, right) => left.price.amountMinor - right.price.amountMinor), providerErrors };
	}

	async lookupAvailability(input: AvailabilityRequest): Promise<AvailabilityQuote> {
		validateSearch(input);
		validateDeal(input.deal);
		const provider = this.providerFor(input.deal.provider);
		const quote = await provider.checkAvailability(input);
		validateQuote(quote);
		if (!quote.available) throw new DealError('UNAVAILABLE', 'This deal is no longer available.');
		return quote;
	}

	async createCheckoutIntent(input: {
		userId: string;
		availability: AvailabilityRequest;
		traveller: Traveller;
	}): Promise<CheckoutIntent> {
		if (!input.userId || !input.traveller.fullName || !isEmail(input.traveller.email)) {
			throw new DealError('INVALID_INPUT', 'A user, traveller name, and valid traveller email are required.');
		}
		const quote = await this.lookupAvailability(input.availability);
		const expiresAt = new Date(Math.min(Date.parse(quote.expiresAt), this.now().getTime() + this.intentLifetimeMs)).toISOString();
		if (Date.parse(expiresAt) <= this.now().getTime()) throw new DealError('QUOTE_EXPIRED', 'The provider quote has expired.');

		const intent: CheckoutIntent = {
			id: randomUUID(),
			userId: input.userId,
			deal: input.availability.deal,
			traveller: input.traveller,
			quote: { ...quote, expiresAt },
			confirmationToken: randomUUID(),
			expiresAt,
			status: 'pending'
		};
		await this.intents.create(intent);
		return intent;
	}

	async confirmCheckout(input: {
		intentId: string;
		userId: string;
		confirmationToken: string;
	}): Promise<BookingResult> {
		if (!input.intentId || !input.userId || !input.confirmationToken) {
			throw new DealError('CONFIRMATION_REQUIRED', 'An explicit confirmation token is required to book.');
		}
		const intent = await this.intents.claimPending({ ...input, now: this.now().toISOString() });
		if (!intent) throw new DealError('CONFIRMATION_REQUIRED', 'This checkout was already used, expired, or was not confirmed.');

		const provider = this.providerFor(intent.deal.provider);
		let currentQuote: AvailabilityQuote;
		try {
			currentQuote = await provider.checkAvailability({
				deal: intent.deal,
				from: intent.deal.availableFrom,
				to: intent.deal.availableTo,
				adults: 1,
				currency: intent.quote.price.currency
			});
			validateQuote(currentQuote);
		} catch (error) {
			if (error instanceof DealError) throw error;
			throw new DealError('BOOKING_FAILED', `Could not revalidate this deal: ${errorMessage(error)}`);
		}
		if (!currentQuote.available) throw new DealError('UNAVAILABLE', 'This deal became unavailable before booking.');
		if (currentQuote.price.amountMinor !== intent.quote.price.amountMinor || currentQuote.price.currency !== intent.quote.price.currency) {
			throw new DealError('PRICE_CHANGED', 'The provider changed the price; create a new checkout intent to accept it.');
		}

		try {
			return await provider.book({ deal: intent.deal, quote: currentQuote, traveller: intent.traveller, idempotencyKey: intent.id });
		} catch (error) {
			throw new DealError('BOOKING_FAILED', `Provider booking failed: ${errorMessage(error)}`);
		}
	}

	private providerFor(name: string): DealProvider {
		const provider = this.providers.get(name);
		if (!provider) throw new DealError('UNKNOWN_PROVIDER', `No connector is configured for provider ${name}.`);
		return provider;
	}
}

function validateSearch(input: Pick<DealSearchInput, 'from' | 'to' | 'adults' | 'currency'>): void {
	if (!Number.isInteger(input.adults) || input.adults < 1 || !input.currency || !validDateRange(input.from, input.to)) {
		throw new DealError('INVALID_INPUT', 'Provide a valid date range, at least one adult, and a currency.');
	}
}

function validateDeal(deal: Deal): void {
	if (!deal.provider || !deal.providerOfferId || !deal.title || !deal.url || !validDateRange(deal.availableFrom, deal.availableTo)) {
		throw new DealError('INVALID_INPUT', 'Provider returned an invalid deal.');
	}
	validateMoney(deal.price);
}

function validateQuote(quote: AvailabilityQuote): void {
	validateMoney(quote.price);
	if (!Number.isFinite(Date.parse(quote.expiresAt))) throw new DealError('INVALID_INPUT', 'Provider returned an invalid quote expiry.');
}

function validateMoney(money: Money): void {
	if (!Number.isInteger(money.amountMinor) || money.amountMinor < 0 || !money.currency) {
		throw new DealError('INVALID_INPUT', 'Provider returned an invalid price.');
	}
}

function validDateRange(from: string, to: string): boolean {
	const start = Date.parse(from);
	const end = Date.parse(to);
	return Number.isFinite(start) && Number.isFinite(end) && end > start;
}

function isEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
