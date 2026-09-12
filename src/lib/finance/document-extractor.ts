export type DocumentKind = 'settlement-statement' | 'loan-agreement' | 'unknown';

export interface FieldEvidence {
	value: number | string;
	snippet: string;
	confidence: 'high' | 'medium';
}

export interface FinanceDocumentExtraction {
	documentId: string;
	fileName: string;
	documentKind: DocumentKind;
	balance?: FieldEvidence;
	termMonths?: FieldEvidence;
	aprPercent?: FieldEvidence;
	fees?: FieldEvidence;
	overpaymentConditions?: FieldEvidence;
	warnings: string[];
}

export interface FinanceDocumentInput {
	documentId: string;
	fileName: string;
	text: string;
}

export interface PaymentEvidence {
	source: 'bank' | 'paypal';
	transactionId: string;
	date: string;
	amount: number;
	description: string;
}

export interface RefinanceOffer {
	aprPercent: number;
	termMonths: number;
	fees: number;
}

export interface RefinanceComparison {
	currentBalance: number;
	currentAprPercent?: number;
	remainingTermMonths: number;
	proposedOffer: RefinanceOffer;
	currentEstimatedMonthlyPayment?: number;
	proposedMonthlyPayment: number;
	currentEstimatedRemainingCost?: number;
	proposedTotalCost: number;
	monthlyPaymentDifference?: number;
	totalCostDifference?: number;
	evidence: Array<{ label: string; source: string; snippet: string }>;
	warnings: string[];
}

const compact = (value: string): string => value.replace(/\s+/g, ' ').trim();

