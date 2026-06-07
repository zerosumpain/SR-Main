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
    min: -2, max: 6, step: 0.5, baseline: 2, policy: 4, format: (v) => `${v > 0 ? '+' : ''}${v}%`,
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
    min: -2, max: 3, step: 0.25, baseline: 0.5, policy: 1.0, format: (v) => `${v > 0 ? '+' : ''}${v}%`,
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
  // ------------------ SEND / EHCP IDENTIFICATION BY AGE (costing scale) ------------------
  {
    id: 'aid_ey', group: 'identification', label: 'Early years (0–4)', unit: '%',
    min: 0, max: 100, step: 5, baseline: 25, policy: 40,
    blurb: 'Share of emerging SEND identified & supported in the early years — screening, Best Start Family Hubs, speech & language.',
    evidence: 'Earliest identification is cheapest per child and, with support, prevents later escalation — but the funded-childcare offer reaches few disadvantaged under-5s, so early identification is currently under-resourced.',
    source: 'Best Start Family Hubs; NAO SEND; EEF early years', url: 'https://www.gov.uk/government/news/access-to-early-send-support-through-best-start-family-hubs',
    confidence: 'assumption', policyRef: 'Best Start Family Hubs / early SEND identification',
  },
  {
    id: 'aid_primary', group: 'identification', label: 'Primary (5–10)', unit: '%',
    min: 0, max: 100, step: 5, baseline: 55, policy: 60,
    blurb: 'SEND identification & support intensity across primary school — SEN support and the bulk of EHCP assessment demand.',
    evidence: 'EHCP demand concentrates in primary/early-secondary; ~65% of assessment requests are agreed and the 20-week timescale is met for under half (capacity-constrained).',
    source: 'DfE EES (EHC plans); IFS Green Budget ch.5', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/education-health-and-care-plans/2025',
    confidence: 'assumption', policyRef: 'SEN support / EHCP assessment',
  },
  {
    id: 'aid_secondary', group: 'identification', label: 'Secondary (11–15)', unit: '%',
    min: 0, max: 100, step: 5, baseline: 60, policy: 60,
    blurb: 'Identification & support across secondary — higher share of complex needs and EHCP placements, costlier per child.',
    evidence: 'Secondary carries the highest share of complex/SEMH needs and special-school/independent placements (≈£24k–£61.5k/place); late identification is the most expensive route.',
    source: 'IFS — Spending on SEN; EES suspensions/exclusions', url: 'https://ifs.org.uk/sites/default/files/2024-12/Spending-on-special-educational-needs-in-England.pdf',
    confidence: 'assumption', policyRef: 'Secondary SEND / EHCP placements',
  },
  {
    id: 'aid_post16', group: 'identification', label: 'Post-16 (16–25)', unit: '%',
    min: 0, max: 100, step: 5, baseline: 35, policy: 40,
    blurb: 'Continued EHCP support to age 25, FE/supported-internship transitions and re-assessment.',
    evidence: 'EHCPs run to 25; ~14% of plan-holders are in FE and transitions are a weak point — only 78.6% of SEN pupils sustain an education destination vs 87.1% of peers.',
    source: 'DfE EES (EHC plans, KS4 destinations)', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/education-health-and-care-plans/2025',
    confidence: 'assumption', policyRef: 'Post-16 EHCP continuation & transitions',
  },
  // ------------------- WIDER DETERMINANTS & SERVICES -------------------
  {
    id: 'send_pipeline', group: 'indirect', label: 'SEND specialist capacity (EP/SALT/OT)', unit: 'index',
    min: 0, max: 100, step: 5, baseline: 30, policy: 70,
    blurb: 'Educational-psychologist, speech-&-language and OT capacity — the clinical throttle that decides whether identified SEND is met or escalates.',
    evidence: 'EP provision ranges from 1-per-480 to 1-per-9,400 pupils; 79% of NHS children’s speech-&-language services report insufficient staff. A supply-side capacity constraint analogous to the teacher workforce, but for specialists.',
    source: 'NAO; BPS; RCSLT', url: 'https://www.nao.org.uk/press-releases/special-educational-needs-system-is-financially-unsustainable/',
    confidence: 'assumption', policyRef: 'EP / SALT / OT specialist capacity',
  },
  {
    id: 'camhs', group: 'indirect', label: 'CAMHS / mental-health access', unit: 'index',
    min: 0, max: 100, step: 5, baseline: 30, policy: 60,
    blurb: 'NHS child & adolescent mental-health service capacity — gates how much unmet mental-health need turns into chronic absence and SEMH-EHCP demand.',
    evidence: '385,540 children were waiting for a first CAMHS contact (Mar 2025, +14% YoY); ~26% of referrals are rejected. Unmet need drives emotionally-based school avoidance. The mental-health→attainment link is SES-confounded, so the model routes it via absence, not as a new outcome.',
    source: 'BMA; NHS Digital', url: 'https://www.bma.org.uk/advice-and-support/nhs-delivery-and-workforce/pressures/children-and-young-people-s-mental-health-services-in-england',
    confidence: 'assumption', policyRef: 'NHS CAMHS access & waiting times',
  },
  {
    id: 'eal_support', group: 'indirect', label: 'EAL / new-arrival catch-up', unit: 'index',
    min: 0, max: 100, step: 5, baseline: 30, policy: 60,
    blurb: 'Language and curriculum-access support for English-as-an-additional-language and recent arrivals — a direct attainment channel that bypasses absence.',
    evidence: 'Late-arriving EAL pupils are ~10 months behind at GCSE and unaccompanied asylum-seekers ~37 months — yet fluent, on-time EAL pupils overtake English-first peers by KS4. Catch-up depends on arrival age and time-in-system; EAL is not a monolithic deficit.',
    source: 'EPI Annual Report 2025 (EAL)', url: 'https://epi.org.uk/annual-report-2025-eal/',
    confidence: 'medium', policyRef: 'EAL / new-arrivals support',
  },
  {
    id: 'care_support', group: 'indirect', label: 'Care-experienced support (virtual schools / PP+)', unit: 'index',
    min: 0, max: 100, step: 5, baseline: 40, policy: 70,
    blurb: 'Support for looked-after, child-in-need and kinship-care pupils — a high-risk stratum largely invisible to FSM flags that hits every mediator at once.',
    evidence: 'Looked-after children are ~29 months behind at GCSE (Attainment 8 ~26 vs ~46) and ~38–40% are NEET vs ~13–15% (≈3.5×). Virtual schools and Pupil Premium Plus target this tail.',
    source: 'EPI; DfE EES (children in need / looked-after)', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/outcomes-for-children-in-need-including-children-looked-after-by-local-authorities-in-england/2024',
    confidence: 'medium', policyRef: 'Virtual schools / Pupil Premium Plus',
  },
  {
    id: 'behaviour_support', group: 'indirect', label: 'Inclusion & behaviour support', unit: 'index',
    min: 0, max: 100, step: 5, baseline: 30, policy: 60,
    blurb: 'Reduces exclusions and off-rolling that funnel pupils into alternative provision and toward NEET.',
    evidence: '~15% of excluded pupils are NEET for 2+ years vs 3% of never-excluded; SEND pupils are ~half of all suspensions. Off-rolling also flatters headline attainment via survivorship. (DfE NEET-persistence figures used; the IPPR lifetime-cost numbers are contested.)',
    source: 'DfE EES (suspensions & exclusions; destinations)', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/suspensions-and-permanent-exclusions-in-england/2023-24',
    confidence: 'assumption', policyRef: 'Exclusions / alternative provision / inclusion',
  },
  {
    id: 'place_investment', group: 'indirect', label: 'Place-based investment (cold spots)', unit: 'index',
    min: 0, max: 100, step: 5, baseline: 20, policy: 60,
    blurb: 'Regeneration and improvement in “left-behind”, coastal and cold-spot areas (Mission North East / Coastal) — a residual two equally-poor areas do not share.',
    evidence: 'Equally-deprived “left-behind” areas score 20.1% vs 27.6% (a ~7.5pp penalty independent of the poverty rate); disadvantaged coastal pupils score ~3 GCSE grades lower. The North-East’s gap ranking decays between age 5 and 16.',
    source: 'Local Trust; EPI', url: 'https://localtrust.org.uk/evidence-insights/left-behind-neighbourhoods/',
    confidence: 'assumption', policyRef: 'Mission North East / Coastal; place-based investment',
  },
  {
    id: 'mission_ne', group: 'indirect', label: 'Mission North East', unit: '%',
    min: 0, max: 100, step: 5, baseline: 0, policy: 50,
    blurb: 'The 2026 place-based programme for the North East: expert-practitioner support to raise teaching quality plus out-of-school mentoring, careers and enrichment — modelled on the London Challenge.',
    evidence: 'Real programme (Schools White Paper, Feb 2026; launches Sept 2026). Targets the lowest Attainment 8 of any region (43.7) and the "North East puzzle" — a small KS2 gap (9.5mo) that widens to 21.6mo by KS4. No budget has been published, and place-based attainment evidence is weak (Opportunity Areas were process-only; one OA gap even widened), so the modelled regional closure is deliberately small, slow and capped.',
    source: 'DfE Schools White Paper 2026; EPI/Durham/NECA North East report (2025)', url: 'https://www.gov.uk/government/news/new-missions-to-transform-childhoods-of-most-disadvantaged',
    confidence: 'assumption', policyRef: 'Mission North East (DfE, Sept 2026)',
  },
  {
    id: 'mission_coastal', group: 'indirect', label: 'Mission Coastal', unit: '%',
    min: 0, max: 100, step: 5, baseline: 0, policy: 50,
    blurb: 'The 2026 place-based programme for coastal/seaside communities (initially Hastings & Scarborough, widening over time) — a London-Challenge-style school-improvement partnership.',
    evidence: 'Real programme (Schools White Paper, Feb 2026; launches Sept 2026). Disadvantaged coastal pupils are ~3 GCSE grades behind non-coastal peers (DfE 2019); disadvantaged pupils in Hastings average ~26 Attainment 8. Coastal underperformance is hidden when merged with wealthier inland averages (CMO 2021). No budget published; the modelled closure of the coastal penalty is small, slow and capped.',
    source: 'DfE Schools White Paper 2026; CMO "Health in Coastal Communities" (2021); DfE 2019', url: 'https://www.gov.uk/government/news/new-missions-to-transform-childhoods-of-most-disadvantaged',
    confidence: 'assumption', policyRef: 'Mission Coastal (DfE, Sept 2026)',
  },
  {
    id: 'tutoring', group: 'indirect', label: 'Catch-up tutoring', unit: 'index',
    min: 0, max: 100, step: 5, baseline: 30, policy: 50,
    blurb: 'Targeted small-group / one-to-one tutoring for disadvantaged pupils (National Tutoring Programme-style) — also the lever for residual COVID learning-loss recovery.',
    evidence: 'EEF: small-group tuition ≈ +4 months’ progress; one-to-one ≈ +5 months. Targeted at disadvantaged pupils, so it narrows the gap rather than just lifting the level.',
    source: 'EEF Toolkit; National Tutoring Programme', url: 'https://educationendowmentfoundation.org.uk/education-evidence/teaching-learning-toolkit/small-group-tuition',
    confidence: 'medium', policyRef: 'National Tutoring Programme / catch-up',
  },
  {
    id: 'housing_instability', group: 'indirect', label: 'Housing instability', unit: 'index',
    min: 0, max: 100, step: 5, baseline: 40, policy: 40,
    blurb: 'Temporary accommodation, overcrowding, damp/cold homes and frequent moves — an exogenous context (not an education-budget lever). Higher = worse; lower to explore improvement.',
    evidence: 'Children in poor-quality housing at age 7 missed 15.5 more school days across Years 1–11 and scored 2–5% lower in English & maths (UCL / Millennium Cohort 2025); 2+ school moves roughly double the odds of poorer early outcomes. Acts mainly through disadvantaged absence.',
    source: 'UCL / Millennium Cohort Study (Baranyi et al. 2025)', url: 'https://www.ucl.ac.uk/news/2025/dec/children-poor-quality-housing-miss-more-school',
    confidence: 'medium', policyRef: 'Housing instability (exogenous context)',
  },
  // ----------------------------- MACRO -----------------------------
  {
    id: 'school_funding', group: 'macro', label: 'Core schools funding (real/yr)', unit: '%/yr',
    min: -3, max: 2.5, step: 0.25, baseline: 0.4, policy: 0.4, format: (v) => `${v > 0 ? '+' : ''}${v}%`,
    blurb: 'Real-terms growth in core per-pupil schools funding.',
    evidence: 'Per-pupil funding is ≈ its 2010 real-terms level, but mainstream funding has been squeezed by SEND cost growth. The funding→attainment elasticity is weak/near-zero at current spending — money is modelled as acting through teacher inputs, not directly.',
    source: 'IFS Spending Review 2025; Jackson et al.', url: 'https://ifs.org.uk/publications/annual-report-education-spending-england-2025-26',
    confidence: 'high', policyRef: 'Spending Review 2025 / National Funding Formula',
  },
];

