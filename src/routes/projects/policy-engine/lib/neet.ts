// neet.ts — verified data for the NEET early-warning Field Study page (/neet).
// All figures from the adversarially fact-checked research dossier; primary-source URLs.
// Self-contained: never imported from outside this route folder.
//
// Honest caveats baked into the consuming copy (do not contradict):
//  • Identification ≠ engagement (even Estonia reached only ~1 in 5 of those it listed).
//  • The data spine is announced, not built; the attendance feed is twice-daily, not real-time.
//  • York/SPRU lifetime costs are 2010 estimates (2009 prices). Eurostat NEET is 15–29;
//    the UK headline (16–24) is a different age band — flagged wherever they sit together.

/** Composition of the current UK 16–24 NEET total (ONS, Jan–Mar 2026). */
export const NEET_NOW = {
  total: 1_012_000,
  pct: 13.5,
  unemployed: 400_000,     // looking for work
  inactive: 613_000,       // not looking / not available — the larger share
  projection: 1_250_000,   // Milburn "1 in 6 within five years"
  asOf: 'Jan–Mar 2026',
  url: 'https://www.ons.gov.uk/employmentandlabourmarket/peoplenotinwork/unemployment/bulletins/youngpeoplenotineducationemploymentortrainingneet/may2026',
};

/** Local-authority 16–17 NEET vs "activity not known" — the real failure mode. */
export interface LARow { la: string; neet: number; notKnown: number; note: string; }
export const LA_SPREAD: LARow[] = [
  { la: 'City of London', neet: 0.0, notKnown: 0.0, note: 'The clean end of the range — tiny cohort, full contact.' },
  { la: 'England (16–17 NEET)', neet: 2.8, notKnown: 0, note: 'The headline NEET rate looks reassuringly low — which is exactly the problem: it hides the “not known”.' },
  { la: 'Dudley', neet: 2.4, notKnown: 19.1, note: 'Only 2.4% counted NEET — but 19.1% are “activity not known”. The 21.5% combined rate is lost contact, not low risk.' },
];
export const LA_NOTE =
  'Headline NEET rates are an average of December/January/February returns; a young person whose activity isn’t reconfirmed in time is logged “activity not known”, not NEET. The “Not Known” cohort — not measured NEET — is the dominant tracking failure.';

/** The fragmented sources a young person's status is reconstructed from. */
export const SILOS = [
  { id: 'npd', label: 'School census / NPD', who: 'DfE' },
  { id: 'ilr', label: 'College & FE records (ILR)', who: 'DfE' },
  { id: 'appr', label: 'Apprenticeships', who: 'DfE' },
  { id: 'dwp', label: 'Benefits data', who: 'DWP' },
  { id: 'hmrc', label: 'PAYE earnings (RTI)', who: 'HMRC' },
];
export const LEO_NOTE =
  'These can be linked — DfE’s LEO dataset already joins ~39 million people’s records across NPD, FE, HE, HMRC and DWP. But LEO is de-identified and lagged: built for research and earnings analysis, not for a local authority to act on a specific named young person. That operational gap is what a spine would close.';

/** The cross-service spokes a single child identifier joins. */
export const JOIN_SPOKES = [
  { label: 'Education', sub: 'school, FE, attendance', colour: '#566a8c' },
  { label: 'Health (NHS)', sub: 'the candidate number', colour: '#3f7d6e' },
  { label: 'Social care', sub: 'looked-after, CIN', colour: '#7a5aa6' },
  { label: 'Police / justice', sub: 'youth offending', colour: '#b4632e' },
  { label: 'Benefits', sub: 'DWP, Universal Credit', colour: '#9a7b1f' },
];

/** Netherlands new early-school-leavers — "more than halved". (Mid-2010s low is approximate.) */
export interface ESLPoint { year: number; value: number; label: string; approx?: boolean; }
export const NL_ESL: ESLPoint[] = [
  { year: 2002, value: 71_000, label: '71,000' },
  { year: 2015, value: 25_000, label: '≈25k (mid-2010s low)', approx: true },
  { year: 2024, value: 29_163, label: '29,163' },
];
export const NL_ESL_NOTE =
  'New early school leavers (school year shown). The mid-2010s low is approximate; the 2002 baseline and the 29,163 figure for 2023/24 are the firmly-sourced endpoints. The national goal was to more than halve new leavers from the 2002 baseline.';

