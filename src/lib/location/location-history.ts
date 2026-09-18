export interface HomeLocation {
	latitude: number;
	longitude: number;
	radiusMetres?: number;
}

export interface LocationHistoryOptions {
	/** Limit output to these device_tracker/person entity IDs. */
	entityIds?: readonly string[];
	home?: HomeLocation;
	/** Consecutive samples farther apart than this begin a new visit. Default: 2 hours. */
	maximumGapMs?: number;
	/** Points within this distance are considered the same visit. Default: 250 metres. */
	visitRadiusMetres?: number;
}

export interface LocationSample {
	entityId: string;
	occurredAt: string;
	latitude?: number;
	longitude?: number;
	state: string;
	locationName?: string;
	isHome: boolean;
	source: 'zone' | 'geopoint';
}

export interface LocationVisit {
	entityId: string;
	startedAt: string;
	endedAt: string;
	sampleCount: number;
	latitude?: number;
	longitude?: number;
	locationName: string;
	isHome: boolean;
}

export interface NormalizedLocationHistory {
	samples: LocationSample[];
	visits: LocationVisit[];
}

type UnknownRecord = Record<string, unknown>;

const DEFAULT_MAXIMUM_GAP_MS = 2 * 60 * 60 * 1000;
const DEFAULT_VISIT_RADIUS_METRES = 250;

/**
 * Normalises both Home Assistant's nested history response (`State[][]`) and
 * flattened/custom responses. Life360 device trackers normally expose a zone
 * name as `state`, but latitude/longitude attributes remain the reliable
 * fallback when no useful zone name is present.
 */
export function normalizeLocationHistory(
	rawHistory: unknown,
	options: LocationHistoryOptions = {}
): NormalizedLocationHistory {
	const allowedEntityIds = options.entityIds ? new Set(options.entityIds) : undefined;
	const samples = collectStateRecords(rawHistory)
		.map((record) => toLocationSample(record, options.home))
		.filter((sample): sample is LocationSample => sample !== undefined)
		.filter((sample) => !allowedEntityIds || allowedEntityIds.has(sample.entityId))
		.sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));

	const deduplicated = samples.filter((sample, index) => {
		const previous = samples[index - 1];
		return !previous || previous.entityId !== sample.entityId || previous.occurredAt !== sample.occurredAt;
	});

	return {
		samples: deduplicated,
		visits: aggregateLocationVisits(deduplicated, options)
	};
}

export function aggregateLocationVisits(
	samples: readonly LocationSample[],
	options: Pick<LocationHistoryOptions, 'maximumGapMs' | 'visitRadiusMetres'> = {}
): LocationVisit[] {
	const maximumGapMs = options.maximumGapMs ?? DEFAULT_MAXIMUM_GAP_MS;
	const visitRadiusMetres = options.visitRadiusMetres ?? DEFAULT_VISIT_RADIUS_METRES;
	const visits: LocationVisit[] = [];

	for (const sample of samples) {
		const previous = visits.at(-1);
		const previousEnd = previous ? Date.parse(previous.endedAt) : Number.NaN;
		const sampleTime = Date.parse(sample.occurredAt);
		if (previous && previous.entityId === sample.entityId && sampleTime - previousEnd <= maximumGapMs && samePlace(previous, sample, visitRadiusMetres)) {
			previous.endedAt = sample.occurredAt;
			previous.sampleCount += 1;
			continue;
		}

		visits.push({
			entityId: sample.entityId,
			startedAt: sample.occurredAt,
			endedAt: sample.occurredAt,
			sampleCount: 1,
			latitude: sample.latitude,
			longitude: sample.longitude,
			locationName: sample.locationName ?? (sample.isHome ? 'Home' : 'Unknown location'),
			isHome: sample.isHome
		});
	}

	return visits;
}

function collectStateRecords(value: unknown, seen = new Set<unknown>()): UnknownRecord[] {
	if (!value || typeof value !== 'object' || seen.has(value)) return [];
	seen.add(value);
	if (isStateRecord(value)) return [value];
	if (Array.isArray(value)) return value.flatMap((entry) => collectStateRecords(entry, seen));
	return Object.values(value).flatMap((entry) => collectStateRecords(entry, seen));
}

