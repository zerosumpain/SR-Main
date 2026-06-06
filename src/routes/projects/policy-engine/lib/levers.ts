// levers.ts — the policy levers the user can move. Each maps to a real DfE policy and
// carries its evidence, source, and confidence (shown in the UI tooltip). The lever ids
// match the coefficient keys in params.ts. Self-contained.

import type { LeverDef, LeverState } from './types';
import { fmtGBP } from './format';

export const LEVERS: LeverDef[] = [
  // ----------------------------- EARLY YEARS -----------------------------
  {
    id: 'ey_quality', group: 'early', label: 'Early-years quality investment', unit: 'index',
    min: 0, max: 100, step: 5, baseline: 30, policy: 80,
    blurb: 'Funding & workforce for high-quality early education — the channel that drives the large gap-closing effects.',
    evidence: 'EEF: communication/language +7 mo, parental engagement +5 mo, early literacy +4 mo. Best Start targets GLD 75% by 2028. Effect reaches GCSE with an ~11-year lag and partial fade-out.',
    source: 'EEF Early Years Toolkit; Best Start in Life (2025); IFS', url: 'https://educationendowmentfoundation.org.uk/education-evidence/early-years-toolkit',
    confidence: 'medium', policyRef: 'Best Start in Life strategy (Jul 2025)',
  },
  {
    id: 'ey_access', group: 'early', label: 'Disadvantaged early-education access', unit: '%',
    min: 0, max: 100, step: 5, baseline: 70, policy: 100,
    blurb: 'Share of disadvantaged under-5s actually in funded early education — the binding constraint on gap effects.',
    evidence: 'The 30-hour expansion is a working-parent subsidy: only ~20% of bottom-third earners qualify vs ~80% of >£45k households. Funded hours buy the +3-month "quantity" effect, not the larger quality effects.',
    source: 'Sutton Trust; IFS', url: 'https://www.suttontrust.com/our-research/inequality-in-early-years-education/',
    confidence: 'medium', policyRef: 'Funded childcare expansion / disadvantaged 2-year-old offer',
  },
  {
    id: 'eypp', group: 'early', label: 'Early Years Pupil Premium', unit: '£/yr',
    min: 0, max: 1500, step: 5, baseline: 570, policy: 655, format: (v) => fmtGBP(v),
    blurb: 'Per-child disadvantage funding for 3–4-year-olds — the early analogue of the school Pupil Premium.',
    evidence: '£1.00/hr ≈ £570/yr (2025-26) rising to £1.15/hr ≈ £655/yr (2026-27); historically ~¼ of the school Pupil Premium. Closing that step matters for the age-5 gap.',
    source: 'IFS; Tes; Hansard 2025-12-15', url: 'https://ifs.org.uk/articles/childcare-funding-rates-largely-protected-real-terms-big-uplift-disadvantage-premium',
    confidence: 'high', policyRef: 'EYPP uplift 2025/26 & 2026/27',
  },
  // ----------------------------- DISADVANTAGE -----------------------------
  {
    id: 'pupil_premium', group: 'disadvantage', label: 'Pupil Premium (per pupil)', unit: '£/pupil',
    min: 0, max: 2500, step: 25, baseline: 1300, policy: 1300, format: (v) => fmtGBP(v),
    blurb: 'Targeted per-pupil funding for disadvantaged pupils (blended primary/secondary).',
    evidence: '£1,515 primary / £1,075 secondary (2025-26); ~£3bn over 2.3m pupils. There is NO robust £→gap elasticity — impact depends on spending quality (EEF tiered model), so this lever is modelled as a quality-moderated offset with wide uncertainty.',
    source: 'Commons Library SN06700; EEF', url: 'https://researchbriefings.files.parliament.uk/documents/SN06700/SN06700.pdf',
    confidence: 'assumption', policyRef: 'Pupil Premium',
  },
  {
    id: 'fsm', group: 'disadvantage', label: 'Free School Meals generosity', unit: 'index',
    min: 0, max: 100, step: 5, baseline: 30, policy: 60,
    blurb: 'FSM eligibility: 30 ≈ current £7,400 threshold · 60 ≈ all Universal-Credit households (Sept 2026) · 100 ≈ universal.',
    evidence: 'Extension to all UC households adds ~500k children immediately (~1.7m long-run) and lifts ~100k out of poverty (DfE, take-up-discounted). Also widens the Pupil-Premium denominator.',
    source: 'IFS; DfE; Children’s Wellbeing & Schools Act 2026 s.32', url: 'https://ifs.org.uk/articles/benefits-and-costs-expanding-access-free-school-meals-will-grow-over-time',
    confidence: 'high', policyRef: 'FSM expansion (CWSA 2026, s.32)',
  },
  {
    id: 'breakfast', group: 'disadvantage', label: 'Breakfast-club coverage', unit: '%',
    min: 0, max: 100, step: 5, baseline: 15, policy: 100,
    blurb: 'Share of primary schools running a funded free breakfast club.',
    evidence: '+2 months KS1 attainment (moderate-low security; KS2 effect null after re-analysis); ~0.43 fewer absence days/pupil/yr; DfE business case BCR 2.43. Funding £25/day + £1/pupil/day.',
    source: 'EEF Magic Breakfast; DfE business case', url: 'https://educationendowmentfoundation.org.uk/projects-and-evaluation/projects/magic-breakfast',
    confidence: 'medium', policyRef: 'Universal breakfast clubs (CWSA 2026, s.30)',
  },
  {
    id: 'poverty_action', group: 'disadvantage', label: 'Child-poverty action', unit: 'index',
    min: 0, max: 100, step: 5, baseline: 20, policy: 70,
    blurb: 'Anti-poverty effort (two-child-limit removal, UC support) — exogenous to schools but a powerful upstream driver of the gap.',
    evidence: 'Child Poverty Strategy targets −550k children by 2028/29 (~−3.7pp). Income acts on the gap mainly via the home-learning environment and attendance (EPI mediation), so the effect is lagged.',
    source: 'CPAG; IFS; Child Poverty Strategy (Dec 2025)', url: 'https://cpag.org.uk/news/child-poverty-statistics-new-record-high-and-further-breakdowns',
    confidence: 'medium', policyRef: 'Child Poverty Strategy (2025)',
  },
  // ----------------------------- SEND -----------------------------
  {
    id: 'inclusion_fund', group: 'send', label: 'Inclusive mainstream + Experts at Hand', unit: '£bn/yr',
    min: 0, max: 3, step: 0.1, baseline: 0, policy: 1.1, format: (v) => `£${v.toFixed(1)}bn`,
    blurb: 'Investment in mainstream SEND capacity and external specialists (educational psychologists, SALT, OT).',
    evidence: '£1.6bn/3yr Inclusive Mainstream Fund + £1.8bn Experts at Hand. There is NO published elasticity of EHCP demand to inclusion funding — tuning band 0% to −30% of new-issue growth, central −10–15%, 2–3-yr lag.',
    source: 'Schools White Paper 2026; IFS', url: 'https://schoolsweek.co.uk/white-paper-1-6bn-for-mainstream-inclusion-1-8bn-for-external-support/',
    confidence: 'assumption', policyRef: 'Schools White Paper 2026 (SEND)',
  },
  {
    id: 'send_early', group: 'send', label: 'Early SEND intervention', unit: 'index',
    min: 0, max: 100, step: 5, baseline: 20, policy: 80,
    blurb: 'Strength of early identification & support (Family Hubs, EP capacity), aiming to meet need below the EHCP threshold.',
    evidence: 'Identification-vs-prevention tension: more early support can RAISE short-run plan demand (more children flagged) before reducing it long-run. No quantified plan-demand reduction exists.',
    source: 'NAO; EEF; Best Start Family Hubs', url: 'https://www.nao.org.uk/reports/support-for-children-and-young-people-with-special-educational-needs/',
    confidence: 'assumption', policyRef: 'Best Start Family Hubs / SEND reform',
  },
  {
    id: 'ehcp_reform', group: 'send', label: 'EHCP reform intensity', unit: '%',
    min: 0, max: 100, step: 5, baseline: 0, policy: 60,
    blurb: 'How far statutory EHC plans are narrowed / diverted to non-statutory Individual Support Plans (from 2029).',
    evidence: 'Double-edged: narrowing plans cuts the high-needs deficit but, WITHOUT matching mainstream investment, worsens SEND attainment and raises tribunal volume. The government’s 7.7%→4.7% prevalence path is disputed by the IFS.',
    source: 'Schools White Paper 2026; IFS Green Budget; Schools Week', url: 'https://schoolsweek.co.uk/schools-white-paper-what-is-happening-to-ehcps-under-send-reforms/',
    confidence: 'assumption', policyRef: 'EHCP reform / Individual Support Plans (WP 2026)',
  },
  {
    id: 'high_needs', group: 'send', label: 'High-needs funding uplift', unit: '%/yr',
    min: -2, max: 10, step: 0.5, baseline: 2, policy: 4, format: (v) => `${v > 0 ? '+' : ''}${v}%`,
    blurb: 'Annual real-terms growth in the high-needs block that funds SEND provision.',
    evidence: 'High-needs spend ~£12bn (2025-26); the accumulated DSG deficit (>£3bn) is forecast to exceed £8bn by 2028 without reform — when the statutory override ends (March 2028), risking mass council insolvency.',
    source: 'IFS Green Budget 2025 ch.5; County Councils Network', url: 'https://ifs.org.uk/publications/annual-report-education-spending-england-2025-26',
    confidence: 'high', policyRef: 'High-needs block / DSG statutory override',
  },
  // ----------------------------- WORKFORCE -----------------------------
  {
    id: 'teachers', group: 'workforce', label: 'Additional teachers', unit: 'k/yr',
    min: 0, max: 8, step: 0.25, baseline: 1.0, policy: 1.6, format: (v) => `${v.toFixed(2)}k`,
    blurb: 'Net additional teachers recruited & retained each year (toward the 6,500 pledge: secondary, special, FE).',
    evidence: 'Teacher quality/supply is the strongest, best-evidenced attainment channel: a 1 SD rise in teacher value-added ≈ +0.10–0.20 SD in pupil scores. ~32% of teachers leave within 5 years, so retention is the binding constraint.',
    source: 'NFER 2025; Chetty/Hanushek; DfE delivery plan', url: 'https://www.nfer.ac.uk/publications/teacher-labour-market-in-england-annual-report-2025/',
    confidence: 'medium', policyRef: '6,500 expert teachers pledge',
  },
  {
    id: 'teacher_pay', group: 'workforce', label: 'Teacher pay (real growth/yr)', unit: '%/yr',
    min: -2, max: 5, step: 0.25, baseline: 0.5, policy: 1.0, format: (v) => `${v > 0 ? '+' : ''}${v}%`,
    blurb: 'Real-terms pay growth above the baseline settlement — the lever on recruitment and retention.',
    evidence: 'Experienced-teacher real pay is ~9% below 2010 and 15pp behind average earnings growth; relative pay vs the graduate labour market drives entry and exit (Dolton–van der Klaauw).',
    source: 'NFER 2025; STRB', url: 'https://www.nfer.ac.uk/publications/teacher-labour-market-in-england-annual-report-2025/',
    confidence: 'medium', policyRef: 'STRB pay awards',
  },
  {
    id: 'bursaries', group: 'workforce', label: 'Shortage-subject bursaries', unit: 'index',
    min: 0, max: 100, step: 5, baseline: 70, policy: 100,
    blurb: 'Trainee bursaries for shortage subjects (physics, computing, MFL, maths).',
    evidence: 'A +£5,000 bursary ⇒ ~+15% trainees in that subject — the most cost-effective recruitment lever. Secondary ITT was at 62% of target (2024/25); physics 31%.',
    source: 'NFER 2025', url: 'https://www.nfer.ac.uk/publications/teacher-labour-market-in-england-annual-report-2025/',
    confidence: 'high', policyRef: 'ITT bursaries',
  },
  // ----------------------------- STANDARDS -----------------------------
  {
    id: 'curriculum', group: 'standards', label: 'Curriculum & assessment reform', unit: '%',
    min: 0, max: 100, step: 5, baseline: 0, policy: 100,
    blurb: 'Implementation of the Francis Review: revised curriculum (2028), Progress 8 reform, oracy, reading fluency.',
    evidence: 'Un-evaluated — the effect could be slightly negative to modestly positive. Reading-CPD analogues suggest +2 to +5 months; the new curriculum is first taught Sept 2028 so effects arrive late in the window.',
    source: 'Curriculum & Assessment (Francis) Review 2025; EEF', url: 'https://www.gov.uk/government/publications/curriculum-and-assessment-review-final-report',
    confidence: 'assumption', policyRef: 'Curriculum & Assessment Review (2025)',
  },
  {
    id: 'reading', group: 'standards', label: 'Reading & oracy push', unit: '%',
    min: 0, max: 100, step: 5, baseline: 30, policy: 90,
    blurb: 'Reading Ambition / Unlocking Reading CPD, the phonics-90% target and the statutory Year-8 reading test — acting now, unlike the 2028 curriculum refresh.',
    evidence: 'Literacy and oral-language CPD has among the most reliable evidence in the EEF toolkit (+2 to +5 months’ progress), with a short lag — distinct from, and faster than, the un-evaluated 2028 curriculum reform.',
    source: 'EEF literacy/oral-language toolkit; Schools White Paper "Reading Ambition for All"', url: 'https://educationendowmentfoundation.org.uk/education-evidence/teaching-learning-toolkit/oral-language-interventions',
    confidence: 'medium', policyRef: 'Reading Ambition / Year-8 reading test (WP 2026)',
  },
  {
    id: 'rise', group: 'standards', label: 'RISE school-improvement coverage', unit: '%',
    min: 0, max: 100, step: 5, baseline: 20, policy: 100,
    blurb: 'Regional Improvement for Standards & Excellence support to struggling schools (replaces forced academisation).',
    evidence: '639 "stuck" schools / ~292,000 pupils eligible (2025). School-improvement analogues (London Challenge, sponsored academies) suggest ~0.1–0.3 SD for the worst schools, but effects are uncertain at scale.',
    source: 'Schools White Paper 2026; DfE; London Challenge analogue', url: 'https://educationhub.blog.gov.uk/2025/07/rise-teams-everything-you-need-to-know/',
    confidence: 'assumption', policyRef: 'RISE teams (2025)',
  },
  // ----------------------------- ATTENDANCE -----------------------------
  {
    id: 'attendance', group: 'attendance', label: 'Attendance mentor coverage', unit: '%',
    min: 0, max: 100, step: 5, baseline: 10, policy: 100,
    blurb: 'Coverage of attendance mentors / hubs for persistently and severely absent pupils.',
    evidence: 'EPI: the ENTIRE post-2019 widening of the secondary disadvantage gap is explained by higher absence among disadvantaged pupils — making this the single highest-leverage equity lever. Mentor pilots: 45–59% improve (uncontrolled — haircut applied).',
    source: 'EPI 2025; DfE attendance-attainment (Mar 2025)', url: 'https://epi.org.uk/annual-report-2025-disadvantage/',
    confidence: 'medium', policyRef: 'Attendance mentors / hubs; RISE',
  },
  // ----------------------- POST-16, SKILLS & WELLBEING -----------------------
  {
    id: 'post16_skills', group: 'post16', label: 'Post-16, skills & Youth Guarantee', unit: '%',
    min: 0, max: 100, step: 5, baseline: 20, policy: 70,
    blurb: 'Skills England, T/V-levels, foundation apprenticeships and the Youth Guarantee — the bridge from school to work.',
    evidence: 'NEET (16–24) is 13.3% and projected to reach 1.25m without reform (Milburn 2026). The Youth Guarantee (£1.5bn) plus 16–19 funding and qualification reform act on the destination end — lower attainment ⇒ ~2× NEET risk.',
    source: 'Post-16 White Paper (Oct 2025); Milburn interim review 2026; EPI', url: 'https://www.gov.uk/government/publications/post-16-education-and-skills-white-paper/post-16-education-and-skills-white-paper',
    confidence: 'assumption', policyRef: 'Post-16 White Paper / Youth Guarantee',
  },
  {
    id: 'mental_health', group: 'post16', label: 'Youth & school mental-health support', unit: 'index',
    min: 0, max: 100, step: 5, baseline: 25, policy: 60,
    blurb: 'Mental Health Support Teams in schools and youth mental-health provision — addressing the driver behind rising youth inactivity.',
    evidence: 'The Milburn review frames youth economic inactivity as a "generational fault line" driven by mental ill-health and neurodiversity (>40% of disabled NEETs cite mental health). Mental ill-health also drives the rising, sticky tail of severe absence.',
    source: 'Milburn interim review 2026; DfE Mental Health Support Teams', url: 'https://www.fenews.co.uk/fe-voices/milburn-interim-review-warns-of-generational-fault-line-as-neet-numbers-could-hit-1-25-million-without-reform/',
    confidence: 'assumption', policyRef: 'Mental Health Support Teams / Milburn review',
  },
  // ----------------------------- MACRO -----------------------------
  {
    id: 'school_funding', group: 'macro', label: 'Core schools funding (real/yr)', unit: '%/yr',
    min: -3, max: 4, step: 0.25, baseline: 0.4, policy: 0.4, format: (v) => `${v > 0 ? '+' : ''}${v}%`,
    blurb: 'Real-terms growth in core per-pupil schools funding.',
    evidence: 'Per-pupil funding is ≈ its 2010 real-terms level, but mainstream funding has been squeezed by SEND cost growth. The funding→attainment elasticity is weak/near-zero at current spending — money is modelled as acting through teacher inputs, not directly.',
    source: 'IFS Spending Review 2025; Jackson et al.', url: 'https://ifs.org.uk/publications/annual-report-education-spending-england-2025-26',
    confidence: 'high', policyRef: 'Spending Review 2025 / National Funding Formula',
  },
];

