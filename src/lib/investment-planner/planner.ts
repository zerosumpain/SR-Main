export type AccountType = 'isa' | 'pension' | 'gia' | 'cash' | 'other';
export type AssetCategory =
	| 'cash'
	| 'global-equity'
	| 'uk-equity'
	| 'us-equity'
	| 'emerging-equity'
	| 'bond'
	| 'property'
	| 'commodity'
	| 'other';

export interface Holding {
	accountType: AccountType;
	name: string;
	ticker?: string;
	category: AssetCategory;
	valueGbp: number;
}

export interface CsvImportResult {
	holdings: Holding[];
	errors: Array<{ row: number; message: string }>;
}

export interface Allowances {
	taxYear: string;
	isaAnnualLimitGbp: number;
	isaContributedGbp: number;
	pensionAnnualAllowanceGbp: number;
	pensionContributedGbp: number;
}

export interface HouseholdPosition {
	cashSavingsGbp: number;
	essentialMonthlySpendingGbp: number;
	highInterestDebtGbp: number;
	emergencyFundTargetMonths: number;
}

export interface ProjectionScenario {
	name: string;
	annualReturnPercent: number;
	years: number;
	monthlyContributionGbp: number;
}

export interface PlannerInput {
	holdings: Holding[];
	allowances: Allowances;
	household: HouseholdPosition;
	scenarios: ProjectionScenario[];
	vwrpMaximumPortfolioPercent?: number;
}

export interface AllocationSlice {
	category: AssetCategory;
	valueGbp: number;
	percent: number;
}

export interface ProjectionResult {
	name: string;
	startingValueGbp: number;
	contributionsGbp: number;
	projectedValueGbp: number;
	annualReturnPercent: number;
	years: number;
}

export interface PortfolioPlan {
	disclaimer: string;
	totalPortfolioGbp: number;
	allocation: AllocationSlice[];
	allowances: {
		taxYear: string;
		isaRemainingGbp: number;
		pensionRemainingGbp: number;
		isaExceededByGbp: number;
		pensionExceededByGbp: number;
	};
	emergencyFund: {
		targetGbp: number;
		shortfallGbp: number;
		monthsCovered: number | null;
	};
	vwrp: {
		valueGbp: number;
		portfolioPercent: number;
		maximumPortfolioPercent: number;
		isAboveMaximum: boolean;
	};
	projections: ProjectionResult[];
	educationalPrompts: string[];
}

export const EDUCATIONAL_DISCLAIMER =
	'Educational planning information only, not regulated financial, tax, or investment advice. Investment values can fall as well as rise; verify current HMRC rules and consider a regulated financial adviser for personal recommendations.';

const accountTypes = new Set<AccountType>(['isa', 'pension', 'gia', 'cash', 'other']);
const categories = new Set<AssetCategory>([
	'cash',
	'global-equity',
	'uk-equity',
	'us-equity',
	'emerging-equity',
	'bond',
	'property',
	'commodity',
	'other'
]);

function normaliseHeader(value: string): string {
	return value.trim().toLowerCase().replace(/[ _-]/g, '');
}

function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;

	for (let index = 0; index < text.length; index += 1) {
		const character = text[index];
		if (character === '"') {
			if (quoted && text[index + 1] === '"') {
				field += '"';
				index += 1;
			} else {
				quoted = !quoted;
			}
		} else if (character === ',' && !quoted) {
			row.push(field.trim());
			field = '';
		} else if ((character === '\n' || character === '\r') && !quoted) {
			if (character === '\r' && text[index + 1] === '\n') index += 1;
			row.push(field.trim());
			if (row.some((cell) => cell.length > 0)) rows.push(row);
			row = [];
			field = '';
		} else {
			field += character;
		}
	}
	if (quoted) throw new Error('CSV contains an unclosed quoted field.');
	row.push(field.trim());
	if (row.some((cell) => cell.length > 0)) rows.push(row);
	return rows;
}

