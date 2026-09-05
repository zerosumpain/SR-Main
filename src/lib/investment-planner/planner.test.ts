import { describe, expect, it } from 'vitest';
import { buildPortfolioPlan, parsePortfolioCsv, projectScenario } from '$lib/investment-planner/planner';

describe('parsePortfolioCsv', () => {
	it('imports quoted holdings while retaining invalid-row errors', () => {
		const result = parsePortfolioCsv('accountType,name,ticker,category,value\nisa,"Vanguard, All-World",VWRP,global-equity,"12,500"\npension,Bond fund,,bond,nope');
		expect(result.holdings).toEqual([{ accountType: 'isa', name: 'Vanguard, All-World', ticker: 'VWRP', category: 'global-equity', valueGbp: 12500 }]);
		expect(result.errors).toEqual([{ row: 3, message: 'Value must be a non-negative GBP amount.' }]);
	});
});

describe('buildPortfolioPlan', () => {
	it('checks allowances, emergency reserve, VWRP concentration, and allocations', () => {
		const plan = buildPortfolioPlan({
			holdings: [
				{ accountType: 'isa', name: 'Vanguard FTSE All-World UCITS ETF', ticker: 'VWRP', category: 'global-equity', valueGbp: 18000 },
				{ accountType: 'pension', name: 'Bond fund', category: 'bond', valueGbp: 2000 }
			],
			allowances: { taxYear: '2025/26', isaAnnualLimitGbp: 20000, isaContributedGbp: 21000, pensionAnnualAllowanceGbp: 60000, pensionContributedGbp: 12000 },
			household: { cashSavingsGbp: 4000, essentialMonthlySpendingGbp: 2000, highInterestDebtGbp: 500, emergencyFundTargetMonths: 6 },
			scenarios: [{ name: 'Flat', annualReturnPercent: 0, years: 1, monthlyContributionGbp: 100 }],
			vwrpMaximumPortfolioPercent: 60
		});
		expect(plan.totalPortfolioGbp).toBe(20000);
		expect(plan.allocation).toContainEqual({ category: 'global-equity', valueGbp: 18000, percent: 90 });
		expect(plan.allowances.isaExceededByGbp).toBe(1000);
		expect(plan.emergencyFund).toEqual({ targetGbp: 12000, shortfallGbp: 8000, monthsCovered: 2 });
		expect(plan.vwrp).toMatchObject({ valueGbp: 18000, portfolioPercent: 90, isAboveMaximum: true });
		expect(plan.projections[0].projectedValueGbp).toBe(21200);
		expect(plan.educationalPrompts.join(' ')).toContain('high-interest debt');
	});
});

describe('projectScenario', () => {
	it('compounds monthly at an annual-equivalent rate with end-month contributions', () => {
		const projection = projectScenario(1000, { name: 'Example', annualReturnPercent: 12, years: 1, monthlyContributionGbp: 0 });
		expect(projection.projectedValueGbp).toBe(1120);
	});
});
