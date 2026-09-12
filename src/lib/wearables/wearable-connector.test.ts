import { describe, expect, it } from 'vitest';
import {
	buildSixWeekFrequencyPlan,
	createAuthorizedWearableConnector,
	type WearableProviderPayload
} from '$lib/wearables/wearable-connector';

describe('createAuthorizedWearableConnector', () => {
	it('authorises the request and creates source-timestamped, idempotent imports', async () => {
		let authorization = '';
		const connector = createAuthorizedWearableConnector<WearableProviderPayload>({
			provider: 'example-watch',
			endpoint: 'https://wearable.example/me/export',
			now: () => new Date('2026-01-10T12:00:00.000Z'),
			fetcher: async (_url, init) => {
				authorization = init.headers.Authorization;
				return {
					ok: true,
					status: 200,
					json: async () => ({
						accountId: 'athlete-1',
						vo2max: [
							{ sourceId: 'v1', observedAt: '2026-01-01T08:00:00Z', value: 48, unit: 'ml/kg/min' },
							{ sourceId: 'v1', observedAt: '2026-01-02T08:00:00Z', value: 49, unit: 'ml/kg/min' }
						],
						heartRateZones: [{
							sourceId: 'z1', observedAt: '2026-01-02T08:00:00Z', zones: [
								{ name: 'Z1', lowerBpm: 100, upperBpm: 120 },
								{ name: 'Z2', lowerBpm: 121, upperBpm: 140 }
							]
						}],
						workouts: [{ sourceId: 'w1', observedAt: '2026-01-03T10:00:00Z', startedAt: '2026-01-03T09:00:00Z', sport: 'run', durationSeconds: 1800 }]
					})
				};
			}
		});

		const snapshot = await connector.importSnapshot('secret-token');
		expect(authorization).toBe('Bearer secret-token');
		expect(snapshot.vo2max).toHaveLength(1);
		expect(snapshot.vo2max[0].importKey).toBe('example-watch:athlete-1:vo2max:v1');
		expect(snapshot.vo2max[0].record.value).toBe(49);
		expect(snapshot.workouts[0].record.startedAt).toBe('2026-01-03T09:00:00Z');
	});
});

describe('buildSixWeekFrequencyPlan', () => {
	it('caps all six weeks and reduces frequency for high fatigue', () => {
		const plan = buildSixWeekFrequencyPlan({
			maximumSessionsPerWeek: 5,
			fatigue: 'high',
			now: new Date('2026-01-29T12:00:00Z'),
			workouts: [
				{ sourceId: '1', observedAt: '2026-01-25T10:00:00Z', startedAt: '2026-01-25T09:00:00Z', sport: 'run', durationSeconds: 1800 },
				{ sourceId: '2', observedAt: '2026-01-20T10:00:00Z', startedAt: '2026-01-20T09:00:00Z', sport: 'run', durationSeconds: 1800 },
				{ sourceId: '3', observedAt: '2026-01-15T10:00:00Z', startedAt: '2026-01-15T09:00:00Z', sport: 'run', durationSeconds: 1800 },
				{ sourceId: '4', observedAt: '2026-01-10T10:00:00Z', startedAt: '2026-01-10T09:00:00Z', sport: 'run', durationSeconds: 1800 }
			],
			vo2max: [{ sourceId: 'v1', observedAt: '2026-01-28T08:00:00Z', value: 50, unit: 'ml/kg/min' }],
			heartRateZones: []
		});

		expect(plan.weeks).toHaveLength(6);
		expect(plan.weeks.every((week) => week.maximumSessions === 1)).toBe(true);
		expect(plan.weeks.every((week) => week.focus === 'recovery')).toBe(true);
		expect(plan.evidence.latestVo2max?.value).toBe(50);
	});
});
