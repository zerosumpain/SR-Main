import { describe, expect, it } from 'vitest';
import { evaluateProgressAlerts, type TrackedTask } from './progress-alerts';

const now = new Date('2026-09-05T12:00:00.000Z');

function task(overrides: Partial<TrackedTask> = {}): TrackedTask {
	return {
		id: 'build-42',
		kind: 'build',
		title: 'Customer dashboard',
		status: 'running',
		startedAt: new Date('2026-09-05T10:00:00.000Z'),
		updatedAt: new Date('2026-09-05T11:55:00.000Z'),
		...overrides
	};
}

describe('evaluateProgressAlerts', () => {
	it('emits every newly crossed configured milestone', () => {
		const alerts = evaluateProgressAlerts({
			task: task({ progressPercent: 76 }),
			policy: { milestones: [{ id: 'halfway', percent: 50 }, { id: 'review', percent: 75 }] },
			deliveredDeduplicationKeys: new Set(),
			now
		});

		expect(alerts.map((alert) => alert.milestoneId)).toEqual(['halfway', 'review']);
		expect(alerts.every((alert) => alert.type === 'milestone')).toBe(true);
	});

	it('does not repeat an already delivered milestone', () => {
		const alerts = evaluateProgressAlerts({
			task: task({ progressPercent: 50 }),
			policy: { milestones: [{ id: 'halfway', percent: 50 }] },
			deliveredDeduplicationKeys: new Set(['progress-alert:build:build-42:milestone:halfway']),
			now
		});

		expect(alerts).toEqual([]);
	});

	it('emits one completion alert and includes the outcome', () => {
		const alerts = evaluateProgressAlerts({
			task: task({ status: 'completed', outcome: 'Published preview is available.' }),
			deliveredDeduplicationKeys: new Set(),
			now
		});

		expect(alerts).toHaveLength(1);
		expect(alerts[0]).toMatchObject({ type: 'completed', deduplicationKey: 'progress-alert:build:build-42:completed' });
		expect(alerts[0]?.message).toContain('Published preview is available.');
	});

	it('identifies a running task that has become stale', () => {
		const alerts = evaluateProgressAlerts({
			task: task({ updatedAt: new Date('2026-09-05T11:00:00.000Z') }),
			policy: { milestones: [], staleAfterMs: 30 * 60 * 1000 },
			deliveredDeduplicationKeys: new Set(),
			now
		});

		expect(alerts).toHaveLength(1);
		expect(alerts[0]).toMatchObject({ type: 'intervention', deduplicationKey: 'progress-alert:build:build-42:stalled' });
	});

	it('prioritises terminal completion over stale and milestone checks', () => {
		const alerts = evaluateProgressAlerts({
			task: task({ status: 'completed', progressPercent: 100, updatedAt: new Date('2026-09-05T09:00:00.000Z') }),
			deliveredDeduplicationKeys: new Set(),
			now
		});

		expect(alerts.map((alert) => alert.type)).toEqual(['completed']);
	});
});