export const LEVERS_BY_ID: Record<string, LeverDef> = Object.fromEntries(LEVERS.map((l) => [l.id, l]));

// ---------------------------------------------------------------------------
// Per-lever model metadata: which outcomes a lever DRIVES (so the UI can show it isn't inert
// just because it doesn't move the headline gap), and a one-line "why it behaves this way in the
// model" note. Complements each lever's blurb (what it is) and evidence (what the research says).
// ---------------------------------------------------------------------------
export type DriveTag = 'gap' | 'attainment' | 'absence' | 'neet' | 'poverty' | 'send' | 'capacity' | 'cost';
export const DRIVE_LABEL: Record<DriveTag, string> = {
  gap: 'Disadvantage gap', attainment: 'Attainment', absence: 'Absence', neet: 'NEET',
  poverty: 'Child poverty', send: 'SEND system', capacity: 'Teacher capacity', cost: 'Cost only',
};
export interface LeverMeta { drives: DriveTag[]; modelNote: string; }
const AGEID_NOTE = 'Part of the SEND identification-by-age costing scale — front-loading to earlier ages is cheaper per child and mildly improves SEND outcomes.';
export const LEVER_META: Record<string, LeverMeta> = {
  ey_quality:     { drives: ['gap', 'attainment'], modelNote: 'Acts fast on the age-5 gap but reaches GCSE only after the cohort ages (~11-year lag) with partial fade-out — a large but late KS4 effect.' },
  ey_access:      { drives: ['gap', 'attainment'], modelNote: 'A quantity lever: funds the +3-month access effect, gated by how many disadvantaged under-5s actually take up the offer; slow KS4 payoff via the cohort lag.' },
  eypp:           { drives: ['gap', 'attainment'], modelNote: 'Per-child early disadvantage funding; small near-term, compounding into the age-5 and (lagged) KS4 gap.' },
  pupil_premium:  { drives: ['gap'], modelNote: 'Modelled as a weak, quality-moderated offset — there is NO robust £→gap elasticity, so large spend moves the gap only a little (wide uncertainty).' },
  fsm:            { drives: ['poverty', 'gap'], modelNote: 'Lifts children out of poverty and widens the Pupil-Premium net; the gap effect is small and indirect (via poverty and attendance).' },
  breakfast:      { drives: ['absence', 'attainment', 'gap'], modelNote: 'Acts on attendance and KS1 attainment; the KS2 effect is null after re-analysis, so the model keeps it modest.' },
  poverty_action: { drives: ['poverty', 'gap'], modelNote: 'Exogenous to schools but a powerful upstream driver — income acts on the gap mainly through the home-learning environment and attendance, so it is lagged.' },
  inclusion_fund: { drives: ['send'], modelNote: 'Bends EHCP demand and lifts SEND attainment / cuts tribunals. Ring-fenced, so it is NOT charged to the high-needs deficit; little direct effect on the headline gap.' },
  send_early:     { drives: ['send'], modelNote: 'Identification-vs-prevention tension: raises plan demand short-run before reducing it long-run.' },
  ehcp_reform:    { drives: ['send'], modelNote: 'Double-edged — cuts the deficit by diverting plans from 2030, but WITHOUT matching inclusion it lowers SEND attainment and raises tribunals.' },
  high_needs:     { drives: ['send'], modelNote: 'Acts on the SEND high-needs DEFICIT, not the headline gap/attainment — it decides whether the March-2028 funding cliff is averted.' },
  teachers:       { drives: ['capacity', 'attainment', 'gap'], modelNote: 'The strongest, best-evidenced attainment channel; the effect caps once the system is fully staffed.' },
  teacher_pay:    { drives: ['capacity', 'attainment'], modelNote: 'Acts INDIRECTLY via recruitment & retention → teacher capacity → attainment; a blunt, expensive route that caps at full staffing.' },
  bursaries:      { drives: ['capacity', 'attainment'], modelNote: 'Shortage-subject recruitment → capacity; the most cost-effective workforce lever per £.' },
  curriculum:     { drives: ['attainment'], modelNote: 'Un-evaluated and gated to first teaching in 2028, so its (uncertain, possibly ±) effect arrives late in the window.' },
  reading:        { drives: ['attainment', 'gap'], modelNote: 'A reliable, fast literacy-CPD effect — acts now, unlike the 2028 curriculum refresh.' },
  rise:           { drives: ['attainment', 'gap'], modelNote: 'Targets stuck (disadvantage-skewed) schools; uncertain at scale.' },
  attendance:     { drives: ['absence', 'gap', 'attainment'], modelNote: 'The single highest-leverage gap lever — EPI attributes the entire post-2019 widening to disadvantaged absence, which this cuts directly.' },
  post16_skills:  { drives: ['neet'], modelNote: 'Acts on the post-16 destination boundary (NEET), not school-age attainment.' },
  mental_health:  { drives: ['neet', 'absence'], modelNote: 'Cuts NEET and the rising tail of severe absence — the Milburn "generational fault line".' },
  aid_ey:         { drives: ['send', 'cost'], modelNote: AGEID_NOTE },
  aid_primary:    { drives: ['send', 'cost'], modelNote: AGEID_NOTE },
  aid_secondary:  { drives: ['send', 'cost'], modelNote: AGEID_NOTE },
  aid_post16:     { drives: ['send', 'cost'], modelNote: AGEID_NOTE },
  send_pipeline:  { drives: ['send', 'absence'], modelNote: 'Specialist capacity (EP/SALT/OT) — the clinical throttle that decides whether identified SEND is met (better attendance, fewer tribunals) or escalates.' },
  camhs:          { drives: ['neet', 'absence', 'send'], modelNote: 'NHS mental-health access gates how much unmet need turns into chronic absence and SEMH-driven EHCP demand; routed via absence, not as a new outcome.' },
  eal_support:    { drives: ['attainment'], modelNote: 'A direct attainment channel that bypasses absence (language & curriculum access).' },
  care_support:   { drives: ['neet', 'send'], modelNote: 'Targets a high-risk stratum (looked-after / kinship) largely invisible to FSM flags — mainly cuts NEET and lifts vulnerable-pupil attainment.' },
  behaviour_support: { drives: ['neet', 'absence'], modelNote: 'Cuts the exclusion → alternative-provision → NEET pipeline.' },
  place_investment: { drives: ['gap', 'neet'], modelNote: 'Closes the cold-spot residual two equally-poor areas don’t share; the Regions page concentrates it in the worst regions (small, slow — weak evidence).' },
  tutoring:       { drives: ['gap'], modelNote: 'Disadvantage-targeted catch-up — narrows the gap rather than just lifting the level.' },
  housing_instability: { drives: ['absence', 'gap'], modelNote: 'An EXOGENOUS context slider (higher = worse), acting mainly through disadvantaged absence — not an education-budget lever.' },
  mission_ne:     { drives: ['gap'], modelNote: 'Acts mostly REGIONALLY (see the Regions page) — closes the North East’s penalty; the national effect is small because it touches ~4.6% of pupils.' },
  mission_coastal:{ drives: ['gap'], modelNote: 'Acts mostly REGIONALLY — closes the coastal cross-cut penalty; small national effect.' },
  school_funding: { drives: ['capacity', 'attainment'], modelNote: 'Money acts THROUGH teacher capacity, never directly (the £→attainment elasticity is ~0), so funding buys staff & retention which buys attainment — a blunt, expensive route that caps at full staffing.' },
};

