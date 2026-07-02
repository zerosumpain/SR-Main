// rubric.ts — the review rubric behind the Author's deep review (/author/review endpoint).
// Distilled from the 2026-07-02 best-practice research sweep: comparator strategies (DHSC,
// MoJ, DfT, Home Office, DWP, HMRC, Scotland, MHRA), government frameworks (DMA for
// Government, Government Data Quality Framework, NDS M&E framework, NAO senior-leaders
// guide) and the NAO/PAC/IfG failure-mode literature. Section keys match the Author's
// section-template ids in ./templates.ts.

/** Per-section quality criteria, phrased as checkable statements. */
export const SECTION_CRITERIA: Record<string, string[]> = {
  vision: [
    'Contains one explicit vision statement of 75 words or fewer that names what data enables for the department’s mission, with a target year — not just ‘better use of data’',
    'Names the beneficiary groups (learners and families, frontline professionals, policymakers, researchers)',
    'Every top-level aim maps to a departmental outcome rather than a data activity',
    'States which categories of data and which organisational units and ALBs are in and out of scope, and how the strategy relates to the sibling digital, technology and AI strategies',
    'Quantifies the current estate (systems, key datasets, volumes, collections) and admits at least three specific weaknesses in plain language',
  ],
  principles: [
    'Between 4 and 8 named principles',
    'Each principle carries an operational implication (‘which means we will…’) rather than an aspiration',
    'Principles are actually referenced by later commitments or an assurance mechanism',
    'No two principles conflict without a stated tiebreaker',
  ],
  'users-needs': [
    'Names distinct internal and external user groups of the department’s data',
    'Cites engagement or consultation evidence for their needs (dates, methods, respondent counts)',
    'Each major initiative is traceable to at least one named user need',
  ],
  'commitments-obligations': [
    'Names the current central artefacts it aligns to (the modern digital government blueprint and roadmap, the National Data Library, cross-government data standards) with specific hooks',
    'Commits to participating in cross-government instruments (Data Maturity Assessment, data marketplace or catalogue contributions)',
    'States how the department’s sector ecosystem (ALBs, regulators, local authorities, providers) is brought along',
  ],
  'architecture-platforms': [
    'Names a target architecture pattern (federated, centralised or hybrid) with rationale',
    'Identifies authoritative sources or registers for the department’s core entities',
    'Explicitly addresses legacy system migration or coexistence, not just the target state',
    'States the platform and tooling direction (cloud, self-service analytics, catalogue) at least at capability level',
    'Commits to a data catalogue or inventory with a delivery date, metadata standards for all new collections, and a findability target for critical datasets',
  ],
  'standards-interoperability': [
    'Names specific standards to adopt (not merely ‘we will use standards’), covering both semantic definitions and technical formats and APIs',
    'Designates an ownership and assurance mechanism for standards (panel, board, or gate in spend controls)',
    'Commits to alignment with cross-government and sector standards rather than inventing local ones',
    'Includes a conformance route for new collections and procurements',
  ],
  identifiers: [
    'Names the canonical identifier for each core entity (learner, institution, workforce member) and its authoritative register',
    'States the matching and linking approach where identifiers are absent',
    'Assigns ownership for reference and master data domains',
  ],
  'data-quality': [
    'References the Government Data Quality Framework or equivalent named dimensions (accuracy, completeness, uniqueness, consistency, timeliness, validity)',
    'Commits to fixing quality at source with named dataset owners, not downstream cleansing alone',
    'Defines how quality of critical datasets will be measured and reported, and at what cadence',
    'Includes root-cause remediation for recurring quality failures',
  ],
  'governance-ownership': [
    'Names a single accountable senior owner (CDO or equivalent) and a standing board with a stated remit',
    'Defines domain-level data owners and stewards across the department and its ALBs',
    'States decision rights explicitly: who approves new collections, sharing and standards exceptions',
    'Describes the operating model (centralised, federated or hub-and-spoke) and how the centre and domains interact',
  ],
  'legal-basis': [
    'Identifies the department’s statutory gateways and lawful bases for its main data uses',
    'Distinguishes data-protection lawful basis from vires (the legal power to collect and share)',
    'Embeds DPIA and IG review into delivery processes rather than as an afterthought',
    'Does not present the law as a blanket blocker — states how legal questions get resolved and by whom, and addresses cultural and incentive barriers to sharing, not only legal and technical ones',
    'Distinguishes internal staff access, cross-government sharing and third-party sharing, with mechanisms for each and named standard artefacts (data sharing agreement templates, API standards) plus who maintains them',
  ],
  'ethics-trust': [
    'References the government Data and AI Ethics Framework (or equivalent) and states how it is operationalised — e.g. ethics review or self-assessment for new uses',
    'Includes a public engagement and transparency plan with named channels',
    'Addresses consent, objection or opt-out handling where person-level data is used',
    'Commits to publishing how data is used and shared (e.g. a transparency register)',
  ],
  'workforce-culture': [
    'Sets a data-literacy ambition for all staff plus a professional capability plan for data specialists',
    'Names recruitment and retention actions for data professions (pay frameworks, career paths)',
    'Includes leadership-level data capability actions (board literacy, decision forums that use data)',
    'Culture actions go beyond training courses (incentives, communities, exemplars)',
  ],
  'analytics-ai': [
    'Identifies priority analytics and AI use cases tied to departmental outcomes',
    'States the AI governance and assurance route (ethics framework, model risk, human oversight)',
    'Links AI ambitions to data readiness prerequisites (quality, catalogue, architecture) rather than treating them independently',
  ],
  'open-data-research': [
    'States an openness posture (e.g. open by default with defined exceptions)',
    'Names the publication channels and standards used (official statistics code, open formats)',
    'Commits to transparency about algorithmic and automated decision-making',
    'Commits to accredited secure research access using TREs, the Five Safes and DEA accreditation, naming research partnerships (e.g. ADR UK) and flagship linked datasets',
    'Sets service standards for researcher access (application turnaround, cost model)',
  ],
  security: [
    'Addresses security by design for data platforms and sharing mechanisms',
    'Covers resilience and recovery for the department’s critical data assets',
    'References the relevant security standards or NCSC guidance',
  ],
  'delivery-roadmap': [
    'Contains dated milestones, each with a named owner',
    'The first 12 months are specified at deliverable level, not theme level',
    'Dependencies and sequencing between workstreams are acknowledged',
    'Committed items are clearly separated from exploratory (‘we will explore’) items',
  ],
  funding: [
    'Identifies the funding source or envelope for delivery (Spending Review line, programme budget, partner funding)',
    'Distinguishes funded commitments from unfunded ambitions explicitly',
    'Includes a benefits case or value narrative linking investment to savings and outcomes',
  ],
  measurement: [
    'Defines success metrics with baselines and targets, including maturity movement on the Data Maturity Assessment',
    'Cites a completed maturity or capability assessment, with its date, as the baseline',
    'Commits to public progress reporting at a stated cadence (at least annual)',
    'Names who reviews progress and has the authority to re-prioritise',
    'Evaluates the strategy itself (logic model or theory of change), not only individual projects',
  ],
};

