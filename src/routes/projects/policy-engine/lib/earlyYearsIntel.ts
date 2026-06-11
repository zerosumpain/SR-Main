// earlyYearsIntel.ts — the data dossier for the Early Years (0-5) Field Study. The model's
// own self-identified blind spot: it acts on 0-5 through levers but first MEASURES a child at
// age 5. This study opens the front door — what England does in the 0-5 period, what the
// evidence says works, what could be improved, and the role for data and monitoring. Each card
// carries a research + eli5 pair. Strictly neutral and sourced. Self-contained.
//
// Figures current to mid-2026; primary sources cited. Estimates/contested points are flagged.

export interface SourcedCard {
  key: string;
  title: string;
  research: string;
  eli5: string;
  source?: string;
  url?: string;
  flag?: 'estimate' | 'contested';
}

// ---------------------------------------------------------------------------
// 1 — What we do now: the four overlapping funded entitlements
// ---------------------------------------------------------------------------
export interface Entitlement {
  label: string; hours: string; who: string; status: string; equity: string;
}
export const ENTITLEMENTS: Entitlement[] = [
  { label: 'Universal 3–4yo', hours: '15h/wk', who: 'all 3–4-year-olds', status: 'long-standing',
    equity: 'Universal — the one entitlement that reaches every child regardless of income.' },
  { label: '2-year-old offer (FRAS)', hours: '15h/wk', who: '2-year-olds in families on qualifying benefits / low income / certain SEN / looked-after', status: 'long-standing',
    equity: 'The equity entitlement. Take-up fell to 65.2% in 2025 (from 74.8% in 2024) — though DfE flags the 2025 figure may be understated by recording errors.' },
  { label: 'Working-parent 9mo–2yo', hours: '30h/wk', who: 'working parents meeting an income test', status: 'fully live from Sep 2025',
    equity: 'Work-conditional: each parent must earn ≥~£10,158/yr and <£100,000. By design this excludes non-working and very-low-earning families.' },
  { label: 'Working-parent extended 3–4yo', hours: '+15h (30h total)', who: 'working parents meeting the income test', status: 'long-standing',
    equity: 'Same work-conditional test — the largest entitlements are the ones the poorest children are least likely to qualify for.' },
];

// ---------------------------------------------------------------------------
// 2 — Headline numbers (the dashboard for 0-5)
// ---------------------------------------------------------------------------
export interface KeyStat { key: string; value: string; label: string; note: string; color: string; }
export const KEY_STATS: KeyStat[] = [
  { key: 'gld', value: '68.3%', label: 'reach a Good Level of Development at 5', note: 'EYFSP 2024/25; the Best Start target is 75% by 2028', color: '#3f7d6e' },
  { key: 'gap', value: '21.3pp', label: 'FSM gap in GLD at age 5', note: 'FSM ~52% vs non-FSM ~71% (2024/25); the gap widened year-on-year', color: '#b4632e' },
  { key: 'gapmo', value: '~4.7mo', label: 'disadvantage gap at 5 (EPI months)', note: '~40% of the eventual age-16 gap is already present by age 5 (EPI)', color: '#b1455e' },
  { key: 'eypp', value: '£655', label: 'Early Years Pupil Premium / yr (2026-27)', note: '≈40% of the ~£1,515 school Pupil Premium — least funding at the highest-return age', color: '#7a5aa6' },
  { key: 'hv', value: '−43%', label: 'fall in health visitors since 2015', note: '~11,192 (2015) → ~6,300 (Dec 2024); the binding constraint on the 0-5 check', color: '#9a6b2e' },
];

