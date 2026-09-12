import { describe, expect, it } from 'vitest';
import { normalizeLocationHistory } from '$lib/location/location-history';

describe('normalizeLocationHistory', () => {
	it('returns an empty, successful-shaped result for empty Home Assistant history', () => {
		expect(normalizeLocationHistory([])).toEqual({ samples: [], visits: [] });
		expect(normalizeLocationHistory({ history: [] })).toEqual({ samples: [], visits: [] });
	});

	it('handles Home Assistant nested multi-device history and identifies the home zone', () => {
		const result = normalizeLocationHistory([
			[
				{ entity_id: 'device_tracker.alice', state: 'home', last_changed: '2026-01-01T08:00:00Z', attributes: { latitude: 54.5, longitude: -1.5 } },
				{ entity_id: 'device_tracker.alice', state: 'Work', last_changed: '2026-01-01T09:00:00Z', attributes: { latitude: 54.6, longitude: -1.6, location_name: 'Office' } }
			],
			[
				{ entity_id: 'device_tracker.bob', state: 'not_home', last_changed: '2026-01-01T09:00:00Z', attributes: { latitude: '54.7', longitude: '-1.7' } }
			]
		]);

		expect(result.samples).toHaveLength(3);
		expect(result.samples[0]).toMatchObject({ entityId: 'device_tracker.alice', isHome: true, locationName: 'Home' });
		expect(result.samples[1]).toMatchObject({ entityId: 'device_tracker.alice', locationName: 'Office', source: 'zone' });
		expect(result.samples[2]).toMatchObject({ entityId: 'device_tracker.bob', source: 'geopoint' });
		expect(result.visits).toHaveLength(3);
	});

	it('uses geopoint history to detect home when Life360 supplies no home state', () => {
		const result = normalizeLocationHistory([{ entity_id: 'device_tracker.phone', state: 'not_home', last_updated: '2026-01-01T10:00:00Z', attributes: { lat: 54.5236, lng: -1.5595 } }], {
			home: { latitude: 54.5236, longitude: -1.5595, radiusMetres: 100 }
		});

		expect(result.samples).toEqual([expect.objectContaining({ isHome: true, locationName: 'Home', source: 'geopoint' })]);
	});

	it('filters requested devices without failing when other device records are present', () => {
		const result = normalizeLocationHistory([
			{ entity_id: 'device_tracker.alice', state: 'home', last_changed: '2026-01-01T10:00:00Z', attributes: {} },
			{ entity_id: 'device_tracker.bob', state: 'home', last_changed: '2026-01-01T10:00:00Z', attributes: {} }
		], { entityIds: ['device_tracker.bob'] });

		expect(result.samples.map((sample) => sample.entityId)).toEqual(['device_tracker.bob']);
	});
});
