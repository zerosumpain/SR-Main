import { describe, expect, it } from 'vitest';
import { rankNextDayActivities } from '$lib/activity-planner/rank-next-day';

describe('rankNextDayActivities', () => {
	it('prioritises an open, nearby indoor preference with confirmed booking evidence', () => {
		const result = rankNextDayActivities({
			targetDate: '2026-09-02',
			weather: { precipitationProbability: 85 },
			familyAges: [6, 10],
			preferredTags: ['swimming', 'creative'],
			availableWindows: [{ start: '10:00', end: '15:00' }],
			bookingEvidence: [{ activityId: 'pool', confirmed: true, source: 'calendar' }],
			priorActivities: [{ activityId: 'museum', date: '2026-08-25' }],
			activities: [
				{ id: 'museum', title: 'Museum craft table', venue: 'Museum', kind: 'indoor', distanceKm: 1, tags: ['creative'], openingHours: [{ weekday: 3, windows: [{ start: '09:00', end: '17:00' }] }] },
				{ id: 'pool', title: 'Family swim', venue: 'Pool', kind: 'indoor', distanceKm: 2, tags: ['swimming'], openingHours: [{ weekday: 3, windows: [{ start: '09:00', end: '18:00' }] }] },
				{ id: 'park', title: 'Park trail', venue: 'Park', kind: 'outdoor', distanceKm: 0.5, tags: ['nature'], openingHours: [{ weekday: 3, windows: [{ start: '08:00', end: '18:00' }] }] }
			]
		});

		expect(result.suggestions.map((suggestion) => suggestion.activity.id)).toEqual(['pool', 'museum', 'park']);
		expect(result.suggestions[0].reasons).toContain('Confirmed booking evidence found.');
	});

	it('rejects activities that are closed, age-incompatible, or listed for another day', () => {
		const result = rankNextDayActivities({
			targetDate: '2026-09-02',
			weather: { precipitationProbability: 10 },
			familyAges: [5],
			preferredTags: [],
			availableWindows: [{ start: '10:00', end: '11:00' }],
			activities: [
				{ id: 'closed', title: 'Closed pool', venue: 'Pool', kind: 'indoor', tags: [], openingHours: [{ weekday: 3, windows: [{ start: '12:00', end: '18:00' }] }] },
				{ id: 'older', title: 'Teen session', venue: 'Centre', kind: 'indoor', minimumAge: 11, tags: [] },
				{ id: 'wrong-day', title: 'Tomorrow no more', venue: 'Hall', kind: 'indoor', date: '2026-09-03', tags: [] }
			]
		});

		expect(result.suggestions).toHaveLength(0);
		expect(result.rejected.map((item) => item.activity.id)).toEqual(['closed', 'older', 'wrong-day']);
	});
});
