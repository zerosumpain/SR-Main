import { describe, expect, it } from 'vitest';
import { assessAvailability, buildAppleCalendarAction, type EventDraft, type FamilyCalendar } from '$lib/calendar/availability';

const draft: EventDraft = {
	calendarId: 'family',
	title: 'Dinner',
	startsAt: '2026-08-20T18:00:00.000Z',
	endsAt: '2026-08-20T19:00:00.000Z',
	attendeeMemberIds: ['alex', 'sam']
};

const calendars: FamilyCalendar[] = [
	{
		memberId: 'alex',
		memberName: 'Alex',
		events: [{ id: 'a1', calendarId: 'alex', title: 'Football', startsAt: '2026-08-20T18:30:00.000Z', endsAt: '2026-08-20T20:00:00.000Z' }]
	},
	{ memberId: 'sam', memberName: 'Sam', events: [{ id: 's1', calendarId: 'sam', title: 'School', startsAt: '2026-08-20T16:00:00.000Z', endsAt: '2026-08-20T18:00:00.000Z' }] }
];

describe('assessAvailability', () => {
	it('identifies overlapping events and available family members', () => {
		const preview = assessAvailability(draft, calendars);
		expect(preview.durationMinutes).toBe(60);
		expect(preview.isAvailableForEveryone).toBe(false);
		expect(preview.unavailableMemberIds).toEqual(['alex']);
		expect(preview.availableMemberIds).toEqual(['sam']);
		expect(preview.conflicts[0]).toMatchObject({ memberName: 'Alex', overlapStartsAt: '2026-08-20T18:30:00.000Z', overlapEndsAt: '2026-08-20T19:00:00.000Z' });
	});

	it('does not treat an event ending at the proposed start as a conflict', () => {
		expect(assessAvailability(draft, [calendars[1]]).isAvailableForEveryone).toBe(true);
	});
});

describe('buildAppleCalendarAction', () => {
	it('builds create, update, and delete payloads', () => {
		expect(buildAppleCalendarAction('create', { calendarId: 'family', event: draft })).toMatchObject({ kind: 'create', calendarId: 'family' });
		expect(buildAppleCalendarAction('update', { calendarId: 'family', eventId: 'event-1', event: draft })).toMatchObject({ kind: 'update', eventId: 'event-1' });
		expect(buildAppleCalendarAction('delete', { calendarId: 'family', eventId: 'event-1' })).toEqual({ kind: 'delete', calendarId: 'family', eventId: 'event-1' });
	});
});
