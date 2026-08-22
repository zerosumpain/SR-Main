import { bigint, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

export const merchantAliases = pgTable(
	'merchant_aliases',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		canonicalMerchant: text('canonical_merchant').notNull(),
		normalizedAlias: text('normalized_alias').notNull(),
		firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
		occurrenceCount: integer('occurrence_count').default(1).notNull()
	},
	(table) => [
		uniqueIndex('merchant_aliases_normalized_alias_unique').on(table.normalizedAlias),
		index('merchant_aliases_canonical_merchant_index').on(table.canonicalMerchant)
	]
);

export const recurringPaymentFingerprints = pgTable(
	'recurring_payment_fingerprints',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		fingerprint: text('fingerprint').notNull(),
		canonicalMerchant: text('canonical_merchant').notNull(),
		currency: varchar('currency', { length: 3 }).notNull(),
		amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
		firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
		occurrenceCount: integer('occurrence_count').default(1).notNull(),
		cadenceDays: integer('cadence_days')
	},
	(table) => [
		uniqueIndex('recurring_payment_fingerprints_fingerprint_unique').on(table.fingerprint),
		index('recurring_payment_fingerprints_merchant_index').on(table.canonicalMerchant)
	]
);

export type MerchantIdentity = {
	canonicalMerchant: string;
	normalizedAlias: string;
};

export type RecurringPaymentFingerprintInput = {
	canonicalMerchant: string;
	currency: string;
	amountMinor: number;
};

const processorPrefixes = /^(?:(?:PAYPAL|PP|SQUARE|SQ|SUMUP|IZETTLE)\s*\*?\s*|(?:CARD\s+PAYMENT|DIRECT\s+DEBIT|POS|PURCHASE)\s+(?:TO\s+)?)/;
const companySuffixes = /\s+(?:INCORPORATED|INC|LIMITED|LTD|LLC|PLC|CORPORATION|CORP|COMPANY|CO)$/;
const webSuffixes = /\s+(?:COM|CO\s+UK|NET|ORG|IO|UK)$/;
const trailingReference = /\s+(?:[A-Z]*\d[A-Z\d-]*|\d{4,})$/;

/**
 * Produces a source-neutral merchant key. It intentionally removes common
 * payment-processor prefixes, legal suffixes, web suffixes, and trailing
 * transaction references while preserving the meaningful merchant name.
 */
export function normalizeMerchantAlias(value: string): string {
	let normalized = value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toUpperCase()
		.replace(/&/g, ' AND ')
		.replace(/[^A-Z0-9]+/g, ' ')
		.trim();

	while (processorPrefixes.test(normalized)) {
		normalized = normalized.replace(processorPrefixes, '').trim();
	}

	let previous: string;
	do {
		previous = normalized;
		normalized = normalized
			.replace(trailingReference, '')
			.replace(webSuffixes, '')
			.replace(companySuffixes, '')
			.trim();
	} while (normalized !== previous);

	if (!normalized) {
		throw new Error('Merchant name must contain at least one letter or number.');
	}

	return normalized;
}

export function resolveMerchantIdentity(rawMerchant: string): MerchantIdentity {
	const normalizedAlias = normalizeMerchantAlias(rawMerchant);
	return {
		canonicalMerchant: normalizedAlias,
		normalizedAlias
	};
}

/**
 * Creates a stable, source-neutral fingerprint for a repeated charge.
 * amountMinor must be an integer expressed in the currency's minor units.
 */
export function buildRecurringPaymentFingerprint(
	input: RecurringPaymentFingerprintInput
): string {
	const canonicalMerchant = normalizeMerchantAlias(input.canonicalMerchant);
	const currency = input.currency.trim().toUpperCase();

	if (!/^[A-Z]{3}$/.test(currency)) {
		throw new Error('Currency must be a three-letter ISO 4217 code.');
	}
	if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0) {
		throw new Error('amountMinor must be a non-negative safe integer.');
	}

	return `v1:${canonicalMerchant}:${currency}:${input.amountMinor}`;
}