function isStateRecord(value: object): value is UnknownRecord {
	const record = value as UnknownRecord;
	return typeof record.entity_id === 'string' && typeof record.state === 'string';
}

function toLocationSample(record: UnknownRecord, home: HomeLocation | undefined): LocationSample | undefined {
	const entityId = record.entity_id;
	const state = record.state;
	if (typeof entityId !== 'string' || typeof state !== 'string') return undefined;

	const occurredAt = dateValue(record.last_changed) ?? dateValue(record.last_updated);
	if (!occurredAt) return undefined;

	const attributes = isObject(record.attributes) ? record.attributes : {};
	const latitude = coordinate(attributes.latitude, -90, 90) ?? coordinate(attributes.lat, -90, 90);
	const longitude = coordinate(attributes.longitude, -180, 180) ?? coordinate(attributes.lon, -180, 180) ?? coordinate(attributes.lng, -180, 180);
	const zoneName = firstText(attributes.zone, attributes.location_name, attributes.friendly_name);
	const homeByZone = isHomeLabel(state) || isHomeLabel(zoneName);
	const homeByCoordinate = latitude !== undefined && longitude !== undefined && home !== undefined && distanceMetres(latitude, longitude, home.latitude, home.longitude) <= (home.radiusMetres ?? 250);
	const isHome = homeByZone || homeByCoordinate;
	const usefulZoneName = zoneName && !isGenericTrackerName(zoneName) ? zoneName : undefined;

	// A state-only zone transition is useful; coordinate-only tracker history is
	// also useful and is the fallback for integrations lacking a zone name.
	if (!isHome && !usefulZoneName && (latitude === undefined || longitude === undefined)) return undefined;

	return {
		entityId,
		occurredAt,
		latitude,
		longitude,
		state,
		locationName: isHome ? 'Home' : usefulZoneName ?? (isGenericState(state) ? undefined : state),
		isHome,
		source: usefulZoneName || !isGenericState(state) ? 'zone' : 'geopoint'
	};
}

function samePlace(visit: LocationVisit, sample: LocationSample, radiusMetres: number): boolean {
	if (visit.isHome !== sample.isHome) return false;
	if (visit.isHome) return true;
	if (visit.latitude !== undefined && visit.longitude !== undefined && sample.latitude !== undefined && sample.longitude !== undefined) {
		return distanceMetres(visit.latitude, visit.longitude, sample.latitude, sample.longitude) <= radiusMetres;
	}
	return visit.locationName === (sample.locationName ?? 'Unknown location');
}

function distanceMetres(latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number): number {
	const radians = Math.PI / 180;
	const deltaLatitude = (latitudeB - latitudeA) * radians;
	const deltaLongitude = (longitudeB - longitudeA) * radians;
	const a = Math.sin(deltaLatitude / 2) ** 2 + Math.cos(latitudeA * radians) * Math.cos(latitudeB * radians) * Math.sin(deltaLongitude / 2) ** 2;
	return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function coordinate(value: unknown, minimum: number, maximum: number): number | undefined {
	const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
	return Number.isFinite(numberValue) && numberValue >= minimum && numberValue <= maximum ? numberValue : undefined;
}

function dateValue(value: unknown): string | undefined {
	if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return undefined;
	return new Date(value).toISOString();
}

function firstText(...values: unknown[]): string | undefined {
	return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim();
}

function isObject(value: unknown): value is UnknownRecord {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isHomeLabel(value: string | undefined): boolean {
	return value?.trim().toLowerCase() === 'home';
}

function isGenericState(state: string): boolean {
	return ['unknown', 'unavailable', 'not_home', 'away'].includes(state.trim().toLowerCase());
}

function isGenericTrackerName(name: string): boolean {
	return ['life360', 'device tracker', 'location'].includes(name.trim().toLowerCase());
}
