export type ConsentPurpose = 'briefing';
export type ActivitySensitivity = 'standard' | 'sensitive';

/** A source- and category-scoped permission granted explicitly by one subject. */
export interface ConsentGrant {
	id: string;
	subjectId: string;
	source: string;
	purposes: readonly ConsentPurpose[];
	categories: readonly string[];
	grantedAt: string;
	revokedAt?: string;
	expiresAt?: string;
}

/** Identifies the exact external record from which an observation was obtained. */
export interface ObservationProvenance {
	source: string;
	sourceRecordId: string;
	retrievedAt: string;
	observedAt?: string;
	url?: string;
}

/**
 * An explicit observation from a connected source. `summary` is source-supplied
 * content, not an inferred user fact. Every observation must retain provenance.
 */
export interface ActivityObservationInput {
	source: string;
	sourceRecordId: string;
	category: string;
	sensitivity: ActivitySensitivity;
	summary: string;
	occurredAt: string;
	startsAt?: string;
	endsAt?: string;
	provenance: ObservationProvenance;
}

export interface ActivityObservation extends ActivityObservationInput {
	id: string;
	occurredAt: string;
	startsAt?: string;
	endsAt?: string;
	provenance: ObservationProvenance;
}

export type ExclusionReason = 'invalid_timestamp' | 'missing_consent' | 'revoked_consent' | 'expired_consent';

export interface ExcludedObservation {
	input: ActivityObservationInput;
	reason: ExclusionReason;
}

export interface NormalisedTimeline {
	observations: readonly ActivityObservation[];
	excluded: readonly ExcludedObservation[];
}

export interface BriefingSchedule {
	intervalMinutes: number;
	lastRunAt?: string;
}

export interface BriefingProposal {
	id: string;
	kind: 'upcoming_observation' | 'new_observation';
	action: 'open_source_record';
	title: string;
	observationId: string;
	provenance: ObservationProvenance;
}

export interface BriefingResult {
	due: boolean;
	timeline: NormalisedTimeline;
	proposals: readonly BriefingProposal[];
}

export interface RunScheduledBriefingInput {
	subjectId: string;
	now: string;
	schedule: BriefingSchedule;
	consents: readonly ConsentGrant[];
	observations: readonly ActivityObservationInput[];
	horizonMinutes?: number;
	maxProposals?: number;
}

function timestamp(value: string): number | undefined {
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? undefined : parsed;
}

function canonicalTimestamp(value: string): string | undefined {
	const parsed = timestamp(value);
	return parsed === undefined ? undefined : new Date(parsed).toISOString();
}

function consentStatus(
	subjectId: string,
	observation: ActivityObservationInput,
	consents: readonly ConsentGrant[],
	now: number
): ExclusionReason | undefined {
	const matching = consents
		.filter(
			(consent) =>
				consent.subjectId === subjectId &&
				consent.source === observation.source &&
				consent.purposes.includes('briefing') &&
				consent.categories.includes(observation.category)
		)
		.sort((left, right) => (timestamp(right.grantedAt) ?? -Infinity) - (timestamp(left.grantedAt) ?? -Infinity));

	const consent = matching[0];
	if (!consent) return 'missing_consent';
	if ((timestamp(consent.revokedAt ?? '') ?? Infinity) <= now) return 'revoked_consent';
	if ((timestamp(consent.expiresAt ?? '') ?? Infinity) <= now) return 'expired_consent';
	if ((timestamp(consent.grantedAt) ?? Infinity) > now) return 'missing_consent';
	return undefined;
}

/**
 * Applies current explicit consent while producing a source-neutral, chronologically
 * ordered timeline. Rejected observations are returned for audit rather than hidden.
 */
