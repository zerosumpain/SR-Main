import { describe, expect, it } from 'vitest';
import { checkTrailRouteQuality, composeTrailRouteWorkflow, normalizeTrailSport } from '$lib/trails/route-workflow';

describe('normalizeTrailSport', () => {
	it('uses the route-tool sport vocabulary while accepting legacy labels', () => {
		expect(normalizeTrailSport('running')).toBe('run');
		expect(normalizeTrailSport('trail running')).toBe('trail_run');
		expect(normalizeTrailSport('mountain bike')).toBe('mtb');
	});

	it('rejects unsupported sports with the platform-compatible vocabulary', () => {
		expect(() => normalizeTrailSport('swimming')).toThrow('sport must be one of: run, trail_run, walk, hike, ride, mtb');
	});
});

describe('trail route workflow', () => {
	const coordinates = [
		[-1.5595, 54.5236, 90],
		[-1.55, 54.53, 102],
		[-1.55955, 54.52365, 91]
	] as const;

	it('passes a mostly-trail loop and composes GPX plus map data', () => {
		const result = composeTrailRouteWorkflow({
			name: 'Riverside & Woods', sport: 'trail_run', coordinates, distanceMetres: 4_000,
			surfaces: [{ value: 'dirt', distanceMetres: 2_500 }, { value: 'asphalt', distanceMetres: 1_500 }]
		});

		expect(result.quality.passed).toBe(true);
		expect(result.mapFeature.geometry.coordinates).toEqual(coordinates);
		expect(result.gpx).toContain('<name>Riverside &amp; Woods</name>');
		expect(result.gpx).toContain('<trkpt lat="54.5236" lon="-1.5595"><ele>90</ele></trkpt>');
		expect(result.exportRequest).toMatchObject({ basename: 'riverside-woods', activity: 'trail_run' });
	});

	it('reports both a non-circular route and insufficient trail surface', () => {
		const quality = checkTrailRouteQuality({
			coordinates: [[-1.5595, 54.5236], [-1.53, 54.54]], distanceMetres: 3_000,
			surfaces: [{ value: 'asphalt', distanceMetres: 3_000 }], circularityToleranceMetres: 100
		});

		expect(quality.passed).toBe(false);
		expect(quality.isCircular).toBe(false);
		expect(quality.isTrailSurfaceSuitable).toBe(false);
		expect(quality.issues).toHaveLength(2);
	});
});
