// comparators.ts — the comparator gallery: other departments' published data strategies,
// what each got right and where each fell down. Facts from the 2026-07-02 best-practice
// research sweep (verified against gov.uk publication records). The Author's guidance panel
// uses SECTION_COMPARATORS to point drafters at the strategies worth reading per section.

export interface Comparator {
  id: string;
  title: string;
  org: string;
  date: string;
  url: string;
  sections: string[];
  strengths: string[];
  weaknesses: string[];
  lesson: string;
}

export const COMPARATORS: Comparator[] = [
  {
    id: 'dhsc-data-saves-lives',
    title: 'Data saves lives: reshaping health and social care with data',
    org: 'Department of Health and Social Care / NHS England',
    date: '2022-06',
    url: 'https://www.gov.uk/government/publications/data-saves-lives-reshaping-health-and-social-care-with-data/data-saves-lives-reshaping-health-and-social-care-with-data',
    sections: [
      'Ministerial foreword',
      'Improving trust in the health and care system’s use of data',
      'Giving health and care professionals the information they need',
      'Improving data for adult social care',
      'Supporting local and national decision-makers with data',
      'Empowering researchers with the data they need',
      'Working with partners to develop innovations',
      'Developing the right technical infrastructure',
      'How you can get involved',
      'Annexes: legislative changes; list of commitments; Goldacre recommendations; glossary',
    ],
    strengths: [
      '102 concrete commitments, each with a delivery date, collected in an annex — the most audit-friendly commitments structure of any departmental data strategy',
      'Dedicated public-trust chapter placed first, added after consultation feedback on the draft and the 2021 GPDPR opt-out crisis',
      'Chapters organised by audience (public, professionals, decision-makers, researchers, innovators), not by internal function',
      'Secure data environments (TREs) made the default access route, directly implementing the Goldacre review',
      'Annual public implementation update tracking each commitment as delivered, minor delay or significant delay',
    ],
    weaknesses: [
      'One year on, 27 commitments had minor delays and 11 significant delays or issues, several explicitly attributed to funding — commitments outran resourcing',
      'The public-perception tracker used to monitor trust is internal-only, so the trust chapter’s own success cannot be publicly verified',
      'Critics argued it was top-down and lacked bottom-up clinical-professional endorsement',
    ],
    lesson:
      'Dated, annexed, publicly-tracked commitments make a strategy accountable — but only if each commitment has a funding line behind it.',
  },
  {
    id: 'moj-data-strategy',
    title: 'MoJ Data Strategy (Becoming a truly data-led justice system)',
    org: 'Ministry of Justice',
    date: '2022-08',
    url: 'https://mojdigital.blog.gov.uk/2022/08/30/becoming-a-truly-data-led-justice-system/',
    sections: [
      'Vision: a data-led and digital department using data assets in an exemplary way',
      'Pillar 1: Improve justice outcomes through data-driven insight and innovation',
      'Pillar 2: Ensure data meets user needs',
      'Pillar 3: Build a data culture that values data as a strategic asset',
      'Three-phase roadmap: prototyping; learning by doing; empowering others',
      'Enablers: Chief Data Officer, Data Board, data architects, Data Improvement Programme',
    ],
    strengths: [
      'One memorable central objective — ‘get data of the right quality to the people who need it’ — with every initiative traceable to it',
      'Explicit three-phase, three-year implementation roadmap published alongside the strategy',
      'Backed by structural change: first MoJ Chief Data Officer, a new Data Board, data catalogue discovery, and a Data Improvement Programme',
      'Public ‘one year on’ progress blog and a ‘data fundamentals’ follow-up on data governance basics',
      'Data First programme (ADR UK-funded) made linked justice datasets available to external researchers',
    ],
    weaknesses: [
      'Published as blog posts and a summary graphic rather than a formal gov.uk document — no single citable full text, no annexed commitments list',
      'Published material is thin on funding, metrics and baseline assessment',
    ],
    lesson:
      'A single sharp objective plus a phased roadmap beats a long wish-list, but publishing only a blog summary undermines accountability and permanence.',
  },
  {
    id: 'dft-transport-data-strategy',
    title: 'Transport data strategy: innovation through data',
    org: 'Department for Transport',
    date: '2023-03',
    url: 'https://www.gov.uk/government/publications/transport-data-strategy-innovation-through-data',
    sections: [
      'Sharing, discoverability and access',
      'Data standards and quality',
      'Skills, culture and leadership',
      'User needs and communication',
      'Governance, protection and ethics',
    ],
    strengths: [
      'First UK sector-wide transport data strategy, with an explicit ‘open by default’ posture',
      'Creates named institutions with ongoing responsibility: Transport Data Catalogue, Transport Data Standards Panel, quarterly community roundtables',
      'Commits to an annual review of strategy progress',
      'Covers the full spread — access, standards and quality, skills and culture, user needs, governance and ethics — in one coherent theme structure',
    ],
    weaknesses: [
      'Many commitments are hedged (‘explore’, ‘consider’ — e.g. exploring a Data Ethics Panel) rather than dated deliverables',
      'Primarily outward and sector-facing — light on DfT’s own internal data management, architecture and funding',
      'No published costings or funding line for the interventions',
    ],
    lesson:
      'Theme structure and named standing institutions are strong, but hedged ‘explore/consider’ language without dates makes progress unmeasurable.',
  },
  {
    id: 'home-office-ddat-2024',
    title: 'Home Office Digital, Data and Technology Strategy 2024',
    org: 'Home Office',
    date: '2021-07',
    url: 'https://www.gov.uk/government/publications/home-office-digital-data-and-technology-strategy-2024/home-office-digital-data-and-technology-strategy-2024',
    sections: [
      'Foreword',
      'Introduction',
      'Converge technologies',
      'Create shared technology products',
      'Be product-centric',
      'Become data-driven',
      'Deliver effectively at scale',
      'Embrace innovation',
      'Assuring these principles',
      'Conclusion',
    ],
    strengths: [
      'Declares ‘data is our primary asset’ and models the technical architecture around collecting, securing and processing it',
      'Commits to a federated data architecture with authoritative data stores owned by core business areas — an explicit, arguable architectural choice',
      'Authoritative register of all technologies and products to force convergence and reuse',
      'Includes an ‘Assuring these principles’ section — a self-policing mechanism most strategies lack',
    ],
    weaknesses: [
      'Data is one principle among six in a combined DDaT strategy, not a standalone data strategy — governance, quality and sharing get shallow treatment',
      'Titled ‘2024’ (the target year) but published in 2021; superseded by the Home Office 2030 Digital Strategy in July 2025',
    ],
    lesson:
      'Naming a target architecture (federated, authoritative stores) gives a data strategy real teeth; burying data inside a broad DDaT strategy dilutes it.',
  },
  {
    id: 'dwp-data-strategy-2023-2030',
    title: 'DWP Data Strategy 2023 to 2030',
    org: 'Department for Work and Pensions',
    date: '2026-01',
    url: 'https://www.gov.uk/government/publications/dwp-data-strategy-2023-to-2030/dwp-data-strategy-2023-to-2030',
    sections: [
      'Foreword',
      'Introduction',
      'Vision: transform DWP into a dynamic data-driven organisation',
      'Priority 1: Build modern business applications with good quality, interoperable data',
      'Priority 2: Make data access and sharing with other departments and third parties seamless and governed',
      'Priority 3: Provide timely, rich insight datasets accessible in self-service',
      'Priority 4: Deploy insight teams covering all dimensions of business performance',
      'Priority 5: Embed data capabilities into business-owned multidisciplinary product teams',
      'Priority 6: Deploy DWP-wide tools for collaboration, productivity and data governance',
      'Priority 7: Embed a data culture, drive data literacy and build data capability throughout DWP',
      'Operating model: federated hub-and-spoke (Chief Data Office hub, business-domain spokes)',
      'Phased roadmap: 2019–23 foundations; 2023–24 joined-up delivery; 2025–30 fully data-driven',
    ],
    strengths: [
      'Seven concrete strategic priorities spanning applications, sharing, self-service insight, teams, tooling and culture',
      'Explicit federated hub-and-spoke operating model — a central Chief Data Office sets standards and policies while business domains own local data decisions',
      'Quantifies the estate (27 petabytes) and sets a long 2030 horizon with phases',
      'Vision wording bakes in ‘responsibly, lawfully and at scale’ — legal and ethical use inside the vision itself',
    ],
    weaknesses: [
      'Published 29 January 2026 despite covering 2023–2030 — three years of its own period had already elapsed, so early phases read as retrospective',
      'No published costings; priorities skew towards technology delivery over legal basis, ethics and public trust',
    ],
    lesson:
      'An explicit operating model (hub-and-spoke with named decision rights) is the component most strategies omit — but publish the strategy at the start of its period.',
  },
  {
    id: 'hmrc-research-future-strategy',
    title: 'HMRC Research Future Strategy (data access strategy)',
    org: 'HM Revenue and Customs (with ADR UK)',
    date: '2025-08',
    url: 'https://www.gov.uk/government/publications/hmrc-research-future-strategy',
    sections: [
      'Improving data access: Datalab enhancements, trusted research environments, options for secure cloud remote access',
      'Governance and documentation review: ensuring data infrastructure meets future research needs',
      'Phased implementation: Phase 1 to March 2026 (preparation, feasibility scoping); Phase 2 from April 2026 (full implementation, migration of research-ready data, DEA accreditation review)',
    ],
    strengths: [
      'Sharply scoped with a dated two-phase implementation plan',
      'Externally funded and co-owned with ADR UK (£100k grant), anchored to Digital Economy Act accreditation and the Five Safes model',
      'Built from researcher and stakeholder feedback — user-needs-led',
    ],
    weaknesses: [
      'Covers research access only — HMRC has no single public department-wide data strategy; broader data commitments sit inside the July 2025 Transformation Roadmap',
      'Departmental data governance, quality and internal analytics are out of scope',
    ],
    lesson:
      'A narrow, funded, dated, partner-backed strategy for one capability can outperform a broad unfunded one — but someone must still own the whole-department picture.',
  },
  {
    id: 'fcdo-digital-development-strategy',
    title: 'Digital Development Strategy 2024 to 2030',
    org: 'Foreign, Commonwealth & Development Office',
    date: '2024-04',
    url: 'https://www.gov.uk/government/publications/digital-development-strategy-2024-to-2030',
    sections: [
      'Last-mile connectivity (support 20+ partner countries to halve digital divides by 2030)',
      'Digital transformation of partner countries',
      'Digital inclusion',
      'Digital responsibility',
      'Digital sustainability',
    ],
    strengths: [
      'Concrete numeric targets with dates (e.g. reduce digital divides by an average of 50% in 20 partner countries by 2030)',
      'Positions internal capability (‘data-driven diplomacy’, DDaT skills) as an enabler of the external mission',
    ],
    weaknesses: [
      'Not a departmental data strategy: it is outward-facing development programming, and FCDO has no published internal data strategy — ‘data-driven diplomacy’ ambitions exist only in blogs',
      'Internal data governance, quality, architecture and workforce are absent',
    ],
    lesson:
      'The absence of a published departmental data strategy is itself a failure mode — external-facing digital ambitions cannot substitute for internal data management.',
  },
  {
    id: 'ofsted-strategy-2022-2027',
    title: 'Ofsted strategy 2022 to 2027 (no standalone data strategy)',
    org: 'Ofsted',
    date: '2022-04',
    url: 'https://www.gov.uk/government/publications/ofsted-strategy-2022-to-2027',
    sections: [
      'Corporate strategy with data and insight strands rather than a data strategy',
      'Statistical publications and the Data View tool, governed under the Code of Practice for Statistics',
      'User-needs review of statistical publications, leading to extended management-information commentaries and rationalised release frequency',
    ],
    strengths: [
      'Statistics production is user-needs-reviewed and OSR-regulated; inspection data products (IDSR) are systematically fed back to providers',
    ],
    weaknesses: [
      'No standalone public data strategy could be found (verified 2026-07): data ambitions are scattered across the corporate strategy, statistics governance and blogs',
      'As the department’s key regulator counterpart, the lack of a published data strategy weakens system-level data planning in education',
    ],
    lesson:
      'Regulators and arm’s-length bodies in the same system often lack their own data strategies — a departmental strategy should state how it engages the wider system’s data estate.',
  },
  {
    id: 'scot-health-social-care-data-strategy',
    title: 'Data Strategy for Health and Social Care',
    org: 'Scottish Government and COSLA',
    date: '2023-02',
    url: 'https://www.gov.scot/publications/data-strategy-health-social-care-2/',
    sections: [
      'Joint foreword and Data Board chair foreword',
      'Introduction and vision',
      'Ethical approaches to data',
      'Data access',
      'Talent and culture',
      'Protecting and sharing data',
      'Technology and infrastructure',
      'Information standards and interoperability',
      'Creating insights from data',
      'Supporting research and innovation',
      'Aligning our work to Scotland’s priorities',
      'Annex A: delivering our strategy',
      'Annex B: your health and social care data rights',
      'Annex C: glossary',
    ],
    strengths: [
      'Jointly owned with local government (COSLA) — cross-tier ownership from day one, built on public consultation through 2022',
      'Standing governance: a Health and Social Care Data Board plus Data Delivery and Data Standards sub-boards',
      'Annual public progress updates (2024 and 2025) restating priorities each year',
      'Citizen-facing annex setting out individuals’ data rights in plain language',
    ],
    weaknesses: [
      'Ambitions are broad and person-centred but delivery detail is relegated to an annex',
      'Progress depends on wider NHS Scotland digital programmes outside the strategy’s control',
    ],
    lesson:
      'Standing governance boards plus a committed annual public update cadence keep a strategy alive after publication day.',
  },
  {
    id: 'mhra-data-strategy-2024-2027',
    title: 'MHRA Data Strategy 2024–2027',
    org: 'Medicines and Healthcare products Regulatory Agency',
    date: '2024-09',
    url: 'https://www.gov.uk/government/publications/mhra-data-strategy-2024-2027/mhra-data-strategy-2024-2027',
    sections: [
      'Executive summary',
      'Context',
      'Lay summary',
      'Digital and technology',
      'Theme 1: Support data-driven innovation, early access and interdisciplinary data science',
      'Theme 2: Enable effective, timely and proportionate regulatory decision-making through real-world evidence',
      'Theme 3: Develop, extend and integrate capabilities in data and digital technologies',
      'Theme 4: Establish, embed and expand synergistic partnerships across the data ecosystem',
      'Theme 5: Safely and responsibly harness AI and advanced analytics throughout the product lifecycle',
    ],
    strengths: [
      'Includes a lay summary — rare, and directly serves public trust and accessibility',
      'Concrete deliverables listed under each theme (e.g. evaluating common data models and federated analytics)',
      'Anchored on a named flagship data asset (CPRD, 65m patients) and a single-point-of-truth system (RegulatoryConnect)',
      'Dedicated AI theme with ‘safely and responsibly’ framing — data strategy and AI governance joined up',
    ],
    weaknesses: [
      'No formal roadmap, milestones or measurement framework — deliverables are undated',
      'Light on funding and workforce numbers',
    ],
    lesson:
      'Anchoring a strategy to named flagship data assets and adding a lay summary make it tangible; undated deliverables remain its Achilles heel.',
  },
  {
    id: 'dfe-childrens-social-care-data-digital-strategy',
    title: 'Children’s social care data and digital strategy',
    org: 'The education department',
    date: '2023-12',
    url: 'https://www.gov.uk/government/publications/childrens-social-care-data-and-digital-strategy/childrens-social-care-data-and-digital-strategy',
    sections: [
      'About the strategy',
      'Children’s social care reviews context (Stable Homes, Built on Love)',
      'Our work so far',
      'Identifying the challenges',
      'Addressing the challenges',
      'Objective 1: Supporting strong data culture and leadership',
      'Objective 2: Supporting systems and technology to meet sector need',
      'Objective 3: Improving the data we collect, share and use',
      'As a result of our strategy',
      'Next steps',
    ],
    strengths: [
      'The department’s most recent data-strategy prior art — sector-facing, with concrete 2023–25 commitments: information-sharing agreement templates, open data and technology standards, an updated dashboard, a family-courts data-linking pilot with the MoJ, an NHS Spine information-sharing test',
      'Grounded in an independent review evidence base and honest about sector challenges',
    ],
    weaknesses: [
      'Covers only one sub-domain (children’s social care) with a two-year horizon — The department has no published department-wide data strategy; its last general one was the 2012 open data strategy',
      'No funding line or measurement framework in the published document',
    ],
    lesson:
      'The department has strategy fragments (children’s social care, digital blog strategy, the EES platform) but no whole-department data strategy — the gap this workbench exists to fill.',
  },
];