export const GROUP_META: Record<string, { label: string; eli5: string; tag: string; colour: string }> = {
  early:        { label: 'Early years',          eli5: 'Under-5s',                 tag: 'EY',  colour: '#3f7d6e' },
  disadvantage: { label: 'Disadvantage & poverty', eli5: 'Poverty & poorer pupils', tag: 'DIS', colour: '#b4632e' },
  send:         { label: 'SEND & EHCPs',          eli5: 'Special needs',            tag: 'SEN', colour: '#7a5aa6' },
  workforce:    { label: 'Teacher workforce',     eli5: 'Teachers',                 tag: 'WKF', colour: '#2f6f97' },
  standards:    { label: 'Curriculum & standards', eli5: 'Lessons & standards',     tag: 'STD', colour: '#9a7b1f' },
  attendance:   { label: 'Attendance',            eli5: 'Going to school',          tag: 'ATT', colour: '#b1455e' },
  post16:       { label: 'Post-16, skills & wellbeing', eli5: 'After-16 & wellbeing', tag: 'P16', colour: '#566a8c' },
  identification: { label: 'SEND identification by age', eli5: 'Spotting special needs by age', tag: 'ID', colour: '#7a5aa6' },
  indirect:     { label: 'Wider determinants & services', eli5: 'Other services that help', tag: 'WDR', colour: '#4a7c7c' },
  macro:        { label: 'School funding',         eli5: 'School money',             tag: 'FND', colour: '#5a6b3a' },
};

