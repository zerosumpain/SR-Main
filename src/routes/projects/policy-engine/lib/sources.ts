// sources.ts — the canonical source list, shared by the Methodology tab and the
// page-bottom sources footer. Self-contained.

export interface Source { org: string; what: string; url: string; }

export const SOURCES: Source[] = [
  { org: 'Education Policy Institute (EPI)', what: 'Annual Report 2025 — disadvantage gap (months), SEND, regional gaps, NEET', url: 'https://epi.org.uk/annual-report-2025-disadvantage/' },
  { org: 'IFS — education spending', what: 'Annual report on education spending in England 2025-26', url: 'https://ifs.org.uk/publications/annual-report-education-spending-england-2025-26' },
  { org: 'IFS — SEND', what: 'Green Budget 2025 ch.5: support for children with SEND (deficit, prevalence, override)', url: 'https://ifs.org.uk/publications/annual-report-education-spending-england-2025-26' },
  { org: 'IFS — early years', what: 'Early years spending update; childcare funding rates & EYPP uplift', url: 'https://ifs.org.uk/articles/childcare-funding-rates-largely-protected-real-terms-big-uplift-disadvantage-premium' },
  { org: 'DfE — Explore Education Statistics', what: 'KS4 & KS2 attainment, EHC plans, pupil absence, school workforce, NEET, EYFSP', url: 'https://explore-education-statistics.service.gov.uk/' },
  { org: 'DfE — Schools White Paper', what: '"Every Child Achieving and Thriving" (CP 1508-I, Feb 2026)', url: 'https://www.gov.uk/government/publications' },
  { org: 'DfE — Curriculum & Assessment Review', what: 'Francis Review final report, "Building a world-class curriculum for all" (Nov 2025)', url: 'https://www.gov.uk/government/publications/curriculum-and-assessment-review-final-report' },
  { org: 'DfE — attendance & attainment', what: 'The link between attendance and attainment in an assessment year (Mar 2025)', url: 'https://www.gov.uk/government/publications/link-between-attendance-and-attainment' },
  { org: 'DfE — Inclusive Mainstream Fund', what: 'Methodology 2026-27 (SEND inclusion funding to mainstream schools)', url: 'https://www.gov.uk/government/publications/inclusive-mainstream-fund-2026-to-2027/inclusive-mainstream-fund-for-schools-methodology-2026-to-2027' },
  { org: 'DfE — RISE', what: 'Regional Improvement for Standards and Excellence; schools eligible for intervention', url: 'https://educationhub.blog.gov.uk/2025/07/rise-teams-everything-you-need-to-know/' },
  { org: 'NFER', what: 'Teacher Labour Market in England — Annual Report 2025 (recruitment, retention, pay)', url: 'https://www.nfer.ac.uk/publications/teacher-labour-market-in-england-annual-report-2025/' },
  { org: 'Education Endowment Foundation (EEF)', what: 'Teaching & Learning + Early Years Toolkits (months-progress effect sizes)', url: 'https://educationendowmentfoundation.org.uk/education-evidence' },
  { org: 'EEF — Magic Breakfast', what: 'Breakfast clubs RCT (+2 months KS1; KS2 null on re-analysis; attendance)', url: 'https://educationendowmentfoundation.org.uk/projects-and-evaluation/projects/magic-breakfast' },
  { org: "Children's Wellbeing and Schools Act 2026", what: 'Breakfast clubs, FSM expansion to all UC, QTS, academy reform, uniform cap', url: 'https://www.legislation.gov.uk/ukpga/2026/21/contents/enacted' },
  { org: 'Milburn review (DWP)', what: '"Young People and Work" interim report, May 2026 (youth NEET & mental health)', url: 'https://www.fenews.co.uk/fe-voices/milburn-interim-review-warns-of-generational-fault-line-as-neet-numbers-could-hit-1-25-million-without-reform/' },
  { org: 'NAO', what: 'Support for children & young people with SEND (Oct 2024); home-to-school transport', url: 'https://www.nao.org.uk/reports/support-for-children-and-young-people-with-special-educational-needs/' },
  { org: 'County Councils Network', what: 'SEND deficits & council insolvency risk if the DSG override ends with deficits on-book', url: 'https://www.countycouncilsnetwork.org.uk/send-deficits-risk-bankrupting-almost-three-quarters-of-englands-largest-councils-by-2027-with-government-urged-to-take-action/' },
  { org: 'Sutton Trust', what: 'Inequality in early years education (childcare-expansion targeting; EYPP vs pupil premium)', url: 'https://www.suttontrust.com/our-research/inequality-in-early-years-education/' },
  { org: 'CPAG / DWP HBAI', what: 'Child poverty statistics; Child Poverty Strategy (Dec 2025)', url: 'https://cpag.org.uk/news/child-poverty-statistics-new-record-high-and-further-breakdowns' },
  { org: 'Commons Library', what: 'Pupil Premium (SN06700); Post-16 White Paper; teacher recruitment briefings', url: 'https://commonslibrary.parliament.uk/' },
  { org: 'Teacher value-added evidence', what: 'Chetty/Friedman/Rockoff & Hanushek (1 SD teacher VA ≈ +0.10–0.20 SD pupil scores)', url: 'https://opportunityinsights.org/wp-content/uploads/2018/10/teachers_wp.pdf' },
  { org: 'School-spending evidence', what: 'Jackson et al. — effects of school spending (weak/contested £→outcome link)', url: 'https://www.brookings.edu/articles/a-state-level-perspective-on-school-spending-and-educational-outcomes/' },
  { org: 'OECD — PISA 2022 (Global tab)', what: 'Maths/reading/science scores, equity (ESCS variance + advantaged−disadvantaged gap), cumulative spend per student 6–15 (Table I.B3.2.2) & 2018→22 trend with significance', url: 'https://www.oecd.org/en/publications/pisa-2022-results-volume-i_53f23881-en.html' },
  { org: 'OECD — Education at a Glance 2024', what: 'Annual expenditure per student & % of GDP on education (context badges on the Global tab)', url: 'https://www.oecd.org/en/about/programmes/education-at-a-glance.html' },
  { org: 'DfE/NFER — PISA 2022 National Report for England', what: 'England-specific PISA means (492/496/503) and the response-rate caveat', url: 'https://assets.publishing.service.gov.uk/media/656dc3321104cf0013fa742f/PISA_2022_England_National_Report.pdf' },
  { org: 'World Bank', what: 'GDP per capita PPP, and government education spend %GDP for non-OECD Singapore & Vietnam', url: 'https://data.worldbank.org/indicator/NY.GDP.PCAP.PP.CD' },
];
