export type SubscriptionEvidenceSource = 'paypal' | 'truelayer' | 'gmail';
export type SubscriptionEvidenceKind = 'charge' | 'invoice' | 'subscription';

export interface SubscriptionEvidence {
	id: string;
	source: SubscriptionEvidenceSource;
	kind: SubscriptionEvidenceKind;
	merchant: string;
	/** Use this to reconcile known aliases, such as a bank descriptor and invoice sender. */
	merchantKey?: string;
	occurredAt: string;
	amountMinor?: number;
	currency?: string;
	paypalSubscriptionId?: string;
	paypalSubscriptionStatus?: 'active' | 'cancelled' | 'suspended' | 'unknown';
	description?: string;
}

export type SubscriptionConfidence = 'high' | 'medium' | 'low';

export interface CancellationHandoff {
	status: 'ready' | 'unavailable';
	confirmationRequired: true;
	paypalSubscriptionId?: string;
	reason: string;
}

export interface SubscriptionReview {
	merchant: string;
	merchantKey: string;
	confidence: SubscriptionConfidence;
	confidenceScore: number;
	confidenceReasons: string[];
	firstChargeAt?: string;
	lastChargeAt?: string;
	lastChargeAmountMinor?: number;
	currency?: string;
	evidence: {
		paypal: SubscriptionEvidence[];
		truelayer: SubscriptionEvidence[];
		gmail: SubscriptionEvidence[];
	};
	cancellation: CancellationHandoff;
}

const sourceOrder: SubscriptionEvidenceSource[] = ['paypal', 'truelayer', 'gmail'];

function merchantKeyFor(evidence: SubscriptionEvidence): string {
	const value = evidence.merchantKey ?? evidence.merchant;
	return value
		.toLocaleLowerCase('en-GB')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.replace(/\s+/g, ' ');
}

function validTimestamp(value: string): number | undefined {
	const timestamp = Date.parse(value);
	return Number.isNaN(timestamp) ? undefined : timestamp;
}

function sortedByOccurrence(evidence: SubscriptionEvidence[]): SubscriptionEvidence[] {
	return [...evidence].sort((left, right) => {
		const leftTime = validTimestamp(left.occurredAt) ?? Number.MAX_SAFE_INTEGER;
		const rightTime = validTimestamp(right.occurredAt) ?? Number.MAX_SAFE_INTEGER;
		return leftTime - rightTime;
	});
}

function confidenceFor(evidence: SubscriptionEvidence[]): {
	score: number;
	confidence: SubscriptionConfidence;
	reasons: string[];
} {
	const reasons: string[] = [];
	const charges = evidence.filter((item) => item.kind === 'charge' && validTimestamp(item.occurredAt) !== undefined);
	const chargeDates = new Set(charges.map((item) => item.occurredAt.slice(0, 10)));
	const sources = new Set(evidence.map((item) => item.source));
	const activePaypalSubscription = evidence.some(
		(item) => item.source === 'paypal' && item.paypalSubscriptionId && item.paypalSubscriptionStatus === 'active'
	);

	let score = 0;
	if (chargeDates.size >= 2) {
		score += 35;
		reasons.push('Multiple charge dates indicate a repeating payment.');
	} else if (chargeDates.size === 1) {
		score += 15;
		reasons.push('One charge has been observed.');
	}
	if (sources.has('truelayer')) {
		score += 20;
		reasons.push('Matched TrueLayer bank evidence.');
	}
	if (sources.has('paypal')) {
		score += 20;
		reasons.push('Matched PayPal evidence.');
	}
	if (sources.has('gmail')) {
		score += 15;
		reasons.push('Matched Gmail invoice or receipt evidence.');
	}
	if (activePaypalSubscription) {
		score += 10;
		reasons.push('An active PayPal billing subscription was identified.');
	}

	const cappedScore = Math.min(score, 100);
	return {
		score: cappedScore,
		confidence: cappedScore >= 70 ? 'high' : cappedScore >= 40 ? 'medium' : 'low',
		reasons
	};
}

function cancellationFor(evidence: SubscriptionEvidence[]): CancellationHandoff {
	const activeIds = new Set(
		evidence
			.filter(
				(item) =>
					item.source === 'paypal' &&
					item.paypalSubscriptionStatus === 'active' &&
					typeof item.paypalSubscriptionId === 'string' &&
					item.paypalSubscriptionId.length > 0
			)
			.map((item) => item.paypalSubscriptionId as string)
	);

	if (activeIds.size === 1) {
		return {
			status: 'ready',
			confirmationRequired: true,
			paypalSubscriptionId: [...activeIds][0],
			reason: 'An active PayPal subscription was matched. Cancellation must be explicitly confirmed by the user.'
		};
	}

	return {
		status: 'unavailable',
		confirmationRequired: true,
		reason:
			activeIds.size > 1
				? 'More than one active PayPal subscription matched this merchant; choose a subscription before cancelling.'
				: 'No uniquely identified active PayPal subscription is available for a safe cancellation handoff.'
	};
}

/**
 * Reconciles evidence already collected by the subscription detector and connected providers.
 * It is deliberately pure: it neither persists data nor executes cancellation.
 */
export function reconcileSubscriptions(evidence: SubscriptionEvidence[]): SubscriptionReview[] {
	const grouped = new Map<string, SubscriptionEvidence[]>();

	for (const item of evidence) {
		const key = merchantKeyFor(item);
		if (!key) continue;
		const group = grouped.get(key) ?? [];
		group.push(item);
		grouped.set(key, group);
	}

	return [...grouped.entries()]
		.map(([merchantKey, group]) => {
			const bySource = Object.fromEntries(
				sourceOrder.map((source) => [source, sortedByOccurrence(group.filter((item) => item.source === source))])
			) as SubscriptionReview['evidence'];
			const charges = sortedByOccurrence(group.filter((item) => item.kind === 'charge' && validTimestamp(item.occurredAt) !== undefined));
			const latestCharge = charges.at(-1);
			const confidence = confidenceFor(group);
			const displayMerchant = group.find((item) => item.merchant.trim())?.merchant.trim() ?? merchantKey;

			return {
				merchant: displayMerchant,
				merchantKey,
				confidence: confidence.confidence,
				confidenceScore: confidence.score,
				confidenceReasons: confidence.reasons,
				firstChargeAt: charges[0]?.occurredAt,
				lastChargeAt: latestCharge?.occurredAt,
				lastChargeAmountMinor: latestCharge?.amountMinor,
				currency: latestCharge?.currency,
				evidence: bySource,
				cancellation: cancellationFor(group)
			};
		})
		.sort((left, right) => right.confidenceScore - left.confidenceScore || left.merchant.localeCompare(right.merchant));
}
