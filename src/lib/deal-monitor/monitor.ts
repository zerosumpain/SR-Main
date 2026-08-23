export type DealRequirement = {
	id: string;
	currency: string;
	notificationThresholdMinor: number;
};

export type DealCandidate = {
	retailerSourceId: string;
	externalId: string;
	title: string;
	url: string;
	priceMinor: number;
	currency: string;
	observedAt: Date;
};

export type ExistingListing = {
	id: string;
	fingerprint: string;
	priceMinor: number;
	currency: string;
};

export type ListingWrite = DealCandidate & {
	requirementId: string;
	fingerprint: string;
};

export type DealEvaluation = {
	fingerprint: string;
	listing: ListingWrite;
	isNewListing: boolean;
	priceChanged: boolean;
	recordPriceHistory: boolean;
	notification: {
		shouldNotify: boolean;
		reason: 'new-under-threshold' | 'crossed-threshold' | null;
	};
};

export function dealFingerprint(retailerSourceId: string, externalId: string): string {
	const source = retailerSourceId.trim().toLowerCase();
	const listing = externalId.trim().toLowerCase();

	if (!source || !listing) throw new Error('retailerSourceId and externalId are required');
	return `${source}:${listing}`;
}

export function evaluateDealCandidate(
	requirement: DealRequirement,
	candidate: DealCandidate,
	existing: ExistingListing | null
): DealEvaluation {
	if (!Number.isSafeInteger(candidate.priceMinor) || candidate.priceMinor < 0) {
		throw new Error('priceMinor must be a non-negative safe integer');
	}
	if (!Number.isSafeInteger(requirement.notificationThresholdMinor) || requirement.notificationThresholdMinor < 0) {
		throw new Error('notificationThresholdMinor must be a non-negative safe integer');
	}
	if (candidate.currency !== requirement.currency) {
		throw new Error('candidate currency must match the requirement currency');
	}

	const fingerprint = dealFingerprint(candidate.retailerSourceId, candidate.externalId);
	if (existing && existing.fingerprint !== fingerprint) {
		throw new Error('existing listing fingerprint does not match candidate');
	}
	if (existing && existing.currency !== candidate.currency) {
		throw new Error('existing listing currency does not match candidate');
	}

	const isNewListing = existing === null;
	const priceChanged = isNewListing || existing.priceMinor !== candidate.priceMinor;
	const underThreshold = candidate.priceMinor <= requirement.notificationThresholdMinor;
	const crossedThreshold = !isNewListing && existing.priceMinor > requirement.notificationThresholdMinor && underThreshold;

	return {
		fingerprint,
		listing: { ...candidate, requirementId: requirement.id, fingerprint },
		isNewListing,
		priceChanged,
		recordPriceHistory: priceChanged,
		notification: {
			shouldNotify: underThreshold && (isNewListing || crossedThreshold),
			reason: isNewListing && underThreshold ? 'new-under-threshold' : crossedThreshold ? 'crossed-threshold' : null
		}
	};
}
