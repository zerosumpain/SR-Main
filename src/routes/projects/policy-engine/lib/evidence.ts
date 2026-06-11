// evidence.ts — a registry of third-party analyses (think-tanks, institutes, watchdogs,
// academics) that bear on the engine's outcomes. The point of this layer: an analysis can
// SIT ON the shoulders of a live result — "here is what others have found about this number"
// — rather than only calibrating an input. Cross-spectrum BY DESIGN, with an openly-shown
// `lean` tag so the reader can weight the source. Strictly descriptive: each `claim` states
// what the analysis found, not what anyone should do. Self-contained.

export type Lean =
  | 'academic'          // university / peer-reviewed research
  | 'official'          // government watchdog / statutory body (NAO, ONS, Ofsted)
  | 'centre'            // non-aligned / cross-party institute
  | 'centre-left'
  | 'centre-right'
  | 'sector'            // sector / professional body / foundation
  | 'international';     // OECD / cross-national

export interface Analysis {
  id: string;
  org: string;            // short name, e.g. 'EPI'
  orgFull?: string;       // expanded name
  lean: Lean;
  title: string;
  year: number;
  claim: string;          // the concrete, neutral finding
  area: string[];         // 'funding'|'gap'|'send'|'attendance'|'early-years'|'neet'|'regional'|'workforce'|'data'
  themes?: string[];      // theme ids (see themes.ts)
  levers?: string[];      // lever ids it speaks to
  outcomes?: string[];    // YearResult outcome ids it bears on
  strength: 'strong' | 'moderate' | 'contested' | 'illustrative';
  url?: string;
}

export const LEAN_META: Record<Lean, { label: string; note: string; color: string }> = {
  academic:      { label: 'Academic',        note: 'University / peer-reviewed research', color: '#2f6f97' },
  official:      { label: 'Official watchdog', note: 'Statutory / government audit body', color: '#1c1611' },
  centre:        { label: 'Non-aligned',      note: 'Cross-party / non-aligned institute', color: '#4a7c7c' },
  'centre-left': { label: 'Centre-left',      note: 'Conventionally placed centre-left', color: '#566a8c' },
  'centre-right':{ label: 'Centre-right',     note: 'Conventionally placed centre-right', color: '#9a6b2e' },
  sector:        { label: 'Sector body',      note: 'Professional / sector / foundation', color: '#7a5aa6' },
  international: { label: 'International',     note: 'OECD / cross-national comparison', color: '#3f7d6e' },
};

