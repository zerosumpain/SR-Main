/**
 * Success and iteration cost, split by the thing that actually predicts them.
 *
 * Across the first 83 production builds the lane changed median iterations to
 * success by roughly 10x (repo 1, app 4, studio 10) while success rate barely
 * moved — so the lane, not the model and not the prompt, is the number worth
 * watching. Nothing here existed before; every figure comes out of columns the
 * page already loads.
 *
 * Two counting traps this deliberately avoids:
 *
 *  - `git_target_config` holds JSON `null`, not SQL NULL, on most rows, so
 *    `IS NOT NULL` matches every build ever created. The lane is decided on
 *    `repoUrl` being present.
 *  - 24 of those 83 rows never ran an iteration — 15 are Hermes registrations
 *    that file `completed` before a file exists. Counting them inflated the
 *    success rate and dragged the median toward zero. Rates here are over
 *    builds that actually ran.
 *
 * Pure module, no imports: it is unit-tested, and anything reaching
 * `$lib/workflows` boots WhatsApp for real under vitest.
 */

export type Lane = 'repo' | 'app' | 'studio';

export interface LaneInput {
	origin: string | null;
	gitTargetConfig: unknown;
	status: string;
	iterationCount: number;
	publishedSlug: string | null;
}

export interface LaneStat {
	lane: Lane;
	/** Rows filed under this lane, including ones that never ran. */
	total: number;
	/** Rows that ran at least one iteration — the denominator for every rate. */
	ran: number;
	completed: number;
	failed: number;
	/** Completed / ran, as a percentage. Null when nothing ran. */
	successRate: number | null;
	/** Median iterations across completed builds. Null when none completed. */
	medianIterations: number | null;
	published: number;
	/** Filed but never started: registrations, queue removals, pre-launch deaths. */
	neverRan: number;
}

export function laneOf(build: Pick<LaneInput, 'origin' | 'gitTargetConfig'>): Lane {
	const cfg = build.gitTargetConfig as { repoUrl?: unknown } | null | undefined;
	if (cfg && typeof cfg === 'object' && typeof cfg.repoUrl === 'string' && cfg.repoUrl.trim()) {
		return 'repo';
	}
	if (build.origin === 'studio') return 'studio';
	return 'app';
}

export function median(values: number[]): number | null {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const LANES: Lane[] = ['repo', 'app', 'studio'];

export function laneStats(builds: LaneInput[]): LaneStat[] {
	return LANES.map((lane) => {
		const rows = builds.filter((b) => laneOf(b) === lane);
		const ran = rows.filter((b) => b.iterationCount > 0);
		const completed = ran.filter((b) => b.status === 'completed');
		const failed = ran.filter((b) => b.status === 'failed');
		return {
			lane,
			total: rows.length,
			ran: ran.length,
			completed: completed.length,
			failed: failed.length,
			successRate: ran.length ? Math.round((completed.length / ran.length) * 100) : null,
			medianIterations: median(completed.map((b) => b.iterationCount)),
			published: ran.filter((b) => b.publishedSlug).length,
			neverRan: rows.length - ran.length,
		};
	});
}
