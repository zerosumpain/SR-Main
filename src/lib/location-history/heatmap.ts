export interface LocationHistoryDateRange {
	/** Inclusive ISO-8601 lower bound used to retrieve the aggregate. */
	start: string;
	/** Inclusive ISO-8601 upper bound used to retrieve the aggregate. */
	end: string;
}

/** A location record produced by a date-bounded location-history aggregation. */
export interface AggregatedLocation {
	latitude: number;
	longitude: number;
	/** Number of distinct visits represented by this location. */
	visitCount?: number;
	/** Total time at this location during the requested period, in minutes. */
	totalMinutes?: number;
	/** Optional reverse-geocoded name, retained for map tooltips. */
	label?: string;
}

export interface RenderMapHeatmapPoint {
	lat: number;
	lng: number;
	weight: number;
	label?: string;
}

export interface LocationHistoryHeatmap {
	dateRange: LocationHistoryDateRange;
	layers: [
		{
			type: 'heatmap';
			points: RenderMapHeatmapPoint[];
		}
	];
}

export interface CreateLocationHistoryHeatmapInput {
	dateRange: LocationHistoryDateRange;
	locations: readonly AggregatedLocation[];
	/** Limits points sent to the visualisation, after highest-weight locations are selected. */
	maxPoints?: number;
}

const DEFAULT_MAX_POINTS = 100;

/**
 * Produces arguments that can be passed directly to render_map for a location
 * history heatmap. The caller is responsible for ensuring `locations` was
 * aggregated using the supplied date range.
 */
export function createLocationHistoryHeatmap(
	input: CreateLocationHistoryHeatmapInput
): LocationHistoryHeatmap {
	assertValidDateRange(input.dateRange);

	const maxPoints = input.maxPoints ?? DEFAULT_MAX_POINTS;
	if (!Number.isInteger(maxPoints) || maxPoints < 1) {
		throw new RangeError('maxPoints must be a positive integer');
	}

	const points = input.locations
		.filter(hasValidCoordinates)
		.map((location) => ({
			lat: location.latitude,
			lng: location.longitude,
			weight: locationWeight(location),
			...(location.label ? { label: location.label } : {})
		}))
		.sort((left, right) => right.weight - left.weight)
		.slice(0, maxPoints);

	return {
		dateRange: { ...input.dateRange },
		layers: [{ type: 'heatmap', points }]
	};
}

function hasValidCoordinates(location: AggregatedLocation): boolean {
	return (
		Number.isFinite(location.latitude) &&
		Number.isFinite(location.longitude) &&
		location.latitude >= -90 &&
		location.latitude <= 90 &&
		location.longitude >= -180 &&
		location.longitude <= 180
	);
}

function locationWeight(location: AggregatedLocation): number {
	const dwellMinutes = positiveFiniteNumber(location.totalMinutes);
	if (dwellMinutes !== undefined) return dwellMinutes;

	const visitCount = positiveFiniteNumber(location.visitCount);
	return visitCount ?? 1;
}

function positiveFiniteNumber(value: number | undefined): number | undefined {
	return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

function assertValidDateRange(range: LocationHistoryDateRange): void {
	const start = Date.parse(range.start);
	const end = Date.parse(range.end);

	if (Number.isNaN(start) || Number.isNaN(end)) {
		throw new TypeError('dateRange start and end must be valid ISO-8601 dates');
	}
	if (start > end) {
		throw new RangeError('dateRange start must not be after end');
	}
}
