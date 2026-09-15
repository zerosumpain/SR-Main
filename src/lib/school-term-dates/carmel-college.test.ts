import { describe, expect, it } from 'vitest';
import {
	CarmelCollegeSourceError,
	extractCarmelCollegeTermEvents,
	fetchCarmelCollegeTermCalendar,
	isOfficialCarmelCollegeTermPage
} from '$lib/school-term-dates/carmel-college';

const officialUrl = 'https://www.carmelcollege.co.uk/term-dates/';
const officialPage = `
	<html><body>
		<h1>Carmel College</h1><p>Darlington</p>
		<h2>Autumn Term 2025</h2>
		<p>Monday 1 September 2025 – Friday 19 December 2025</p>
		<h2>Spring Term 2026</h2>
		<p>Monday 5 January 2026 to Friday 27 March 2026</p>
	</body></html>
`;

describe('Carmel College term-date connector', () => {
	it('verifies the official school hostname and school identity', () => {
		expect(isOfficialCarmelCollegeTermPage(officialUrl, officialPage)).toBe(true);
		expect(isOfficialCarmelCollegeTermPage('https://example.test/term-dates', officialPage)).toBe(false);
		expect(isOfficialCarmelCollegeTermPage(officialUrl, '<h1>Carmel College</h1>')).toBe(false);
	});

	it('normalises published inclusive date ranges into all-day calendar events', () => {
		expect(extractCarmelCollegeTermEvents(officialPage, officialUrl)).toEqual([
		{
			id: 'carmel-college-2025-09-01-2025-12-20',
			title: 'Autumn Term 2025',
			startDate: '2025-09-01',
			endDate: '2025-12-20',
			allDay: true,
			sourceUrl: officialUrl
		},
		{
			id: 'carmel-college-2026-01-05-2026-03-28',
			title: 'Spring Term 2026',
			startDate: '2026-01-05',
			endDate: '2026-03-28',
			allDay: true,
			sourceUrl: officialUrl
		}
		]);
	});

	it('fetches only verified pages and returns source provenance', async () => {
		const calendar = await fetchCarmelCollegeTermCalendar({
			fetch: async () => ({ ok: true, status: 200, url: officialUrl, text: async () => officialPage }),
			now: () => new Date('2025-01-01T12:00:00.000Z')
		});

		expect(calendar.schoolName).toBe('Carmel College, Darlington');
		expect(calendar.fetchedAt).toBe('2025-01-01T12:00:00.000Z');
		expect(calendar.events).toHaveLength(2);
	});

	it('rejects a redirect away from the official school website', async () => {
		await expect(
			fetchCarmelCollegeTermCalendar({
				fetch: async () => ({
					ok: true,
					status: 200,
					url: 'https://calendar.example.test/carmel',
					text: async () => officialPage
				})
			})
		).rejects.toBeInstanceOf(CarmelCollegeSourceError);
	});
});