/** Plain-English ("ELI5") lever names. */
export const LEVER_ELI5_NAME: Record<string, string> = {
  ey_quality: 'Better nurseries & early education', ey_access: 'Getting poorer toddlers into nursery', eypp: 'Extra money for poorer under-5s',
  pupil_premium: 'Extra money per poorer pupil', fsm: 'Free school meals', breakfast: 'Free breakfast clubs', poverty_action: 'Tackling child poverty',
  inclusion_fund: 'Special-needs help in normal schools', send_early: 'Spotting special needs early', ehcp_reform: 'Changing special-needs plans', high_needs: 'Special-needs budget growth',
  teachers: 'More teachers', teacher_pay: 'Teacher pay rises', bursaries: 'Cash to train scarce-subject teachers',
  curriculum: 'New curriculum & exams', reading: 'Reading & speaking push', rise: 'Help for struggling schools',
  attendance: 'Attendance mentors', post16_skills: 'Skills & jobs for school-leavers', mental_health: 'Youth mental-health support',
  aid_ey: 'Under-5s (0–4)', aid_primary: 'Primary (5–10)', aid_secondary: 'Secondary (11–15)', aid_post16: 'After 16 (16–25)',
  send_pipeline: 'Special-needs specialists (psychologists, therapists)', camhs: 'NHS mental-health for children', eal_support: 'Help for children learning English',
  care_support: 'Help for children in care', behaviour_support: 'Behaviour support & fewer exclusions', place_investment: 'Investment in left-behind areas',
  tutoring: 'Catch-up tutoring', housing_instability: 'Bad / unstable housing', mission_ne: 'Mission North East', mission_coastal: 'Mission Coastal',
  school_funding: 'Overall school funding',
};

