import { getFromExtracted } from '$lib/server/extracted-app';
import type {
	HealthDerived,
	HealthSegmentTaxonomy,
} from '$lib/server/health-signals-contract';

/**
 * What the daydream sampler reads out of SR-Health, now that it is a call.
 *
 * These five used to be `await import('$lib/health/…')` and a function call in
 * this process. Health is its own application, so they are service-lane GETs —
 * and the subsets below are the honest statement of what this repository
 * actually indexes, kept in one file rather than spread across four.
 *
 * Two of the five have a shared, byte-identical contract on both sides
 * (`derived` and `segmentTaxonomy`) because their endpoints exist only for this
 * caller and are annotated with those very types, so a rename fails the type
 * check over there. The other three are the analyses the agent tools also read,
 * which are served unprojected; declaring only the fields used here is the
 * correct trade, and it is not free — a rename on the far side arrives as
 * `undefined`, not as a build error.
 *
 * That is survivable BECAUSE of where these are called. Every one of the five
 * sits inside a try/catch that records a failed or empty source on the
 * snapshot's own source list, and `health-derived` and `segments` raise a
 * `source_error` fault that becomes `silent_source` after ten quiet days. A
 * field that goes missing shows up as a reading that stopped, which is the
 * thing that list exists to notice.
 */

/** `GET /api/health/sleep` — the two figures the sleep tripwire checks. */
export type RemoteSleep = {
	latest: {
		/** MILLISECONDS (whoop_sleep.total_in_bed). The "464,018 hours" bug was
		 *  this value assigned straight into a field named durationMins. */
		totalDuration: number;
		performance: number;
		endedAt?: string | null;
	} | null;
};

/** `GET /api/health/training-load`. */
export type RemoteTrainingLoad = {
	ratio: number;
	zone: string;
	history?: ReadonlyArray<{ date: string; load: number }>;
};

/** `GET /api/health/readiness`. */
export type RemoteReadiness = {
	score: number;
	label: string;
	factors: {
		hrvTrend: {
			observedAt?: string | null;
			raw?: number | null;
			avg7d?: number | null;
			source?: string | null;
		};
	};
};

export const remoteSleep = () => getFromExtracted<RemoteSleep>('health', '/api/health/sleep');

export const remoteTrainingLoad = () =>
	getFromExtracted<RemoteTrainingLoad>('health', '/api/health/training-load');

export const remoteReadiness = () =>
	getFromExtracted<RemoteReadiness>('health', '/api/health/readiness');

export const remoteHealthDerived = () =>
	getFromExtracted<HealthDerived>('health', '/api/health/derived');

export const remoteSegmentTaxonomy = () =>
	getFromExtracted<HealthSegmentTaxonomy>('health', '/api/health/segment-taxonomy');
