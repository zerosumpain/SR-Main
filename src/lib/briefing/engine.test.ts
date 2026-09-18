import { describe, expect, it } from 'vitest';
import { normaliseTimeline, runScheduledBriefing, type ActivityObservationInput, type ConsentGrant } from '$lib/briefing/engine';

const now = '2026-08-25T09:00:00.000Z';

function consent(overrides: Partial<ConsentGrant> = {}): ConsentGrant {
	return {
		id: 'consent-1',
		subjectId: 'person-1',
		source: 'calendar',
		purposes: ['briefing'],
		categories: ['calendar'],
		grantedAt: '2026-08-01T00:00:00.000Z',
		...overrides
	};
}

function observation(overrides: Partial<ActivityObservationInput> = {}): ActivityObservationInput {
	return {
		source: 'calendar',
		sourceRecordId: 'event-42',
		category: 'calendar',
		sensitivity: 'sensitive',
		summary: 'Private appointment',
		occurredAt: '2026-08-25T08:30:00.000Z',
		startsAt: '2026-08-25T10:00:00.000Z',
		provenance: {
			source: 'calendar',
			sourceRecordId: 'event-42',
			retrievedAt: '2026-08-25T08:31:00.000Z',
			url: 'https://calendar.example/events/event-42'
		},
		...overrides
	};
}

describe('normaliseTimeline', () => {
	it('keeps provenance and excludes records after consent has been revoked', () => {
		const active = observation();
		const revoked = observation({ sourceRecordId: 'event-43', provenance: { source: 'calendar', sourceRecordId: 'event-43', retrievedAt: now } });
		const result = normaliseTimeline('person-1', [active, revoked], [consent()], now);

		expect(result.observations).toHaveLength(2);
		expect(result.observations[0].provenance.url).toBe('https://calendar.example/events/event-42');

		const revokedResult = normaliseTimeline('person-1', [active], [consent({ revokedAt: '2026-08-24T00:00:00.000Z' })], now);
		expect(revokedResult.observations).toEqual([]);
		expect(revokedResult.excluded[0]?.reason).toBe('revoked_consent');
	});
});

describe('runScheduledBriefing', () => {
	it('returns review-only proposals without repeating sensitive source content', () => {
		const result = runScheduledBriefing({
			subjectId: 'person-1',
			now,
			schedule: { intervalMinutes: 60, lastRunAt: '2026-08-25T07:00:00.000Z' },
			consents: [consent()],
			observations: [observation()]
		});

		expect(result.due).toBe(true);
		expect(result.proposals).toHaveLength(1);
		expect(result.proposals[0]).toMatchObject({ action: 'open_source_record', kind: 'upcoming_observation' });
		expect(result.proposals[0]?.title).not.toContain('Private appointment');
		expect(result.proposals[0]?.provenance.sourceRecordId).toBe('event-42');
	});

	it('does not inspect or propose observations before the schedule is due', () => {
		const result = runScheduledBriefing({
			subjectId: 'person-1',
			now,
			schedule: { intervalMinutes: 60, lastRunAt: '2026-08-25T08:30:00.000Z' },
			consents: [],
			observations: [observation()]
		});

		expect(result).toEqual({ due: false, timeline: { observations: [], excluded: [] }, proposals: [] });
	});
});
