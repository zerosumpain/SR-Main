import { describe, expect, it } from 'vitest';
import { buildRefinanceComparison, extractFinanceDocument } from '$lib/finance/document-extractor';

describe('extractFinanceDocument', () => {
	it('extracts explainable fields from a settlement statement', () => {
		const extraction = extractFinanceDocument({
			documentId: 'doc-1',
			fileName: 'settlement.pdf',
			text: 'Settlement Statement. Your settlement figure is £8,450.50. The remaining repayment period is 36 months. APR is 12.9%. Early repayment charge is £58. You may make overpayments at any time without penalty.'
		});
		expect(extraction.documentKind).toBe('settlement-statement');
		expect(extraction.balance?.value).toBe(8450.5);
		expect(extraction.termMonths?.value).toBe(36);
		expect(extraction.aprPercent?.value).toBe(12.9);
		expect(extraction.fees?.value).toBe(58);
		expect(extraction.overpaymentConditions?.value).toContain('overpayments');
		expect(extraction.balance?.snippet).toContain('£8,450.50');
	});
});

describe('buildRefinanceComparison', () => {
	it('calculates a comparison and retains bank and PayPal evidence', () => {
		const extraction = extractFinanceDocument({
			documentId: 'doc-2',
			fileName: 'agreement.txt',
			text: 'Loan Agreement. Outstanding balance: £10,000. Loan term: 24 months. APR: 10%. Overpayment is permitted.'
		});
		const comparison = buildRefinanceComparison(extraction, { aprPercent: 5, termMonths: 24, fees: 100 }, [
			{ source: 'bank', transactionId: 'bank-1', date: '2026-01-01', amount: 461.45, description: 'LOAN PAYMENT' },
			{ source: 'paypal', transactionId: 'pp-1', date: '2026-01-02', amount: 10, description: 'Loan protection' }
		]);
		expect(comparison.proposedMonthlyPayment).toBeLessThan(comparison.currentEstimatedMonthlyPayment!);
		expect(comparison.totalCostDifference).toBeLessThan(0);
		expect(comparison.evidence).toHaveLength(4);
		expect(comparison.warnings.some((warning) => warning.includes('Review the extracted overpayment'))).toBe(true);
	});
});