function money(value: string): number | undefined {
	const parsed = Number(value.replace(/,/g, ''));
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function nearby(text: string, index: number): string {
	const start = Math.max(0, text.lastIndexOf('.', index) + 1);
	const endAt = text.indexOf('.', index);
	return compact(text.slice(start, endAt === -1 ? Math.min(text.length, index + 180) : endAt + 1));
}

function findMoneyField(text: string, patterns: RegExp[]): FieldEvidence | undefined {
	for (const pattern of patterns) {
		const match = pattern.exec(text);
		if (match?.[1]) {
			const value = money(match[1]);
			if (value !== undefined) return { value, snippet: nearby(text, match.index), confidence: 'high' };
		}
	}
	return undefined;
}

function findApr(text: string): FieldEvidence | undefined {
	const match = /(?:representative\s+)?APR\s*(?:of|:|is)?\s*(\d+(?:\.\d+)?)\s*%/i.exec(text);
	if (!match) return undefined;
	return { value: Number(match[1]), snippet: nearby(text, match.index), confidence: 'high' };
}

function findTerm(text: string): FieldEvidence | undefined {
	const months = /(?:loan\s+)?term|duration|repayment\s+period\s*(?:of|:|is)?\s*(\d{1,3})\s*months?/i.exec(text);
	if (months) return { value: Number(months[1]), snippet: nearby(text, months.index), confidence: 'high' };
	const years = /(?:loan\s+)?term|duration|repayment\s+period\s*(?:of|:|is)?\s*(\d{1,2})\s*years?/i.exec(text);
	if (years) return { value: Number(years[1]) * 12, snippet: nearby(text, years.index), confidence: 'high' };
	return undefined;
}

function findOverpayment(text: string): FieldEvidence | undefined {
	const match = /[^.]{0,120}\b(?:overpayment|early repayment|settlement charge|prepayment)[^.]{0,180}\.?/i.exec(text);
	return match ? { value: compact(match[0]), snippet: compact(match[0]), confidence: 'medium' } : undefined;
}

export function extractFinanceDocument(input: FinanceDocumentInput): FinanceDocumentExtraction {
	const text = compact(input.text);
	const lower = text.toLowerCase();
	const documentKind: DocumentKind = /settlement figure|settlement statement|amount to settle/.test(lower)
		? 'settlement-statement'
		: /loan agreement|credit agreement|fixed-sum loan/.test(lower)
			? 'loan-agreement'
			: 'unknown';
	const balance = findMoneyField(text, [
		/(?:settlement figure|amount to settle|outstanding balance|balance remaining|remaining balance)\s*(?:is|:|of)?\s*£\s*([\d,]+(?:\.\d{1,2})?)/i
	]);
	const fees = findMoneyField(text, [
		/(?:settlement fee|early repayment charge|exit fee|arrangement fee|administration fee)\s*(?:is|:|of)?\s*£\s*([\d,]+(?:\.\d{1,2})?)/i
	]);
	const result: FinanceDocumentExtraction = {
		documentId: input.documentId,
		fileName: input.fileName,
		documentKind,
		balance,
		termMonths: findTerm(text),
		aprPercent: findApr(text),
		fees,
		overpaymentConditions: findOverpayment(text),
		warnings: []
	};
	if (!balance) result.warnings.push('No current settlement or outstanding balance was found.');
	if (!result.termMonths) result.warnings.push('No loan term or remaining repayment period was found.');
	if (!result.aprPercent) result.warnings.push('No APR was found.');
	if (!result.overpaymentConditions) result.warnings.push('No overpayment or early-repayment condition was found.');
	return result;
}

function monthlyPayment(principal: number, aprPercent: number, months: number): number {
	const rate = aprPercent / 100 / 12;
	if (rate === 0) return principal / months;
	return (principal * rate) / (1 - Math.pow(1 + rate, -months));
}

function validPositive(value: number): boolean {
	return Number.isFinite(value) && value > 0;
}

export function buildRefinanceComparison(
	extraction: FinanceDocumentExtraction,
	offer: RefinanceOffer,
	payments: PaymentEvidence[] = []
): RefinanceComparison {
	const balance = extraction.balance?.value;
	const term = extraction.termMonths?.value;
	if (typeof balance !== 'number' || !validPositive(balance)) throw new Error('A positive extracted balance is required.');
	if (typeof term !== 'number' || !Number.isInteger(term) || term < 1) throw new Error('A positive whole-number remaining term is required.');
	if (!validPositive(offer.termMonths) || !Number.isInteger(offer.termMonths)) throw new Error('Offer term must be a positive whole number of months.');
	if (offer.aprPercent < 0 || offer.fees < 0 || !Number.isFinite(offer.aprPercent) || !Number.isFinite(offer.fees)) throw new Error('Offer APR and fees must be non-negative finite numbers.');

	const proposedPrincipal = balance + offer.fees;
	const proposedMonthlyPayment = monthlyPayment(proposedPrincipal, offer.aprPercent, offer.termMonths);
	const currentApr = extraction.aprPercent?.value;
	const currentEstimatedMonthlyPayment = typeof currentApr === 'number' ? monthlyPayment(balance, currentApr, term) : undefined;
	const currentEstimatedRemainingCost = currentEstimatedMonthlyPayment ? currentEstimatedMonthlyPayment * term : undefined;
	const proposedTotalCost = proposedMonthlyPayment * offer.termMonths;
	const warnings = [...extraction.warnings];
	if (extraction.overpaymentConditions) warnings.push('Review the extracted overpayment condition before settling: ' + extraction.overpaymentConditions.value);
	if (payments.length === 0) warnings.push('No bank or PayPal payment evidence was supplied.');
	return {
		currentBalance: balance,
		currentAprPercent: typeof currentApr === 'number' ? currentApr : undefined,
		remainingTermMonths: term,
		proposedOffer: offer,
		currentEstimatedMonthlyPayment,
		proposedMonthlyPayment,
		currentEstimatedRemainingCost,
		proposedTotalCost,
		monthlyPaymentDifference: currentEstimatedMonthlyPayment ? proposedMonthlyPayment - currentEstimatedMonthlyPayment : undefined,
		totalCostDifference: currentEstimatedRemainingCost ? proposedTotalCost - currentEstimatedRemainingCost : undefined,
		evidence: [
		...(extraction.balance ? [{ label: 'Current balance', source: extraction.fileName, snippet: extraction.balance.snippet }] : []),
		...(extraction.aprPercent ? [{ label: 'Current APR', source: extraction.fileName, snippet: extraction.aprPercent.snippet }] : []),
		...payments.map((payment) => ({ label: 'Payment evidence', source: payment.source + ':' + payment.transactionId, snippet: payment.date + ' £' + payment.amount.toFixed(2) + ' ' + payment.description }))
		],
		warnings
	};
}