/** Where the Netherlands sits internationally on NEET (Eurostat 15–29). UK is a different age band. */
export interface NeetBar { name: string; flag: string; pct: number; kind: 'low' | 'avg' | 'high' | 'uk'; note: string; }
export const EUROSTAT_NEET: NeetBar[] = [
  { name: 'Netherlands', flag: '🇳🇱', pct: 5.3, kind: 'low', note: 'Lowest NEET rate in the EU (15–29), 2025.' },
  { name: 'EU average', flag: '🇪🇺', pct: 11.0, kind: 'avg', note: 'EU-27 average (15–29), 2025. The 2030 target is under 9%.' },
  { name: 'UK (16–24)', flag: '🇬🇧', pct: 13.5, kind: 'uk', note: 'Different age band (16–24, not 15–29) — shown for scale, not a like-for-like Eurostat comparison.' },
  { name: 'Romania', flag: '🇷🇴', pct: 19.2, kind: 'high', note: 'Highest in the EU (15–29), 2025.' },
];

/** Estonia's Youth Guarantee Support System — identification ≠ engagement. */
export const ESTONIA_FUNNEL = [
  { pct: 100, label: '9 state registers cross-referenced', sub: 'twice a year (15 Mar / 15 Oct), over X-Road' },
  { pct: 100, label: 'Per-municipality NEET list', sub: 'every one of all 79 municipalities joined' },
  { pct: 50, label: '~half were contacted', sub: 'a list is not a conversation' },
  { pct: 20, label: '~1 in 5 actually reached', sub: 'the honest ceiling (IBS evaluation, 2021)' },
];

/** Attendance-as-hub: the ABC signals + the multi-agency RONI inputs. */
export const ABC = [
  { letter: 'A', label: 'Attendance', sub: 'the earliest, strongest signal — fed twice daily', colour: '#b1455e' },
  { letter: 'B', label: 'Behaviour', sub: 'suspensions, exclusions', colour: '#b4632e' },
  { letter: 'C', label: 'Course performance', sub: 'failing core subjects', colour: '#2f6f97' },
];
export const RONI_INPUTS = ['SEN status', 'Exclusions', 'Care status', 'Youth justice', 'Social care', 'Prior attainment', 'Persistent absence'];

/** International NEET-monitoring comparators (cards + matrix). */
export interface NeetIntlRow {
  country: string; flag: string; system: string;
  mechanism: string; result: string; lesson: string; sourceUrl: string;
  tier: 'leader' | 'pattern' | 'domestic' | 'warning';
}
export const NEET_INTL: NeetIntlRow[] = [
  {
    country: 'Netherlands', flag: '🇳🇱', tier: 'leader',
    system: 'RMC + Verzuimloket + onderwijsnummer',
    mechanism: 'Every funded student has a lifelong education number; schools must report unauthorised absence (16 hrs in 4 weeks) into a national Digital Absence Portal, routed via DUO to the home municipality; 39 regional RMC coordinators must re-engage every leaver up to 23 without a basic qualification. Targets were binding.',
    result: 'New early school leavers more than halved: ~71,000 (2002) → 29,163 (2023/24). The Netherlands now has the EU’s lowest NEET rate, 5.3% of 15–29s.',
    lesson: 'Make absence the live trigger and route it automatically to a named local coordinator with a duty to act — the mature version of England’s attendance feed + NCCIS.',
    sourceUrl: 'https://www.nji.nl/cijfers/voortijdig-schoolverlaten',
  },
  {
    country: 'Estonia', flag: '🇪🇪', tier: 'pattern',
    system: 'Youth Guarantee Support System + X-Road',
    mechanism: 'Twice a year an automated query over X-Road cross-references nine state registers to produce, per municipality, a consented list of resident 16–26-year-old NEETs with contact details; case managers act via the STAR system. Young people can refuse the analysis.',
    result: 'All 79 municipalities joined; evaluated as effective at moving youth into work/education — BUT only ~half of those listed were contacted, and contact was achieved with about one-fifth.',
    lesson: 'The register-query is exactly what a spine + identifier could enable — but budget for outreach, because identification is not engagement.',
    sourceUrl: 'https://sotsiaalkindlustusamet.ee/ngts',
  },
  {
    country: 'Finland', flag: '🇫🇮', tier: 'pattern',
    system: 'Outreach youth work + ~70 Ohjaamo one-stop centres',
    mechanism: 'Statutory outreach youth work actively finds under-29s excluded from education/work; ~70 Ohjaamo centres co-locate employment, social, health and education services so guidance arrives in one place. Detection is people-led as well as register-led.',
    result: 'Recognised EU good practice with broad coverage; youth workshops run in over 90% of mainland municipalities.',
    lesson: 'Pair register-based detection with funded human outreach and a one-stop front door — data finds the young person; a person re-engages them.',
    sourceUrl: 'https://okm.fi/en/-/tyopajat-ja-etsiva-nuorisotyo',
  },
  {
    country: 'European Union', flag: '🇪🇺', tier: 'pattern',
    system: 'Reinforced Youth Guarantee + Cedefop EWS toolkit',
    mechanism: 'A quality offer of work/education/apprenticeship/traineeship within four months, extended to under-30s, with emphasis on reaching the hardest-to-reach inactive NEETs; Cedefop publishes a five-step method for early-warning systems.',
    result: 'Over 63 million young people have started an offer since 2013; the EU early-leaving rate fell from 16.9% (2002) to 9.4% (2024).',
    lesson: 'A time-bound guarantee gives the early-warning flag something concrete to trigger — detection without a guaranteed offer is just a list.',
    sourceUrl: 'https://employment-social-affairs.ec.europa.eu/policies-and-activities/eu-employment-policies/youth-employment-support/reinforced-youth-guarantee_en',
  },
  {
    country: 'Scotland', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', tier: 'domestic',
    system: '16+ Data Hub (Skills Development Scotland)',
    mechanism: 'A secure shared portal on 16–24s links local authorities, colleges, the Scottish Funding Council, SAAS, DWP and (from 2025) HMRC — capturing expected leaving dates and destinations — so anyone without a positive destination is quickly identified.',
    result: '2025 measure: 93.4% of 16–19s participating, 3.9% NEET, 2.8% status unknown (the 2025 HMRC-data inclusion raised participation and breaks like-for-like comparison).',
    lesson: 'A UK-domestic proof of concept already exists: cross-agency data-sharing sharply cuts the “unknown” cohort that plagues England’s NCCIS returns.',
    sourceUrl: 'https://www.skillsdevelopmentscotland.co.uk/media/2y3ex4it/2025-annual-participation-measure-statistics.pdf',
  },
  {
    country: 'Wisconsin, US', flag: '🇺🇸', tier: 'warning',
    system: 'DEWS — Dropout Early Warning System',
    mechanism: 'A machine-learning model run twice yearly for grades 6–9, producing colour-coded risk scores; inputs included test scores, discipline, attendance AND race and free/reduced-lunch status.',
    result: 'Wrong ~74% of the time when predicting non-graduation; false-alarm rate 42pp higher for Black and 18pp higher for Hispanic students; found to have no measurable effect on graduation; the state knew it was unfair from 2021.',
    lesson: 'Never feed race or proxies into the model, audit for bias before deploying, keep a human in the loop, and treat a flag as “check in”, not a verdict — or you entrench the inequity you meant to fix.',
    sourceUrl: 'https://themarkup.org/machine-learning/2023/04/27/false-alarm-how-wisconsin-uses-race-and-income-to-label-students-high-risk',
  },
];

