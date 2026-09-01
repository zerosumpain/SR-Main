export type TrailSport = 'run' | 'trail_run' | 'walk' | 'hike' | 'ride' | 'mtb';

export type RouteCoordinate = readonly [longitude: number, latitude: number, elevationMetres?: number];

export interface SurfaceBreakdown {
	value: string;
	distanceMetres: number;
}

export interface TrailRouteInput {
	name: string;
	sport: string;
	coordinates: readonly RouteCoordinate[];
	distanceMetres: number;
	surfaces?: readonly SurfaceBreakdown[];
	circularityToleranceMetres?: number;
}

export interface RouteQualityCheck {
	isCircular: boolean;
	endpointGapMetres: number;
	circularityToleranceMetres: number;
	trailSurfaceMetres: number;
	trailSurfacePercent: number;
	isTrailSurfaceSuitable: boolean;
	passed: boolean;
	issues: string[];
}

export interface GeoJsonLineStringFeature {
	type: 'Feature';
	properties: { name: string; sport: TrailSport; quality: RouteQualityCheck };
	geometry: { type: 'LineString'; coordinates: RouteCoordinate[] };
}

export interface TrailRouteWorkflow {
	sport: TrailSport;
	quality: RouteQualityCheck;
	gpx: string;
	mapFeature: GeoJsonLineStringFeature;
	exportRequest: { gpx: string; basename: string; activity: TrailSport; distanceMiles: number };
}

const SPORT_ALIASES: Record<string, TrailSport> = {
	run: 'run',
	running: 'run',
	trail_run: 'trail_run',
	'trail running': 'trail_run',
	trailrunning: 'trail_run',
	walk: 'walk',
	walking: 'walk',
	hike: 'hike',
	hiking: 'hike',
	ride: 'ride',
	cycling: 'ride',
	'bike ride': 'ride',
	mtb: 'mtb',
	'mountain bike': 'mtb',
	mountain_bike: 'mtb'
};

const TRAIL_SURFACES = new Set([
	'ground', 'dirt', 'earth', 'grass', 'gravel', 'fine_gravel', 'compacted', 'pebblestone',
	'woodchips', 'sand', 'unpaved', 'path', 'trail'
]);

export function normalizeTrailSport(value: string): TrailSport {
	const normalized = value.trim().toLowerCase().replace(/-/g, '_').replace(/\s+/g, ' ');
	const sport = SPORT_ALIASES[normalized];
	if (!sport) {
		throw new Error('sport must be one of: run, trail_run, walk, hike, ride, mtb');
	}
	return sport;
}

export function checkTrailRouteQuality(input: Pick<TrailRouteInput, 'coordinates' | 'distanceMetres' | 'surfaces' | 'circularityToleranceMetres'>): RouteQualityCheck {
	if (input.coordinates.length < 2) throw new Error('A route requires at least two coordinates');
	if (!Number.isFinite(input.distanceMetres) || input.distanceMetres <= 0) throw new Error('distanceMetres must be greater than zero');

	const endpointGapMetres = distanceBetween(input.coordinates[0], input.coordinates[input.coordinates.length - 1]);
	const circularityToleranceMetres = input.circularityToleranceMetres ?? Math.max(100, input.distanceMetres * 0.03);
	const trailSurfaceMetres = (input.surfaces ?? []).reduce(
		(total, surface) => total + (TRAIL_SURFACES.has(surface.value.toLowerCase()) ? Math.max(0, surface.distanceMetres) : 0),
		0
	);
	const trailSurfacePercent = input.surfaces?.length ? Math.min(100, (trailSurfaceMetres / input.distanceMetres) * 100) : 0;
	const isCircular = endpointGapMetres <= circularityToleranceMetres;
	const isTrailSurfaceSuitable = trailSurfacePercent >= 50;
	const issues = [
		...(isCircular ? [] : [`Route ends ${Math.round(endpointGapMetres)}m from its start`]),
		...(isTrailSurfaceSuitable ? [] : [`Only ${Math.round(trailSurfacePercent)}% of the route is trail/path surface`])
	];

	return { isCircular, endpointGapMetres, circularityToleranceMetres, trailSurfaceMetres, trailSurfacePercent, isTrailSurfaceSuitable, passed: issues.length === 0, issues };
}

export function composeTrailRouteWorkflow(input: TrailRouteInput): TrailRouteWorkflow {
	const sport = normalizeTrailSport(input.sport);
	const quality = checkTrailRouteQuality(input);
	const coordinates = input.coordinates.map((coordinate) => [...coordinate] as RouteCoordinate);
	const mapFeature: GeoJsonLineStringFeature = {
		type: 'Feature',
		properties: { name: input.name, sport, quality },
		geometry: { type: 'LineString', coordinates }
	};
	const gpx = toGpx(input.name, sport, coordinates);
	return {
		sport,
		quality,
		gpx,
		mapFeature,
		exportRequest: { gpx, basename: slugify(input.name), activity: sport, distanceMiles: input.distanceMetres / 1609.344 }
	};
}

function distanceBetween(a: RouteCoordinate, b: RouteCoordinate): number {
	const radians = Math.PI / 180;
	const latitudeDelta = (b[1] - a[1]) * radians;
	const longitudeDelta = (b[0] - a[0]) * radians;
	const startLatitude = a[1] * radians;
	const endLatitude = b[1] * radians;
	const haversine = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
	return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function toGpx(name: string, sport: TrailSport, coordinates: readonly RouteCoordinate[]): string {
	const points = coordinates.map(([longitude, latitude, elevation]) => `    <trkpt lat="${latitude}" lon="${longitude}">${elevation === undefined ? '' : `<ele>${elevation}</ele>`}</trkpt>`).join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="trail-route-workflow" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk>\n    <name>${escapeXml(name)}</name>\n    <type>${sport}</type>\n    <trkseg>\n${points}\n    </trkseg>\n  </trk>\n</gpx>`;
}

function slugify(value: string): string {
	const slug = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
	return slug || 'trail-route';
}

function escapeXml(value: string): string {
	return value.replace(/[<>&'\"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character] as string);
}
