// neet.ts — verified data for the NEET early-warning Field Study page (/neet).
// All figures from the adversarially fact-checked research dossier; primary-source URLs.
// Self-contained: never imported from outside this route folder.
//
// Caveats carried in the consuming copy (do not contradict):
//  • Identification is not the same as engagement (even Estonia reached only ~1 in 5 of those it listed).
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

/** Local-authority 16–17 NEET vs "activity not known" — the dominant tracking failure. */
export interface LARow { la: string; neet: number; notKnown: number; note: string; }
export const LA_SPREAD: LARow[] = [
  { la: 'City of London', neet: 0.0, notKnown: 0.0, note: 'The lowest end of the range — a small cohort with full contact.' },
  { la: 'England (16–17 NEET)', neet: 2.8, notKnown: 0, note: 'The headline NEET rate is low, but it does not capture the “not known” cohort.' },
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
  { name: 'Netherlands', flag: 'NL', pct: 5.3, kind: 'low', note: 'Lowest NEET rate in the EU (15–29), 2025.' },
  { name: 'EU average', flag: 'EU', pct: 11.0, kind: 'avg', note: 'EU-27 average (15–29), 2025. The 2030 target is under 9%.' },
  { name: 'UK (16–24)', flag: 'GB', pct: 13.5, kind: 'uk', note: 'Different age band (16–24, not 15–29) — shown for scale, not a like-for-like Eurostat comparison.' },
  { name: 'Romania', flag: 'RO', pct: 19.2, kind: 'high', note: 'Highest in the EU (15–29), 2025.' },
];

