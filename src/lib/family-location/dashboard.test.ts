import { describe, expect, it } from 'vitest';
import { buildFamilyLocationDashboard, type LocationTimelinePoint } from '$lib/family-location/dashboard';

const points: LocationTimelinePoint[] = [
	{ personId: 'alex', personName: 'Alex', occurredAt: '2026-08-20T08:00:00Z', latitude: 54.5, longitude: -1.5 },
	{ personId: 'alex', personName: 'Alex', occurredAt: '2026-08-20T08:30:00Z', latitude: 54.5, longitude: -1.5 },
	{ personId: 'alex', personName: 'Alex', occurredAt: '2026-08-20T09:00:00Z', latitude: 54.51, longitude: -1.51, placeName: 'School' },
	{ personId: 'alex', personName: 'Alex', occurredAt: '2026-08-20T10:00:00Z', latitude: 54.5101, longitude: -1.5101, placeName: 'School' },
	{ personId: 'private', personName: 'Private', occurredAt: '2026-08-20T09:00:00Z', latitude: 54.6, longitude: -1.6 }
];

describe('buildFamilyLocationDashboard', () => {
	it('builds tracks, home/away periods and spatial destination dwells', () => {
		const dashboard = buildFamilyLocationDashboard(points, { startDate: '2026-08-20', endDate: '2026-08-20' }, { allowedPersonIds: ['alex'] }, { home: { latitude: 54.5, longitude: -1.5 }, minimumDwellMinutes: 20 });
		expect(dashboard.tracks).toHaveLength(1);
		expect(dashboard.tracks[0].points).toHaveLength(4);
		expect(dashboard.presencePeriods.map((period) => [period.state, period.durationMinutes])).toEqual([['home', 30], ['away', 60]]);
		expect(dashboard.destinationDwells).toMatchObject([{ label: 'Home', durationMinutes: 30 }, { label: 'School', durationMinutes: 60 }]);
	});

	it('clips requested dates to the server-side privacy window and excludes unrequested people', () => {
		const dashboard = buildFamilyLocationDashboard(points, { startDate: '2026-08-01', endDate: '2026-08-30', personIds: ['alex', 'private'] }, { allowedPersonIds: ['alex', 'private'], permittedStartDate: '2026-08-20', permittedEndDate: '2026-08-20', coordinatePrecisionMeters: 100 });
		expect(dashboard.filter).toEqual({ startDate: '2026-08-20', endDate: '2026-08-20' });
		expect(dashboard.tracks.map((track) => track.personId)).toEqual(['alex', 'private']);
		expect(dashboard.tracks[0].points[0].latitude).not.toBe(54.5);
	});

	it('rejects malformed date filters', () => {
		expect(() => buildFamilyLocationDashboard([], { startDate: '20-08-2026', endDate: '2026-08-20' }, { allowedPersonIds: [] })).toThrow('YYYY-MM-DD');
	});
});