export const COMPARATOR_BY_ID: Record<string, Comparator> = Object.fromEntries(
  COMPARATORS.map((c) => [c.id, c]),
);

/**
 * Which comparators are worth reading for each Author section template —
 * with one line on what to steal from that strategy for that section.
 */
export const SECTION_COMPARATORS: Record<string, { comparatorId: string; note: string }[]> = {
  vision: [
    { comparatorId: 'moj-data-strategy', note: 'One memorable central objective — ‘get data of the right quality to the people who need it’ — that every initiative traces back to.' },
    { comparatorId: 'dwp-data-strategy-2023-2030', note: 'A vision that bakes ‘responsibly, lawfully and at scale’ into its own wording and sets a 2030 horizon with phases.' },
  ],
  principles: [
    { comparatorId: 'home-office-ddat-2024', note: 'Six named principles plus an ‘Assuring these principles’ section — a self-policing mechanism most strategies lack.' },
    { comparatorId: 'dft-transport-data-strategy', note: 'An explicit ‘open by default’ posture stated as a decision-forcing stance, not an aspiration.' },
  ],
  'users-needs': [
    { comparatorId: 'dhsc-data-saves-lives', note: 'Chapters organised by audience — public, professionals, decision-makers, researchers, innovators — rather than by internal function.' },
    { comparatorId: 'hmrc-research-future-strategy', note: 'A strategy built from researcher and stakeholder feedback, so scope follows evidenced user need.' },
    { comparatorId: 'ofsted-strategy-2022-2027', note: 'Statistics outputs user-needs-reviewed under OSR regulation, with inspection data products fed back to providers.' },
  ],
  'commitments-obligations': [
    { comparatorId: 'dhsc-data-saves-lives', note: '102 dated commitments collected in an annex — the most audit-friendly commitments structure in government.' },
    { comparatorId: 'dfe-childrens-social-care-data-digital-strategy', note: 'The department’s own prior art: concrete two-year commitments (sharing-agreement templates, standards, cross-department pilots) tied to a review evidence base.' },
  ],
  'architecture-platforms': [
    { comparatorId: 'home-office-ddat-2024', note: 'Names a target architecture — federated, with authoritative data stores owned by core business areas — an explicit, arguable choice.' },
    { comparatorId: 'mhra-data-strategy-2024-2027', note: 'Anchors the strategy to named flagship data assets (CPRD) and a single-point-of-truth system.' },
    { comparatorId: 'moj-data-strategy', note: 'Data catalogue discovery and critical-dataset mapping as an early, visible deliverable.' },
  ],
  'standards-interoperability': [
    { comparatorId: 'dft-transport-data-strategy', note: 'A named standing owner for standards — the Transport Data Standards Panel — plus a sector data catalogue and quarterly roundtables.' },
    { comparatorId: 'home-office-ddat-2024', note: 'An authoritative register of all technologies and products to force convergence and reuse.' },
  ],
  identifiers: [
    { comparatorId: 'home-office-ddat-2024', note: 'Authoritative data stores per core entity give identifiers a home, each with a named owning business area.' },
  ],
  'data-quality': [
    { comparatorId: 'moj-data-strategy', note: 'Quality is the centre of gravity — the single objective is data of the right quality, with a ‘data fundamentals’ follow-up on governance basics.' },
    { comparatorId: 'dwp-data-strategy-2023-2030', note: 'Priority 1 couples quality with interoperability inside modern business applications — quality fixed where data is created.' },
  ],
  'governance-ownership': [
    { comparatorId: 'dwp-data-strategy-2023-2030', note: 'A federated hub-and-spoke operating model: a central Chief Data Office sets standards while business domains own local decisions.' },
    { comparatorId: 'scot-health-social-care-data-strategy', note: 'Standing governance — a Data Board with delivery and standards sub-boards — jointly owned with local government.' },
    { comparatorId: 'moj-data-strategy', note: 'Structural change shipped with the strategy: a first CDO, a new Data Board and a Data Improvement Programme.' },
  ],
  'legal-basis': [
    { comparatorId: 'scot-health-social-care-data-strategy', note: 'A citizen-facing annex stating individuals’ data rights in plain language, alongside a protecting-and-sharing chapter.' },
    { comparatorId: 'hmrc-research-future-strategy', note: 'Access anchored to Digital Economy Act accreditation and the Five Safes, so the legal route is designed in from the start.' },
  ],
  'ethics-trust': [
    { comparatorId: 'dhsc-data-saves-lives', note: 'A dedicated public-trust chapter placed first, added after the GPDPR opt-out crisis — trust designed in as chapter one.' },
    { comparatorId: 'mhra-data-strategy-2024-2027', note: 'A lay summary — rare, and directly serving public trust and accessibility.' },
    { comparatorId: 'scot-health-social-care-data-strategy', note: 'An ‘ethical approaches to data’ chapter plus a plain-language statement of citizens’ data rights.' },
  ],
  'workforce-culture': [
    { comparatorId: 'dwp-data-strategy-2023-2030', note: 'Priority 7 spells out the trio: embed a data culture, drive literacy for all staff, build specialist capability.' },
    { comparatorId: 'moj-data-strategy', note: 'A whole pillar on building a culture that values data as a strategic asset, backed by named enabler roles.' },
  ],
  'analytics-ai': [
    { comparatorId: 'mhra-data-strategy-2024-2027', note: 'A dedicated AI theme framed ‘safely and responsibly’ — data strategy and AI governance joined up rather than bolted on.' },
    { comparatorId: 'dwp-data-strategy-2023-2030', note: 'Insight teams deployed across all dimensions of business performance, with self-service insight as its own priority.' },
  ],
  'open-data-research': [
    { comparatorId: 'hmrc-research-future-strategy', note: 'A sharply scoped, funded research-access plan: Datalab, TREs and secure cloud remote access on a dated two-phase timeline.' },
    { comparatorId: 'dhsc-data-saves-lives', note: 'Secure data environments made the default access route for researchers, implementing the Goldacre review.' },
    { comparatorId: 'dft-transport-data-strategy', note: '‘Open by default’ stated for a whole sector, with a catalogue to make what is published discoverable.' },
  ],
  security: [
    { comparatorId: 'home-office-ddat-2024', note: 'Declares data the primary asset and models the technical architecture around collecting, securing and processing it.' },
  ],
  'delivery-roadmap': [
    { comparatorId: 'dhsc-data-saves-lives', note: '102 commitments each with a delivery date, annexed, then publicly tracked in an annual implementation update.' },
    { comparatorId: 'moj-data-strategy', note: 'A three-phase, three-year roadmap — prototyping, learning by doing, empowering others — published with the strategy.' },
    { comparatorId: 'hmrc-research-future-strategy', note: 'A dated two-phase plan with phases sized to the funding actually secured.' },
  ],
  funding: [
    { comparatorId: 'hmrc-research-future-strategy', note: 'Externally funded and co-owned with ADR UK — phases sized to a real grant, not to aspiration.' },
    { comparatorId: 'dhsc-data-saves-lives', note: 'The cautionary tale: 11 commitments hit significant delays explicitly including funding — ambition outran resourcing.' },
  ],
  measurement: [
    { comparatorId: 'dhsc-data-saves-lives', note: 'An annual public implementation update tracking every commitment as delivered, minor delay or significant delay.' },
    { comparatorId: 'scot-health-social-care-data-strategy', note: 'A committed annual public update cadence that restates priorities each year and keeps the strategy alive.' },
    { comparatorId: 'dft-transport-data-strategy', note: 'A commitment to an annual review of strategy progress written into the document itself.' },
  ],
};
