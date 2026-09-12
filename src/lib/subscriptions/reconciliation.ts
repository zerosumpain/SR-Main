import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

export const subscriptionSources = ['truelayer', 'paypal', 'gmail', 'detector'] as const;
export type SubscriptionSource = (typeof subscriptionSources)[number];

export const subscriptionStatuses = [
	'review',
	'kept',
	'dismissed',
	'cancellation_requested',
	'cancellation_failed',
	'cancelled'
] as const;
export type SubscriptionStatus = (typeof subscriptionStatuses)[number];

export type BillingCadence = 'weekly' | 'monthly' | 'annual' | 'unknown';

export interface SubscriptionEvidence {
	id: string;
	source: SubscriptionSource;
	merchant: string;
	occurredAt?: string;
	amountMinor?: number;
	currency?: string;
	cadence?: BillingCadence;
	confidence?: number;
	/** A PayPal billing subscription id when this evidence can be cancelled through PayPal. */
	externalSubscriptionId?: string;
	url?: string;
	description?: string;
}

export interface CancellationRequest {
	provider: 'paypal';
	subscriptionId: string;
	requestedAt: string;
	completedAt?: string;
	error?: string;
}

export interface SubscriptionRecord {
	id: string;
	userId: string;
	merchant: string;
	merchantKey: string;
	amountMinor: number | null;
	currency: string;
	cadence: BillingCadence;
	confidence: number;
	status: SubscriptionStatus;
	evidence: SubscriptionEvidence[];
	cancellation: CancellationRequest | null;
	lastSeenAt: string;
	createdAt: string;
	updatedAt: string;
}

/**
 * Persistent storage shape. Export this table from the application's Drizzle schema
 * registry before generating the migration.
 */
export const subscriptionReconciliations = pgTable(
	'subscription_reconciliations',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		userId: text('user_id').notNull(),
		merchant: text('merchant').notNull(),
		merchantKey: text('merchant_key').notNull(),
		amountMinor: integer('amount_minor'),
		currency: varchar('currency', { length: 3 }).notNull(),
		cadence: varchar('cadence', { length: 16 }).notNull(),
		confidence: integer('confidence').notNull(),
		status: varchar('status', { length: 32 }).notNull(),
		evidence: jsonb('evidence').$type<SubscriptionEvidence[]>().notNull(),
		cancellation: jsonb('cancellation').$type<CancellationRequest | null>(),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
	},
	(table) => [
		uniqueIndex('subscription_reconciliations_user_merchant_currency_unique').on(
			table.userId,
			table.merchantKey,
			table.currency
		),
		index('subscription_reconciliations_user_status_idx').on(table.userId, table.status)
	]
);

