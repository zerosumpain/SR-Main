import { describe, expect, it } from 'vitest';

import { createLocationHistoryHeatmap } from '$lib/location-history/heatmap';

describe('createLocationHistoryHeatmap', () => {
	const dateRange = {
		start: '2026-09-01T00:00:00.000Z',
		end: '2026-09-07T23:59:59.999Z'
	};

	it('creates a render_map heatmap layer ordered by dwell time', () => {
		const heatmap = createLocationHistoryHeatmap({
			dateRange,
			locations: [
				{ latitude: 54.5236, longitude: -1.5595, totalMinutes: 30, visitCount: 2, label: 'Town' },
				{ latitude: 54.5, longitude: -1.6, totalMinutes: 180, visitCount: 1, label: 'Home' }
			]
		});

		expect(heatmap).toEqual({
			dateRange,
			layers: [
				{
					type: 'heatmap',
					points: [
						{ lat: 54.5, lng: -1.6, weight: 180, label: 'Home' },
						{ lat: 54.5236, lng: -1.5595, weight: 30, label: 'Town' }
					]
				}
			]
		});
	});

	it('uses visit count when dwell time is unavailable and excludes invalid coordinates', () => {
		const heatmap = createLocationHistoryHeatmap({
			dateRange,
			locations: [
				{ latitude: 51.5, longitude: -0.12, visitCount: 4 },
				{ latitude: 91, longitude: 0, visitCount: 99 },
				{ latitude: Number.NaN, longitude: 0, visitCount: 99 }
			]
		});

		expect(heatmap.layers[0].points).toEqual([{ lat: 51.5, lng: -0.12, weight: 4 }]);
	});

	it('limits the most significant points and rejects an inverted date range', () => {
		expect(
			createLocationHistoryHeatmap({
				dateRange,
				maxPoints: 1,
				locations: [
					{ latitude: 1, longitude: 1, visitCount: 1 },
					{ latitude: 2, longitude: 2, visitCount: 2 }
				]
			}).layers[0].points
		).toEqual([{ lat: 2, lng: 2, weight: 2 }]);

		expect(() =>
			createLocationHistoryHeatmap({
				dateRange: { start: dateRange.end, end: dateRange.start },
				locations: []
			})
		).toThrow('dateRange start must not be after end');
	});
});
