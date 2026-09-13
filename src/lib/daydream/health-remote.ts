import { getFromExtracted } from '$lib/server/extracted-app';
import type {
	HealthDerived,
	HealthSegmentTaxonomy,
} from '$lib/server/health-signals-contract';
import type {
	ReadinessResponse,
	SleepAnalysis,
	TrainingLoadResponse,
} from '$lib/health-sync/types';

/**
 * What the daydream sampler reads out of SR-Health, now that it is a call.
 *
 * These five used to be `await import('$lib/health/…')` and a function call in
 * this process. Health is its own application, so they are service-lane GETs.
 *
 * None of the five declares its own idea of the payload, and that is the point.
 * Sleep, readiness and training load are typed from $lib/health-sync/types —
 * the file that came out of the health tree with the ingest lane, is
 * byte-identical to SR-Health's copy, and is already registered in both drift
 * manifests. So the types these endpoints actually return are the types used
 * here, and changing one without the other is a red test rather than a field
 * that silently arrives undefined. A hand-written subset would have been a
 * second, unguarded opinion about the same shape — and the first attempt at one
 * missed `trend` and `latest.date`, which is exactly how that goes.
 *
 * `derived` and `segmentTaxonomy` have a contract of their own, for endpoints
 * that exist only for this caller and annotate their responses with it.
 *
 * Every one of the five is called inside a try/catch that records a failed or
 * empty source on the snapshot's source list, and health-derived and segments
 * raise a source_error fault that becomes silent_source after ten quiet days.
 * That is what makes "Health is not answering" a visible state rather than a
 * reading that quietly stops.
 */

export const remoteSleep = () => getFromExtracted<SleepAnalysis>('health', '/api/health/sleep');

export const remoteTrainingLoad = () =>
	getFromExtracted<TrainingLoadResponse>('health', '/api/health/training-load');

export const remoteReadiness = () =>
	getFromExtracted<ReadinessResponse>('health', '/api/health/readiness');

export const remoteHealthDerived = () =>
	getFromExtracted<HealthDerived>('health', '/api/health/derived');

export const remoteSegmentTaxonomy = () =>
	getFromExtracted<HealthSegmentTaxonomy>('health', '/api/health/segment-taxonomy');