/** Minimal boundary a server-side Drizzle repository should implement. */
export interface SubscriptionReconciliationStore {
	listForUser(userId: string): Promise<SubscriptionRecord[]>;
	upsert(record: Omit<SubscriptionRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<SubscriptionRecord>;
	setStatus(id: string, status: SubscriptionStatus, updatedAt: string): Promise<SubscriptionRecord>;
	setCancellation(id: string, cancellation: CancellationRequest, status: SubscriptionStatus): Promise<SubscriptionRecord>;
}

export interface ReconciliationDraft extends Omit<SubscriptionRecord, 'id' | 'createdAt' | 'updatedAt'> {}

export interface DashboardData {
	reviewQueue: SubscriptionRecord[];
	cancellationQueue: SubscriptionRecord[];
	activeMonthlyEstimateMinor: number;
	currency: string | null;
}

export function normaliseMerchant(value: string): string {
	return value
		.toLocaleLowerCase('en-GB')
		.replace(/https?:\/\/|www\./g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.replace(/\b(payment|card|purchase|subscription|invoice|receipt|direct debit)\b/g, '')
		.trim()
		.replace(/\s+/g, ' ');
}

export function reconcileEvidence(userId: string, evidence: SubscriptionEvidence[], now = new Date().toISOString()): ReconciliationDraft[] {
	const groups = new Map<string, SubscriptionEvidence[]>();

	for (const item of evidence) {
		const merchantKey = normaliseMerchant(item.merchant);
		if (!merchantKey) continue;
		const currency = (item.currency ?? 'GBP').toUpperCase();
		const key = `${merchantKey}:${currency}`;
		const group = groups.get(key) ?? [];
		group.push({ ...item, currency });
		groups.set(key, group);
	}

	return [...groups.entries()].map(([key, items]) => {
		const [merchantKey, currency] = key.split(':');
		const datedItems = items
			.map((item) => ({ item, time: item.occurredAt ? Date.parse(item.occurredAt) : Number.NaN }))
			.filter((entry) => Number.isFinite(entry.time))
			.sort((a, b) => a.time - b.time);
		const mostRecent = datedItems.at(-1)?.item.occurredAt ?? now;
		const paypalEvidence = items.find((item) => item.source === 'paypal' && item.externalSubscriptionId);
		const sources = new Set(items.map((item) => item.source));
		const suppliedCadence = items.find((item) => item.cadence && item.cadence !== 'unknown')?.cadence;
		const amount = [...items].reverse().find((item) => Number.isInteger(item.amountMinor) && item.amountMinor! > 0)?.amountMinor ?? null;

		return {
			userId,
			merchant: items[0].merchant.trim(),
			merchantKey,
			amountMinor: amount,
			currency,
			cadence: suppliedCadence ?? inferCadence(datedItems.map((entry) => entry.time)),
			confidence: confidenceFor(items, sources.size),
			status: 'review',
			evidence: items,
			cancellation: paypalEvidence
				? { provider: 'paypal', subscriptionId: paypalEvidence.externalSubscriptionId!, requestedAt: '' }
				: null,
			lastSeenAt: mostRecent
		};
	});
}

export function requestCancellation(record: SubscriptionRecord, now = new Date().toISOString()): CancellationRequest {
	const subscriptionId = record.evidence.find(
		(item) => item.source === 'paypal' && Boolean(item.externalSubscriptionId)
	)?.externalSubscriptionId;
	if (!subscriptionId) throw new Error('This subscription has no cancellable PayPal billing agreement.');
	return { provider: 'paypal', subscriptionId, requestedAt: now };
}

export function recordCancellationResult(request: CancellationRequest, succeeded: boolean, now = new Date().toISOString(), error?: string): CancellationRequest {
	return succeeded
		? { ...request, completedAt: now, error: undefined }
		: { ...request, error: error || 'The provider did not confirm cancellation.' };
}

export function buildDashboard(records: SubscriptionRecord[]): DashboardData {
	const reviewQueue = records.filter((record) => record.status === 'review').sort(byConfidenceThenMerchant);
	const cancellationQueue = records
		.filter((record) => record.status === 'cancellation_requested' || record.status === 'cancellation_failed')
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	const active = records.filter((record) => ['review', 'kept', 'cancellation_requested'].includes(record.status));
	const currencies = new Set(active.map((record) => record.currency));
	const currency = currencies.size === 1 ? [...currencies][0] : null;
	const activeMonthlyEstimateMinor = currency
		? active.reduce((sum, record) => sum + monthlyAmount(record.amountMinor, record.cadence), 0)
		: 0;
	return { reviewQueue, cancellationQueue, activeMonthlyEstimateMinor, currency };
}

function inferCadence(times: number[]): BillingCadence {
	if (times.length < 2) return 'unknown';
	const gaps = times.slice(1).map((time, index) => (time - times[index]) / 86_400_000).sort((a, b) => a - b);
	const gap = gaps[Math.floor(gaps.length / 2)];
	if (gap >= 5 && gap <= 10) return 'weekly';
	if (gap >= 20 && gap <= 40) return 'monthly';
	if (gap >= 300 && gap <= 400) return 'annual';
	return 'unknown';
}

function confidenceFor(items: SubscriptionEvidence[], sourceCount: number): number {
	const explicit = Math.max(0, ...items.map((item) => item.confidence ?? 0));
	const detectorBonus = items.some((item) => item.source === 'detector') ? 0.18 : 0;
	const repeats = Math.max(0, items.length - 1) * 0.08;
	return Math.round(Math.min(0.98, Math.max(explicit, 0.2 + sourceCount * 0.18 + detectorBonus + repeats)) * 100);
}

function monthlyAmount(amountMinor: number | null, cadence: BillingCadence): number {
	if (amountMinor === null) return 0;
	if (cadence === 'weekly') return Math.round((amountMinor * 52) / 12);
	if (cadence === 'annual') return Math.round(amountMinor / 12);
	return cadence === 'monthly' ? amountMinor : 0;
}

function byConfidenceThenMerchant(a: SubscriptionRecord, b: SubscriptionRecord): number {
	return b.confidence - a.confidence || a.merchant.localeCompare(b.merchant);
}
