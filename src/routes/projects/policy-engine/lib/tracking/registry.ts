// tracking/registry.ts — the catalogue of model indicators that have a live data
// counterpart, with VERIFIED DfE EES / ONS / World Bank fetch recipes (probed June 2026).
//
// Each EES recipe pins every filter column on its data-set (the API returns multiple rows
// otherwise) and reads results[0].values[indicatorId]. GUIDs + opaque option ids were all
// confirmed against the live API. geographicLevels is always NAT (added by the query builder).
//
// Honesty is encoded, not hidden: indicators with no machine-readable source are listed with
// feasibility 'manual'/'csv-bulk' and a caveat, and appear in the UI as "projection only, no
// live source yet" rather than being silently dropped.

import type { IndicatorSpec } from './types';

const AY_24_25 = { code: 'AY' as const, period: '2024/2025' };
const AY_25_26 = { code: 'AY' as const, period: '2025/2026' };
const CY_2024 = { code: 'CY' as const, period: '2024' };

// ---- KS4 performance: National characteristics summary data ----
const KS4_GUID = '19e39901-560d-f972-b6f3-dd085539c095';
const KS4_SLUG = 'key-stage-4-performance';
const KS4_A8 = 'H21zL'; // Average Attainment 8 score
const KS4_G5 = 'fLjYF'; // % grade 5+ in English & maths
// filter columns: eWguS (characteristic group) + OYzCL (characteristic)
const KS4_TOTAL = { eWguS: 'pmYIS', OYzCL: 'oQRmX' };
const KS4_DIS = { eWguS: 'NgxhD', OYzCL: 'HWKzL' };
const KS4_EHCP = { eWguS: 'OJt6C', OYzCL: 'YL1HK' };

// ---- KS2 attainment by pupil characteristics (9 filters, all pinned) ----
const KS2_GUID = 'c62e9901-58a5-ba76-aa0d-5ee4ef269776';
const KS2_SLUG = 'key-stage-2-attainment';
const KS2_RWM = 'Bzo7J'; // % meeting expected standard, reading writing & maths
const KS2_BASE = {
  RaVka: 'Az8GK', bjstT: '1jki3', Dt8Qe: 'EYgqF', e9vuS: '0yZT5',
  '0unT5': 'rO8Nj', '5PHdi': 'a1GLP', '4h0UZ': 'mcX9K', mRd9K: '1Ahi3', // 1Ahi3 = RWM combined
};
const KS2_TOTAL = { ...KS2_BASE, y2daB: 'TyAPJ' };
const KS2_DIS = { ...KS2_BASE, y2daB: 'jHaAM' };

// ---- EYFSP: headline measures by child characteristics (3 filters) ----
const EYFSP_GUID = '019ac0fb-e082-7202-871f-439d6d036893';
const EYFSP_SLUG = 'early-years-foundation-stage-profile-results';
const GLD = 'b2TtT'; // % good level of development
const EYFSP_TOTAL = { NAEDC: 'O16CL', L6tWj: 'fdpUY', wOGbx: 'CijId' };
const EYFSP_FSM = { NAEDC: 'lPjcB', L6tWj: 'TyUcP', wOGbx: 'CijId' };

// ---- SEN in England: pupils by type of SEN provision (4 filters) ----
const SEN_GUID = '019df85e-ab00-7458-a4ff-b381997776cb';
const SEN_SLUG = 'special-educational-needs-in-england';
const SEN_PCT = 'emJ2u'; // % of pupils
const SEN_COUNT = 'jgizA'; // headcount
const SEN_BASE = { oMxmX: 'DIqhQ', '9114v': '93yS4', OTeCL: 'cDKt3' };
const SEN_SUPPORT = { ...SEN_BASE, dc30Z: 'PL4ve' };
const SEN_EHCP = { ...SEN_BASE, dc30Z: '2rs9l' };

// ---- Pupil absence ----
const ABS_PA_GUID = '019d209c-08dc-74b6-9edb-52d521406fcf'; // persistent & severe
const ABS_OVERALL_GUID = '019d209b-b031-7497-8205-af255b581d91';
const ABS_SLUG = 'pupil-absence-in-schools-in-england';
const ABS_PA_PCT = 'TuAuP'; // % of enrolments (PA / severe)
const ABS_OVERALL_PCT = 'jgLjA'; // overall absence rate (% sessions)