// ---------------------------------------------------------------------------
// The registry. Claims are deliberately neutral ("X finds Y"), with the contested
// ones flagged by `strength: 'contested'` and surfaced together in contradictions.ts.
// ---------------------------------------------------------------------------
export const ANALYSES: Analysis[] = [
  // ---- Funding → attainment (the model's central modelling choice) ----
  { id: 'ifs-spend-2025', org: 'IFS', orgFull: 'Institute for Fiscal Studies', lean: 'centre',
    title: 'Annual report on education spending in England 2025–26', year: 2025,
    claim: 'Per-pupil school funding is around its 2010 real-terms level, but mainstream budgets are squeezed by high-needs (SEND) cost growth; college and sixth-form funding remain well below 2010.',
    area: ['funding', 'send'], themes: ['equity-not-money'], levers: ['school_funding', 'high_needs', 'post16_premium'], outcomes: ['fundingPerPupil', 'highNeedsDeficitStock'], strength: 'strong',
    url: 'https://ifs.org.uk/publications/annual-report-education-spending-england-2025-26' },
  { id: 'hanushek-money', org: 'Hanushek', orgFull: 'Eric Hanushek (Stanford)', lean: 'academic',
    title: 'The evidence on class size / expenditure and achievement', year: 2003,
    claim: 'Across many studies, the link between marginal spending and measured attainment is weak or inconsistent — outcomes depend more on how resources are used than on the level of spend.',
    area: ['funding'], themes: ['equity-not-money'], levers: ['school_funding'], outcomes: ['attainment8'], strength: 'contested' },
  { id: 'jackson-finance', org: 'Jackson et al.', orgFull: 'Jackson, Johnson & Persico; Lafortune et al.', lean: 'academic',
    title: 'Quasi-experimental school-finance-reform studies (US)', year: 2016,
    claim: 'Court-mandated school-finance reforms that raised per-pupil spending improved attainment and adult outcomes, especially for low-income pupils — evidence that money can matter when targeted.',
    area: ['funding'], themes: ['equity-not-money'], levers: ['school_funding'], outcomes: ['attainment8', 'gapKS4'], strength: 'contested' },

  // ---- Disadvantage gap ----
  { id: 'epi-annual-2025', org: 'EPI', orgFull: 'Education Policy Institute', lean: 'centre',
    title: 'Annual Report 2025 — the disadvantage gap', year: 2025,
    claim: 'The disadvantage gap at GCSE is at its widest in over a decade; EPI attributes the entire post-2019 widening to higher persistent absence among disadvantaged pupils.',
    area: ['gap', 'attendance'], themes: ['equity-not-money', 'early-identification'], levers: ['attendance', 'pupil_premium'], outcomes: ['gapKS4', 'persistentAbsenceDis'], strength: 'strong',
    url: 'https://epi.org.uk/annual-report-2025-disadvantage/' },
  { id: 'epi-early-gap', org: 'EPI', orgFull: 'Education Policy Institute', lean: 'centre',
    title: 'Early years and the disadvantage gap', year: 2024,
    claim: 'Around 40% of the GCSE disadvantage gap is already present at age 5, and the gap is observable from age 3 — locating much of the problem before school begins.',
    area: ['early-years', 'gap'], themes: ['early-identification'], levers: ['ey_quality', 'ey_access', 'eypp'], outcomes: ['gapReception', 'gapAge3'], strength: 'strong' },
  { id: 'gorard-pp', org: 'Gorard', orgFull: 'Stephen Gorard (Durham)', lean: 'academic',
    title: 'Critique of the Pupil Premium', year: 2022,
    claim: 'The attainment gap has barely narrowed over the Pupil Premium era, raising doubt about a reliable £-per-pupil → gap effect at current funding levels.',
    area: ['gap', 'funding'], themes: ['equity-not-money', 'measurement-validity'], levers: ['pupil_premium'], outcomes: ['gapKS4'], strength: 'contested' },
  { id: 'eef-toolkit', org: 'EEF', orgFull: 'Education Endowment Foundation', lean: 'sector',
    title: 'Teaching and Learning Toolkit', year: 2024,
    claim: 'Effect sizes vary widely by approach: small-group tuition ≈ +4 months, oral-language/early-literacy approaches among the most reliable; many popular interventions show small or null effects.',
    area: ['gap', 'attainment', 'early-years'], themes: ['equity-not-money'], levers: ['tutoring', 'reading', 'ey_quality'], outcomes: ['gapKS4', 'attainment8', 'gld'], strength: 'strong',
    url: 'https://educationendowmentfoundation.org.uk/education-evidence/teaching-learning-toolkit' },
  { id: 'suttontrust-ey', org: 'Sutton Trust', lean: 'sector',
    title: 'Inequality in the early years', year: 2024,
    claim: 'The funded-childcare expansion is structured as a working-parent subsidy: a minority of the lowest-income children qualify for the largest entitlements, so it does little to narrow the early gap.',
    area: ['early-years', 'gap'], themes: ['equity-not-money', 'early-identification'], levers: ['ey_access', 'eypp'], outcomes: ['gapReception', 'gapAge3'], strength: 'moderate',
    url: 'https://www.suttontrust.com/our-research/inequality-in-early-years-education/' },

  // ---- SEND ----
  { id: 'nao-send-2024', org: 'NAO', orgFull: 'National Audit Office', lean: 'official',
    title: 'Support for children and young people with SEN', year: 2024,
    claim: 'The SEND system is financially unsustainable: high-needs spending rose ~58% in real terms over the decade while measured outcomes for children with SEND did not improve.',
    area: ['send'], themes: ['equity-not-money', 'data-gap'], levers: ['high_needs', 'ehcp_reform', 'inclusion_fund'], outcomes: ['highNeedsDeficitStock', 'ehcpAttainment8'], strength: 'strong',
    url: 'https://www.nao.org.uk/reports/support-for-children-and-young-people-with-special-educational-needs/' },
  { id: 'isos-send', org: 'Isos Partnership', lean: 'sector',
    title: 'Towards an effective SEND system', year: 2025,
    claim: 'The cost growth is driven mainly by a loss of confidence in mainstream provision and an incentive structure that routes families toward statutory EHC plans, not by rising underlying need alone.',
    area: ['send'], themes: ['data-gap', 'early-identification'], levers: ['inclusion_fund', 'ehcp_reform', 'send_early'], outcomes: ['ehcpPct', 'highNeedsDeficitStock'], strength: 'moderate' },
  { id: 'ccn-send', org: 'CCN', orgFull: 'County Councils Network', lean: 'sector',
    title: 'SEND and the high-needs deficit', year: 2025,
    claim: 'Without reform the cumulative high-needs deficit is projected to reach a scale that threatens council solvency when the statutory override ends.',
    area: ['send'], themes: ['data-gap'], levers: ['high_needs', 'ehcp_reform'], outcomes: ['highNeedsDeficitStock'], strength: 'moderate' },

  // ---- Attendance ----
  { id: 'dfe-attendance', org: 'DfE', orgFull: 'Department for Education', lean: 'official',
    title: 'Attendance and attainment analysis', year: 2025,
    claim: 'There is a strong dose-response association between absence and attainment at KS2 and KS4; the association is correlational and confounded by pupil characteristics.',
    area: ['attendance'], themes: ['early-identification', 'measurement-validity'], levers: ['attendance'], outcomes: ['persistentAbsence', 'attainment8'], strength: 'moderate' },
  { id: 'fft-absence', org: 'FFT Datalab', orgFull: 'FFT Education Datalab', lean: 'sector',
    title: 'Persistent absence trends', year: 2025,
    claim: 'Post-pandemic absence remains elevated and is concentrated; a rising tail of severe absence is the sharpest divergence from the pre-2020 pattern.',
    area: ['attendance'], themes: ['measurement-validity'], levers: ['attendance'], outcomes: ['severeAbsence', 'persistentAbsence'], strength: 'strong',
    url: 'https://ffteducationdatalab.org.uk/' },

  // ---- NEET / post-16 ----
  { id: 'resolution-neet', org: 'Resolution Foundation', lean: 'centre-left',
    title: 'False Starts / Lost in Transition (youth labour market)', year: 2025,
    claim: 'Youth economic inactivity is increasingly driven by ill-health rather than cyclical unemployment, making it stickier and less responsive to job-matching schemes.',
    area: ['neet'], themes: ['early-identification'], levers: ['mental_health', 'youth_guarantee'], outcomes: ['neetInactiveHealth', 'neet'], strength: 'moderate',
    url: 'https://www.resolutionfoundation.org/' },
  { id: 'epi-neet', org: 'EPI', orgFull: 'Education Policy Institute', lean: 'centre',
    title: 'Five charts that explain the rise in NEET rates', year: 2025,
    claim: 'Disadvantage funding largely stops at 16 even though the NEET risk concentrates at 16–18; a 16–19 disadvantage premium is proposed as the most direct funding response.',
    area: ['neet', 'funding'], themes: ['equity-not-money'], levers: ['post16_premium'], outcomes: ['neet'], strength: 'moderate',
    url: 'https://epi.org.uk/publications-and-research/five-charts-that-explain-the-rise-in-neet-rates/' },

  // ---- Regional ----
  { id: 'burgess-london', org: 'Burgess', orgFull: 'Simon Burgess (Bristol)', lean: 'academic',
    title: 'Understanding the success of London’s schools', year: 2014,
    claim: 'London’s relative success is substantially explained by its pupil composition — a higher share of ethnic groups with strong educational aspiration — rather than by policy alone.',
    area: ['regional'], themes: ['equity-not-money', 'measurement-validity'], levers: ['place_investment'], outcomes: ['gapKS4'], strength: 'contested' },
  { id: 'fft-london', org: 'FFT Datalab', orgFull: 'FFT Education Datalab', lean: 'sector',
    title: 'The London effect and primary-era improvement', year: 2015,
    claim: 'Much of London’s secondary advantage traces to earlier primary-phase improvement and prior attainment, qualifying composition-only explanations.',
    area: ['regional'], themes: ['measurement-validity'], levers: ['place_investment'], outcomes: ['gapKS4'], strength: 'contested',
    url: 'https://ffteducationdatalab.org.uk/' },
  { id: 'localtrust-lbn', org: 'Local Trust', lean: 'sector',
    title: 'Left-behind neighbourhoods', year: 2024,
    claim: 'Equally-deprived areas without social infrastructure score materially worse, indicating a place-based residual independent of the household poverty rate.',
    area: ['regional'], themes: ['equity-not-money'], levers: ['place_investment', 'mission_ne', 'mission_coastal'], outcomes: ['gapKS4'], strength: 'moderate',
    url: 'https://localtrust.org.uk/' },

  // ---- International ----
  { id: 'oecd-pisa', org: 'OECD', lean: 'international',
    title: 'PISA 2022 and Education at a Glance', year: 2023,
    claim: 'Across systems, cumulative spend per student explains little of the variation in outcomes above a threshold; equity (the strength of the socio-economic gradient) differentiates the leaders.',
    area: ['funding', 'gap'], themes: ['equity-not-money'], levers: ['school_funding'], outcomes: ['attainment8', 'gapKS4'], strength: 'strong',
    url: 'https://www.oecd.org/pisa/' },

  // ---- Data / monitoring ----
  { id: 'adruk-echild', org: 'ADR UK', orgFull: 'Administrative Data Research UK', lean: 'sector',
    title: 'ECHILD — linked education, health and social-care records', year: 2024,
    claim: 'Whole-population linkage of education, health and social-care records is technically demonstrated; a perinatal-to-earnings life-course readout is constructible with existing data.',
    area: ['data', 'early-years'], themes: ['data-gap', 'measurement-validity'], outcomes: ['gld'], strength: 'strong',
    url: 'https://www.adruk.org/' },
  { id: 'adalovelace-data', org: 'Ada Lovelace', orgFull: 'Ada Lovelace Institute', lean: 'sector',
    title: 'Governance of children’s data and risk models', year: 2024,
    claim: 'Predictive risk models on children’s data carry equity and due-process risks; published precision/recall and challengeability are preconditions for legitimate use.',
    area: ['data', 'neet'], themes: ['data-gap', 'measurement-validity'], outcomes: ['neet'], strength: 'moderate',
    url: 'https://www.adalovelaceinstitute.org/' },
  { id: 'ifg-data', org: 'IfG', orgFull: 'Institute for Government', lean: 'centre',
    title: 'Data sharing and joined-up public services', year: 2024,
    claim: 'Cross-service data sharing repeatedly stalls on governance and accountability rather than technical capability; a single accountable owner for the join is usually absent.',
    area: ['data'], themes: ['data-gap'], outcomes: [], strength: 'moderate',
    url: 'https://www.instituteforgovernment.org.uk/' },

  // ---- Cross-spectrum policy institutes (verified/expanded during build) ----
  { id: 'ippr-send', org: 'IPPR', orgFull: 'Institute for Public Policy Research', lean: 'centre-left',
    title: 'Exclusions and the cost of lost potential', year: 2024,
    claim: 'Exclusions and off-rolling funnel pupils toward alternative provision and NEET; the lifetime fiscal cost estimates are large but contested.',
    area: ['neet', 'send'], themes: ['early-identification'], levers: ['behaviour_support'], outcomes: ['neet'], strength: 'contested',
    url: 'https://www.ippr.org/' },
  { id: 'policyexchange-standards', org: 'Policy Exchange', lean: 'centre-right',
    title: 'Knowledge-rich curriculum and standards', year: 2024,
    claim: 'England’s reading and curriculum reforms are associated with international reading gains; attributing the gains to specific reforms is methodologically difficult.',
    area: ['attainment'], themes: ['measurement-validity'], levers: ['curriculum', 'reading'], outcomes: ['ks2RWM'], strength: 'contested',
    url: 'https://policyexchange.org.uk/' },
  { id: 'onward-place', org: 'Onward', lean: 'centre-right',
    title: 'Place, opportunity and human capital', year: 2024,
    claim: 'Regional gaps in opportunity persist independently of headline spending; local institutions and labour-market access are emphasised as drivers.',
    area: ['regional', 'neet'], themes: ['equity-not-money'], levers: ['place_investment'], outcomes: ['gapKS4', 'neet'], strength: 'moderate',
    url: 'https://www.ukonward.com/' },
  { id: 'smf-skills', org: 'SMF', orgFull: 'Social Market Foundation', lean: 'centre',
    title: 'Post-16 skills and the forgotten third', year: 2024,
    claim: 'A persistent third of pupils do not achieve strong passes in English and maths by 16, with weak subsequent support — a structural feature, not a cohort effect.',
    area: ['neet', 'attainment'], themes: ['measurement-validity'], levers: ['post16_skills', 'post16_premium'], outcomes: ['grade5EM', 'neet'], strength: 'moderate',
    url: 'https://www.smf.co.uk/' },
  { id: 'cep-teachers', org: 'CEP/LSE', orgFull: 'Centre for Economic Performance, LSE', lean: 'academic',
    title: 'Teacher quality and pupil outcomes', year: 2023,
    claim: 'Teacher quality and supply are among the strongest school-level determinants of attainment; recruitment and retention are the binding constraints in shortage subjects and deprived areas.',
    area: ['workforce', 'attainment'], themes: ['equity-not-money'], levers: ['teachers', 'teacher_pay', 'bursaries'], outcomes: ['attainment8'], strength: 'strong',
    url: 'https://cep.lse.ac.uk/' },
  { id: 'nuffield-ey', org: 'Nuffield Foundation', lean: 'sector',
    title: 'Early childhood education and care evidence', year: 2024,
    claim: 'Quality of early education — not hours alone — drives durable cognitive gains, with the largest benefits for disadvantaged children (consistent with EPPE/EPPSE).',
    area: ['early-years'], themes: ['equity-not-money', 'early-identification'], levers: ['ey_quality'], outcomes: ['gld', 'gapReception', 'gapAge3'], strength: 'strong',
    url: 'https://www.nuffieldfoundation.org/' },

  // ===========================================================================
  // ADDED — broaden coverage and cross-spectrum balance. Figures verified against
  // primary/named sources (see dossier). Contested/forecast figures flagged inline.
  // ===========================================================================

  // ---- EEF (specific trials) ----
  { id: 'eef-neli', org: 'EEF', orgFull: 'Education Endowment Foundation', lean: 'sector',
    title: 'Nuffield Early Language Intervention (NELI) scale-up evaluation', year: 2021,
    claim: 'A 20-week reception oral-language programme produced about +2 to +4 months of additional language progress overall, with a larger (~7-month) boost for children eligible for free school meals.',
    area: ['early-years', 'gap'], themes: ['early-identification', 'equity-not-money'], levers: ['ey_quality', 'reading', 'eypp'], outcomes: ['gld', 'gapReception'], strength: 'strong',
    url: 'https://educationendowmentfoundation.org.uk/projects-and-evaluation/projects/nuffield-early-language-intervention-scale-up-impact-evaluation' },
  { id: 'eef-breakfast', org: 'EEF', orgFull: 'Education Endowment Foundation', lean: 'sector',
    title: 'Magic Breakfast / breakfast clubs trial', year: 2016,
    claim: 'In a trial across 106 disadvantaged primaries, Year 2 pupils in breakfast-club schools made roughly +2 months of additional progress in reading, writing and maths.',
    area: ['attendance', 'gap'], themes: ['early-identification', 'equity-not-money'], levers: ['breakfast', 'attendance'], outcomes: ['ks2RWM', 'persistentAbsenceDis'], strength: 'moderate',
    url: 'https://educationendowmentfoundation.org.uk/news/breakfast-clubs-found-to-boost-primary-pupils-reading-writing-and-maths-res' },

  // ---- EPI (additional) ----
  { id: 'epi-regional-gaps', org: 'EPI', orgFull: 'Education Policy Institute', lean: 'centre',
    title: 'Annual Report 2024 — regional gaps', year: 2024,
    claim: 'The disadvantage gap varies markedly by region and is not closing evenly; London is the only English region still narrowing its GCSE gap.',
    area: ['regional', 'gap'], themes: ['equity-not-money'], levers: ['place_investment', 'mission_ne', 'mission_coastal'], outcomes: ['gapKS4'], strength: 'strong',
    url: 'https://epi.org.uk/annual-report-2024-regional-gaps-2/' },
  { id: 'epi-accountability', org: 'EPI', orgFull: 'Education Policy Institute', lean: 'centre',
    title: 'Reforming accountability', year: 2024,
    claim: 'EPI analyses how inspection and accountability design relate to outcomes and what distinguishes higher-performing school groups, separate from the level of funding.',
    area: ['funding', 'attainment'], themes: ['measurement-validity', 'equity-not-money'], levers: ['rise'], outcomes: ['attainment8'], strength: 'moderate',
    url: 'https://epi.org.uk/publications-and-research/reforming-accountability/' },

  // ---- IFS (additional) ----
  { id: 'ifs-send-2024', org: 'IFS', orgFull: 'Institute for Fiscal Studies', lean: 'centre',
    title: 'Spending on special educational needs in England: something has to change', year: 2024,
    claim: 'High-needs (SEND) growth explains over half the 2019–24 school-funding rise; the high-needs block rose roughly £6.8bn→£10.4bn (2015→2024, +59% real), yet still did not clear in-year deficits — with the precise future gap a contested forecast.',
    area: ['send', 'funding'], themes: ['equity-not-money', 'data-gap'], levers: ['high_needs', 'inclusion_fund', 'ehcp_reform'], outcomes: ['highNeedsDeficitStock', 'ehcpPct'], strength: 'strong',
    url: 'https://ifs.org.uk/publications/spending-special-educational-needs-england-something-has-change' },
  { id: 'ifs-thirty-hours', org: 'IFS', orgFull: 'Institute for Fiscal Studies', lean: 'centre',
    title: 'New childcare entitlements and the early gap', year: 2024,
    claim: 'Because the 30-hours offer is conditional on parental work, it flows mainly to better-off working families and excludes the non-working poorest, so IFS judges it likely to widen — not narrow — the gap between children in better-off and poorer families; the targeted 15-hour/2-year-old strand is framed more favourably.',
    area: ['early-years', 'gap'], themes: ['equity-not-money', 'early-identification'], levers: ['ey_access', 'eypp'], outcomes: ['gapReception', 'gapAge3', 'eyTakeUp'], strength: 'moderate',
    url: 'https://ifs.org.uk/articles/what-you-need-know-about-new-childcare-entitlements' },
  { id: 'ifs-growth-skills', org: 'IFS', orgFull: 'Institute for Fiscal Studies', lean: 'centre',
    title: 'Labour’s Growth and Skills levy', year: 2024,
    claim: 'A more flexible apprenticeship levy gives firms more latitude, but IFS concludes employer uptake — not levy design — remains the binding constraint on youth apprenticeship opportunities.',
    area: ['neet', 'funding'], themes: ['equity-not-money'], levers: ['apprenticeships', 'post16_skills'], outcomes: ['neet'], strength: 'moderate',
    url: 'https://ifs.org.uk/articles/labours-growth-and-skills-levy-would-give-more-flexibility-firms-employers-would-still' },

  // ---- NAO (additional) ----
  { id: 'nao-teacher-pledge', org: 'NAO', orgFull: 'National Audit Office', lean: 'official',
    title: 'The government’s 6,500-teacher pledge', year: 2024,
    claim: 'NAO warns the pledge to recruit 6,500 additional teachers faces material uncertainty as pupil numbers and subject-specific shortfalls shift, with no clear delivery baseline.',
    area: ['workforce'], themes: ['data-gap', 'measurement-validity'], levers: ['teachers', 'teacher_pay', 'bursaries'], outcomes: ['teacherShortfall'], strength: 'moderate',
    url: 'https://www.nao.org.uk/press-releases/governments-6500-teacher-pledge-faces-uncertainties-as-student-numbers-surge/' },

  // ---- OECD (additional) ----
  { id: 'oecd-eag-2024', org: 'OECD', lean: 'international',
    title: 'Education at a Glance 2024 (equity edition)', year: 2024,
    claim: 'The OECD-wide 18–24 NEET rate fell from about 16% to 14% since 2016, but low performance among 15-year-olds persists; spend-per-student differences explain little of cross-country outcome variation above a threshold.',
    area: ['neet', 'funding', 'gap'], themes: ['equity-not-money'], levers: ['post16_premium', 'school_funding'], outcomes: ['neet', 'attainment8'], strength: 'strong',
    url: 'https://www.oecd.org/en/publications/education-at-a-glance-2024_c00cad36-en/full-report.html' },

  // ---- Nuffield Foundation (additional) ----
  { id: 'nuffield-ifs-funder', org: 'Nuffield Foundation', lean: 'sector',
    title: 'Funder of the IFS education-spending series', year: 2024,
    claim: 'Nuffield underwrites the canonical per-student spending series used across the policy debate, supplying the funding evidence base rather than advocating a position.',
    area: ['funding', 'data'], themes: ['data-gap', 'equity-not-money'], levers: ['school_funding'], outcomes: ['fundingPerPupil'], strength: 'moderate',
    url: 'https://www.nuffieldfoundation.org/research/education' },

  // ---- Sutton Trust (additional) ----
  { id: 'suttontrust-tutoring', org: 'Sutton Trust', lean: 'sector',
    title: 'Private tutoring polling (Ipsos series)', year: 2024,
    claim: 'Around 23% of pupils in the worst-off households received private tutoring versus 30% in the best-off, with sharp geographic gaps (about 45% in London vs 27% elsewhere); in-school tutoring fell after the National Tutoring Programme ended in 2024.',
    area: ['gap', 'regional'], themes: ['equity-not-money'], levers: ['tutoring', 'pupil_premium'], outcomes: ['gapKS4'], strength: 'moderate',
    url: 'https://www.suttontrust.com/our-research/tutoring-2023-the-new-landscape/' },
  { id: 'suttontrust-apprentice', org: 'Sutton Trust', lean: 'sector',
    title: 'Apprenticeships and social mobility', year: 2024,
    claim: 'Only about 5% of degree apprentices were FSM-eligible and starts skew toward older, wealthier entrants; young-person apprenticeship starts fell after the 2017 levy reform.',
    area: ['neet', 'gap'], themes: ['equity-not-money'], levers: ['apprenticeships', 'careers_gatsby'], outcomes: ['neet'], strength: 'moderate',
    url: 'https://www.suttontrust.com/our-priorities/apprenticeships/' },

  // ---- FFT Education Datalab (additional) ----
  { id: 'fft-exclusions', org: 'FFT Datalab', orgFull: 'FFT Education Datalab', lean: 'sector',
    title: 'Exclusions and suspensions in 2023/24', year: 2024,
    claim: 'Suspensions and exclusions continued to rise, with disadvantaged pupils disproportionately affected; the series flags a possible recent peak.',
    area: ['attendance', 'gap'], themes: ['early-identification', 'measurement-validity'], levers: ['behaviour_support'], outcomes: ['neet', 'gapKS4'], strength: 'moderate',
    url: 'https://ffteducationdatalab.org.uk/2024/11/exclusions-and-suspensions-in-2023-24/' },
  { id: 'fft-persistent-absence', org: 'FFT Datalab', orgFull: 'FFT Education Datalab', lean: 'sector',
    title: 'Persistent-absence analysis', year: 2024,
    claim: 'Persistent absence rose from about 10.9% (2018/19) to 20.0% (2023/24), with FSM-eligible pupils more than twice as likely to be persistently absent (about 34.8% vs 14.1%).',
    area: ['attendance', 'gap'], themes: ['measurement-validity', 'early-identification'], levers: ['attendance'], outcomes: ['persistentAbsence', 'persistentAbsenceDis'], strength: 'strong',
    url: 'https://ffteducationdatalab.org.uk/category/attendance/' },

  // ---- Resolution Foundation (additional) ----
  { id: 'resolution-neet-europe', org: 'Resolution Foundation', lean: 'centre-left',
    title: 'Lost in transition — the UK NEET rate in international context', year: 2025,
    claim: 'The UK 18–24 NEET rate rose from about 13% (2019) to 15% (2025), the third-highest in Europe; only 43% of UK 18–24s were in education in 2024 versus an OECD average of 53%, identifying weak education participation as a key driver.',
    area: ['neet'], themes: ['early-identification', 'equity-not-money'], levers: ['youth_guarantee', 'post16_skills', 'apprenticeships'], outcomes: ['neet', 'neetInactiveOther'], strength: 'moderate',
    url: 'https://www.resolutionfoundation.org/publications/lost-in-transition/' },

  // ---- Institute for Government (additional) ----
  { id: 'ifg-tracker-schools', org: 'IfG', orgFull: 'Institute for Government', lean: 'centre',
    title: 'Public Services Performance Tracker — schools', year: 2024,
    claim: 'Drawing on 250+ indicators, the Tracker identifies the EHCP/SEND demand surge as a central pressure on the schools system, alongside spending and staffing constraints.',
    area: ['funding', 'send', 'workforce'], themes: ['data-gap'], levers: ['high_needs', 'teachers'], outcomes: ['highNeedsDeficitStock', 'ehcpPct'], strength: 'moderate',
    url: 'https://www.instituteforgovernment.org.uk/our-work/topics/public-services/schools' },
  { id: 'ifg-teacher-supply', org: 'IfG', orgFull: 'Institute for Government', lean: 'centre',
    title: 'Teacher supply (Performance Tracker)', year: 2024,
    claim: 'Secondary ITT recruitment targets were missed in 13 of 18 subjects in 2024/25 (e.g. physics ~31%, computing ~37% of target); secondary teacher numbers rose only ~3% (2015/16–2023/24) while secondary pupils rose ~15%.',
    area: ['workforce'], themes: ['data-gap', 'equity-not-money'], levers: ['teachers', 'teacher_pay', 'bursaries'], outcomes: ['teacherShortfall'], strength: 'strong',
    url: 'https://www.instituteforgovernment.org.uk/our-work/topics/public-services/schools' },

  // ---- IPPR (additional) ----
  { id: 'ippr-losing-learning', org: 'IPPR', orgFull: 'Institute for Public Policy Research', lean: 'centre-left',
    title: 'Who is losing learning?', year: 2024,
    claim: 'Post-pandemic lost learning through exclusions and absence falls disproportionately on disadvantaged pupils and those with SEND, concentrating the gap in a vulnerable group.',
    area: ['attendance', 'gap', 'send'], themes: ['early-identification'], levers: ['behaviour_support', 'mental_health'], outcomes: ['persistentAbsenceDis', 'gapKS4'], strength: 'moderate',
    url: 'https://www.ippr.org/articles/who-is-losing-learning' },

  // ---- Policy Exchange (additional) ----
  { id: 'policyexchange-phones', org: 'Policy Exchange', lean: 'centre-right',
    title: 'Disconnect — smartphones in schools', year: 2024,
    claim: 'Reports that pupils in schools with an effective smartphone ban achieve GCSE results 1–2 grades higher and estimates only ~11% of secondaries enforce an effective ban; the attainment claim is correlational, not a causal trial estimate, and is contested.',
    area: ['attendance', 'attainment'], themes: ['measurement-validity'], levers: ['behaviour_support', 'curriculum'], outcomes: ['attainment8'], strength: 'contested',
    url: 'https://policyexchange.org.uk/publication/disconnect/' },

  // ---- Onward (additional) ----
  { id: 'onward-course-correction', org: 'Onward', lean: 'centre-right',
    title: 'Course Correction — apprenticeship reform', year: 2022,
    claim: 'Highlights a funding asymmetry whereby 16–18 A-levels are fully government-funded while apprenticeships rely on employer contributions, and argues the post-2017 levy reduced opportunities for younger and poorer apprentices.',
    area: ['neet', 'funding'], themes: ['equity-not-money'], levers: ['apprenticeships', 'post16_skills', 'careers_gatsby'], outcomes: ['neet'], strength: 'moderate',
    url: 'https://www.ukonward.com/reports/course-correction-apprenticeships/' },

  // ---- SMF (additional) ----
  { id: 'smf-financial-ed', org: 'SMF', orgFull: 'Social Market Foundation', lean: 'centre',
    title: 'Financial education in primary schools', year: 2024,
    claim: 'Only about 1% of primary teachers think pupils’ financial literacy is adequate and 81% cite lack of time as the main barrier; SMF recommends statutory whole-school financial education.',
    area: ['attainment'], themes: ['measurement-validity'], levers: ['curriculum'], outcomes: ['ks2RWM'], strength: 'moderate',
    url: 'https://www.smf.co.uk/wp-content/uploads/2024/04/Investing-in-the-future-April-2024.pdf' },

  // ---- CEP/LSE (additional) ----
  { id: 'cep-vocational', org: 'CEP/LSE', orgFull: 'Centre for Economic Performance, LSE', lean: 'academic',
    title: 'Vocational and further-education research (CVER)', year: 2024,
    claim: 'FE colleges are the principal post-16 route for lower-income 16–19s; CEP/CVER work quantifies returns to vocational qualifications, T-levels and apprenticeships and their role in regional opportunity.',
    area: ['neet', 'regional', 'funding'], themes: ['equity-not-money'], levers: ['post16_skills', 'apprenticeships', 'careers_gatsby'], outcomes: ['neet', 'grade5EM'], strength: 'moderate',
    url: 'https://cep.lse.ac.uk/_new/our-work/education-and-skills/' },

  // ---- Isos Partnership (additional) ----
  { id: 'isos-send-sustainable', org: 'Isos Partnership', lean: 'sector',
    title: 'Towards a financially sustainable approach to SEND (for LGA & CCN)', year: 2024,
    claim: 'In a sector survey, more than 9 in 10 leaders disagreed that the SEND system was financially sustainable, adequately funded, fairly resourced, equitable or impactful — concluding reform is urgent and unavoidable (commissioned by local-government bodies).',
    area: ['send', 'funding', 'regional'], themes: ['data-gap', 'early-identification'], levers: ['ehcp_reform', 'inclusion_fund', 'high_needs', 'send_early'], outcomes: ['highNeedsDeficitStock', 'ehcpPct'], strength: 'moderate',
    url: 'https://www.local.gov.uk/publications/towards-effective-and-financially-sustainable-approach-send-england' },

  // ---- ADR UK (additional) ----
  { id: 'adruk-grade', org: 'ADR UK', orgFull: 'Administrative Data Research UK', lean: 'sector',
    title: 'GRADE — Grading and Admissions Data for England', year: 2023,
    claim: 'Links GCSE/A-level grades, the National Pupil Database and UCAS admissions for English pupils (2017–2020), enabling fair-access and attainment-to-higher-education research from existing administrative data.',
    area: ['data', 'gap'], themes: ['data-gap', 'measurement-validity'], levers: [], outcomes: ['gapKS4'], strength: 'strong',
    url: 'https://www.adruk.org/our-work/children-young-people/' },

  // ---- Ada Lovelace (additional) ----
  { id: 'adalovelace-ai-schools', org: 'Ada Lovelace', orgFull: 'Ada Lovelace Institute', lean: 'sector',
    title: 'A learning curve? AI and education in the UK (with Nuffield)', year: 2025,
    claim: 'A landscape review of AI in state schools identifies opportunities and risks across teaching, marking and careers guidance, and flags gaps in data, privacy, transparency and regulation as preconditions for safe use.',
    area: ['data', 'attainment'], themes: ['data-gap', 'measurement-validity'], levers: [], outcomes: [], strength: 'moderate',
    url: 'https://www.adalovelaceinstitute.org/report/a-learning-curve/' },
];

export const ANALYSES_BY_ID: Record<string, Analysis> = Object.fromEntries(ANALYSES.map((a) => [a.id, a]));

/** Analyses bearing on a given outcome id. */
export function analysesForOutcome(id: string): Analysis[] {
  return ANALYSES.filter((a) => a.outcomes?.includes(id));
}
/** Analyses bearing on a given lever id. */
export function analysesForLever(id: string): Analysis[] {
  return ANALYSES.filter((a) => a.levers?.includes(id));
}
/** Analyses bearing on a theme id. */
export function analysesForTheme(id: string): Analysis[] {
  return ANALYSES.filter((a) => a.themes?.includes(id));
}