/** Whole-document criteria the deep review applies across sections. */
export const DOCUMENT_CRITERIA: string[] = [
  'The document reads as one strategy: vision, principles, commitments and roadmap reference each other rather than standing as disconnected lists',
  'Every commitment on the roadmap has a funding line behind it, with funded items explicitly distinguished from unfunded ambitions',
  'A single accountable senior owner and standing governance are named with decision rights, so nothing on the roadmap is ownerless',
  'The strategy can measure itself: baselined indicators, targets and a public reporting cadence are stated, not implied',
  'The current state is honestly assessed — a dated maturity assessment, a quantified estate and admitted weaknesses',
  'Children’s data carries an explicitly higher bar: ethics, transparency and objection-handling are designed in, not appended',
  'Delivery is credible: a deliverable-level first-12-months slice, named owners, acknowledged dependencies and a funded legacy remediation path',
  'The strategy states how it plugs into the cross-government agenda (the digital centre, the National Data Library, shared standards) and how it brings the sector along',
];

/** Documented failure modes of departmental data strategies, from NAO/PAC/IfG and comparator post-mortems. */
export const FAILURE_MODES: string[] = [
  'Watch for a culture of tolerating and working around poor data instead of fixing it at source — every downstream use inherits the defects (NAO, 2019)',
  'Watch for fragmented leadership with no single accountable owner or standing board — strategies without one drift (PAC, 2019)',
  'Watch for commitments published without a funding line — ambition without resourcing becomes a delivery report of delays (Data Saves Lives implementation update)',
  'Watch for missing common standards and identifiers — the NAO found over 20 ways of identifying individuals across just 10 departments, making linkage structurally impossible',
  'Watch for a strategy that describes only the target state and ignores legacy systems — an unfunded remediation path fails operationally (NAO, 2022; DWP state-pension underpayments)',
  'Watch for public trust treated as an afterthought — one badly-engaged programme (GPDPR, 2021) triggered an opt-out surge that taxed every later use of the data',
  'Watch for hedged ‘explore/consider’ commitments with no dated roadmap — without dates, owners and a first-12-months slice, a strategy is a position paper (DfT, 2023)',
  'Watch for misdiagnosing cultural barriers as legal ones — the IfG found existing law (DEA, UK GDPR) was not the pandemic-era blocker; incentives, risk appetite and relationships were',
  'Watch for no mechanism to measure the strategy itself — no baselined indicators, logic model or public reporting cadence (the NDS M&E framework is the exception that proves the rule)',
  'Watch for a strategy stale by publication — DWP’s 2023–2030 strategy appeared in January 2026, three years into its own period, turning commitments into retrospective narrative',
  'Watch for fragmented partial strategies with no whole-department view — research-access-only, one sub-sector, or outward-facing digital, with nobody owning the whole estate (DfE’s last department-wide artefact dates from 2012)',
];