export function normaliseTimeline(
	subjectId: string,
	inputs: readonly ActivityObservationInput[],
	consents: readonly ConsentGrant[],
	now: string
): NormalisedTimeline {
	const nowMs = timestamp(now);
	if (nowMs === undefined) throw new RangeError('now must be a valid ISO timestamp');

	const observations: ActivityObservation[] = [];
	const excluded: ExcludedObservation[] = [];

	for (const input of inputs) {
		const occurredAt = canonicalTimestamp(input.occurredAt);
		const retrievedAt = canonicalTimestamp(input.provenance.retrievedAt);
		const startsAt = input.startsAt === undefined ? undefined : canonicalTimestamp(input.startsAt);
		const endsAt = input.endsAt === undefined ? undefined : canonicalTimestamp(input.endsAt);

		if (!occurredAt || !retrievedAt || (input.startsAt !== undefined && !startsAt) || (input.endsAt !== undefined && !endsAt)) {
			excluded.push({ input, reason: 'invalid_timestamp' });
			continue;
		}

		const consentReason = consentStatus(subjectId, input, consents, nowMs);
		if (consentReason) {
			excluded.push({ input, reason: consentReason });
			continue;
		}

		observations.push({
			...input,
			id: `${input.source}:${input.sourceRecordId}`,
			occurredAt,
			startsAt,
			endsAt,
			provenance: { ...input.provenance, retrievedAt }
		});
	}

	observations.sort(
		(left, right) => timestamp(right.occurredAt)! - timestamp(left.occurredAt)! || left.id.localeCompare(right.id)
	);
	return { observations, excluded };
}

export function isBriefingDue(schedule: BriefingSchedule, now: string): boolean {
	if (!Number.isFinite(schedule.intervalMinutes) || schedule.intervalMinutes <= 0) {
		throw new RangeError('intervalMinutes must be greater than zero');
	}

	if (!schedule.lastRunAt) return true;
	const nowMs = timestamp(now);
	const lastRunMs = timestamp(schedule.lastRunAt);
	if (nowMs === undefined || lastRunMs === undefined) throw new RangeError('schedule timestamps must be valid ISO timestamps');
	return nowMs - lastRunMs >= schedule.intervalMinutes * 60_000;
}

function proposalFor(observation: ActivityObservation, kind: BriefingProposal['kind']): BriefingProposal {
	const category = observation.category.replace(/[_-]+/g, ' ').trim() || 'source';
	return {
		id: `${kind}:${observation.id}`,
		kind,
		action: 'open_source_record',
		// Deliberately generic: a briefing can point to sensitive source data without restating it as a fact.
		title: `Review ${category} update from ${observation.source}`,
		observationId: observation.id,
		provenance: { ...observation.provenance }
	};
}

/**
 * Produces review-only proposals. It has no storage dependency and never creates
 * profile facts or inferred sensitive attributes; consumers must treat its output
 * as ephemeral unless a user explicitly approves a separate save operation.
 */
export function runScheduledBriefing(input: RunScheduledBriefingInput): BriefingResult {
	if (!isBriefingDue(input.schedule, input.now)) {
		return { due: false, timeline: { observations: [], excluded: [] }, proposals: [] };
	}

	const horizonMinutes = input.horizonMinutes ?? 24 * 60;
	const maxProposals = input.maxProposals ?? 5;
	if (!Number.isFinite(horizonMinutes) || horizonMinutes < 0 || !Number.isInteger(maxProposals) || maxProposals < 1) {
		throw new RangeError('horizonMinutes must be non-negative and maxProposals must be a positive integer');
	}

	const timeline = normaliseTimeline(input.subjectId, input.observations, input.consents, input.now);
	const nowMs = timestamp(input.now)!;
	const lastRunMs = input.schedule.lastRunAt ? timestamp(input.schedule.lastRunAt) : undefined;
	const horizonMs = nowMs + horizonMinutes * 60_000;
	const proposals: BriefingProposal[] = [];

	for (const observation of timeline.observations) {
		const startsAtMs = observation.startsAt ? timestamp(observation.startsAt)! : undefined;
		const isUpcoming = startsAtMs !== undefined && startsAtMs >= nowMs && startsAtMs <= horizonMs;
		const isNew = lastRunMs === undefined || timestamp(observation.occurredAt)! > lastRunMs;
		if (!isUpcoming && !isNew) continue;

		proposals.push(proposalFor(observation, isUpcoming ? 'upcoming_observation' : 'new_observation'));
		if (proposals.length === maxProposals) break;
	}

	return { due: true, timeline, proposals };
}
