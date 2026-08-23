import { describe, expect, it } from 'vitest';
import { laneOf, laneStats, median, type LaneInput } from '$lib/builds/lane-stats';

function b(over: Partial<LaneInput> = {}): LaneInput {
	return {
		origin: 'manual',
		gitTargetConfig: null,
		status: 'completed',
		iterationCount: 1,
		publishedSlug: null,
		...over,
	};
}

describe('laneOf', () => {
	it('reads repo from repoUrl, not from the config being non-null', () => {
		// The production trap: git_target_config holds JSON null on most rows,
		// so `IS NOT NULL` matched all 83 builds and reported every one as repo.
		expect(laneOf({ origin: 'manual', gitTargetConfig: null })).toBe('app');
		expect(laneOf({ origin: 'manual', gitTargetConfig: {} })).toBe('app');
		expect(laneOf({ origin: 'manual', gitTargetConfig: { repoUrl: '' } })).toBe('app');
		expect(laneOf({ origin: 'manual', gitTargetConfig: { repoUrl: '  ' } })).toBe('app');
		expect(laneOf({ origin: 'manual', gitTargetConfig: { repoUrl: 'git@x:y.git' } })).toBe('repo');
	});

	it('classifies studio by origin, and repo wins over studio', () => {
		expect(laneOf({ origin: 'studio', gitTargetConfig: null })).toBe('studio');
		expect(laneOf({ origin: 'studio', gitTargetConfig: { repoUrl: 'git@x:y.git' } })).toBe('repo');
	});

	it('defaults everything else to app', () => {
		for (const origin of ['manual', 'hermes', 'forge', 'change-request', null]) {
			expect(laneOf({ origin, gitTargetConfig: null })).toBe('app');
		}
	});
});

describe('median', () => {
	it('handles odd, even and empty', () => {
		expect(median([3, 1, 2])).toBe(2);
		expect(median([4, 1, 2, 3])).toBe(2.5);
		expect(median([])).toBe(null);
	});
});

describe('laneStats', () => {
	it('excludes builds that never ran from every rate', () => {
		// 15 Hermes registrations file `completed` with zero iterations and zero
		// tokens. Counting them made the builder look better than it is.
		const rows = [
			b({ status: 'completed', iterationCount: 0 }),
			b({ status: 'completed', iterationCount: 0 }),
			b({ status: 'completed', iterationCount: 2 }),
			b({ status: 'failed', iterationCount: 4 }),
		];
		const app = laneStats(rows).find((s) => s.lane === 'app')!;
		expect(app.total).toBe(4);
		expect(app.ran).toBe(2);
		expect(app.neverRan).toBe(2);
		expect(app.completed).toBe(1);
		expect(app.failed).toBe(1);
		expect(app.successRate).toBe(50);
		expect(app.medianIterations).toBe(2);
	});

	it('reports every lane even when empty', () => {
		const stats = laneStats([]);
		expect(stats.map((s) => s.lane)).toEqual(['repo', 'app', 'studio']);
		for (const s of stats) {
			expect(s.successRate).toBe(null);
			expect(s.medianIterations).toBe(null);
			expect(s.total).toBe(0);
		}
	});

	it('separates the three lanes and counts published among those that ran', () => {
		const rows = [
			b({ gitTargetConfig: { repoUrl: 'git@x:y.git' }, iterationCount: 1 }),
			b({ origin: 'studio', iterationCount: 10 }),
			b({ iterationCount: 4, publishedSlug: 'thing' }),
			b({ iterationCount: 0, publishedSlug: 'never-ran' }),
		];
		const [repo, app, studio] = laneStats(rows);
		expect(repo.ran).toBe(1);
		expect(repo.medianIterations).toBe(1);
		expect(studio.medianIterations).toBe(10);
		expect(app.published).toBe(1);
		expect(app.total).toBe(2);
	});

	it('does not count a cancelled build as either success or failure', () => {
		const rows = [b({ status: 'cancelled', iterationCount: 3 }), b({ iterationCount: 1 })];
		const app = laneStats(rows).find((s) => s.lane === 'app')!;
		expect(app.ran).toBe(2);
		expect(app.completed).toBe(1);
		expect(app.failed).toBe(0);
		expect(app.successRate).toBe(50);
	});
});
