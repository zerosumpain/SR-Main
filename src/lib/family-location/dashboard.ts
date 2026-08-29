export interface LocationTimelinePoint {
	personId: string;
	personName: string;
	occurredAt: string;
	latitude: number;
	longitude: number;
	placeName?: string | null;
}

export interface LocationPrivacyPolicy {
	/** Stable person IDs the current viewer is permitted to inspect. */
	allowedPersonIds: readonly string[];
	/** Inclusive ISO calendar date, interpreted as UTC. */
	permittedStartDate?: string;
	/** Inclusive ISO calendar date, interpreted as UTC. */
	permittedEndDate?: string;
	/** Maximum selectable range, inclusive, measured in calendar days. */
	maxDateRangeDays?: number;
	/** Coordinates are rounded to this grid before being returned to the UI. */
	coordinatePrecisionMeters?: number;
}

export interface DashboardFilter {
	startDate: string;
	endDate: string;
	personIds?: readonly string[];
}

export interface DashboardOptions {
	home?: { latitude: number; longitude: number; label?: string };
	homeRadiusMeters?: number;
	presenceGapMinutes?: number;
	dwellRadiusMeters?: number;
	minimumDwellMinutes?: number;
}

export interface MapTrackPoint {
	occurredAt: string;
	latitude: number;
	longitude: number;
	placeName?: string;
}

export interface DashboardTrack {
	personId: string;
	personName: string;
	points: MapTrackPoint[];
}

export interface PresencePeriod {
	personId: string;
	personName: string;
	state: 'home' | 'away';
	startedAt: string;
	endedAt: string;
	durationMinutes: number;
}

export interface DestinationDwell {
	personId: string;
	personName: string;
	label: string;
	latitude: number;
	longitude: number;
	startedAt: string;
	endedAt: string;
	durationMinutes: number;
	pointCount: number;
}

export interface FamilyLocationDashboard {
	filter: { startDate: string; endDate: string };
	tracks: DashboardTrack[];
	presencePeriods: PresencePeriod[];
	destinationDwells: DestinationDwell[];
}

