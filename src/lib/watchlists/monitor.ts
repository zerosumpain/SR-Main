import type { WatchCriteria, WatchlistKind } from './schema';

export interface DealObservation {
	sourceId: string;
	externalId: string;
	canonicalUrl: string;
	title: string;
	retailerName?: string;
	kind: WatchlistKind;
	currency: string;
	priceMinor: number;
	originalPriceMinor?: number;
	availability?: string;
	attributes?: Record<string, unknown>;
}

export interface PricePoint {
	priceMinor: number;
	observedAt: Date;
}

export interface EvaluatedAlert {
	fingerprint: string;
	reason: string;
	medianPriceMinor?: number;
	discountPercent?: number;
}

/** Stable source-provider identity used for listing upserts. */
export function listingDeduplicationKey(observation: Pick<DealObservation, 'sourceId' | 'externalId'>): string {
	return `${observation.sourceId}:${observation.externalId.trim()}`;
}

export function medianPriceMinor(history: readonly PricePoint[]): number | undefined {
	if (history.length === 0) return undefined;
	const values = history.map((point) => point.priceMinor).sort((a, b) => a - b);
	const middle = Math.floor(values.length / 2);
	return values.length % 2 === 1 ? values[middle] : Math.round((values[middle - 1] + values[middle]) / 2);
}

export function matchesWatchCriteria(observation: DealObservation, criteria: WatchCriteria): boolean {
	if (criteria.currency && criteria.currency.toUpperCase() !== observation.currency.toUpperCase()) return false;
	if (criteria.sourceIds?.length && !criteria.sourceIds.includes(observation.sourceId)) return false;
	if (
		criteria.retailerNames?.length &&
		(!observation.retailerName ||
			!criteria.retailerNames.some((name) => name.toLowerCase() === observation.retailerName?.toLowerCase()))
	) return false;

	const searchable = `${observation.title} ${JSON.stringify(observation.attributes ?? {})}`.toLowerCase();
	if (criteria.query && !searchable.includes(criteria.query.toLowerCase())) return false;
	if (criteria.destination && String(observation.attributes?.destination ?? '').toLowerCase() !== criteria.destination.toLowerCase()) return false;
	if (criteria.departureAirport && String(observation.attributes?.departureAirport ?? '').toLowerCase() !== criteria.departureAirport.toLowerCase()) return false;
	if (criteria.vehicleRegistration && String(observation.attributes?.vehicleRegistration ?? '').toLowerCase() !== criteria.vehicleRegistration.toLowerCase()) return false;
	if (criteria.vehicleMakeModel && !searchable.includes(criteria.vehicleMakeModel.toLowerCase())) return false;
	return true;
}

export function evaluateObservation(
	watchlistId: string,
	observation: DealObservation,
	criteria: WatchCriteria,
	priorPrices: readonly PricePoint[]
): EvaluatedAlert | undefined {
	if (observation.priceMinor < 0 || !Number.isSafeInteger(observation.priceMinor)) {
		throw new Error('priceMinor must be a non-negative safe integer');
	}
	if (observation.availability && observation.availability !== 'available') return undefined;
	if (!matchesWatchCriteria(observation, criteria)) return undefined;

	const reasons: string[] = [];
	const baseline = medianPriceMinor(priorPrices);
	const discountPercent = observation.originalPriceMinor && observation.originalPriceMinor > 0
		? Math.round((1 - observation.priceMinor / observation.originalPriceMinor) * 100)
		: undefined;

	if (criteria.maxPriceMinor !== undefined && observation.priceMinor <= criteria.maxPriceMinor) {
		reasons.push(`price is at or below the ${criteria.maxPriceMinor} minor-unit target`);
	}
	if (criteria.minDiscountPercent !== undefined && discountPercent !== undefined && discountPercent >= criteria.minDiscountPercent) {
		reasons.push(`discount is ${discountPercent}%`);
	}
	if (criteria.exceptionalBelowMedianPercent !== undefined && baseline && baseline > 0) {
		const reduction = Math.round((1 - observation.priceMinor / baseline) * 100);
		if (reduction >= criteria.exceptionalBelowMedianPercent) reasons.push(`price is ${reduction}% below its observed median`);
	}
	if (reasons.length === 0) return undefined;

	const fingerprint = hash(`${watchlistId}|${listingDeduplicationKey(observation)}|${observation.priceMinor}`);
	return { fingerprint, reason: reasons.join('; '), medianPriceMinor: baseline, discountPercent };
}

function hash(value: string): string {
	let result = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		result ^= value.charCodeAt(index);
		result = Math.imul(result, 16777619);
	}
	return `deal-${(result >>> 0).toString(16)}`;
}
