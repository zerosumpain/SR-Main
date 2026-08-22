export type EvidenceSource = 'bank' | 'paypal' | 'email';

export interface SubscriptionEvidence {
	id: string;
	source: EvidenceSource;
	merchant: string;
	occurredAt: string;
	amount?: number;
	currency?: string;
	description?: string;
	paypalSubscriptionId?: string;
}

export interface ReconciliationInput {
	evidence: readonly SubscriptionEvidence[];
	knownSubscriptionKeys?: readonly string[];
}

export interface ReviewGroup {
	id: string;
	merchant: string;
	merchantKey: string;
	evidence: readonly SubscriptionEvidence[];
	sources: readonly EvidenceSource[];
	paymentCount: number;
	currency?: string;
	averageAmount?: number;
	cadenceDays?: number;
	isRecurring: boolean;
	isNew: boolean;
	status: 'review' | 'confirmed';
	paypalSubscriptionId?: string;
}

export interface ReconciliationReview {
	groups: readonly ReviewGroup[];
	newRecurringCount: number;
}

export interface CancellationRequest {
	groupId: string;
	merchant: string;
	paypalSubscriptionId: string;
}

const recurringCadenceMinimumDays = 20;
const recurringCadenceMaximumDays = 40;

export function reconcileSubscriptions(input: ReconciliationInput): ReconciliationReview {
	const knownKeys = new Set((input.knownSubscriptionKeys ?? []).map(normalizeMerchant));
	const grouped = new Map<string, SubscriptionEvidence[]>();

	for (const item of input.evidence) {
		const merchantKey = normalizeMerchant(item.merchant);
		if (!merchantKey || !isValidDate(item.occurredAt)) continue;
		const items = grouped.get(merchantKey) ?? [];
		items.push(item);
		grouped.set(merchantKey, items);
	}

	const groups = [...grouped.entries()]
		.map(([merchantKey, evidence]) => buildGroup(merchantKey, evidence, knownKeys))
		.sort((left, right) => Number(right.isNew) - Number(left.isNew) || left.merchant.localeCompare(right.merchant));

	return {
		groups,
		newRecurringCount: groups.filter((group) => group.isNew).length
	};
}

export function confirmCancellation(review: ReconciliationReview, groupId: string): ReconciliationReview {
	let found = false;
	const groups = review.groups.map((group) => {
		if (group.id !== groupId) return group;
		found = true;
		return { ...group, status: 'confirmed' as const };
	});

	if (!found) throw new Error(`Unknown subscription review group: ${groupId}`);
	return { ...review, groups };
}

export function createCancellationRequest(review: ReconciliationReview, groupId: string): CancellationRequest {
	const group = review.groups.find((candidate) => candidate.id === groupId);
	if (!group) throw new Error(`Unknown subscription review group: ${groupId}`);
	if (group.status !== 'confirmed') throw new Error('Cancellation must be confirmed before it can be requested.');
	if (!group.paypalSubscriptionId) throw new Error('This subscription has no PayPal subscription id to cancel.');

	return {
		groupId: group.id,
		merchant: group.merchant,
		paypalSubscriptionId: group.paypalSubscriptionId
	};
}

export function normalizeMerchant(merchant: string): string {
	return merchant
		.toLocaleLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.replace(/\s+/g, ' ');
}

function buildGroup(merchantKey: string, evidence: readonly SubscriptionEvidence[], knownKeys: ReadonlySet<string>): ReviewGroup {
	const sortedEvidence = [...evidence].sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
	const payments = sortedEvidence.filter((item) => typeof item.amount === 'number' && item.amount > 0);
	const cadenceDays = calculateCadenceDays(payments);
	const isRecurring = payments.length >= 2 && cadenceDays !== undefined && cadenceDays >= recurringCadenceMinimumDays && cadenceDays <= recurringCadenceMaximumDays;
	const currencies = new Set(payments.map((item) => item.currency).filter((currency): currency is string => Boolean(currency)));
	const paypalSubscriptionId = sortedEvidence.find((item) => item.paypalSubscriptionId)?.paypalSubscriptionId;

	return {
		id: merchantKey,
		merchant: sortedEvidence[0]?.merchant ?? merchantKey,
		merchantKey,
		evidence: sortedEvidence,
		sources: [...new Set(sortedEvidence.map((item) => item.source))].sort(),
		paymentCount: payments.length,
		currency: currencies.size === 1 ? [...currencies][0] : undefined,
		averageAmount: payments.length ? roundToPennies(payments.reduce((total, item) => total + (item.amount ?? 0), 0) / payments.length) : undefined,
		cadenceDays,
		isRecurring,
		isNew: isRecurring && !knownKeys.has(merchantKey),
		status: 'review',
		paypalSubscriptionId
	};
}

function calculateCadenceDays(payments: readonly SubscriptionEvidence[]): number | undefined {
	if (payments.length < 2) return undefined;
	const intervals = payments.slice(1).map((payment, index) => (Date.parse(payment.occurredAt) - Date.parse(payments[index].occurredAt)) / 86_400_000);
	intervals.sort((left, right) => left - right);
	const middle = Math.floor(intervals.length / 2);
	const median = intervals.length % 2 ? intervals[middle] : (intervals[middle - 1] + intervals[middle]) / 2;
	return roundToPennies(median);
}

function isValidDate(value: string): boolean {
	return !Number.isNaN(Date.parse(value));
}

function roundToPennies(value: number): number {
	return Math.round(value * 100) / 100;
}