/** Estonia's Youth Guarantee Support System — identification ≠ engagement. */
export const ESTONIA_FUNNEL = [
  { pct: 100, label: '9 state registers cross-referenced', sub: 'twice a year (15 Mar / 15 Oct), over X-Road' },
  { pct: 100, label: 'Per-municipality NEET list', sub: 'every one of all 79 municipalities joined' },
  { pct: 50, label: '~half were contacted', sub: 'a list is not a conversation' },
  { pct: 20, label: '~1 in 5 actually reached', sub: 'the measured ceiling (IBS evaluation, 2021)' },
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
    country: 'Netherlands', flag: 'NL', tier: 'leader',
    system: 'RMC + Verzuimloket + onderwijsnummer',
    mechanism: 'Every funded student has a lifelong education number; schools must report unauthorised absence (16 hrs in 4 weeks) into a national Digital Absence Portal, routed via DUO to the home municipality; 39 regional RMC coordinators must re-engage every leaver up to 23 without a basic qualification. Targets were binding.',
    result: 'New early school leavers more than halved: ~71,000 (2002) → 29,163 (2023/24). The Netherlands now has the EU’s lowest NEET rate, 5.3% of 15–29s.',
    lesson: 'Make absence the live trigger and route it automatically to a named local coordinator with a duty to act — the mature version of England’s attendance feed + NCCIS.',
    sourceUrl: 'https://www.nji.nl/cijfers/voortijdig-schoolverlaten',
  },
  {
    country: 'Estonia', flag: 'EE', tier: 'pattern',
    system: 'Youth Guarantee Support System + X-Road',
    mechanism: 'Twice a year an automated query over X-Road cross-references nine state registers to produce, per municipality, a consented list of resident 16–26-year-old NEETs with contact details; case managers act via the STAR system. Young people can refuse the analysis.',
    result: 'All 79 municipalities joined; evaluated as effective at moving youth into work/education — BUT only ~half of those listed were contacted, and contact was achieved with about one-fifth.',
    lesson: 'The register-query is exactly what a spine + identifier could enable — but budget for outreach, because identification is not engagement.',
    sourceUrl: 'https://sotsiaalkindlustusamet.ee/ngts',
  },
  {
    country: 'Finland', flag: 'FI', tier: 'pattern',
    system: 'Outreach youth work + ~70 Ohjaamo one-stop centres',
    mechanism: 'Statutory outreach youth work actively finds under-29s excluded from education/work; ~70 Ohjaamo centres co-locate employment, social, health and education services so guidance arrives in one place. Detection is people-led as well as register-led.',
    result: 'Recognised EU good practice with broad coverage; youth workshops run in over 90% of mainland municipalities.',
    lesson: 'Pair register-based detection with funded human outreach and a one-stop front door — data finds the young person; a person re-engages them.',
    sourceUrl: 'https://okm.fi/en/-/tyopajat-ja-etsiva-nuorisotyo',
  },
  {
    country: 'European Union', flag: 'EU', tier: 'pattern',
    system: 'Reinforced Youth Guarantee + Cedefop EWS toolkit',
    mechanism: 'A quality offer of work/education/apprenticeship/traineeship within four months, extended to under-30s, with emphasis on reaching the hardest-to-reach inactive NEETs; Cedefop publishes a five-step method for early-warning systems.',
    result: 'Over 63 million young people have started an offer since 2013; the EU early-leaving rate fell from 16.9% (2002) to 9.4% (2024).',
    lesson: 'A time-bound guarantee gives the early-warning flag something concrete to trigger — detection without a guaranteed offer is just a list.',
    sourceUrl: 'https://employment-social-affairs.ec.europa.eu/policies-and-activities/eu-employment-policies/youth-employment-support/reinforced-youth-guarantee_en',
  },
  {
    country: 'Scotland', flag: 'SCT', tier: 'domestic',
    system: '16+ Data Hub (Skills Development Scotland)',
    mechanism: 'A secure shared portal on 16–24s links local authorities, colleges, the Scottish Funding Council, SAAS, DWP and (from 2025) HMRC — capturing expected leaving dates and destinations — so anyone without a positive destination is quickly identified.',
    result: '2025 measure: 93.4% of 16–19s participating, 3.9% NEET, 2.8% status unknown (the 2025 HMRC-data inclusion raised participation and breaks like-for-like comparison).',
    lesson: 'A UK-domestic proof of concept already exists: cross-agency data-sharing sharply cuts the “unknown” cohort that plagues England’s CCIS-based tracking.',
    sourceUrl: 'https://www.skillsdevelopmentscotland.co.uk/media/2y3ex4it/2025-annual-participation-measure-statistics.pdf',
  },
  {
    country: 'Wisconsin, US', flag: 'US', tier: 'warning',
    system: 'DEWS — Dropout Early Warning System',
    mechanism: 'A machine-learning model run twice yearly for grades 6–9, producing colour-coded risk scores; inputs included test scores, discipline, attendance AND race and free/reduced-lunch status.',
    result: 'Wrong ~74% of the time when predicting non-graduation; false-alarm rate 42pp higher for Black and 18pp higher for Hispanic students; found to have no measurable effect on graduation; the state knew it was unfair from 2021.',
    lesson: 'The design conditions the case points to: race and its proxies are excluded from the model, bias is audited before deployment, a human stays in the loop, and a flag is treated as “check in” rather than a verdict — otherwise the system can reinforce the inequity it was meant to reduce.',
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

// ---- How AI could improve England's NEET approach (verified, adversarially fact-checked) ----
// Ordered from the strongest, lowest-risk role to the most cautionary. Evidence standards applied:
//  • Prediction of individual child risk has repeatedly underperformed (WWCSC 2020) — triage, not verdict.
//  • Accuracy on paper does not equal impact; vendor/council self-reports are not independent evaluations.
//  • These are co-pilots and signposts for human youth workers, never autonomous decision-makers.

export const AI_INTRO = {
  research:
    'AI is not one intervention but a set of distinct roles across the NEET pipeline — and the evidence for each varies widely in quality. The throughline is constant: AI’s function is to target scarce human capacity and close the gap between identifying a young person and actually engaging them — a co-pilot for youth workers, not an automated verdict on a child. The engine on this page already projects NEET; AI is one route to closing the loop from projection to action. Four roles, ordered from the strongest, lowest-risk use to the most cautionary.',
  eli5:
    'AI can help with NEET, but it is well-suited to some jobs and poorly suited to others. Consider it as four jobs, with one rule running through all of them: the computer helps a human youth worker spend their limited time on the right young people. It is a co-pilot, not a decision-maker on a child’s future.',
};

export interface AIRole {
  key: string; icon: string; tag: string; title: string; verdict: string; colour: string;
  research: string; eli5: string; example: string; exampleUrl: string;
}

export const AI_ROLES: AIRole[] = [
  {
    key: 'find', icon: '', tag: 'FIND', title: 'Record linkage to fix the “Not Known”',
    verdict: 'Strongest, lowest-risk role', colour: '#4a7c7c',
    research: `The “Not Known” cohort is fundamentally a data-matching problem, not a prediction problem. DfE’s own methodology states there is “considerable variation at local authority level in how well 16 and 17 year olds are tracked”, so not-known proportions distort NEET estimates. The fix is entity resolution — knowing where a young person actually is across school, college, apprenticeship and benefits systems before anyone tries to predict anything. AI-grade probabilistic linkage is a mature government capability: MoJ’s open-source Splink (a Fellegi–Sunter model with DuckDB / Spark / Athena backends, built under ADR UK’s Data First) scales to ~15m records in under an hour, and GOV.UK states it delivers “an unambiguously better ROC curve” than the prior rules-based approach. National infrastructures set a realistic accuracy benchmark: Stats NZ’s IDI linked the 2023 Census at 97.9–98.2% with a 0.8% false-positive rate, and DfE’s own ECHILD links the National Pupil Database to Hospital Episode Statistics at ~99%. The caveat: these are research/statistical spines, not operational LA early-warning feeds — but this is the strongest, lowest-risk role for AI in the pipeline: locate, do not predict.`,
    eli5: `A central data gap in NEET tracking is that councils sometimes do not know where a teenager went — they are filed as “activity not known”. That is not a prediction problem, it is a record-matching problem: the school, college, apprenticeship and benefits lists are all separate, and the same young person is spelled slightly differently on each. AI is well-suited to the routine but important job of saying “these two records are the same person, with 95% confidence”. The government already has a free tool for this (Splink) that the Ministry of Justice runs on tens of millions of records, and New Zealand and DfE’s own health-linked data match people at ~98–99% accuracy with very few mistakes. So the safest, most useful thing AI can do here is locate the young people who have dropped off the records — before inferring anything about them.`,
    example: `Splink — the Ministry of Justice’s open-source probabilistic record-linkage library (ADR UK Data First, peer-reviewed with ONS). Its deployed use is linking MoJ courts/prisons/probation records, so the NEET application is an analogy rather than a claim Splink itself makes. Benchmark: Stats NZ’s IDI links the 2023 Census at 97.9–98.2% (0.8% false positives); DfE’s ECHILD links NPD to hospital records at ~99%.`,
    exampleUrl: 'https://github.com/moj-analytical-services/splink',
  },
  {
    key: 'predict', icon: '', tag: 'PREDICT & PRIORITISE', title: 'Risk scores as triage, never a verdict',
    verdict: 'Cautionary — triage only', colour: '#b1455e',
    research: `This is where the evidence is most cautionary. England’s official policy is the lower-risk version: DfE’s January 2025 guidance formalises the Risk of NEET Indicator (RONI), and DfE is building a national RONI tool inside NCCIS that hands each LA a twice-yearly list of at-risk Year 10/11 pupils from the National Pupil Database (free school meals, absence, exclusions, looked-after, children in need) — deterministic indicator-flagging, not machine learning. Where councils went further into predictive ML, the documented record is weak. The most-cited evaluation is What Works for Children’s Social Care (now Foundations), 2020: across four LAs, models missed ~4 in 5 at-risk children and were wrong ~6 times in 10 when they flagged one, failing a 65% precision bar on all eight scenarios — the lead author reported being “surprised by just how bad the models performed”. Several flagship council systems were withdrawn (Hackney’s Xantura EHPS, ~£361k, “did not realise the expected benefits”; Bristol closed its exploitation models in 2023, keeping only its NEET model — itself a predictive decision-tree/regression model). The base-rate problem is structural: when the outcome is rare, even an accurate-looking model produces a high false-positive rate. On this evidence, risk scores function as triage for scarce outreach and to “screen in” extra help, not to gate it.`,
    eli5: `This is the appealing idea — have a computer predict which young people will struggle — and the one with the weakest track record. In the most-cited UK test, the model missed about four in five children who actually needed help, and when it did raise a flag it was wrong more than half the time. Several councils withdrew their systems. In Wisconsin, a dropout predictor was wrong about three-quarters of the time and far more likely to wrongly flag Black and Hispanic students. The reason: the outcome being predicted is rare, and predicting rare events produces many false alarms. On this evidence, a flag means “give this young person an extra phone call”, not a fixed judgement about that young person. England’s current policy (the RONI list) uses simple, transparent warning signs rather than a black-box predictor.`,
    example: `The most-cited evaluation: What Works for Children’s Social Care (now Foundations), 2020 — ML models across four LAs missed ~4 in 5 at-risk children and were wrong ~6 in 10 when flagging; lead author Michael Sanders reported being “surprised by just how bad the models performed”. The contrast where triage performed better: Allegheny County’s Family Screening Tool is a decision AID for call-screeners (not a decision-maker) and cut the Black–White disparity gap in investigations from 10.6 to 1.8 points (−83%) and removals from 4.3 to 1.2 (−73%) — the inverse of DEWS, because it triages capacity rather than issuing a verdict.`,
    exampleUrl: 'https://www.communitycare.co.uk/2020/09/10/evidence-machine-learning-works-well-childrens-social-care-study-finds/',
  },
  {
    key: 'reach', icon: '', tag: 'REACH & ENGAGE', title: 'An LLM co-pilot for youth workers, and a guidance front door',
    verdict: 'Best causal evidence', colour: '#2f7d4f',
    research: `Finding a young person is not the same as engaging one — the identification-versus-engagement gap is where much NEET effort is lost, and here AI has both the strongest causal evidence and the most live UK deployment. On proactive outreach, conversational nudges have RCT-grade evidence: Georgia State’s text chatbot “Pounce” (AdmitHub, now Mainstay) cut summer melt 21.4% and raised enrolment 3.3–3.9% in a randomised trial (~3,114 in treatment, ~300 extra enrolees); 80% rated it 4–5/5. On caseworker admin, LLM co-pilots are already live across UK councils: North Yorkshire’s DfE-funded children’s-social-care proof of concept used semantic search and reported a ~90% reduction in time/cost for some data-retrieval tasks plus auto-generated eco-maps — the “summarise a young person’s cross-service history” pattern a NEET caseworker needs. An LGA survey found 95% of responding councils using or exploring AI. For a guidance front door, GOV.UK Chat reportedly reached ~90% accuracy in testing — but its launch drew criticism for incorrect tax/benefits answers, so it functions as a signpost, not advice on an individual’s case. The evidenced pattern (from i.AI’s Consult, F1 0.76 vs human experts, but weaker at identifying missing themes) is that these tools augment rather than replace.`,
    eli5: `Knowing where a young person is does not help if they are never reached — and reaching them is the difficult part. The best-evidenced AI here is the two-way text chatbot: one US university’s chatbot, “Pounce”, texted students reminders and answers, and in a controlled trial 21% fewer dropped out over the summer; students rated it well. The other evidenced use is giving a stretched youth worker a co-pilot — AI that reads a young person’s scattered records and writes a short summary, so the worker spends time on the person rather than the paperwork. UK councils already do this (one cut some admin tasks by ~90%). There is also an AI helper on GOV.UK, though it serves as a signpost only (it returned some incorrect tax answers at launch), not personal advice. The limit: these tools augment a worker’s capacity rather than substitute for the worker’s judgement.`,
    example: `Georgia State’s “Pounce” chatbot (AdmitHub / Mainstay): in an RCT it cut summer melt 21.4% and raised enrolment 3.3–3.9% (~300 extra enrolees from ~3,114 in treatment), with 80% rating it 4–5/5 — the best causal evidence for conversational AI as a re-engagement front door. UK admin-reduction analogue: North Yorkshire Council’s DfE-funded social-care AI PoC reported a ~90% reduction in time/cost for some data-retrieval tasks.`,
    exampleUrl: 'https://mainstay.com/case-study/how-georgia-state-university-supports-every-student-with-personalized-text-messaging/',
  },
  {
    key: 'nowcast', icon: '', tag: 'NOWCAST & EVALUATE', title: 'See it sooner, learn what actually works',
    verdict: 'Foundation exists; product aspirational', colour: '#2f6f97',
    research: `The final role is closing the loop from data to learning. On timeliness, the foundation already exists: the IFS uses administrative data (payrolled employment, out-of-work benefit claims) to track NEET drivers faster than the Labour Force Survey — which is quarterly and which ONS itself says should be “used with caution” due to reduced reliability. So the timeliness gap and the admin-data inputs for nowcasting are established; what remains more proposed than deployed is a validated ML NEET-nowcasting product on top of that descriptive tracking. On learning what cuts NEET, linking trials to NPD/admin outcomes is the established “what works” route, but the evidence base is thin: EEF’s pilot of the ThinkForward coaching programme concluded it was “not ready for a large trial”, and reviews find mostly low-quality evidence. This is the slot a policy simulator like the engine on this page occupies — explore options, then close the loop: the engine already projects NEET; AI-grade linkage and nowcasting are one route to feeding fast outcome data back in to test whether the projected effect occurred. The framing: a simulator and a nowcaster support reasoning about and monitoring the system; they do not, on their own, establish causation — that still requires trials linked to admin data.`,
    eli5: `The official NEET figures come from a survey that is slow and, at present, of reduced reliability — so a problem can be worsening for months before the numbers register it. The government already holds faster signals (payroll, benefit records) that the IFS uses to spot trends early; AI could turn that into an early-warning dashboard — a “nowcast” instead of a lagging report. The second part is learning what works: the way to know whether a programme cuts NEET is to test it and then follow those young people in the data — and when this is done rigorously, results are often modest (one large coaching programme was judged “not ready” for a full trial). That is the purpose of this simulator: explore what might work, then use AI to add fast, real data afterwards to check whether it did.`,
    example: `IFS — “Why has the NEET rate risen?”: uses administrative data (payrolled employment, out-of-work benefit claims) to track NEET drivers faster than the lagged, currently-unreliable Labour Force Survey — the empirical foundation a NEET nowcaster would sit on (a productionised ML nowcaster is the still-proposed next step). On the evaluate side, EEF’s pilot of ThinkForward concluded it was “not ready for a large trial” — an illustration that the intervention evidence base is thin.`,
    exampleUrl: 'https://ifs.org.uk/publications/why-has-neet-rate-risen-understanding-trends-and-drivers-using-administrative-data',
  },
];

export const AI_STATS = [
  { big: '~4 in 5', label: 'at-risk children MISSED by the most-cited UK ML child-risk trial (WWCSC, 4 LAs, 2020) — wrong ~6 in 10 when it did flag one', url: 'https://www.communitycare.co.uk/2020/09/10/evidence-machine-learning-works-well-childrens-social-care-study-finds/' },
  { big: '97.9–98.2%', label: 'link rate (0.8% false positives) for Stats NZ’s IDI — the realistic accuracy benchmark for AI record linkage to fix the “Not Known” cohort', url: 'https://www.stats.govt.nz/methods/linking-2023-census-responses-to-the-integrated-data-infrastructure/' },
  { big: '−21.4%', label: 'summer melt in an RCT of Georgia State’s “Pounce” chatbot (+3.3–3.9% enrolment) — strongest causal evidence for conversational AI re-engagement', url: 'https://mainstay.com/case-study/how-georgia-state-university-supports-every-student-with-personalized-text-messaging/' },
  { big: '−83% / −73%', label: 'cut in the Black–White disparity gap (investigations / removals) from Allegheny’s screening AID — proof governed triage can reduce bias, the opposite of DEWS', url: 'https://analytics.alleghenycounty.us/2024/05/31/predictive-risk-models-in-child-welfare/' },
];

export const AI_CAUTIONS = [
  'The base-rate / false-positive problem is structural, not a tuning issue: when the outcome is rare, even an accurate-looking model produces a high false-positive rate. On this evidence, the design condition is that risk scores “screen in” extra support rather than gate it.',
  'Accuracy on paper does not equal impact: Wisconsin’s DEWS had no measurable effect on flagged students’ graduation, and the US EWIMS trial moved leading indicators but not graduation. A flag without attached human capacity to act produces no observed change in outcomes.',
  'Risk flags can encode protected characteristics as “risk” — DfE’s own RONI guidance lists some ethnic-minority groups, and free school meals is a poverty proxy. Bias requires active auditing rather than being assumed absent.',
  'The strongest “positive” claims are vendor/council self-reports, not independent evaluations (e.g. Xantura/EY’s ~40% homelessness-reduction figure ran during the atypical Covid period and concerns homelessness, not NEET). The magnitudes are therefore unverified.',
];

// ---- CCIS — the system local authorities submit NEET data into (verified, adversarially fact-checked) ----
// Naming held strictly per DfE usage: CCIS = the LOCAL LA product; NCCIS = the national return/aggregation
// layer. The spec is the "NCCIS management information requirement" (DfE also titles it "CCIS …"). CCIS expands
// to "Client Caseload Information System" — NOT "Careers, Education…" or "Connexions…". These LA NEET figures are
// management information, NOT accredited official statistics, and are not comparable with the LFS 16–24 measure.

export const CCIS_INTRO = {
  research: `Behind those local-authority figures sits the operational system a data spine, a consistent identifier and AI record-linkage would overhaul. Each council runs its own <b>CCIS</b> (a supplier-procured, DfE-spec product) recording every 16–17-year-old’s current activity in three buckets — in education/employment/training, NEET, or <b>“activity not known”</b> — plus the date it was last confirmed, under the Education and Skills Act 2008 s.68 support duty. Every month it extracts an XML return to DfE’s <b>NCCIS</b>, which feeds the published LA NEET figures. Note that these are <b>management information, not accredited official statistics</b>: they cover only the 16–17s a council knows about, and cannot be compared with the LFS-based national NEET 16–24 number this page opened with.`,
  eli5: `Behind those council figures is the actual system they use, called <b>CCIS</b>. Each council keeps its own list of what every 16- and 17-year-old is doing — in school or college, in work or training, NEET, or “not known” — and once a month sends a snapshot up to a national system, <b>NCCIS</b>, which is where the country’s 16–17 NEET numbers come from. It works, but it’s a once-a-month photo built from a lot of phone-calls — and it’s a rough management count, not the same official measure as the “million NEETs” figure at the top of this page.`,
};

export const CCIS_NAMING = [
  { name: 'CCIS', expand: 'Client Caseload Information System', detail: 'The local product each LA runs (bought from a supplier) to track every young person’s current activity and when it was last confirmed. Really a DfE data <b>standard</b> — the 117-page “NCCIS management information requirement” — that LA products must meet; there is no single central system.', colour: '#566a8c' },
  { name: 'NCCIS', expand: 'National CCIS', detail: 'The DfE return/aggregation layer LAs upload their monthly XML to, and which the published statistics — and the new national RONI tool — are built from. DfE uses both names; the spec’s cover says both.', colour: '#4a7c7c' },
];

export interface PointDetail { point: string; detail: string; }

export const CCIS_ROLE: PointDetail[] = [
  { point: 'Tracks each 16–17-year-old’s activity — and when it was last confirmed', detail: 'Status is coded into EET, NEET and “activity not known” (which splits into “situation not known”, “cannot be contacted” and “refused to disclose”). Cohort: academic age 16–17, tracked to 18 — and to 25 for EHC-plan holders.' },
  { point: 'Evidences the council’s statutory support duty', detail: 'Education and Skills Act 2008 s.68: LAs must encourage, enable or assist participation. (The duty ON young people to stay in education or training to 18 — Raising the Participation Age — is Part 1 of the same Act, not s.68.)' },
  { point: 'Produces the monthly NCCIS return', detail: 'LA systems extract a monthly XML return to DfE; the September Guarantee rides within it; the Annual Activity Survey (Year-11 destinations as at 1 November) goes separately as a CSV.' },
  { point: 'Feeds the LA NEET statistics — as management information', detail: 'NEET/“not known” is a December/January/February three-month average; participation a March snapshot. Not accredited official statistics, and not comparable with the LFS 16–24 figure.' },
];

export const CCIS_LIMITS: PointDetail[] = [
  { point: 'Monthly batch, not real-time', detail: 'A once-a-month XML extract on a legacy data standard, so the figures lag — which is exactly why DfE averages three months of returns rather than trusting a single snapshot.' },
  { point: 'Tracking quality varies wildly by council', detail: 'DfE warns of “considerable variation … in how well 16/17 year olds are tracked”; the Dec 2024–Feb 2025 NEET/“not known” spread ran 0.0% (City of London) to 21.5% (Dudley). Some LAs are suppressed for system migrations — so a council can look good by chasing harder, not by having fewer lost young people.' },
  { point: 'A persistent “not known / no record” cohort', detail: 'September 2025: ~80,000 of a ~1.3m cohort with no suitable offer recorded — including ~44,000 (~3%) where councils held “no record” of whether an offer was even made, read by commentators as young people “lost to the system”.' },
  { point: 'No shared identifier → manual, lossy matching', detail: 'Each agency keys data on its own reference numbers, so confirming where a young person actually is means manual matching across systems never designed to join up. That gap — not a missing dashboard — is the thing to overhaul.' },
];

export interface OverhaulRow { dimension: string; today: string; overhauled: string; }

export const CCIS_OVERHAUL: OverhaulRow[] = [
  { dimension: 'Update cadence', today: 'Monthly XML batch to NCCIS; the LA NEET figure is a Dec/Jan/Feb average — a once-a-month photo that lags reality.', overhauled: 'Near-source, continuous status updates from registers (attendance, enrolment, payroll/benefit signals) so “last confirmed” is days old — the model the Netherlands’ DUO/Verzuimloket already runs nationally.' },
  { dimension: 'Resolving “not known”', today: 'Manual chasing of young people and providers; the unresolved fall into “situation not known / cannot be contacted / refused”, inflating the figure and varying by LA.', overhauled: 'Probabilistic record linkage (e.g. MoJ/ADR-UK’s Splink) auto-matches the cohort across School Census/NPD, ILR, apprenticeships and DWP/HMRC — the cross-register move Scotland’s 16+ Data Hub already uses. (A logical, not-yet-announced application.)' },
  { dimension: 'Joining records', today: 'Each agency keys on its own reference numbers; CCIS relies on manual matching across systems that don’t share an identifier.', overhauled: 'A consistent child identifier — a regulation-making power in the Children’s Wellbeing and Schools Act 2026, the NHS number the likely candidate (to be confirmed in regulations) — lets registers join by design. Estonia’s EHIS is the mature version.' },
  { dimension: 'Risk identification', today: 'Schools hand-populate Risk-of-NEET indicators; effort and consistency vary, and at-risk lists are labour-intensive to build.', overhauled: 'An announced national RONI tool auto-generates at-risk lists twice a year from the NCCIS data, cutting school data-entry — staff still filter the list. (In DfE’s Jan 2025 guidance; not yet fully live.)' },
  { dimension: 'Underlying architecture', today: 'A legacy standard plus LA-procured products of varying quality, aggregated through a national return — bolt-ons, not connected infrastructure.', overhauled: 'The Schools White Paper (Feb 2026) commits to a national “data spine” to connect fragmented systems. (A commitment; it doesn’t yet name CCIS or 16–18 tracking — that linkage is implied.)' },
];

export const CCIS_AIVALUE = {
  research: `The framing: AI here is <b>record-linkage, not prediction</b>. CCIS’s core difficulty is the “not known” cohort and the manual matching that creates it — what probabilistic linkage addresses. Applied to NEET tracking, a tool like Splink could auto-resolve much of “not known” by matching across School Census/NPD, ILR, apprenticeships and DWP/HMRC — auto-populating activity instead of chasing it, and nowcasting NEET faster than the lagged monthly return. The method is established: Scotland’s 16+ Data Hub already shrinks the “unconfirmed” cohort this way, and once a consistent identifier exists much of the matching becomes deterministic. The announced RONI-in-NCCIS tool is the triage layer on top. The limits: the UK GDPR’s rules on solely-automated significant decisions (Arts 22A–D) mean AI can resolve a <i>probable</i> status and prioritise outreach, but confirming “EET” or directing an intervention requires a human; a match is a probable status, not confirmed engagement; and part of “not known” is unreachable by matching. Better tracking is a precondition, but tracking is not engagement.`,
  eli5: `When a young person is in the council’s “not known” category, somewhere else — a college roll, an apprenticeship list, a pay or benefits record — there is almost certainly a line indicating where they are, filed under a different number. AI record-matching locates that line and fills the field in automatically, rather than requiring repeated phone calls. Scotland uses a version of this and it reduced its “not known” count. The constraints: the computer suggests rather than decides — a human confirms before anyone acts, as the law requires; a match is a probable status, not confirmation that the person is engaged; and some young people are absent from every list and no matching locates them. Locating them is the more tractable step; re-engaging them is the harder one.`,
};

export const CCIS_STATS = [
  { big: '117 pages', label: 'the current “NCCIS management information requirement: 2026 to 2027” spec (updated 31 Dec 2025) — the data standard every LA product must meet', url: 'https://assets.publishing.service.gov.uk/media/6943ca108f4636fa2c547e25/NCCIS_management_information_requirement_2026_to_2027.pdf' },
  { big: 'Monthly', label: 'frequency of the XML batch return LAs submit to DfE via NCCIS — a once-a-month photo, not a live feed', url: 'https://explore-education-statistics.service.gov.uk/methodology/participation-in-education-training-and-neet-age-16-to-17-by-local-authority' },
  { big: '0.0–21.5%', label: 'spread in 16–17 NEET/“not known” across LAs (Dec 2024–Feb 2025 avg): City of London to Dudley — the tracking-quality gap', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/participation-in-education-training-and-neet-age-16-to-17-by-local-authority/2024-25' },
  { big: 'Twice a year', label: 'how often the announced national RONI tool would generate at-risk lists from the NCCIS data', url: 'https://policyconnect.org.uk/blog/government-announces-new-risk-neet-indicator-roni-process/' },
];


// ---------------------------------------------------------------------------
// The risk-tooling ladder (2026-06): how NEET risk scoring is actually practised
// in England — checklist → weighted index → ML — and the failure gallery that
// constrains any DfE deployment. [DfE RONI guidance Jan 2025; IFF/NatCen research
// Apr 2026 via Youth Futures; Bristol CC ATRS record; Ada Lovelace Critical Analytics?]
// ---------------------------------------------------------------------------
export interface ToolingRung {
  rung: number; name: string; what: string; whatEli5: string;
  status: string; weakness: string; colour: string;
}

export const TOOLING_LADDER: ToolingRung[] = [
  {
    rung: 1, name: 'RONI — the checklist', colour: '#9a7b1f',
    what: 'Unweighted points over ~15 indicators (absence, exclusions, SEND, FSM, care status…). Emerged from LA practice in the early 2010s; nationalised by DfE guidance in January 2025: LAs generate twice-yearly at-risk lists from NCCIS, refined by careers leaders who know the young person.',
    whatEli5: 'A tick-list: one point for each warning sign. Councils now have to run it twice a year, and a teacher who knows the child checks the list.',
    status: 'National guidance since Jan 2025; OnTrack+ (Careers & Enterprise Company) delivers it inside schools for Years 7–11.',
    weakness: 'Unweighted — treats every marker the same when the measured risks differ 2–3×; the Years 10–11 focus is later than the evidence supports (signals are visible from primary school); wide variation in whether and how LAs run it.',
  },
  {
    rung: 2, name: 'NERI — the weighted index', colour: '#b4632e',
    what: 'NatCen’s statistically-derived upgrade (Blackpool case study, Apr 2026): weights estimated from admin data on >1 million young people. Key findings — prior attainment predicts NEET well before GCSEs; FSM + care experience compound.',
    whatEli5: 'The smarter version: each warning sign counts for what it’s actually worth, worked out from a million real records — and it can spot risk from primary school.',
    status: 'Research-stage with a published methodology; not yet the national standard.',
    weakness: 'Still risk-ranking, not treatment-effect ranking; still only as good as the data the LA can see (no health signal).',
  },
  {
    rung: 3, name: 'Machine learning', colour: '#b1455e',
    what: 'Bristol City Council runs the only NEET model in England with a published ATRS transparency record: decision trees on the Think Family database (education + police + DWP + NHS), refreshed weekly, advisory-only, viewed by ~150 safeguarding staff. Essex runs a validated RONI dashboard; Xantura/EY sell council risk models commercially.',
    whatEli5: 'A few councils use proper prediction software. Bristol is the only one that publishes how its model works — and even Bristol won’t say how accurate it is.',
    status: 'Scattered LA deployments; vendor models documented as opaque (Ada Lovelace’s Barking & Dagenham ethnography).',
    weakness: 'NO deployed English NEET model has published precision/recall. Bristol’s record says the metrics exist internally — and discloses none. The accuracy of the entire national practice is unverifiable.',
  },
];

export interface FailureCase { name: string; what: string; rule: string; url: string; }

export const FAILURE_GALLERY: FailureCase[] = [
  {
    name: 'Ofqual 2020',
    what: 'The exam algorithm: 40% of teacher grades downgraded, systematic disadvantage to large state colleges, attempted NDAs on the Royal Statistical Society, full U-turn.',
    rule: 'Criterion: the method is published before results reach individuals, not after.',
    url: 'https://en.wikipedia.org/wiki/Ofqual_exam_results_algorithm',
  },
  {
    name: 'DfE ABIE (2025)',
    what: 'DfE’s own AI-set school attendance targets — suspended over data-quality problems; a quarter of schools never received targets; heads publicly sceptical.',
    rule: 'Finding: national-scale ML fails on data quality and user trust before it fails on modelling.',
    url: 'https://schoolsweek.co.uk/ai-to-set-minimum-attendance-targets-for-all-schools/',
  },
  {
    name: 'DWP UC advances model',
    what: 'Fraud-risk scoring deployed 2021; the Public Law Project called its fairness assessment “flawed and inadequate”; disclosure resisted for years.',
    rule: 'Criterion: advisory scores attach to an OFFER of support, not to sanction or rationing.',
    url: 'https://committees.parliament.uk/writtenevidence/152681/pdf/',
  },
  {
    name: 'Wisconsin DEWS',
    what: 'US dropout early-warning system: ~74% false-alarm rate, racial bias gaps, no measurable effect on graduation.',
    rule: 'Criterion: precision/recall is reported by subgroup, publicly — headline accuracy figures obscure the failure mode.',
    url: 'https://themarkup.org/machine-learning/2023/04/27/false-alarm-how-wisconsin-uses-race-and-income-to-label-students-high-risk',
  },
];

// ---------------------------------------------------------------------------
// The ML/AI opportunity ladder: eight shapes ranked by evidence-to-novelty, each
// with its data dependency and governance price. [research dossier 2026-06-10]
// ---------------------------------------------------------------------------
export interface OpportunityRung {
  rank: number; name: string; what: string; needs: string; evidence: string; governance: string; frontier?: boolean;
  /** estate-map node ids this shape depends on (renders as jump-chips) */
  needIds?: string[];
}

export const OPPORTUNITY_LADDER: OpportunityRung[] = [
  { rank: 1, needIds: ['census', 'nccis', 'leo'],  name: 'Validated weighted risk index', what: 'NERI-style weights, validated against LEO 5-year outcomes, distributed through OnTrack+/NCCIS.', needs: 'NPD + NCCIS + LEO (all exist)', evidence: 'Method proven; validation undone — the cheapest credible move', governance: 'DPIA + ATRS record with published precision/recall' },
  { rank: 2, needIds: ['attendance'],  name: 'Attendance-feed early warning', what: 'Trajectory flags (sudden deterioration, Years 9–11) pushed to LAs and careers leaders in-year.', needs: 'Daily attendance feed (exists, school-level only)', evidence: 'DfE already runs ML on this data; ABIE shows the data-quality work needed first', governance: 'Individual-level DPIA; human-in-the-loop; opt-out clarity' },
  { rank: 3, needIds: ['census', 'ilr', 'nccis', 'leo'],  name: 'Transition survival analysis', what: 'Time-to-NEET / time-to-re-engagement hazards over the Year-11 cliff and the age-18 dark zone.', needs: 'NPD→ILR→NCCIS→LEO spine (research access)', evidence: 'No published UK work — a genuine analytical gap', governance: 'Research-grade first; SRS access' },
  { rank: 4, needIds: ['nccis'],  name: 'Place-based NEET forecasting', what: 'Local NEET-supply forecasts (how many, what needs, where) to size Youth Guarantee provision.', needs: 'LA-level cohort + labour-market data', evidence: 'YFF risk-factor maps exist; commissioning demand is live (£820m to allocate)', governance: 'Lowest ethical risk — no person-level flags; a good first product' },
  { rank: 5, name: 'Service matching', what: 'Matching young people to provision — the Dutch RMC function, algorithmically assisted.', needs: 'A national provision taxonomy (does not exist)', evidence: 'Unproven in the UK', governance: 'Recommender-grade transparency; right to explanation' },
  { rank: 6, name: 'LLM-assisted casework', what: 'Transcription, summarisation and next-step suggestions for careers advisers and tracking teams.', needs: 'Casework systems integration', evidence: 'Beam Magic Notes: 100+ LAs, ~12 hrs/week saved in social care — the adjacent proof', governance: 'Workflow side only — never the scoring side; accuracy review' },
  { rank: 7, needIds: ['leo', 'ilr'],  name: 'NEET nowcasting', what: 'Admin-data nowcast of the national/local NEET rate, faster than the lagged and volatile LFS.', needs: 'HMRC RTI + DWP + ILR at monthly cadence', evidence: 'IFS has shown admin data tracks NEET better than the survey', governance: 'Aggregate-only — minimal personal-data risk' },
  { rank: 8, needIds: ['leo'],  name: 'Uplift modelling', frontier: true, what: 'Target by TREATMENT EFFECT, not risk: who would benefit from which intervention. Risk-based targeting directs spend toward high-risk cases that may have low responsiveness.', needs: 'RCT outcomes (YFF portfolio) × LEO linkage', evidence: 'Causal-forest analyses of US summer-jobs RCTs found benefits concentrated in subgroups standard methods miss; not yet done for UK NEET', governance: 'The full stack — and the highest-leverage shape in this field study' },
];

export const GOVERNANCE_CHECKLIST: { item: string; why: string }[] = [
  { item: 'DPIA, published', why: 'DfE already publishes the attendance-collection DPIA; an unpublished one signals something to hide.' },
  { item: 'ATRS record from day one — WITH metrics', why: 'Mandatory for central departments since 2024. Bristol’s record is the template; its omission of precision/recall is the gap a DfE record would need to close.' },
  { item: 'Human-in-the-loop that can overrule', why: 'ICO guidance requires review that is active, trained and empowered — not tokenistic sign-off. The Jan-2025 RONI guidance already encodes this; keep it in anything ML.' },
  { item: 'Subgroup error rates, published', why: 'Recall parity across SEND type, ethnicity and FSM is where early-warning systems actually fail (Wisconsin).' },
  { item: 'Sunset & review clauses', why: 'Bristol’s 6-monthly review is good practice; models degrade as cohorts and policies shift.' },
  { item: 'Challenger capacity on vendor models', why: 'The LGA pattern: contractual accuracy measures plus an in-house team able to interrogate the supplier’s claims.' },
];

// ---------------------------------------------------------------------------
// The transition curve: NEET rate by single year of age, 16→24. Calibrated to the
// DfE 2025 annual brief (16–17: 4.0%; 18–24: 16.0%) — single-age points interpolated
// to those anchors. The story is the SHAPE: the post-GCSE step, the age-18 jump, and
// the plateau that begins exactly where the tracking duty ends.
// ---------------------------------------------------------------------------
export const AGE_PROFILE: { age: number; pct: number }[] = [
  { age: 16, pct: 2.8 }, { age: 17, pct: 5.2 }, { age: 18, pct: 11.5 }, { age: 19, pct: 14.0 },
  { age: 20, pct: 15.5 }, { age: 21, pct: 16.4 }, { age: 22, pct: 16.8 }, { age: 23, pct: 17.0 }, { age: 24, pct: 17.2 },
];

// ---------------------------------------------------------------------------
// The Milburn review ("Young People and Work", interim DIAGNOSTIC report, May 2026):
// the five interlocking system failures and the new headline numbers. DIAGNOSIS ONLY —
// the review makes no recommendations until the "solutions" phase, autumn 2026; the
// directional asks live in directions.ts (tagged status:'diagnosis'). [gov.uk interim report]
// ---------------------------------------------------------------------------
export interface MilburnFailure { chapter: string; title: string; research: string; eli5: string; }

export const MILBURN_FAILURES: MilburnFailure[] = [
  { chapter: 'Ch.3', title: 'The youth economy',
    research: 'The youth share of the labour market has fallen even as overall employment rose; entry-level roles are fewer and more demanding, and recruitment is "more remote, more automated and less human" — "a portal, a test, a recorded interview or an algorithm".',
    eli5: 'There are fewer first jobs, and getting one now means passing online portals and automated tests instead of meeting a manager.' },
  { chapter: 'Ch.5', title: 'Health — configured for treatment, not participation',
    research: 'Health-related reasons for youth NEET rose ~70% in a decade and mental health is the primary condition for >4 in 10 disabled NEETs; the system treats illness rather than supporting a route back to work or learning.',
    eli5: 'Health care for young people is set up to treat illness, not to help them back into work or study.' },
  { chapter: 'Ch.4', title: 'Education & skills — the faltering foundation',
    research: 'Too many young people leave education without the qualifications or support to make the transition to work, and disadvantage funding largely stops at 16 even though the NEET cliff is at 16–18.',
    eli5: 'School and college do not set enough young people up for work, and the extra help stops at 16.' },
  { chapter: 'Ch.6', title: 'A welfare state not designed for participation',
    research: 'In 2024/25 about £1 was spent on employment support for young people for every ~£25 on benefits; the system parks young people rather than re-engaging them, and ~7 in 10 claiming a health/disability benefit are still claiming a decade later.',
    eli5: 'The benefits system spends far more keeping young people on benefits than helping them into work.' },
  { chapter: 'Ch.7', title: 'The architecture — a system in name, not in design',
    research: 'Responsibility for young people is split across education, health, welfare and employers with no one owning the join — "a system in name, not in design" — so no one sees the whole young person or the £1:£25 spend split.',
    eli5: 'No single body joins up education, benefits, health and employers, so nobody sees the whole picture.' },
];

export const MILBURN_STATS = [
  { big: '~£125bn', label: 'estimated annual cost of ~1m young NEETs — "more than we spend on education each year"', url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report' },
  { big: '£1 : £25', label: 'spent on youth employment support vs on benefits (2024/25)', url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report' },
  { big: '6 in 10', label: 'NEETs today have never had a job — up from 4 in 10 in 2005', url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report' },
  { big: '+70%', label: 'rise in health-related reasons for being NEET over a decade', url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report' },
  { big: 'only Romania', label: 'had a higher youth NEET rate in Europe by 2025', url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report' },
];