export const NEET_TIER_META: Record<NeetIntlRow['tier'], { label: string; colour: string }> = {
  leader: { label: 'The standout result', colour: '#2f7d4f' },
  pattern: { label: 'The design pattern', colour: '#2f6f97' },
  domestic: { label: 'Already works in the UK', colour: '#4a7c7c' },
  warning: { label: 'The cautionary case', colour: '#b1455e' },
};

export const NEET_KEY_STATS = [
  { big: '1,012,000', label: '16–24-year-olds NEET in the UK (13.5%), Jan–Mar 2026 — of whom ~613,000 are not even looking for work', url: 'https://www.ons.gov.uk/employmentandlabourmarket/peoplenotinwork/unemployment/bulletins/youngpeoplenotineducationemploymentortrainingneet/may2026' },
  { big: '~£125bn', label: 'Estimated annual economic cost of youth NEET (Milburn interim review, May 2026) — could reach 1 in 6 within five years', url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report' },
  { big: '~80,000', label: 'School leavers (6% of ~1.3m) with no recorded suitable September Guarantee offer in 2025 — incl. 44,000 with “no record”', url: 'https://feweek.co.uk/missing-teenagers-suggests-a-worthless-guarantee/' },
  { big: '~44%', label: 'Of NEETs are “hidden” — not claiming out-of-work benefits, so the systems meant to find them never see them', url: 'https://policyinpractice.co.uk/blog/empowering-local-authorities-to-solve-the-neet-crisis-with-better-data/' },
  { big: '~1 in 5', label: 'Of the NEETs Estonia’s register query identified were actually reached — identification is not engagement', url: 'https://www.ibs.ee/en/publications/the-youth-guarantee-support-system-2/' },
  { big: '£56,301', label: 'Lifetime public-finance cost of a single 16–18 NEET (York/SPRU, 2010 estimate in 2009 prices)', url: 'https://www.york.ac.uk/inst/spru/research/pdf/NEET.pdf' },
];