function asMoney(value: string): number | null {
	const parsed = Number(value.replace(/[£,]/g, '').trim());
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Parses a client-supplied CSV without uploading it anywhere. */
export function parsePortfolioCsv(csv: string): CsvImportResult {
	const rows = parseCsv(csv);
	if (rows.length === 0) return { holdings: [], errors: [] };

	const header = rows[0].map(normaliseHeader);
	const column = (names: string[]) => header.findIndex((item) => names.includes(item));
	const account = column(['account', 'accountname']);
	const accountType = column(['accounttype', 'wrapper', 'type']);
	const name = column(['name', 'holding', 'fund', 'security']);
	const ticker = column(['ticker', 'symbol', 'sedol', 'isin']);
	const category = column(['category', 'assetcategory', 'assetclass']);
	const value = column(['value', 'valuegbp', 'marketvalue', 'balance']);

	if (name < 0 || category < 0 || value < 0) {
		throw new Error('CSV must include name, category, and value columns.');
	}

	const holdings: Holding[] = [];
	const errors: CsvImportResult['errors'] = [];
	for (let index = 1; index < rows.length; index += 1) {
		const cells = rows[index];
		const rawCategory = (cells[category] ?? '').trim().toLowerCase() as AssetCategory;
		const rawAccountType = (cells[accountType] ?? cells[account] ?? 'other').trim().toLowerCase() as AccountType;
		const valueGbp = asMoney(cells[value] ?? '');
		if (!cells[name]?.trim()) errors.push({ row: index + 1, message: 'Holding name is required.' });
		else if (!categories.has(rawCategory)) errors.push({ row: index + 1, message: `Unknown category: ${rawCategory || '(blank)'}.` });
		else if (!accountTypes.has(rawAccountType)) errors.push({ row: index + 1, message: `Unknown account type: ${rawAccountType || '(blank)'}.` });
		else if (valueGbp === null) errors.push({ row: index + 1, message: 'Value must be a non-negative GBP amount.' });
		else holdings.push({ accountType: rawAccountType, name: cells[name].trim(), ticker: cells[ticker]?.trim() || undefined, category: rawCategory, valueGbp });
	}
	return { holdings, errors };
}

function nonNegative(name: string, value: number): void {
	if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative finite number.`);
}

function roundMoney(value: number): number {
	return Math.round(value * 100) / 100;
}

function isVwrp(holding: Holding): boolean {
	return holding.ticker?.toUpperCase() === 'VWRP' || /vanguard ftse all-world ucits etf/i.test(holding.name);
}

export function projectScenario(startingValueGbp: number, scenario: ProjectionScenario): ProjectionResult {
	nonNegative('startingValueGbp', startingValueGbp);
	nonNegative('monthlyContributionGbp', scenario.monthlyContributionGbp);
	if (!Number.isInteger(scenario.years) || scenario.years < 1) throw new Error('Scenario years must be a positive integer.');
	if (!Number.isFinite(scenario.annualReturnPercent) || scenario.annualReturnPercent <= -100) {
		throw new Error('Scenario annualReturnPercent must be greater than -100.');
	}
	const months = scenario.years * 12;
	const monthlyRate = Math.pow(1 + scenario.annualReturnPercent / 100, 1 / 12) - 1;
	let projectedValueGbp = startingValueGbp;
	for (let month = 0; month < months; month += 1) {
		projectedValueGbp = projectedValueGbp * (1 + monthlyRate) + scenario.monthlyContributionGbp;
	}
	return {
		name: scenario.name,
		startingValueGbp: roundMoney(startingValueGbp),
		contributionsGbp: roundMoney(scenario.monthlyContributionGbp * months),
		projectedValueGbp: roundMoney(projectedValueGbp),
		annualReturnPercent: scenario.annualReturnPercent,
		years: scenario.years
	};
}

export function buildPortfolioPlan(input: PlannerInput): PortfolioPlan {
	const { allowances, household } = input;
	for (const [name, value] of Object.entries({ ...allowances, ...household })) {
		if (name !== 'taxYear' && typeof value === 'number') nonNegative(name, value);
	}
	for (const holding of input.holdings) {
		nonNegative(`holding ${holding.name} value`, holding.valueGbp);
		if (!categories.has(holding.category)) throw new Error(`Unknown holding category: ${holding.category}.`);
	}

	const totalPortfolioGbp = input.holdings.reduce((sum, holding) => sum + holding.valueGbp, 0);
	const allocation = [...categories].map((category) => {
		const valueGbp = input.holdings.filter((holding) => holding.category === category).reduce((sum, holding) => sum + holding.valueGbp, 0);
		return { category, valueGbp: roundMoney(valueGbp), percent: totalPortfolioGbp === 0 ? 0 : roundMoney((valueGbp / totalPortfolioGbp) * 100) };
	}).filter((slice) => slice.valueGbp > 0);
	const targetGbp = household.essentialMonthlySpendingGbp * household.emergencyFundTargetMonths;
	const shortfallGbp = Math.max(0, targetGbp - household.cashSavingsGbp);
	const vwrpValueGbp = input.holdings.filter(isVwrp).reduce((sum, holding) => sum + holding.valueGbp, 0);
	const vwrpPercent = totalPortfolioGbp === 0 ? 0 : (vwrpValueGbp / totalPortfolioGbp) * 100;
	const maximumPortfolioPercent = input.vwrpMaximumPortfolioPercent ?? 60;
	if (!Number.isFinite(maximumPortfolioPercent) || maximumPortfolioPercent < 0 || maximumPortfolioPercent > 100) throw new Error('vwrpMaximumPortfolioPercent must be between 0 and 100.');

	const prompts: string[] = [];
	if (household.highInterestDebtGbp > 0) prompts.push('Educational priority: compare the cost of high-interest debt with investing, and consider a debt-management professional where appropriate.');
	if (shortfallGbp > 0) prompts.push(`Educational priority: the stated emergency reserve is £${roundMoney(shortfallGbp).toLocaleString('en-GB')} below its target before new investment risk is considered.`);
	if (vwrpPercent > maximumPortfolioPercent) prompts.push(`VWRP represents ${roundMoney(vwrpPercent)}% of the portfolio, above the selected ${maximumPortfolioPercent}% concentration check; review diversification, overlap, and risk tolerance.`);
	if (allowances.isaContributedGbp > allowances.isaAnnualLimitGbp) prompts.push('ISA contributions exceed the entered annual limit; verify subscriptions, transfers, and the applicable tax-year rules.');
	if (allowances.pensionContributedGbp > allowances.pensionAnnualAllowanceGbp) prompts.push('Pension contributions exceed the entered allowance; annual allowance, tapering, carry-forward, and tax-relief rules are personal and should be verified.');
	if (prompts.length === 0) prompts.push('Use the allocation and scenarios to ask informed questions; they do not determine a suitable investment for you.');

	return {
		disclaimer: EDUCATIONAL_DISCLAIMER,
		totalPortfolioGbp: roundMoney(totalPortfolioGbp),
		allocation,
		allowances: {
			taxYear: allowances.taxYear,
			isaRemainingGbp: roundMoney(Math.max(0, allowances.isaAnnualLimitGbp - allowances.isaContributedGbp)),
			pensionRemainingGbp: roundMoney(Math.max(0, allowances.pensionAnnualAllowanceGbp - allowances.pensionContributedGbp)),
			isaExceededByGbp: roundMoney(Math.max(0, allowances.isaContributedGbp - allowances.isaAnnualLimitGbp)),
			pensionExceededByGbp: roundMoney(Math.max(0, allowances.pensionContributedGbp - allowances.pensionAnnualAllowanceGbp))
		},
		emergencyFund: { targetGbp: roundMoney(targetGbp), shortfallGbp: roundMoney(shortfallGbp), monthsCovered: household.essentialMonthlySpendingGbp === 0 ? null : roundMoney(household.cashSavingsGbp / household.essentialMonthlySpendingGbp) },
		vwrp: { valueGbp: roundMoney(vwrpValueGbp), portfolioPercent: roundMoney(vwrpPercent), maximumPortfolioPercent, isAboveMaximum: vwrpPercent > maximumPortfolioPercent },
		projections: input.scenarios.map((scenario) => projectScenario(totalPortfolioGbp, scenario)),
		educationalPrompts: prompts
	};
}
