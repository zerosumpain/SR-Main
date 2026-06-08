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

// ---- How AI could improve England's NEET approach (verified, adversarially fact-checked) ----
// Ordered from the strongest, lowest-risk role to the most cautionary. Honesty rules:
//  • Prediction of individual child risk has repeatedly underperformed (WWCSC 2020) — triage, not verdict.
//  • Accuracy on paper ≠ impact; vendor/council self-reports are not independent evaluations.
//  • These are co-pilots and signposts for human youth workers, never autonomous decision-makers.

export const AI_INTRO = {
  research:
    'AI is not one intervention but a set of distinct roles across the NEET pipeline — and the evidence for each is wildly different in quality. The throughline is constant: AI’s job is to target scarce human capacity and close the gap between identifying a young person and actually engaging them — a co-pilot for youth workers, never an automated verdict on a child. The engine on this page already projects NEET; AI is how you would close the loop from projection to action. Four roles, ordered from the strongest, lowest-risk use to the most cautionary.',
  eli5:
    'AI can help with NEET — but only if you’re honest that it’s great at some jobs and dangerous at others. Think of it as four jobs, with one golden rule running through all of them: the computer helps a human youth worker spend their limited time on the right young people. It’s a co-pilot. It never gets to decide a child’s future on its own.',
};

export interface AIRole {
  key: string; icon: string; tag: string; title: string; verdict: string; colour: string;
  research: string; eli5: string; example: string; exampleUrl: string;
}

