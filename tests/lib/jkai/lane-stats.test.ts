import { describe, expect, it } from 'vitest';
import { laneOf, laneStats, median, type LaneInput } from '$lib/builds/lane-stats';

function b(over: Partial<LaneInput> = {}): LaneInput {
	return {
		origin: 'manual',
		gitTargetConfig: null,
		status: 'completed',
		outcome: null,
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
		for (const origin of ['manual', 'chat', 'forge', 'change-request', null]) {
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
		// 15 chat registrations file `completed` with zero iterations and zero
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
		expect(app.stopped).toBe(1);
	});

	it('does not count a budget cap-out or a hand-kill as a delivery', () => {
		// The production shape: of 53 rows reading `completed`, only 27 had
		// delivered. Six hit their budget and five were stopped by hand, and
		// every one of them counted as a success.
		const rows = [
			b({ outcome: 'delivered', iterationCount: 2 }),
			b({ outcome: 'budget_cap', iterationCount: 11 }),
			b({ outcome: 'stopped_by_user', iterationCount: 6 }),
			b({ status: 'failed', iterationCount: 3 }),
		];
		const app = laneStats(rows).find((s) => s.lane === 'app')!;
		expect(app.ran).toBe(4);
		// `completed` still counts all three, which is the number the old page
		// showed: 75%.
		expect(app.completed).toBe(3);
		expect(app.delivered).toBe(1);
		expect(app.capped).toBe(1);
		expect(app.stopped).toBe(1);
		expect(app.successRate).toBe(25);
		// The cap-out's 11 iterations must not drag the median for delivery.
		expect(app.medianIterations).toBe(2);
	});

	it('keeps an open PR out of the delivered numerator', () => {
		const rows = [
			b({ gitTargetConfig: { repoUrl: 'git@x:y.git' }, outcome: 'pr_open', publishedSlug: 'https://github.test/pull/1' }),
		];
		const repo = laneStats(rows).find((s) => s.lane === 'repo')!;
		expect(repo.proposed).toBe(1);
		expect(repo.delivered).toBe(0);
		expect(repo.successRate).toBe(0);
	});

	it('reads a null outcome as delivered so old rows are not demoted', () => {
		const rows = [b({ outcome: null, iterationCount: 3 })];
		const app = laneStats(rows).find((s) => s.lane === 'app')!;
		expect(app.delivered).toBe(1);
		expect(app.successRate).toBe(100);
	});

	it('counts registrations without letting them touch a rate', () => {
		const rows = [
			b({ origin: 'chat', outcome: 'registered', iterationCount: 0 }),
			b({ outcome: 'delivered', iterationCount: 2 }),
		];
		const app = laneStats(rows).find((s) => s.lane === 'app')!;
		expect(app.registered).toBe(1);
		expect(app.ran).toBe(1);
		expect(app.successRate).toBe(100);
	});
});
