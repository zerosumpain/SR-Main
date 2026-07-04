// templates.ts — the section skeleton of a strong departmental data strategy,
// distilled from the comparator strategies (DHSC, MoJ, DfT, Home Office) and the
// government frameworks (DMA for Government, Government Data Quality Framework,
// National Data Strategy) gathered in the 2026-07-02 research sweep.
// Guidance is enriched by Task B2 with per-section exemplars + the review rubric.

import type { HeuristicId } from './heuristics';

export interface SectionTemplate {
  id: string;
  title: string;
  /** What a strong version of this section does (shown in the guidance panel). */
  guidance: string;
  /** Questions the section should answer — writing prompts. */
  prompts: string[];
  /** A short exemplar observation from a comparator strategy. */
  exemplar?: string;
  /** Which completeness heuristics apply to this section. */
  heuristics: HeuristicId[];
}

export interface StrategySection {
  id: string;
  templateId: string | null;
  title: string;
  html: string;
}

export interface StrategyDoc {
  title: string;
  sections: StrategySection[];
  updatedAt: number;
}

const ALL: HeuristicId[] = ['substance', 'dates', 'owner', 'measurable', 'evidence', 'plain-english'];
const PROSE: HeuristicId[] = ['substance', 'evidence', 'plain-english'];

export const SECTION_TEMPLATES: SectionTemplate[] = [
  {
    id: 'vision',
    title: 'Vision & case for change',
    guidance:
      'One page that a Secretary of State, a head teacher and a data engineer would all recognise. Say what will be different for children and learners when the strategy has worked, why now (the commitments, the pressures, the cost of inaction), and the two or three big shifts the department is choosing to make. Avoid abstract aspiration — anchor every claim to a real problem the department has today.',
    prompts: [
      'What will be measurably different for a child, a school and an analyst in three years?',
      'Which of the white-paper commitments make the status quo untenable?',
      'What are the 2–3 big shifts (not 12)? What are you explicitly NOT doing?',
    ],
    heuristics: ['substance', 'dates', 'measurable', 'plain-english'],
  },
  {
    id: 'principles',
    title: 'Principles',
    guidance:
      'A handful of principles that actually bind decisions — each one should fail a real test sometimes, or it is a platitude. Good principles resolve arguments: collect once use many times; data is shared by default within the law; every dataset has an owner; build on standards before building systems; children\'s data demands a higher bar of care.',
    prompts: [
      'For each principle: name a real decision this year it would change.',
      'What tension does each principle resolve (openness vs safeguarding, centralise vs federate)?',
      'Which principle protects children and learners specifically?',
    ],
    heuristics: PROSE,
  },
  {
    id: 'users-needs',
    title: 'Users & their needs',
    guidance:
      'Who the strategy serves, in their own terms: ministers and policy leads, the department analysts, schools and trusts, local authorities, children and families, researchers, other departments. For each: what they need from data that they cannot get today, and the moments that matter (an admissions decision, a safeguarding referral, a funding allocation).',
    prompts: [
      'Which user is worst served by the current estate? What does it cost them?',
      'What does a school get BACK for the data it gives the department?',
      'Which needs are met by joining up existing data rather than collecting more?',
    ],
    heuristics: PROSE,
  },
  {
    id: 'commitments-obligations',
    title: 'Commitments & obligations',
    guidance:
      'The delivery wall the strategy must answer: the statutory duties (consistent identifier, children-not-in-school registers, safeguarding information-sharing), the white-paper commitments (school profiles, digital ISPs, Best Start records), and the cross-government mandates (DUAA, One Login, the digital blueprint, the National Data Library). State each obligation, who owns it, and what the strategy does about it — the commitments ledger in this workbench is the source.',
    prompts: [
      'Which statutory duties bind the department, and by when?',
      'Which commitments create NEW data flows or partners the estate does not support today?',
      'Where do two commitments demand the same underlying capability (build once)?',
    ],
    heuristics: ALL,
  },
  {
    id: 'architecture-platforms',
    title: 'Architecture & platforms',
    guidance:
      'The target data architecture and the honest current state: the data spine / single view of a learner, the collections estate (census → API-first), the analytical platform, cataloguing and discovery. Name the major platform decisions (build/buy/reuse, cloud, the spine\'s scope) and the migration path — not a technology shopping list, but the architecture the commitments require.',
    prompts: [
      'What is the target architecture for the learner record (the spine), and what stages get there?',
      'Which collections move to API-first / event-driven (like attendance) and when?',
      'What is the single source of truth for each core entity (learner, setting, workforce)?',
    ],
    heuristics: ALL,
  },
  {
    id: 'standards-interoperability',
    title: 'Standards & interoperability',
    guidance:
      'How data joins up: the standards the department adopts (and mandates), API strategy, common reference data, metadata and cataloguing. Be specific about which standards are adopted verbatim, which are profiled for education, and how compliance is assured across a federated system of thousands of settings and suppliers.',
    prompts: [
      'Which data standards will the department mandate for suppliers (MIS vendors) and by when?',
      'What is the API strategy — who can build on the department data, and how do they discover it?',
      'How are standards governed — who decides, who assures, who funds adoption?',
    ],
    heuristics: ALL,
  },
  {
    id: 'identifiers',
    title: 'Identifiers & the single view',
    guidance:
      'The identifier layer beneath everything: the consistent identifier for children (CWSA s.4 / Children Act 2004 s.16LC), UPN/ULN futures, matching and linkage policy, and how identity is handled across the child\'s journey (early years → school → post-16 → HE/work). This is where the strategy earns its data spine.',
    prompts: [
      'How does the consistent-identifier duty change UPN/ULN — replace, map or wrap?',
      'What is the matching/linkage service, who runs it, and what quality bar does it meet?',
      'How are identifier errors detected and corrected — and who is accountable?',
    ],
    heuristics: ALL,
  },
  {
    id: 'data-quality',
    title: 'Data quality & management',
    guidance:
      'Quality by design, not audit-after: the Government Data Quality Framework applied to the education estate — accuracy, completeness, timeliness, validity at the point of collection; quality metrics on the critical datasets; the data lifecycle including retention and deletion. Tie every quality claim to a measure.',
    prompts: [
      'Which 5–10 critical datasets get quality SLAs first, and what are the SLAs?',
      'How is quality fixed at source (school MIS, LA systems) rather than in cleansing?',
      'What is the retention and deletion posture for children\'s data?',
    ],
    heuristics: ALL,
  },
  {
    id: 'governance-ownership',
    title: 'Governance & ownership',
    guidance:
      'Who decides, who owns, who assures: the data operating model (central team vs federated stewards), the Chief Data Officer\'s mandate, information asset ownership, the boards that arbitrate, and how governance stays proportionate — enabling sharing rather than blocking it. Name roles, not sentiments.',
    prompts: [
      'Who is the named owner for each critical data asset?',
      'What decision rights does the CDO actually hold (budget, standards veto, quality gates)?',
      'How does governance speed up lawful sharing instead of slowing it?',
    ],
    heuristics: ['substance', 'owner', 'evidence', 'plain-english'],
  },
  {
    id: 'legal-basis',
    title: 'Legal basis & information rights',
    guidance:
      'The lawful footing, layer by layer: data-protection bases (UK GDPR/DPA 2018), the statutory gateways and duties (CWSA duty to share, DEA 2017, DUAA 2025 provisions), and the governance instruments (DSAs, DPIAs). Distinguish "lawful basis to process" from "legal power to share" — the vires distinction — and say how new flows get legal cover quickly and safely.',
    prompts: [
      'For each major new flow, what is the power to share AND the protection basis?',
      'What does DUAA 2025 change for the department (recognised legitimate interests, research reuse)?',
      'What is the standard route (and target time) from "we need this flow" to a signed DSA?',
    ],
    heuristics: ['substance', 'evidence', 'plain-english'],
  },
  {
    id: 'ethics-trust',
    title: 'Ethics, transparency & public trust',
    guidance:
      'The licence to operate, especially for children\'s data: the ethics framework applied to real decisions, algorithmic transparency (ATRS entries for every algorithmic tool), how children and parents are told what is held and shared, engagement with the sector\'s safeguarding-vs-privacy split, and red lines the department will not cross.',
    prompts: [
      'What are the red lines for children\'s data (uses the department will never make)?',
      'How do parents and young people see, question and correct data about them?',
      'Which algorithmic tools get ATRS entries and independent review?',
    ],
    heuristics: PROSE,
  },
  {
    id: 'workforce-culture',
    title: 'Workforce, skills & culture',
    guidance:
      'The people who make the strategy real: the data profession (recruitment, retention, mixed teams), data literacy for policy and delivery colleagues, leadership fluency, and the culture shift from data-as-burden to data-as-asset — in the department AND the sector it works through.',
    prompts: [
      'What is the target shape of the data profession (roles, seniority, location) by year?',
      'What does every policy lead need to be able to do with data unaided?',
      'What reduces the data burden on schools — and what new skill does the sector need?',
    ],
    heuristics: ALL,
  },
  {
    id: 'analytics-ai',
    title: 'Analytics, AI & decisions',
    guidance:
      'How data becomes decisions: the analytical operating model, evaluation by default, and a deliberate AI posture — where AI is used (targeting support, early warning, content), the safeguards (product safety expectations, bias testing, human-in-the-loop), and the data foundations AI actually needs (the content store, quality, licensing).',
    prompts: [
      'Which decisions get decision-support first (RISE targeting, NEET risk, attendance)?',
      'What is the AI assurance route — who signs off a model touching children\'s data?',
      'What data foundations must precede the AI ambitions (quality, linkage, licensing)?',
    ],
    heuristics: ALL,
  },
  {
    id: 'open-data-research',
    title: 'Open data, research & the wider ecosystem',
    guidance:
      'The estate as national infrastructure: what is published openly (EES, the API), how researchers get safe access (ONS SRS/IDS, ADR UK, the National Data Library), how LEO and linked data grow, and what the department contributes to — and asks of — the cross-government data ecosystem.',
    prompts: [
      'What is the default: which data is open, which safe-access, which closed — and why?',
      'How does a researcher get from question to safe data access, and how long does it take?',
      'What does the department contribute to the National Data Library, and on what terms?',
    ],
    heuristics: PROSE,
  },
  {
    id: 'security',
    title: 'Security & resilience',
    guidance:
      'Protecting a high-value, high-sensitivity estate: security posture for children\'s data, supplier and MIS-vendor assurance, resilience of the critical services (what happens when the attendance feed fails), and incident response including the sector-facing duty of candour when things go wrong.',
    prompts: [
      'Which services are criticial national infrastructure in all but name, and what resilience bar do they meet?',
      'How is the supply chain (MIS vendors, platforms) assured for children\'s data?',
      'What is the incident playbook — including telling schools and families?',
    ],
    heuristics: PROSE,
  },
  {
    id: 'delivery-roadmap',
    title: 'Delivery roadmap',
    guidance:
      'The strategy\'s spine of credibility: sequenced milestones with owners and dates, the first-100-days moves, dependencies (what must precede what), and the funding line each phase draws on. A strategy without a roadmap is a pamphlet. Use the Plan tab to build this and keep it consistent with the commitments\' statutory deadlines.',
    prompts: [
      'What lands in year 1 that users will notice — and what proves momentum in 100 days?',
      'Which milestones are fixed by statute (registers, identifier regulations) vs chosen?',
      'What is explicitly sequenced AFTER the foundations (and resisted until then)?',
    ],
    heuristics: ALL,
  },
  {
    id: 'funding',
    title: 'Funding & sustainability',
    guidance:
      'How the strategy is paid for: the funding envelope and its sources (SR settlements, programme budgets), the run-vs-change split, what happens at the spending-review boundary, and the efficiency case (what the strategy saves or unlocks — burden reduction, collection consolidation, reuse over rebuild).',
    prompts: [
      'What does the strategy cost by year, and which budget line carries it?',
      'What is the efficiency/benefits case — cashable and non-cashable?',
      'What gets stopped or consolidated to fund the new (collections, duplicative platforms)?',
    ],
    heuristics: ALL,
  },
  {
    id: 'measurement',
    title: 'Measuring the strategy',
    guidance:
      'How the department will know the strategy is working: a small set of measures with baselines and targets (maturity assessment scores, quality SLAs met, time-to-data-share, burden hours on schools, API adoption), who reviews them and how often, and the trigger points for changing course. The strategy should hold itself to the standard it sets for everyone else.',
    prompts: [
      'What are the 6–10 measures, their baselines and their year-3 targets?',
      'Who reviews progress, at what cadence, with what power to redirect?',
      'What would cause the department to STOP part of the strategy?',
    ],
    heuristics: ALL,
  },
];

export const TEMPLATE_BY_ID: Record<string, SectionTemplate> = Object.fromEntries(
  SECTION_TEMPLATES.map((t) => [t.id, t]),
);

/** A fresh strategy document seeded with every core section, empty. */
export function newDoc(): StrategyDoc {
  return {
    title: 'Education data strategy — working draft',
    sections: SECTION_TEMPLATES.map((t) => ({ id: t.id, templateId: t.id, title: t.title, html: '' })),
    updatedAt: 0,
  };
}
