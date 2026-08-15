export type CalendarEvent = {
	id: string;
	calendarId: string;
	title: string;
	startsAt: string;
	endsAt: string;
	allDay?: boolean;
};

export type FamilyCalendar = {
	memberId: string;
	memberName: string;
	events: CalendarEvent[];
};

export type EventDraft = {
	calendarId: string;
	title: string;
	startsAt: string;
	endsAt: string;
	location?: string;
	notes?: string;
	attendeeMemberIds?: string[];
};

export type CalendarConflict = {
	memberId: string;
	memberName: string;
	event: CalendarEvent;
	overlapStartsAt: string;
	overlapEndsAt: string;
};

export type EventPreview = EventDraft & {
	durationMinutes: number;
	conflicts: CalendarConflict[];
	availableMemberIds: string[];
	unavailableMemberIds: string[];
	isAvailableForEveryone: boolean;
};

export type AppleCalendarAction =
	| { kind: 'create'; calendarId: string; event: EventDraft }
	| { kind: 'update'; calendarId: string; eventId: string; event: EventDraft }
	| { kind: 'delete'; calendarId: string; eventId: string };

function asDate(value: string, field: string): Date {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new Error(`${field} must be a valid ISO date-time`);
	}
	return date;
}

function assertDraft(draft: EventDraft): { start: Date; end: Date } {
	if (!draft.calendarId.trim()) throw new Error('calendarId is required');
	if (!draft.title.trim()) throw new Error('title is required');
	const start = asDate(draft.startsAt, 'startsAt');
	const end = asDate(draft.endsAt, 'endsAt');
	if (end <= start) throw new Error('endsAt must be after startsAt');
	return { start, end };
}

function overlaps(start: Date, end: Date, event: CalendarEvent): boolean {
	const eventStart = asDate(event.startsAt, 'event.startsAt');
	const eventEnd = asDate(event.endsAt, 'event.endsAt');
	if (eventEnd <= eventStart) throw new Error(`event ${event.id} ends before it starts`);
	return start < eventEnd && eventStart < end;
}

function latestIso(...dates: Date[]): string {
	return new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString();
}

function earliestIso(...dates: Date[]): string {
	return new Date(Math.min(...dates.map((date) => date.getTime()))).toISOString();
}

export function assessAvailability(draft: EventDraft, calendars: FamilyCalendar[]): EventPreview {
	const { start, end } = assertDraft(draft);
	const requestedMembers = draft.attendeeMemberIds
		? new Set(draft.attendeeMemberIds)
		: new Set(calendars.map((calendar) => calendar.memberId));
	const relevantCalendars = calendars.filter((calendar) => requestedMembers.has(calendar.memberId));
	const conflicts = relevantCalendars.flatMap((calendar) =>
		calendar.events
			.filter((event) => overlaps(start, end, event))
			.map((event) => ({
				memberId: calendar.memberId,
				memberName: calendar.memberName,
				event,
				overlapStartsAt: latestIso(start, asDate(event.startsAt, 'event.startsAt')),
				overlapEndsAt: earliestIso(end, asDate(event.endsAt, 'event.endsAt'))
			}))
	);
	const unavailableMemberIds = [...new Set(conflicts.map((conflict) => conflict.memberId))];
	const availableMemberIds = relevantCalendars
		.map((calendar) => calendar.memberId)
		.filter((memberId) => !unavailableMemberIds.includes(memberId));

	return {
		...draft,
		durationMinutes: Math.round((end.getTime() - start.getTime()) / 60_000),
		conflicts,
		availableMemberIds,
		unavailableMemberIds,
		isAvailableForEveryone: unavailableMemberIds.length === 0
	};
}

export function buildAppleCalendarAction(
	operation: 'create' | 'update' | 'delete',
	input: { calendarId: string; eventId?: string; event?: EventDraft }
): AppleCalendarAction {
	if (!input.calendarId.trim()) throw new Error('calendarId is required');
	if (operation === 'delete') {
		if (!input.eventId?.trim()) throw new Error('eventId is required for delete');
		return { kind: 'delete', calendarId: input.calendarId, eventId: input.eventId };
	}
	if (!input.event) throw new Error(`event is required for ${operation}`);
	assertDraft(input.event);
	if (input.event.calendarId !== input.calendarId) {
		throw new Error('event.calendarId must match calendarId');
	}
	if (operation === 'create') return { kind: 'create', calendarId: input.calendarId, event: input.event };
	if (!input.eventId?.trim()) throw new Error('eventId is required for update');
	return { kind: 'update', calendarId: input.calendarId, eventId: input.eventId, event: input.event };
}
