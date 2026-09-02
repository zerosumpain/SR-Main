export interface SubscriptionTransaction {
	id: string;
	merchant: string;
	amount: number;
	currency: string;
	occurredAt: string;
}

export interface GmailInvoiceEvidence {
	id: string;
	merchant?: string;
	sender: string;
	subject: string;
	receivedAt: string;
}

export interface SubscriptionConsolidationInput {
	transactions: readonly SubscriptionTransaction[];
	invoices?: readonly GmailInvoiceEvidence[];
	now: string | Date;
	knownMerchantKeys?: readonly string[];
	newChargeWindowDays?: number;
}

export interface ConsolidatedSubscription {
	merchant: string;
	merchantKey: string;
	currency: string;
	transactions: readonly SubscriptionTransaction[];
	invoiceEvidence: readonly GmailInvoiceEvidence[];
	recurrenceIntervalDays: number | null;
	recurringConfidence: number;
	isRecurring: boolean;
	isNewCharge: boolean;
}

const DEFAULT_NEW_CHARGE_WINDOW_DAYS = 45;

export function normaliseMerchant(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/https?:\/\/|www\./g, ' ')
		.replace(/\b(?:paypal|pp\*|card|visa|mastercard|purchase|payment|online|recurring|subscription|ltd|limited|inc|llc|com|co|uk)\b/g, ' ')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.replace(/\s+/g, ' ');
}

export function consolidateSubscriptions(input: SubscriptionConsolidationInput): ConsolidatedSubscription[] {
	const now = toTimestamp(input.now);
	if (now === null) {
		throw new Error('now must be a valid date');
	}

	const windowDays = input.newChargeWindowDays ?? DEFAULT_NEW_CHARGE_WINDOW_DAYS;
	if (!Number.isFinite(windowDays) || windowDays < 1) {
		throw new Error('newChargeWindowDays must be at least 1');
	}

	const known = new Set((input.knownMerchantKeys ?? []).map(normaliseMerchant).filter(Boolean));
	const groups = new Map<string, SubscriptionTransaction[]>();

	for (const transaction of input.transactions) {
		const merchantKey = normaliseMerchant(transaction.merchant);
		if (!merchantKey || transaction.amount <= 0 || toTimestamp(transaction.occurredAt) === null) continue;
		const key = `${merchantKey}\u0000${transaction.currency.toUpperCase()}`;
		groups.set(key, [...(groups.get(key) ?? []), transaction]);
	}

	return [...groups.entries()]
		.map(([groupKey, transactions]) => {
			const [merchantKey, currency] = groupKey.split('\u0000');
			const ordered = [...transactions].sort((a, b) => toTimestamp(a.occurredAt)! - toTimestamp(b.occurredAt)!);
			const intervals = intervalsBetween(ordered);
			const recurrenceIntervalDays = intervals.length === 0 ? null : median(intervals);
			const invoiceEvidence = (input.invoices ?? []).filter((invoice) => invoiceMatchesMerchant(invoice, merchantKey));
			const recurringConfidence = confidence(ordered, intervals, invoiceEvidence.length);
			const cutoff = now - windowDays * 86_400_000;
			const hasRecentCharge = ordered.some((transaction) => toTimestamp(transaction.occurredAt)! >= cutoff);
			const hasOlderCharge = ordered.some((transaction) => toTimestamp(transaction.occurredAt)! < cutoff);

			return {
				merchant: ordered[0].merchant,
				merchantKey,
				currency,
				transactions: ordered,
				invoiceEvidence,
				recurrenceIntervalDays,
				recurringConfidence,
				isRecurring: recurringConfidence >= 0.65,
				isNewCharge: hasRecentCharge && !hasOlderCharge && !known.has(merchantKey)
			};
		})
		.sort((a, b) => b.recurringConfidence - a.recurringConfidence || a.merchant.localeCompare(b.merchant));
}

function invoiceMatchesMerchant(invoice: GmailInvoiceEvidence, merchantKey: string): boolean {
	const sources = [invoice.merchant, invoice.sender, invoice.subject]
		.filter((value): value is string => Boolean(value))
		.map(normaliseMerchant);
	return sources.some((source) => source === merchantKey || (merchantKey.length >= 4 && source.includes(merchantKey)));
}

function intervalsBetween(transactions: readonly SubscriptionTransaction[]): number[] {
	const intervals: number[] = [];
	for (let index = 1; index < transactions.length; index += 1) {
		const days = (toTimestamp(transactions[index].occurredAt)! - toTimestamp(transactions[index - 1].occurredAt)!) / 86_400_000;
		if (days >= 20 && days <= 400) intervals.push(days);
	}
	return intervals;
}

function confidence(transactions: readonly SubscriptionTransaction[], intervals: readonly number[], invoiceCount: number): number {
	if (transactions.length < 2 || intervals.length === 0) return invoiceCount > 0 ? 0.35 : 0;
	const intervalMedian = median(intervals);
	const intervalDeviation = median(intervals.map((interval) => Math.abs(interval - intervalMedian)));
	const regularity = Math.max(0, 1 - intervalDeviation / Math.max(intervalMedian, 1));
	const amounts = transactions.map((transaction) => transaction.amount);
	const amountMedian = median(amounts);
	const amountDeviation = median(amounts.map((amount) => Math.abs(amount - amountMedian)));
	const amountConsistency = Math.max(0, 1 - amountDeviation / Math.max(amountMedian, 1));
	const repeatScore = Math.min(1, intervals.length / 3);
	return Math.min(1, Number((0.45 * repeatScore + 0.3 * regularity + 0.15 * amountConsistency + 0.1 * Math.min(invoiceCount, 1)).toFixed(2)));
}

function median(values: readonly number[]): number {
	const ordered = [...values].sort((a, b) => a - b);
	const middle = Math.floor(ordered.length / 2);
	return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
}

function toTimestamp(value: string | Date): number | null {
	const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : null;
}