/** The canonical components of a strong departmental data strategy, weighted, for the missing-components check. */
export const COMPONENT_CHECKLIST: { id: string; title: string; weight: number }[] = [
  { id: 'vision-and-outcomes', title: 'Vision and outcomes', weight: 5 },
  { id: 'scope-and-definitions', title: 'Scope, definitions and relationship to other strategies', weight: 3 },
  { id: 'principles', title: 'Principles', weight: 4 },
  { id: 'user-needs-and-personas', title: 'User needs and personas', weight: 4 },
  { id: 'baseline-current-state', title: 'Baseline and honest current-state assessment', weight: 4 },
  { id: 'data-architecture-and-platforms', title: 'Data architecture and platforms', weight: 4 },
  { id: 'standards-and-interoperability', title: 'Standards and interoperability', weight: 5 },
  { id: 'identifiers-and-master-data', title: 'Identifiers and master data', weight: 4 },
  { id: 'data-quality', title: 'Data quality', weight: 5 },
  { id: 'metadata-catalogue-discoverability', title: 'Metadata, cataloguing and discoverability', weight: 4 },
  { id: 'governance-and-ownership', title: 'Governance, ownership and operating model', weight: 5 },
  { id: 'ethics-and-public-trust', title: 'Ethics and public trust', weight: 5 },
  { id: 'legal-basis-and-information-governance', title: 'Legal basis and information governance', weight: 4 },
  { id: 'data-sharing-and-access', title: 'Data sharing and access (internal and cross-government)', weight: 4 },
  { id: 'open-data-and-transparency', title: 'Open data and transparency', weight: 3 },
  { id: 'research-access', title: 'Research and secure external access', weight: 4 },
  { id: 'analytics-ai-and-innovation', title: 'Analytics, AI and innovation', weight: 4 },
  { id: 'workforce-skills-and-culture', title: 'Workforce, skills and culture', weight: 5 },
  { id: 'security-and-resilience', title: 'Security and resilience', weight: 4 },
  { id: 'funding-and-resourcing', title: 'Funding and resourcing', weight: 5 },
  { id: 'delivery-roadmap-and-milestones', title: 'Delivery roadmap and milestones', weight: 5 },
  { id: 'measurement-and-review', title: 'Measurement, evaluation and review cadence', weight: 5 },
  { id: 'cross-government-alignment', title: 'Alignment with the cross-government data agenda', weight: 4 },
];