// 'identification' is deliberately excluded — it is rendered by its own AgeIdentification panel.
export const GROUP_ORDER = ['early', 'disadvantage', 'send', 'workforce', 'standards', 'attendance', 'post16', 'indirect', 'macro'];

/** Age-band metadata for the SEND/EHCP identification costing scale (high-level estimates). */
export interface AgeBand { leverId: string; age: string; pop: number; unit: number; note: string; }
export const AGE_BANDS: AgeBand[] = [
  { leverId: 'aid_ey',        age: 'Early years (0–4)', pop: 3.3, unit: 1500, note: 'screening, Family Hubs, early speech & language support' },
  { leverId: 'aid_primary',   age: 'Primary (5–10)',    pop: 4.7, unit: 2600, note: 'SEN support + the bulk of EHCP assessments' },
  { leverId: 'aid_secondary', age: 'Secondary (11–15)', pop: 3.3, unit: 3600, note: 'higher complex-need / placement share — costliest to identify late' },
  { leverId: 'aid_post16',    age: 'Post-16 (16–25)',   pop: 2.6, unit: 3100, note: 'continued EHCP to 25, FE & supported-internship transitions' },
];

/** High-level annual identification + early-support cost for one age band, £bn.
 *  cost = age-band population (m) × SEND prevalence × intensity × unit-cost-per-child. */