export const AI_ROLES: AIRole[] = [
  {
    key: 'find', icon: '🔗', tag: 'FIND', title: 'Record linkage to fix the “Not Known”',
    verdict: 'Strongest, lowest-risk role', colour: '#4a7c7c',
    research: `The “Not Known” cohort is fundamentally a data-matching problem, not a prediction problem. DfE’s own methodology warns there is “considerable variation at local authority level in how well 16 and 17 year olds are tracked”, so not-known proportions distort NEET estimates. The fix is entity resolution — knowing where a young person actually is across school, college, apprenticeship and benefits systems before anyone tries to predict anything. AI-grade probabilistic linkage is a mature government capability: MoJ’s open-source Splink (a Fellegi–Sunter model with DuckDB / Spark / Athena backends, built under ADR UK’s Data First) scales to ~15m records in under an hour, and GOV.UK states it delivers “an unambiguously better ROC curve” than the prior rules-based approach. National infrastructures set a realistic accuracy benchmark: Stats NZ’s IDI linked the 2023 Census at 97.9–98.2% with a 0.8% false-positive rate, and DfE’s own ECHILD links the National Pupil Database to Hospital Episode Statistics at ~99%. The honest caveat: these are research/statistical spines, not operational LA early-warning feeds — but this is the strongest, lowest-risk role for AI in the whole pipeline: locate, don’t predict.`,
    eli5: `The biggest scandal in NEET data is that councils sometimes don’t know where a teenager went — they’re filed as “activity not known”. That’s not a crystal-ball problem, it’s a filing problem: the school, college, apprenticeship and benefits lists are all separate, and the same kid is spelled slightly differently on each. AI is really good at the boring-but-vital job of saying “these two records are the same person, with 95% confidence”. The government already has a free tool for this (Splink) that the Ministry of Justice runs on tens of millions of records, and New Zealand and DfE’s own health-linked data match people at ~98–99% accuracy with very few mistakes. So the safest, most useful thing AI can do here is simply find the young people who’ve slipped off the radar — before guessing anything about them.`,
    example: `Splink — the Ministry of Justice’s open-source probabilistic record-linkage library (ADR UK Data First, peer-reviewed with ONS). Its deployed use is linking MoJ courts/prisons/probation records, so the NEET application is a sound analogy rather than a claim Splink itself makes. Benchmark: Stats NZ’s IDI links the 2023 Census at 97.9–98.2% (0.8% false positives); DfE’s ECHILD links NPD to hospital records at ~99%.`,
    exampleUrl: 'https://github.com/moj-analytical-services/splink',
  },
  {
    key: 'predict', icon: '🎯', tag: 'PREDICT & PRIORITISE', title: 'Risk scores as triage, never a verdict',
    verdict: 'Cautionary — triage only', colour: '#b1455e',
    research: `This is where the evidence is most cautionary. England’s official policy is deliberately the safe version: DfE’s January 2025 guidance formalises the Risk of NEET Indicator (RONI), and DfE is building a national RONI tool inside NCCIS that hands each LA a twice-yearly list of at-risk Year 10/11 pupils from the National Pupil Database (free school meals, absence, exclusions, looked-after, children in need) — deterministic indicator-flagging, not machine learning. Where councils went further into predictive ML, the record is sobering. The canonical caution is What Works for Children’s Social Care (now Foundations), 2020: across four LAs, models missed ~4 in 5 at-risk children and were wrong ~6 times in 10 when they flagged one, failing a 65% precision bar on all eight scenarios — the lead author was “surprised by just how bad the models performed”. Several flagship council systems were quietly dropped (Hackney’s Xantura EHPS, ~£361k, “did not realise the expected benefits”; Bristol shut its exploitation models in 2023, keeping only its NEET model — itself a predictive decision-tree/regression model). The base-rate problem is structural: when the outcome is rare, even an accurate-looking model produces overwhelming false alarms. So risk scores should TRIAGE scarce outreach and “screen in” extra help — never gate it.`,
    eli5: `This is the tempting idea — let a computer predict which kids will struggle — and the one that keeps going wrong. In the most famous UK test, the computer missed about four in five children who actually needed help, and when it did raise a flag it was wrong more than half the time. Several councils quietly switched their systems off. In Wisconsin, a dropout predictor was wrong about three-quarters of the time and far more likely to wrongly alarm about Black and Hispanic students. Why so bad? Because the thing you’re predicting is rare, and predicting rare things produces loads of false alarms. So the rule has to be: a flag means “give this young person an extra phone call”, never “this young person is a lost cause”. England’s actual policy (the RONI list) sticks to simple, transparent warning signs rather than a black-box predictor — the sensible choice.`,
    example: `The honest failure: What Works for Children’s Social Care (now Foundations), 2020 — ML models across four LAs missed ~4 in 5 at-risk children and were wrong ~6 in 10 when flagging; lead author Michael Sanders was “surprised by just how bad the models performed”. The contrast that shows triage CAN work: Allegheny County’s Family Screening Tool is a decision AID for call-screeners (not a decision-maker) and cut the Black–White disparity gap in investigations from 10.6 to 1.8 points (−83%) and removals from 4.3 to 1.2 (−73%) — the opposite of DEWS, because it triages capacity rather than issuing a verdict.`,
    exampleUrl: 'https://www.communitycare.co.uk/2020/09/10/evidence-machine-learning-works-well-childrens-social-care-study-finds/',
  },
  {
    key: 'reach', icon: '💬', tag: 'REACH & ENGAGE', title: 'An LLM co-pilot for youth workers, and a guidance front door',
    verdict: 'Best causal evidence', colour: '#2f7d4f',
    research: `Finding a young person is not the same as engaging one — the “identification ≠ engagement” gap is where most NEET effort is actually lost, and here AI has both the strongest causal evidence and the most live UK deployment. On proactive outreach, conversational nudges have RCT-grade evidence: Georgia State’s text chatbot “Pounce” (AdmitHub, now Mainstay) cut summer melt 21.4% and raised enrolment 3.3–3.9% in a randomised trial (~3,114 in treatment, ~300 extra enrolees); 80% rated it 4–5/5. On caseworker admin, LLM co-pilots are already live across UK councils: North Yorkshire’s DfE-funded children’s-social-care proof of concept used semantic search and reported a ~90% reduction in time/cost for some data-retrieval tasks plus auto-generated eco-maps — exactly the “summarise a young person’s cross-service history” pattern a NEET caseworker needs. An LGA survey found 95% of responding councils using or exploring AI. For a guidance front door, GOV.UK Chat reportedly hit ~90% accuracy in testing — but its launch drew criticism for misleading tax/benefits answers, so it is a signpost, not advice on an individual’s case. The honest pattern (from i.AI’s Consult, F1 0.76 vs human experts, but weak at finding missing themes) is that these tools augment rather than replace.`,
    eli5: `Knowing where a teenager is doesn’t help if you never reach them — and reaching them is the hard part. The best-proven AI here is the friendly, two-way text chatbot: one US university’s chatbot, “Pounce”, texted students reminders and answers, and in a proper trial got 21% fewer to vanish over the summer; students liked it. The other proven use is giving a stretched youth worker a co-pilot — AI that reads a young person’s scattered records and writes a quick summary, so the worker spends time on the person, not the paperwork. UK councils already do this (one cut some admin tasks by ~90%). There’s even an AI helper on GOV.UK now, though it’s only a signpost (it got some tax questions wrong at launch), not personal advice. The honest limit: these tools are brilliant assistants but bad bosses.`,
    example: `Georgia State’s “Pounce” chatbot (AdmitHub / Mainstay): in an RCT it cut summer melt 21.4% and raised enrolment 3.3–3.9% (~300 extra enrolees from ~3,114 in treatment), with 80% rating it 4–5/5 — the best causal evidence for conversational AI as a re-engagement front door. UK admin-reduction analogue: North Yorkshire Council’s DfE-funded social-care AI PoC reported a ~90% reduction in time/cost for some data-retrieval tasks.`,
    exampleUrl: 'https://mainstay.com/case-study/how-georgia-state-university-supports-every-student-with-personalized-text-messaging/',
  },
  {
    key: 'nowcast', icon: '📡', tag: 'NOWCAST & EVALUATE', title: 'See it sooner, learn what actually works',
    verdict: 'Foundation exists; product aspirational', colour: '#2f6f97',
    research: `The final role is closing the loop from data to learning. On timeliness, the foundation already exists: the IFS uses administrative data (payrolled employment, out-of-work benefit claims) to track NEET drivers faster than the Labour Force Survey — which is quarterly and which ONS itself says should be “used with caution” due to reduced reliability. So the timeliness gap and the admin-data inputs for nowcasting are established; what is still more proposed than deployed is a validated ML NEET-nowcasting product on top of that descriptive tracking. On learning what cuts NEET, linking trials to NPD/admin outcomes is the established “what works” route, but the evidence base is genuinely thin: EEF’s pilot of the ThinkForward coaching programme concluded it was “not ready for a large trial”, and reviews find mostly low-quality evidence. This is exactly the slot a policy simulator like the engine on this page occupies — explore options, then close the loop: the engine already projects NEET; AI-grade linkage and nowcasting are how you would feed real, fast outcome data back in to test whether the projected effect actually happened. The honest framing: a simulator and a nowcaster help you reason about and watch the system; they do not, by themselves, prove causation — that still needs trials linked to admin data.`,
    eli5: `The official NEET figures come from a survey that’s slow and, right now, a bit shaky — so a problem can be getting worse for months before the numbers admit it. The good news: the government already has faster signals (payroll, benefit records) that the IFS uses to spot trends early; AI could turn that into a proper early-warning dashboard — a “nowcast” instead of a lagging report. The second half is learning what genuinely helps: the only honest way to know if a programme cuts NEET is to test it and then follow those young people in the data — and when people do that properly, results are often disappointing (one big coaching programme was judged “not ready” for a full trial). That’s what this simulator is for: explore what might work, then use AI to plug in fast, real data afterwards to check whether it actually did.`,
    example: `IFS — “Why has the NEET rate risen?”: uses administrative data (payrolled employment, out-of-work benefit claims) to track NEET drivers faster than the lagged, currently-unreliable Labour Force Survey — the empirical foundation a NEET nowcaster would sit on (a productionised ML nowcaster is the still-aspirational next step). On the evaluate side, EEF’s pilot of ThinkForward concluded it was “not ready for a large trial” — an honest illustration that the intervention evidence base is thin.`,
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
  'The base-rate / false-positive problem is structural, not a tuning issue: when the outcome is rare, even an accurate-looking model produces overwhelming false alarms. This is why risk scores must “screen in” extra support and never gate it.',
  'Accuracy on paper ≠ impact: Wisconsin’s DEWS had no measurable effect on flagged students’ graduation, and the US EWIMS trial moved leading indicators but not graduation. A flag without attached human capacity to act changes nothing.',
  'Risk flags can encode protected characteristics as “risk” — DfE’s own RONI guidance lists some ethnic-minority groups, and free school meals is a poverty proxy. Bias must be actively audited, not assumed away.',
  'The strongest “positive” claims are vendor/council self-reports, not independent evaluations (e.g. Xantura/EY’s ~40% homelessness-reduction figure ran during the atypical Covid period and concerns homelessness, not NEET). Treat magnitudes as unverified.',
];