interface TimedPoint extends LocationTimelinePoint {
	time: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const EARTH_RADIUS_METERS = 6_371_000;

/**
 * Produces display-safe family movement data. Raw points are never mutated and
 * coordinates are rounded only after server-side presence/dwell calculations.
 */
export function buildFamilyLocationDashboard(
	points: readonly LocationTimelinePoint[],
	filter: DashboardFilter,
	policy: LocationPrivacyPolicy,
	options: DashboardOptions = {}
): FamilyLocationDashboard {
	const range = resolvePermittedRange(filter, policy);
	const allowedPeople = new Set(policy.allowedPersonIds);
	const requestedPeople = filter.personIds ? new Set(filter.personIds) : undefined;
	const precision = positiveOrDefault(policy.coordinatePrecisionMeters, 0);
	const homeRadius = positiveOrDefault(options.homeRadiusMeters, 150);
	const presenceGapMs = positiveOrDefault(options.presenceGapMinutes, 90) * 60_000;
	const dwellRadius = positiveOrDefault(options.dwellRadiusMeters, 120);
	const minimumDwellMs = positiveOrDefault(options.minimumDwellMinutes, 10) * 60_000;

	const grouped = new Map<string, TimedPoint[]>();
	for (const point of points) {
		const time = Date.parse(point.occurredAt);
		if (
			!allowedPeople.has(point.personId) ||
			(requestedPeople !== undefined && !requestedPeople.has(point.personId)) ||
			!Number.isFinite(time) ||
			time < range.start ||
			time >= range.endExclusive ||
			!isCoordinate(point.latitude, point.longitude)
		) {
			continue;
		}
		const memberPoints = grouped.get(point.personId) ?? [];
		memberPoints.push({ ...point, time });
		grouped.set(point.personId, memberPoints);
	}

	const tracks: DashboardTrack[] = [];
	const presencePeriods: PresencePeriod[] = [];
	const destinationDwells: DestinationDwell[] = [];
	for (const [personId, memberPoints] of grouped) {
		memberPoints.sort((a, b) => a.time - b.time);
		const personName = memberPoints[0].personName;
		tracks.push({
			personId,
			personName,
			points: memberPoints.map((point) => ({
				occurredAt: point.occurredAt,
				latitude: roundCoordinate(point.latitude, precision),
				longitude: roundCoordinate(point.longitude, precision),
				...(point.placeName ? { placeName: point.placeName } : {})
			}))
		});
		presencePeriods.push(...derivePresence(memberPoints, personId, personName, options.home, homeRadius, presenceGapMs));
		destinationDwells.push(...deriveDwells(memberPoints, personId, personName, dwellRadius, minimumDwellMs, precision, options.home, homeRadius));
	}

	return {
		filter: { startDate: toCalendarDate(range.start), endDate: toCalendarDate(range.endExclusive - 1) },
		tracks: tracks.sort((a, b) => a.personName.localeCompare(b.personName)),
		presencePeriods: presencePeriods.sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
		destinationDwells: destinationDwells.sort((a, b) => b.durationMinutes - a.durationMinutes)
	};
}

function derivePresence(points: readonly TimedPoint[], personId: string, personName: string, home: DashboardOptions['home'], homeRadius: number, gapMs: number): PresencePeriod[] {
	if (points.length === 0) return [];
	const periods: PresencePeriod[] = [];
	let start = points[0];
	let state = isHome(points[0], home, homeRadius) ? 'home' : 'away';
	let previous = points[0];
	for (const point of points.slice(1)) {
		const nextState = isHome(point, home, homeRadius) ? 'home' : 'away';
		if (nextState !== state || point.time - previous.time > gapMs) {
			periods.push(makePresence(personId, personName, state, start, previous));
			start = point;
			state = nextState;
		}
		previous = point;
	}
	periods.push(makePresence(personId, personName, state, start, previous));
	return periods;
}

function makePresence(personId: string, personName: string, state: 'home' | 'away', start: TimedPoint, end: TimedPoint): PresencePeriod {
	return { personId, personName, state, startedAt: start.occurredAt, endedAt: end.occurredAt, durationMinutes: Math.round((end.time - start.time) / 60_000) };
}

function deriveDwells(points: readonly TimedPoint[], personId: string, personName: string, radius: number, minimumMs: number, precision: number, home: DashboardOptions['home'], homeRadius: number): DestinationDwell[] {
	const dwells: DestinationDwell[] = [];
	let cluster: TimedPoint[] = [];
	const flush = () => {
		if (cluster.length === 0) return;
		const duration = cluster[cluster.length - 1].time - cluster[0].time;
		if (duration >= minimumMs) {
			const latitude = cluster.reduce((total, point) => total + point.latitude, 0) / cluster.length;
			const longitude = cluster.reduce((total, point) => total + point.longitude, 0) / cluster.length;
			const first = cluster[0];
			dwells.push({
				personId, personName,
				label: isHome(first, home, homeRadius) ? (home?.label ?? 'Home') : (first.placeName?.trim() || 'Destination'),
				latitude: roundCoordinate(latitude, precision), longitude: roundCoordinate(longitude, precision),
				startedAt: first.occurredAt, endedAt: cluster[cluster.length - 1].occurredAt,
				durationMinutes: Math.round(duration / 60_000), pointCount: cluster.length
			});
		}
		cluster = [];
	};
	for (const point of points) {
		if (cluster.length === 0 || distanceMeters(cluster[0], point) <= radius) cluster.push(point);
		else { flush(); cluster.push(point); }
	}
	flush();
	return dwells;
}

function resolvePermittedRange(filter: DashboardFilter, policy: LocationPrivacyPolicy): { start: number; endExclusive: number } {
	let start = parseCalendarDate(filter.startDate);
	let endExclusive = parseCalendarDate(filter.endDate) + DAY_MS;
	if (endExclusive <= start) throw new Error('endDate must not be before startDate');
	if (policy.permittedStartDate) start = Math.max(start, parseCalendarDate(policy.permittedStartDate));
	if (policy.permittedEndDate) endExclusive = Math.min(endExclusive, parseCalendarDate(policy.permittedEndDate) + DAY_MS);
	if (policy.maxDateRangeDays && endExclusive - start > policy.maxDateRangeDays * DAY_MS) endExclusive = start + policy.maxDateRangeDays * DAY_MS;
	if (endExclusive <= start) throw new Error('The selected dates are outside the permitted privacy window');
	return { start, endExclusive };
}

function parseCalendarDate(value: string): number {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Dates must use YYYY-MM-DD format');
	const time = Date.parse(`${value}T00:00:00.000Z`);
	if (!Number.isFinite(time) || toCalendarDate(time) !== value) throw new Error(`Invalid calendar date: ${value}`);
	return time;
}

function toCalendarDate(time: number): string { return new Date(time).toISOString().slice(0, 10); }
function isCoordinate(latitude: number, longitude: number): boolean { return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180; }
function positiveOrDefault(value: number | undefined, fallback: number): number { return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback; }
function isHome(point: Pick<LocationTimelinePoint, 'latitude' | 'longitude'>, home: DashboardOptions['home'], radius: number): boolean { return home !== undefined && distanceMeters(point, home) <= radius; }
function roundCoordinate(value: number, precisionMeters: number): number { if (precisionMeters <= 0) return value; const degrees = precisionMeters / 111_320; return Math.round(value / degrees) * degrees; }
function distanceMeters(a: Pick<LocationTimelinePoint, 'latitude' | 'longitude'>, b: Pick<LocationTimelinePoint, 'latitude' | 'longitude'>): number { const radians = Math.PI / 180; const dLat = (b.latitude - a.latitude) * radians; const dLon = (b.longitude - a.longitude) * radians; const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(dLon / 2) ** 2; return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h)); }