// ---------------------------------------------------------------------------
// 3 — What the evidence says works
// ---------------------------------------------------------------------------
export const WHAT_WORKS: SourcedCard[] = [
  { key: 'eppe', title: 'EPPE / EPPSE — quality and duration, lasting effects',
    research: 'The foundational UK longitudinal study (~3,000 children, age 3 → post-16) finds high-quality pre-school confers positive, enduring benefits detectable to age 14 and at GCSE. Both quality and duration matter, and disadvantaged children benefit most from high-quality settings. The authors caution that no single influence fully overcomes disadvantage.',
    eli5: 'A big long-term British study followed children from age 3 into their teens. Good nurseries gave a lasting boost — biggest for poorer children — but no nursery on its own cancels out a tough start.',
    source: 'DfE / Sylva, Sammons et al., EPPSE 3-16+', url: 'https://assets.publishing.service.gov.uk/media/5a803cb240f0b62305b89fbf/RB455_Effective_pre-school_primary_and_secondary_education_project.pdf.pdf' },
  { key: 'eef', title: 'EEF Early Years Toolkit — the best-evidenced strands',
    research: 'Communication & language approaches are associated with about +7 months of progress (among the best-evidenced), early literacy with +4 (up to +6) months, and parental engagement with +5 months. The "months" are effect-size translations with attached evidence-security ratings, not precise causal guarantees.',
    eli5: 'The clearest wins in the early years are talking, reading and getting parents involved — worth several months of extra progress each.',
    source: 'Education Endowment Foundation, Early Years Toolkit', url: 'https://educationendowmentfoundation.org.uk/education-evidence/early-years-toolkit/communication-and-language-approaches' },
  { key: 'heckman', title: 'The Heckman curve — returns are highest earliest',
    research: 'The rate of return to human-capital investment is highest in the earliest years and declines with age; Heckman estimates ~13% per-annum ROI for high-quality birth-to-5 programmes for disadvantaged children. The figure derives from small, intensive 1970s US RCTs, so its external validity to a universal England offer is debated — a direction-and-magnitude anchor, not a transplantable coefficient.',
    eli5: 'Money spent helping very young children tends to pay back more than the same money spent later. The exact "13% return" comes from small old American trials, so treat it as a strong steer, not a precise promise.',
    source: 'Heckman et al., The Heckman Equation', url: 'https://heckmanequation.org/resource/the-heckman-curve/', flag: 'estimate' },
  { key: 'hle', title: 'The home learning environment is the dominant early driver',
    research: 'EPPE/EPPSE and EPI consistently find the home learning environment — engagement in learning activities, quality of parent–child interaction, access to resources — predicts early development over and above parental income, education and socio-economic status. This is the mechanism Best Start\'s parenting/HLE interventions target.',
    eli5: 'What happens at home — talking, reading together, play — matters more for early development than income alone. It is the single strongest early lever.',
    source: 'EPI, The importance of the home learning environment', url: 'https://epi.org.uk/publications-and-research/the-importance-of-supporting-the-home-learning-environment-in-the-early-years/' },
];