export function ageBandCostBn(band: AgeBand, intensityPct: number, prevalence: number): number {
  return (band.pop * prevalence * (intensityPct / 100) * band.unit) / 1000;
}

/** Total / baseline / additional ("stretch") identification cost across all age bands, £bn. */
export function ageIdTotals(levers: LeverState, prevalence: number): { total: number; baseline: number; additional: number } {
  let total = 0, baseline = 0;
  for (const band of AGE_BANDS) {
    const L = LEVERS_BY_ID[band.leverId];
    total += ageBandCostBn(band, levers[band.leverId] ?? L.baseline, prevalence);
    baseline += ageBandCostBn(band, L.baseline, prevalence);
  }
  return { total, baseline, additional: total - baseline };
}

/** A [0,1] index of how FRONT-LOADED the identification profile is vs baseline (early-years +
 *  primary share of total identification effort). Drives the light early-intervention effect. */
export function earlyIdShift(levers: LeverState): number {
  const v = (id: string) => levers[id] ?? LEVERS_BY_ID[id].baseline;
  const share = (s: Record<string, number>) => (s.aid_ey + s.aid_primary) / Math.max(1e-6, s.aid_ey + s.aid_primary + s.aid_secondary + s.aid_post16);
  const now = share({ aid_ey: v('aid_ey'), aid_primary: v('aid_primary'), aid_secondary: v('aid_secondary'), aid_post16: v('aid_post16') });
  const base = share({ aid_ey: 25, aid_primary: 55, aid_secondary: 60, aid_post16: 35 });
  return Math.max(0, Math.min(1, (now - base) / 0.25));
}

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
