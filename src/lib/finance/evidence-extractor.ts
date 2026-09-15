export type EvidenceSource = 'gmail' | 'drive';

export interface AuthorisedFinancialDocument {
	id: string;
	source: EvidenceSource;
	name: string;
	text: string;
	ownerAuthorised: boolean;
	capturedAt: string;
}

export interface TrueLayerTransaction {
	id: string;
	merchantName?: string | null;
	description?: string | null;
	amount: number;
	currency: string;
	bookedAt: string;
}

export interface EvidenceReference {
	documentId: string;
	source: EvidenceSource;
	documentName: string;
	capturedAt: string;
	excerpt: string;
}

export interface ExtractedLoan {
	kind: 'loan';
	lender: string;
	balance?: number;
	monthlyPayment?: number;
	paymentDate?: string;
	apr?: number;
	remainingMonths?: number;
	source: EvidenceReference;
}

export interface ExtractedRecurringSpend {
	kind: 'recurring-spend';
	merchant: string;
	amount: number;
	cadence: 'weekly' | 'monthly' | 'quarterly' | 'annual' | 'unknown';
	nextPaymentDate?: string;
	source: EvidenceReference;
}

export interface ExtractionResult {
	loans: ExtractedLoan[];
	recurringSpend: ExtractedRecurringSpend[];
}

export interface ReconciledLoan extends ExtractedLoan {
	matchedTransactions: TrueLayerTransaction[];
	verification: 'verified' | 'document-attested' | 'unverified';
	verificationReason: string;
}

export interface RefinanceOffer {
	apr: number;
	termMonths: number;
	fee?: number;
}

export interface RefinancingComparison {
	currentMonthlyPayment: number;
	refinanceMonthlyPayment: number;
	currentRemainingCost: number;
	refinanceTotalCost: number;
	totalSaving: number;
	breakEvenMonths: number | null;
}

const moneyPattern = /(?:£|GBP\s?)([\d,]+(?:\.\d{1,2})?)/i;
const numberPattern = /([\d,]+(?:\.\d{1,2})?)/;

function amountFrom(match: RegExpMatchArray | null, group = 1): number | undefined {
	if (!match?.[group]) return undefined;
	const amount = Number(match[group].replace(/,/g, ''));
	return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
}

function excerptFor(text: string, index: number): string {
	return text.slice(Math.max(0, index - 80), Math.min(text.length, index + 180)).replace(/\s+/g, ' ').trim();
}

function sourceFor(document: AuthorisedFinancialDocument, text: string, index: number): EvidenceReference {
	return {
		documentId: document.id,
		source: document.source,
		documentName: document.name,
		capturedAt: document.capturedAt,
		excerpt: excerptFor(text, index)
	};
}

function lenderFrom(document: AuthorisedFinancialDocument, text: string): string {
	const labelled = text.match(/(?:lender|creditor|provider)\s*[:\-]\s*([^\n,]{2,80})/i)?.[1]?.trim();
	if (labelled) return labelled;
	return document.name.replace(/\.[a-z0-9]+$/i, '').trim() || 'Unknown lender';
}

function dateValue(value: string): string | undefined {
	const parsed = new Date(value);
	return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString().slice(0, 10);
}

function firstMatch(text: string, patterns: RegExp[]): { match: RegExpMatchArray; index: number } | undefined {
	for (const pattern of patterns) {
		const match = text.match(pattern);
		if (match) return { match, index: match.index ?? 0 };
	}
	return undefined;
}