// ---------------------------------------------------------------------------
// 4 — What could be improved (stated as evaluable observations, not recommendations)
// ---------------------------------------------------------------------------
export const IMPROVE: SourcedCard[] = [
  { key: 'paradox', title: 'The investment paradox: most spend where the gap forms least',
    research: 'The largest new spending — the 30-hour working-parent offer — is structured so the poorest third of families benefit least: only ~20% of bottom-third earners qualify at 3–4, vs ~80% of those over £45,000. IFS estimates ~five-sixths of the new-entitlement spend is deadweight. Meanwhile the highest-return window (0-5) carries the smallest per-child targeted funding (EYPP ~£655 vs school Pupil Premium ~£1,515).',
    eli5: 'The biggest new childcare money mostly helps better-off working parents, while the years where it would do most good for poorer children get the least targeted funding.',
    source: 'IFS; Sutton Trust, A Fair Start?', url: 'https://www.suttontrust.com/our-research/a-fair-start-equalising-access-to-early-education/' },
  { key: 'eypp-step', title: 'The EYPP step',
    research: 'The Early Years Pupil Premium rose to ~£570/yr (2025-26) and ~£655/yr (2026-27), but remains roughly 40% of the school Pupil Premium per head — a smaller per-child investment at the age where the evidence points to the highest return.',
    eli5: 'Poorer under-5s attract about 40p of extra funding for every £1 a poorer school-age child gets — the opposite of where the evidence says the money works hardest.',
    source: 'IFS; NDNA', url: 'https://ifs.org.uk/articles/childcare-funding-rates-largely-protected-real-terms-big-uplift-disadvantage-premium' },
  { key: 'hv', title: 'The health-visitor workforce',
    research: 'Health visitors in England fell ~43% between 2015 and 2024 (~11,192 → ~6,300), with caseloads above the recommended ≤250 children in roughly three-quarters of local authorities. This is the workforce reality beneath the headline 93.3% ASQ-3 coverage at the 2–2½-year review; quality of the check varies from professional judgement to a parent-reported tick-list.',
    eli5: 'There are far fewer health visitors than a decade ago, so the age-2 development check — when it happens at all — is often rushed or done by questionnaire rather than a trained professional.',
    source: 'UCL (Mar 2026); Institute of Health Visiting', url: 'https://www.ucl.ac.uk/news/2026/mar/number-health-visitors-england-falls-fifth-over-five-years' },
  { key: 'takeup', title: 'Disadvantaged take-up of the 2-year-old offer',
    research: 'Take-up of the disadvantaged 2-year-old (FRAS) entitlement was recorded at 65.2% in 2025 (95,000 of ~145,700 eligible), down from 74.8% in 2024 — though DfE warns the 2025 figure may be deflated by children being recorded under the wrong funding stream. The equity entitlement reaches the smallest share of those it targets.',
    eli5: 'Only about two-thirds of the poorest two-year-olds who qualify for free childcare actually take it up — the entitlement aimed at them reaches the fewest.',
    source: 'DfE / Explore Education Statistics, 2025', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/funded-early-education-and-childcare/2025', flag: 'contested' },
];

// ---------------------------------------------------------------------------
// 5 — Best Start in Life (the new institutional layer)
// ---------------------------------------------------------------------------
export const BEST_START: SourcedCard = {
  key: 'best-start', title: 'Best Start in Life (2025)',
  research: 'The July 2025 strategy ("Giving Every Child the Best Start in Life"), backed by ~£1.5bn over three years, sets the 75%-GLD-by-2028 milestone and stands up Best Start Family Hubs (~£500m to 2028, new money from April 2026) integrating early help, health visiting and parenting/home-learning support. From the 68.3% (2024/25) base, the 75% target requires ~+7pp in three years — described as a stretch given the widening FSM gap.',
  eli5: 'A 2025 plan with about £1.5bn aims to get 75% of five-year-olds "school-ready" by 2028 and rolls out one-stop family hubs. Getting from 68% to 75% in three years is a big ask while the rich–poor gap is widening.',
  source: 'DfE, Giving Every Child the Best Start in Life', url: 'https://commonslibrary.parliament.uk/research-briefings/cdp-2025-0163/',
};

// ---------------------------------------------------------------------------
// 6 — The data / monitoring picture (the role for data-driven decisions)
// ---------------------------------------------------------------------------
export const DATA_PICTURE: SourcedCard[] = [
  { key: 'gld-idaci', title: 'Age-5 is reasonably well-instrumented by deprivation',
    research: 'GLD/EYFSP outcomes are publishable by FSM and by IDACI deprivation decile via DfE Explore Education Statistics, and DfE released a Best Start GLD data tool with local-authority targets (2025). The education view at age 5 is, by the standards of the rest of the 0-5 estate, comparatively good.',
    eli5: 'Once a child is 5, we can see school-readiness broken down by how poor the area is — the one part of the early-years data picture that is reasonably clear.',
    source: 'DfE / EES, EYFSP', url: 'https://www.gov.uk/guidance/compare-your-good-level-of-development-gld-data' },
  { key: 'health-ed-gap', title: 'The health(0-5) ↔ education(5+) data gap',
    research: 'Pre-school development data (the ASQ-3 at the 2–2½-year review, health-visitor metrics) sits in NHS/OHID systems (CSDS); education data (EYFSP onward) sits in the National Pupil Database. Historically these were not linked, so no routine joined-up readout ran from the perinatal period through age-2 development to age-5 GLD and beyond. This is the same health↔education break that recurs in the SEND and Jigsaw studies.',
    eli5: 'A toddler\'s development is measured by health services; school-readiness by education. The two systems don\'t talk, so nobody routinely follows a child from the baby checks through to school.',
    source: 'medRxiv / UCL (ASQ-3 CSDS analysis)', url: 'https://www.medrxiv.org/content/10.1101/2024.09.28.24314205v1.full' },
  { key: 'echild', title: 'ECHILD and Children of the 2020s make the readout constructible',
    research: 'ECHILD links NHS hospital, state-school and children\'s social-care records for ~20 million children (born 1984–2022; UCL with NHS England + DfE, funded by ADR UK). Children of the 2020s follows ~8,500 children from 9 months to age 5 and is designed to link to administrative records. Together they make a perinatal → age-2 development → age-5 GLD → KS → earnings trajectory technically constructible — but as a research-access capability, not a standing published statistic.',
    eli5: 'Two big data projects already prove you could follow children from birth checks to GCSEs and earnings. The pipeline exists for research — it just isn\'t published as a regular national statistic.',
    source: 'UCL / ADR UK (ECHILD); DfE (Children of the 2020s)', url: 'https://academic.oup.com/ije/article/51/1/17/6425590' },
];

// the cohort funnel reused on this page (illustrative, sourced) — eligibility by income third
export interface EligibilityBand { label: string; share: number; note: string; }
export const ELIGIBILITY: EligibilityBand[] = [
  { label: 'Bottom third of earners', share: 0.20, note: '~20% qualify for the 30-hour 3–4yo entitlement' },
  { label: 'Middle third', share: 0.55, note: 'partial eligibility' },
  { label: 'Top third of earners', share: 0.80, note: '~80% qualify; ~70% of eligible parents are in the top half of earners' },
];