export const LEVERS_BY_ID: Record<string, LeverDef> = Object.fromEntries(LEVERS.map((l) => [l.id, l]));

export const GROUP_META: Record<string, { label: string; tag: string; colour: string }> = {
  early:        { label: 'Early years',          tag: 'EY',  colour: '#3f7d6e' },
  disadvantage: { label: 'Disadvantage & poverty', tag: 'DIS', colour: '#b4632e' },
  send:         { label: 'SEND & EHCPs',          tag: 'SEN', colour: '#7a5aa6' },
  workforce:    { label: 'Teacher workforce',     tag: 'WKF', colour: '#2f6f97' },
  standards:    { label: 'Curriculum & standards', tag: 'STD', colour: '#9a7b1f' },
  attendance:   { label: 'Attendance',            tag: 'ATT', colour: '#b1455e' },
  post16:       { label: 'Post-16, skills & wellbeing', tag: 'P16', colour: '#566a8c' },
  macro:        { label: 'School funding',         tag: 'FND', colour: '#5a6b3a' },
};

export const GROUP_ORDER = ['early', 'disadvantage', 'send', 'workforce', 'standards', 'attendance', 'post16', 'macro'];

/** A lever state with every lever at its status-quo baseline. */
export function baselineLevers(): LeverState {
  const s: LeverState = {};
  for (const l of LEVERS) s[l.id] = l.baseline;
  return s;
}

/** A lever state with every lever at its announced-policy value. */
export function policyLevers(): LeverState {
  const s: LeverState = {};
  for (const l of LEVERS) s[l.id] = l.policy;
  return s;
}