/** Extracts facts only from text that the caller has marked as owner-authorised. */
export function extractFinancialEvidence(document: AuthorisedFinancialDocument): ExtractionResult {
	if (!document.ownerAuthorised) {
		throw new Error('Financial evidence extraction requires owner-authorised document access.');
	}

	const text = document.text;
	const balance = firstMatch(text, [
		/(?:outstanding|remaining|current)\s+(?:loan\s+)?balance\s*[:\-]?\s*(?:£|GBP\s?)([\d,]+(?:\.\d{1,2})?)/i,
		/balance\s*[:\-]?\s*(?:£|GBP\s?)([\d,]+(?:\.\d{1,2})?)/i
	]);
	const payment = firstMatch(text, [
		/(?:monthly\s+)?(?:repayment|payment|instalment)\s*[:\-]?\s*(?:£|GBP\s?)([\d,]+(?:\.\d{1,2})?)/i
	]);
	const apr = firstMatch(text, [/(?:representative\s+)?APR\s*[:\-]?\s*([\d.]+)\s*%/i]);
	const term = firstMatch(text, [
		/(?:remaining\s+term|term\s+remaining)\s*[:\-]?\s*(\d+)\s*months?/i,
		/(\d+)\s*months?\s+remaining/i
	]);
	const paymentDay = firstMatch(text, [/(?:payment|collection)\s+(?:date|day)\s*[:\-]?\s*(\d{1,2})(?:st|nd|rd|th)?\b/i]);
	const nextDate = firstMatch(text, [/(?:next\s+payment|payment\s+due)\s*(?:date)?\s*[:\-]?\s*([A-Z][a-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i]);

	const loans: ExtractedLoan[] = [];
	if (balance || payment || apr || term) {
		const anchor = balance ?? payment ?? apr ?? term!;
		const day = paymentDay ? Number(paymentDay.match[1]) : undefined;
		loans.push({
			kind: 'loan',
			lender: lenderFrom(document, text),
			balance: balance ? amountFrom(balance.match) : undefined,
			monthlyPayment: payment ? amountFrom(payment.match) : undefined,
			paymentDate: nextDate ? dateValue(nextDate.match[1]) : day && day <= 31 ? `day-of-month:${day}` : undefined,
			apr: apr ? Number(apr.match[1]) : undefined,
			remainingMonths: term ? Number(term.match[1]) : undefined,
			source: sourceFor(document, text, anchor.index)
		});
	}

	const recurring: ExtractedRecurringSpend[] = [];
	const recurringMatch = firstMatch(text, [
		/(?:subscription|membership|recurring\s+(?:payment|charge))\s*(?:for)?\s*[:\-]?\s*([^\n£]{2,80}?)\s+(?:of\s+)?(?:£|GBP\s?)([\d,]+(?:\.\d{1,2})?)(?:\s*(?:per|\/|every)\s*(week|month|quarter|year))?/i
	]);
	if (recurringMatch) {
		const unit = recurringMatch.match[3]?.toLowerCase();
		recurring.push({
			kind: 'recurring-spend',
			merchant: recurringMatch.match[1].trim().replace(/[,:-]+$/, ''),
			amount: amountFrom(recurringMatch.match, 2) ?? 0,
			cadence: unit === 'week' ? 'weekly' : unit === 'month' ? 'monthly' : unit === 'quarter' ? 'quarterly' : unit === 'year' ? 'annual' : 'unknown',
			nextPaymentDate: nextDate ? dateValue(nextDate.match[1]) : undefined,
			source: sourceFor(document, text, recurringMatch.index)
		});
	}

	return { loans, recurringSpend: recurring };
}

function normalise(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function daysBetween(left: string, right: string): number {
	return Math.abs(new Date(left).valueOf() - new Date(right).valueOf()) / 86_400_000;
}

/** Corroborates a documented monthly repayment with matching TrueLayer debits. */
export function reconcileLoans(loans: ExtractedLoan[], transactions: TrueLayerTransaction[]): ReconciledLoan[] {
	return loans.map((loan) => {
		const lender = normalise(loan.lender);
		const matches = loan.monthlyPayment === undefined ? [] : transactions.filter((transaction) => {
			const label = normalise(`${transaction.merchantName ?? ''} ${transaction.description ?? ''}`);
			const amountMatches = Math.abs(Math.abs(transaction.amount) - loan.monthlyPayment!) <= 0.01;
			const lenderMatches = lender.length >= 3 && (label.includes(lender) || lender.includes(label));
			const dateMatches = loan.paymentDate?.startsWith('day-of-month:')
				? Math.abs(new Date(transaction.bookedAt).getUTCDate() - Number(loan.paymentDate.slice(13))) <= 3
				: loan.paymentDate ? daysBetween(transaction.bookedAt, loan.paymentDate) <= 45 : true;
			return transaction.amount < 0 && amountMatches && lenderMatches && dateMatches;
		});
		const hasCoreTerms = loan.balance !== undefined && loan.apr !== undefined && loan.remainingMonths !== undefined;
		return {
			...loan,
			matchedTransactions: matches,
			verification: matches.length > 0 && hasCoreTerms ? 'verified' : loan.balance !== undefined || loan.monthlyPayment !== undefined ? 'document-attested' : 'unverified',
			verificationReason: matches.length > 0 && hasCoreTerms
				? 'Documented balance, APR and remaining term are corroborated by a matching TrueLayer repayment.'
				: matches.length > 0 ? 'A TrueLayer repayment matches, but one or more core loan terms are absent.'
				: 'No matching TrueLayer repayment was found; values remain document-attested only.'
		};
	});
}

function monthlyPayment(principal: number, annualApr: number, months: number): number {
	const monthlyRate = annualApr / 100 / 12;
	if (monthlyRate === 0) return principal / months;
	return principal * monthlyRate / (1 - Math.pow(1 + monthlyRate, -months));
}

/** Compares refinancing using a loan that has been independently transaction-corroborated. */
export function compareRefinancing(loan: ReconciledLoan, offer: RefinanceOffer): RefinancingComparison {
	if (loan.verification !== 'verified') throw new Error('Only verified loans can be used for refinancing comparisons.');
	if (!loan.balance || !loan.apr || !loan.remainingMonths || offer.apr < 0 || offer.termMonths <= 0) throw new Error('Complete positive loan and offer terms are required.');
	const currentMonthlyPayment = loan.monthlyPayment ?? monthlyPayment(loan.balance, loan.apr, loan.remainingMonths);
	const refinanceMonthlyPayment = monthlyPayment(loan.balance, offer.apr, offer.termMonths);
	const currentRemainingCost = currentMonthlyPayment * loan.remainingMonths;
	const refinanceTotalCost = refinanceMonthlyPayment * offer.termMonths + (offer.fee ?? 0);
	const monthlySaving = currentMonthlyPayment - refinanceMonthlyPayment;
	return {
		currentMonthlyPayment,
		refinanceMonthlyPayment,
		currentRemainingCost,
		refinanceTotalCost,
		totalSaving: currentRemainingCost - refinanceTotalCost,
		breakEvenMonths: monthlySaving > 0 && (offer.fee ?? 0) > 0 ? (offer.fee ?? 0) / monthlySaving : monthlySaving > 0 ? 0 : null
	};
}