// ---- NEET 16-17 (LFS annual brief, quarterly) ----
const NEET1617_GUID = '019cc380-4628-71be-bdc2-a01a95b64c89';
const NEET1617_SLUG = 'neet-statistics-annual-brief';
const NEET1617_PCT = '6DPUr';

export const INDICATORS: IndicatorSpec[] = [
  // ===================== EES dual-comparator (attainment) =====================
  {
    key: 'attainment8', label: 'Attainment 8 (all pupils)', unit: 'score', goodIfUp: true,
    group: 'ees', feasibility: 'api-ready', expectedReleaseMonths: [10], cadenceLabel: 'Annual (autumn)',
    source: { publisher: 'DfE EES', name: 'KS4 performance — national characteristics', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/key-stage-4-performance' },
    fetch: { kind: 'ees', datasetGuid: KS4_GUID, publicationSlug: KS4_SLUG, timePeriod: AY_24_25, indicatorId: KS4_A8, filters: KS4_TOTAL },
    projection: (y) => y.attainment8,
  },
  {
    key: 'attainment8Dis', label: 'Attainment 8 (disadvantaged)', unit: 'score', goodIfUp: true,
    group: 'ees', feasibility: 'api-ready', expectedReleaseMonths: [10], cadenceLabel: 'Annual (autumn)',
    source: { publisher: 'DfE EES', name: 'KS4 performance — national characteristics', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/key-stage-4-performance' },
    fetch: { kind: 'ees', datasetGuid: KS4_GUID, publicationSlug: KS4_SLUG, timePeriod: AY_24_25, indicatorId: KS4_A8, filters: KS4_DIS },
    projection: (y) => y.attainment8Dis,
  },
  {
    key: 'a8Gap', label: 'Attainment 8 disadvantage gap', unit: 'score pts', goodIfUp: false,
    group: 'ees', feasibility: 'api-ready', expectedReleaseMonths: [10], cadenceLabel: 'Annual (autumn)',
    source: { publisher: 'DfE EES', name: 'KS4 performance — derived A8 gap (total − disadvantaged)', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/key-stage-4-performance' },
    fetch: { kind: 'derived', from: ['attainment8', 'attainment8Dis'], combine: (v) => v.attainment8 - v.attainment8Dis },
    projection: (y) => y.attainment8 - y.attainment8Dis,
    caveat: 'Raw A8-point gap. The model also tracks the gap in EPI "months of learning" (gapKS4) — a separate EPI transform published only as an annual PDF, not via the API.',
  },
  {
    key: 'ehcpAttainment8', label: 'Attainment 8 (EHCP pupils)', unit: 'score', goodIfUp: true,
    group: 'ees', feasibility: 'api-ready', expectedReleaseMonths: [10], cadenceLabel: 'Annual (autumn)',
    source: { publisher: 'DfE EES', name: 'KS4 performance — national characteristics', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/key-stage-4-performance' },
    fetch: { kind: 'ees', datasetGuid: KS4_GUID, publicationSlug: KS4_SLUG, timePeriod: AY_24_25, indicatorId: KS4_A8, filters: KS4_EHCP },
    projection: (y) => y.ehcpAttainment8,
    caveat: 'Exam points are a weak ruler for many EHCP pupils in special/alternative provision.',
  },
  {
    key: 'grade5EM', label: 'Grade 5+ English & maths (all)', unit: '%', goodIfUp: true,
    group: 'ees', feasibility: 'api-ready', expectedReleaseMonths: [10], cadenceLabel: 'Annual (autumn)',
    source: { publisher: 'DfE EES', name: 'KS4 performance — national characteristics', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/key-stage-4-performance' },
    fetch: { kind: 'ees', datasetGuid: KS4_GUID, publicationSlug: KS4_SLUG, timePeriod: AY_24_25, indicatorId: KS4_G5, filters: KS4_TOTAL },
    projection: (y) => y.grade5EM,
  },
  {
    key: 'grade5EMDis', label: 'Grade 5+ English & maths (disadvantaged)', unit: '%', goodIfUp: true,
    group: 'ees', feasibility: 'api-ready', expectedReleaseMonths: [10], cadenceLabel: 'Annual (autumn)',
    source: { publisher: 'DfE EES', name: 'KS4 performance — national characteristics', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/key-stage-4-performance' },
    fetch: { kind: 'ees', datasetGuid: KS4_GUID, publicationSlug: KS4_SLUG, timePeriod: AY_24_25, indicatorId: KS4_G5, filters: KS4_DIS },
    projection: (y) => y.grade5EMDis,
  },
  {
    key: 'ks2RWM', label: 'KS2 reading, writing & maths (all)', unit: '%', goodIfUp: true,
    group: 'ees', feasibility: 'api-ready', expectedReleaseMonths: [9], cadenceLabel: 'Annual (autumn)',
    source: { publisher: 'DfE EES', name: 'KS2 attainment by pupil characteristics', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/key-stage-2-attainment' },
    fetch: { kind: 'ees', datasetGuid: KS2_GUID, publicationSlug: KS2_SLUG, timePeriod: AY_24_25, indicatorId: KS2_RWM, filters: KS2_TOTAL },
    projection: (y) => y.ks2RWM,
  },
  {
    key: 'ks2RWMDis', label: 'KS2 reading, writing & maths (disadvantaged)', unit: '%', goodIfUp: true,
    group: 'ees', feasibility: 'api-ready', expectedReleaseMonths: [9], cadenceLabel: 'Annual (autumn)',
    source: { publisher: 'DfE EES', name: 'KS2 attainment by pupil characteristics', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/key-stage-2-attainment' },
    fetch: { kind: 'ees', datasetGuid: KS2_GUID, publicationSlug: KS2_SLUG, timePeriod: AY_24_25, indicatorId: KS2_RWM, filters: KS2_DIS },
    projection: (y) => y.ks2RWMDis,
  },
  {
    key: 'gld', label: 'Good level of development (all)', unit: '%', goodIfUp: true,
    group: 'ees', feasibility: 'api-ready', expectedReleaseMonths: [11], cadenceLabel: 'Annual (autumn)',
    source: { publisher: 'DfE EES', name: 'EYFSP results', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/early-years-foundation-stage-profile-results' },
    fetch: { kind: 'ees', datasetGuid: EYFSP_GUID, publicationSlug: EYFSP_SLUG, timePeriod: AY_24_25, indicatorId: GLD, filters: EYFSP_TOTAL },
    projection: (y) => y.gld,
  },
  {
    key: 'gldDis', label: 'Good level of development (FSM)', unit: '%', goodIfUp: true,
    group: 'ees', feasibility: 'api-ready', expectedReleaseMonths: [11], cadenceLabel: 'Annual (autumn)',
    source: { publisher: 'DfE EES', name: 'EYFSP results (FSM eligible)', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/early-years-foundation-stage-profile-results' },
    fetch: { kind: 'ees', datasetGuid: EYFSP_GUID, publicationSlug: EYFSP_SLUG, timePeriod: AY_24_25, indicatorId: GLD, filters: EYFSP_FSM },
    projection: (y) => y.gldDis,
    caveat: 'FSM eligibility is the disadvantage proxy (EYFSP has no "disadvantaged" breakdown).',
  },
  // ===================== EES dual-comparator (SEND + absence) =====================
  {
    key: 'senSupportPct', label: 'SEN support prevalence', unit: '%', goodIfUp: false,
    group: 'ees', feasibility: 'api-ready', expectedReleaseMonths: [6], cadenceLabel: 'Annual (summer)',
    source: { publisher: 'DfE EES', name: 'Special educational needs in England', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/special-educational-needs-in-england' },
    fetch: { kind: 'ees', datasetGuid: SEN_GUID, publicationSlug: SEN_SLUG, timePeriod: AY_25_26, indicatorId: SEN_PCT, filters: SEN_SUPPORT },
    projection: (y) => y.senSupportPct,
  },
  {
    key: 'ehcpPct', label: 'EHC plan prevalence', unit: '%', goodIfUp: false,
    group: 'ees', feasibility: 'api-ready', expectedReleaseMonths: [6], cadenceLabel: 'Annual (summer)',
    source: { publisher: 'DfE EES', name: 'Special educational needs in England', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/special-educational-needs-in-england' },
    fetch: { kind: 'ees', datasetGuid: SEN_GUID, publicationSlug: SEN_SLUG, timePeriod: AY_25_26, indicatorId: SEN_PCT, filters: SEN_EHCP },
    projection: (y) => y.ehcpPct,
    caveat: 'Observed is % of school pupils; the model anchors on a wider 0–25 reference population, so compare the trend, not the exact level.',
  },
  {
    key: 'ehcpCountSchool', label: 'EHC plans in school (headcount)', unit: 'pupils', goodIfUp: false,
    group: 'ees', feasibility: 'api-ready', expectedReleaseMonths: [6], cadenceLabel: 'Annual (summer)',
    source: { publisher: 'DfE EES', name: 'Special educational needs in England', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/special-educational-needs-in-england' },
    fetch: { kind: 'ees', datasetGuid: SEN_GUID, publicationSlug: SEN_SLUG, timePeriod: AY_25_26, indicatorId: SEN_COUNT, filters: SEN_EHCP },
    caveat: 'School-pupil EHCP headcount; the model’s ehcpCount counts all 0–25 EHC plans (a wider scope), so this is shown as context, not a drift comparison.',
  },
  {
    key: 'persistentAbsence', label: 'Persistent absence (all)', unit: '%', goodIfUp: false,
    group: 'ees', feasibility: 'api-ready', expectedReleaseMonths: [3], cadenceLabel: 'Termly + annual',
    source: { publisher: 'DfE EES', name: 'Pupil absence in schools in England', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/pupil-absence-in-schools-in-england' },
    fetch: { kind: 'ees', datasetGuid: ABS_PA_GUID, publicationSlug: ABS_SLUG, timePeriod: AY_24_25, indicatorId: ABS_PA_PCT, filters: { daL0Z: 'qYfzj', OS5CL: 'X5Vmf' } },
    projection: (y) => y.persistentAbsence,
  },
  {
    key: 'severeAbsence', label: 'Severe absence', unit: '%', goodIfUp: false,
    group: 'ees', feasibility: 'api-ready', expectedReleaseMonths: [3], cadenceLabel: 'Termly + annual',
    source: { publisher: 'DfE EES', name: 'Pupil absence in schools in England', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/pupil-absence-in-schools-in-england' },
    fetch: { kind: 'ees', datasetGuid: ABS_PA_GUID, publicationSlug: ABS_SLUG, timePeriod: AY_24_25, indicatorId: ABS_PA_PCT, filters: { daL0Z: 'aKM6L', OS5CL: 'X5Vmf' } },
    projection: (y) => y.severeAbsence,
  },
  {
    key: 'absenceOverall', label: 'Overall absence rate', unit: '%', goodIfUp: false,
    group: 'ees', feasibility: 'api-ready', expectedReleaseMonths: [3], cadenceLabel: 'Termly + annual',
    source: { publisher: 'DfE EES', name: 'Pupil absence in schools in England', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/pupil-absence-in-schools-in-england' },
    fetch: { kind: 'ees', datasetGuid: ABS_OVERALL_GUID, publicationSlug: ABS_SLUG, timePeriod: AY_24_25, indicatorId: ABS_OVERALL_PCT, filters: { NBODC: '9c2T4', wf7bx: '7VSHX', o3cmX: 'L1KsW', '9ZZ4v': 'Y0dTH' } },
    projection: (y) => y.absenceOverall,
  },
  // ===================== Observed-only context (no engine field on the same basis) =====================
  {
    key: 'neet1617', label: 'NEET 16–17 (LFS, Q4)', unit: '%', goodIfUp: false,
    group: 'neet', feasibility: 'api-ready', expectedReleaseMonths: [6], cadenceLabel: 'Quarterly (LFS)',
    source: { publisher: 'DfE EES', name: 'NEET statistics annual brief (LFS)', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/neet-statistics-annual-brief' },
    fetch: { kind: 'ees', datasetGuid: NEET1617_GUID, publicationSlug: NEET1617_SLUG, timePeriod: CY_2024, indicatorId: NEET1617_PCT, filters: { TLgPJ: 'rgqmN', m3f9K: 'o2yPm', hKJyW: 'TyUpP' } },
    caveat: '16–17 only; the model’s headline NEET is 16–24. Survey-based with wide confidence intervals.',
  },
  {
    key: 'neet', label: 'NEET 16–24 (headline rate)', unit: '%', goodIfUp: false,
    group: 'neet', feasibility: 'csv-bulk', expectedReleaseMonths: [2, 5, 8, 11], cadenceLabel: 'Quarterly (ONS LFS)',
    source: { publisher: 'ONS', name: 'Young people NEET — Table NEET 1', url: 'https://www.ons.gov.uk/employmentandlabourmarket/peoplenotinwork/unemployment/datasets/youngpeoplenotineducationemploymentortrainingneettable1' },
    fetch: { kind: 'ons-neet-xlsx', field: 'rate' },
    projection: (y) => y.neet,
    caveat: 'ONS LFS survey: "official statistics in development", high volatility — do not read quarter-to-quarter moves as signal. Published only as a spreadsheet.',
  },
  {
    key: 'gdpPerCapitaUK', label: 'UK GDP per capita (PPP)', unit: 'intl $', goodIfUp: true,
    group: 'context', feasibility: 'api-ready', expectedReleaseMonths: [4], cadenceLabel: 'Annual',
    source: { publisher: 'World Bank', name: 'GDP per capita, PPP', url: 'https://data.worldbank.org/indicator/NY.GDP.PCAP.PP.CD?locations=GB' },
    fetch: { kind: 'worldbank', indicator: 'NY.GDP.PCAP.PP.CD', country: 'GBR' },
    caveat: 'International-comparison context for the Global tab, not a model output.',
  },
  {
    key: 'eduSpendPctGdpUK', label: 'UK education spend (% GDP)', unit: '%', goodIfUp: true,
    group: 'context', feasibility: 'api-ready', expectedReleaseMonths: [4], cadenceLabel: 'Annual (lagged)',
    source: { publisher: 'World Bank', name: 'Govt expenditure on education, % GDP', url: 'https://data.worldbank.org/indicator/SE.XPD.TOTL.GD.ZS?locations=GB' },
    fetch: { kind: 'worldbank', indicator: 'SE.XPD.TOTL.GD.ZS', country: 'GBR' },
    caveat: 'Often null for the latest 1–2 years; the latest non-null value is used.',
  },
  // ===================== Deferred: documented, no machine source yet (projection-only in UI) =====================
  {
    key: 'persistentAbsenceDis', label: 'Persistent absence (disadvantaged)', unit: '%', goodIfUp: false,
    group: 'annual', feasibility: 'csv-bulk', expectedReleaseMonths: [3], cadenceLabel: 'Annual full-year only',
    source: { publisher: 'DfE EES', name: 'Pupil absence — FSM breakdown (annual full-year tables)', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/pupil-absence-in-schools-in-england' },
    fetch: { kind: 'manual' },
    projection: (y) => y.persistentAbsenceDis,
    caveat: 'The engine’s central gap driver, but the FSM/disadvantaged absence split is not in the EES API data-sets — only in the annual full-year publication tables. Tracked manually for now.',
  },
  {
    key: 'fundingPerPupil', label: 'Funding per pupil (real terms)', unit: '£', goodIfUp: true,
    group: 'annual', feasibility: 'scrape', expectedReleaseMonths: [11], cadenceLabel: 'Annual (IFS report)',
    source: { publisher: 'IFS', name: 'Annual report on education spending', url: 'https://ifs.org.uk/education-spending' },
    fetch: { kind: 'manual' },
    projection: (y) => y.fundingPerPupil,
    caveat: 'The canonical real-terms per-pupil series is IFS, published as a report (no API). Nominal NFF allocations are a separate bulk download.',
  },
  {
    key: 'childPoverty', label: 'Child poverty (relative, AHC)', unit: '%', goodIfUp: false,
    group: 'annual', feasibility: 'csv-bulk', expectedReleaseMonths: [3], cadenceLabel: 'Annual (HBAI)',
    source: { publisher: 'DWP', name: 'Households below average income (HBAI)', url: 'https://www.gov.uk/government/collections/households-below-average-income-hbai--2' },
    fetch: { kind: 'manual' },
    projection: (y) => y.childPoverty,
    caveat: 'DWP Stat-Xplore exposes an API but requires a free key; the headline also ships as ODS/CSV. Survey-based, ~1 year in arrears.',
  },
  {
    key: 'teacherShortfall', label: 'Teacher shortfall vs pledge', unit: 'k FTE', goodIfUp: false,
    group: 'annual', feasibility: 'csv-bulk', expectedReleaseMonths: [6], cadenceLabel: 'Annual (SWC)',
    source: { publisher: 'DfE / NFER', name: 'School workforce census; NFER labour-market analysis', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/school-workforce-in-england' },
    fetch: { kind: 'manual' },
    projection: (y) => y.teacherShortfall,
    caveat: 'Total teacher FTE is published, but not via the EES query API; the 6,500-pledge shortfall framing is NFER/Full-Fact analysis.',
  },
];

export const INDICATORS_BY_KEY: Record<string, IndicatorSpec> = Object.fromEntries(
  INDICATORS.map((i) => [i.key, i]),
);

/** Keys grouped by the cron workflow that refreshes them. */
export function autoFetchedKeys(group: IndicatorSpec['group']): string[] {
  return INDICATORS.filter((i) => i.group === group && i.fetch.kind !== 'manual').map((i) => i.key);
}
