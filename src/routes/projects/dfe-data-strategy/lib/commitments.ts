// commitments.ts — the commitments ledger. Every data-relevant commitment in the
// 2024→2026 white-paper landscape that DfE must deliver, produce, support or comply
// with, synthesized from a nine-agent research sweep of primary sources (gov.uk,
// legislation.gov.uk, parliament.uk) on 2026-07-02, merged, de-duplicated and
// verified before freeze. Integrity enforced by lib/__tests__/commitments.test.ts;
// methodology documented on the method page. GENERATED from the research sweep —
// edit deliberately, and keep every record's sourceUrls + confidence honest.

import type { Commitment, CommitmentStatus, CommitmentTheme, DfeRole, PolicyDocument } from './types';

// Colors validated (dataviz six-checks, light surface) 2026-07-02: lightness band,
// chroma floor, adjacent-pair CVD (with glyph/gap/label secondary encoding), contrast.
// THEME_ORDER is the validated fixed legend/assignment order — never cycle or repaint.
export const THEME_ORDER: CommitmentTheme[] = [
  'identifiers',
  'analytics',
  'standards',
  'accountability',
  'safeguarding',
  'data-sharing',
  'funding',
  'new-service',
  'ai',
  'workforce',
  'infrastructure',
  'register',
];

export const THEME_META: Record<CommitmentTheme, { label: string; color: string }> = {
  identifiers: { label: 'Identifiers', color: '#8a2d3a' },
  analytics: { label: 'Analytics & evidence', color: '#0086a3' },
  standards: { label: 'Standards', color: '#a06a1f' },
  accountability: { label: 'Accountability', color: '#4558b2' },
  safeguarding: { label: 'Safeguarding', color: '#b04a2f' },
  'data-sharing': { label: 'Data sharing', color: '#2c6fa3' },
  funding: { label: 'Funding & oversight', color: '#9a6416' },
  'new-service': { label: 'New services', color: '#2f7a4f' },
  ai: { label: 'AI', color: '#7d3c78' },
  workforce: { label: 'Workforce', color: '#6f8034' },
  infrastructure: { label: 'Infrastructure', color: '#4d6ba8' },
  register: { label: 'Registers', color: '#8a63c9' },
};

export const STATUS_META: Record<CommitmentStatus, { label: string; short: string; rank: number }> = {
  'statutory-duty': { label: 'Statutory duty — in force', short: 'Statutory', rank: 0 },
  'legislated-not-commenced': { label: 'Legislated, not yet commenced', short: 'Legislated', rank: 1 },
  'in-delivery': { label: 'In delivery', short: 'Delivering', rank: 2 },
  announced: { label: 'Announced', short: 'Announced', rank: 3 },
  proposed: { label: 'Proposed', short: 'Proposed', rank: 4 },
  consulting: { label: 'In consultation', short: 'Consulting', rank: 5 },
};

export const ROLE_META: Record<DfeRole, { label: string; note: string }> = {
  owner: { label: 'DfE owns it', note: 'DfE is accountable for delivering this commitment.' },
  deliverer: { label: 'DfE delivers', note: 'DfE builds or runs a major part of it.' },
  partner: { label: 'DfE partners', note: 'Another department leads; DfE must supply or receive data.' },
  complier: { label: 'DfE complies', note: 'A cross-government mandate DfE must meet.' },
};

export const DOCUMENTS: PolicyDocument[] = [
  {
    "id": "send-ap-improvement-plan-2023",
    "title": "SEND and Alternative Provision Improvement Plan",
    "shortName": "SEND & AP Plan 2023",
    "type": "action-plan",
    "publisher": "DfE / DHSC",
    "date": "2023-03",
    "url": "https://www.gov.uk/government/publications/send-and-alternative-provision-improvement-plan",
    "oneLiner": "2023 response to the SEND green paper: national standards, standardised/digitised EHCPs, inclusion dashboards, tailored lists, AP performance framework — largely stalled and superseded by the 2026 white paper.",
    "status": "published"
  },
  {
    "id": "csc-data-digital-strategy",
    "title": "Children's social care data and digital strategy",
    "shortName": "CSC Data Strategy",
    "type": "strategy",
    "publisher": "Department for Education",
    "date": "2023-12",
    "url": "https://www.gov.uk/government/publications/childrens-social-care-data-and-digital-strategy/childrens-social-care-data-and-digital-strategy",
    "oneLiner": "DfE's long-term plan for children's social care data: national dashboard, standard local dataset, open standards, automated collections, CP-IS improvement and NHS-number-as-identifier testing.",
    "status": "published"
  },
  {
    "id": "agency-data-return",
    "title": "Agency child and family social workers: data return and price caps",
    "shortName": "Agency SW Data Return",
    "type": "guidance",
    "publisher": "Department for Education",
    "date": "2024-05",
    "url": "https://www.gov.uk/government/publications/agency-child-and-family-social-workers-data-return-and-price-caps",
    "oneLiner": "Operational guidance for the quarterly statutory data collection on agency child and family social worker use and pay, and regional price caps (price-cap data from Q4 2025).",
    "status": "published"
  },
  {
    "id": "trs-repo",
    "title": "Teaching Record System (DFE-Digital/teaching-record-system)",
    "shortName": "TRS Repo",
    "type": "roadmap",
    "publisher": "DfE Digital (GitHub)",
    "date": "2024-06",
    "url": "https://github.com/DFE-Digital/teaching-record-system",
    "oneLiner": "Public repo for the Teaching Record System — modernising the Database of Qualified Teachers into DfE's primary teacher record (TRN-keyed) with APIs for consuming services.",
    "status": "published"
  },
  {
    "id": "content-store-announcement",
    "title": "Teachers to get more trustworthy AI tech (education content store announcement)",
    "shortName": "AI Content Store",
    "type": "blog",
    "publisher": "DfE / DSIT",
    "date": "2024-08",
    "url": "https://www.gov.uk/government/news/teachers-to-get-more-trustworthy-ai-tech-as-generative-tools-learn-from-new-bank-of-lesson-plans-and-curriculums-helping-them-mark-homework-and-save",
    "oneLiner": "£4m package: £3m DSIT-funded education content store pooling curriculum guidance, lesson plans and anonymised pupil assessments for AI training, plus £1m tool prizes.",
    "status": "published"
  },
  {
    "id": "attendance-data-guidance",
    "title": "Share your daily school attendance data (attendance data solution)",
    "shortName": "Attendance Data Guidance",
    "type": "guidance",
    "publisher": "Department for Education",
    "date": "2024-09",
    "url": "https://www.gov.uk/guidance/share-your-daily-school-attendance-data",
    "oneLiner": "Statutory guidance for the daily attendance data solution: automated twice-daily extraction of pupil-level attendance from school MIS to DfE, mandatory since academic year 2024/25.",
    "status": "published"
  },
  {
    "id": "attendance-dpia",
    "title": "School attendance data collection: data protection impact assessment",
    "shortName": "Attendance DPIA",
    "type": "evidence",
    "publisher": "Department for Education",
    "date": "2024-09",
    "url": "https://assets.publishing.service.gov.uk/media/66d83f677a73423428aa2f14/School_attendance_data_collection_DPIA.pdf",
    "oneLiner": "DPIA for the automated daily attendance collection, documenting pupil-level flows from school MIS to DfE and stating the ambition to extend automated collection to other data.",
    "status": "published"
  },
  {
    "id": "get-britain-working",
    "title": "Get Britain Working White Paper",
    "shortName": "Get Britain Working",
    "type": "white-paper",
    "publisher": "DWP (with DfE and DHSC)",
    "date": "2024-11",
    "url": "https://www.gov.uk/government/publications/get-britain-working-white-paper/get-britain-working-white-paper",
    "oneLiner": "80% employment ambition (26 November 2024): Youth Guarantee for 18-21s and merger of Jobcentre Plus and the National Careers Service into a new jobs and careers service.",
    "status": "published"
  },
  {
    "id": "kcshft",
    "title": "Keeping children safe, helping families thrive (CP 1200)",
    "shortName": "KCSHFT 2024",
    "type": "strategy",
    "publisher": "Department for Education",
    "date": "2024-11",
    "url": "https://www.gov.uk/government/publications/keeping-children-safe-helping-families-thrive",
    "oneLiner": "Policy statement setting the children's social care reform agenda: single unique identifier, information-sharing duty, multi-agency child protection teams, provider financial oversight — legislated via the CWSA 2026.",
    "status": "published"
  },
  {
    "id": "english-devolution-wp",
    "title": "English Devolution White Paper: Power and Partnership",
    "shortName": "Devolution WP",
    "type": "white-paper",
    "publisher": "MHCLG",
    "date": "2024-12",
    "url": "https://www.gov.uk/government/publications/english-devolution-white-paper-power-and-partnership-foundations-for-growth/english-devolution-white-paper",
    "oneLiner": "Strategic authorities, integrated settlements and central-local data partnership — enacted April 2026.",
    "status": "enacted"
  },
  {
    "id": "plan-for-change",
    "title": "Plan for Change: Milestones for Mission-led Government",
    "shortName": "Plan for Change",
    "type": "strategy",
    "publisher": "Cabinet Office / No.10",
    "date": "2024-12",
    "url": "https://www.gov.uk/government/publications/plan-for-change",
    "oneLiner": "No.10's Parliament milestones — the school-ready target rides on DfE's EYFSP collection.",
    "status": "published"
  },
  {
    "id": "ai-opportunities-action-plan",
    "title": "AI Opportunities Action Plan",
    "shortName": "AI Action Plan",
    "type": "action-plan",
    "publisher": "DSIT",
    "date": "2025-01",
    "url": "https://www.gov.uk/government/publications/ai-opportunities-action-plan/ai-opportunities-action-plan",
    "oneLiner": "50 recommendations (all accepted in substance) covering AI infrastructure, unlocking public data via a National Data Library, and Scan>Pilot>Scale public-sector AI adoption; 38/50 met at one year.",
    "status": "published"
  },
  {
    "id": "blueprint-modern-digital-government",
    "title": "A blueprint for modern digital government",
    "shortName": "Digital Gov Blueprint",
    "type": "strategy",
    "publisher": "DSIT / Government Digital Service",
    "date": "2025-01",
    "url": "https://www.gov.uk/government/publications/a-blueprint-for-modern-digital-government/a-blueprint-for-modern-digital-government-html",
    "oneLiner": "Six-point plan for digital government reform: join up services, harness AI, strengthen digital/data infrastructure, talent, funding reform, transparency — with explicit departmental mandates.",
    "status": "published"
  },
  {
    "id": "genai-product-safety",
    "title": "Generative AI: product safety expectations",
    "shortName": "GenAI Safety Expectations",
    "type": "guidance",
    "publisher": "Department for Education",
    "date": "2025-01",
    "url": "https://www.gov.uk/government/publications/generative-ai-product-safety-expectations",
    "oneLiner": "Safety expectations for generative AI products in education (filtering, logging, security, data protection); expanded 19 Jan 2026 with cognitive-development, mental-health and manipulation standards.",
    "status": "published"
  },
  {
    "id": "ai-playbook-uk-government",
    "title": "Artificial Intelligence Playbook for the UK Government",
    "shortName": "AI Playbook",
    "type": "guidance",
    "publisher": "Government Digital Service",
    "date": "2025-02",
    "url": "https://www.gov.uk/government/publications/ai-playbook-for-the-uk-government",
    "oneLiner": "10 principles and lifecycle guidance for safe, responsible AI use by departments; supersedes the 2024 Generative AI Framework; works alongside the mandatory ATRS transparency standard.",
    "status": "published"
  },
  {
    "id": "evaluation-registry-guidance",
    "title": "Guidance on using the Evaluation Registry",
    "shortName": "Evaluation Registry Guidance",
    "type": "guidance",
    "publisher": "Evaluation Task Force (Cabinet Office / HM Treasury)",
    "date": "2025-03",
    "url": "https://www.gov.uk/guidance/guidance-on-using-the-evaluation-registry",
    "oneLiner": "Public Evaluation Registry launched March 2025; mandatory for all ministerial departments to register planned, live and completed evaluations from 1 April 2024 onwards.",
    "status": "published"
  },
  {
    "id": "ffp-guide",
    "title": "Families First Partnership programme guide",
    "shortName": "FFP Guide",
    "type": "guidance",
    "publisher": "Department for Education",
    "date": "2025-03",
    "url": "https://www.gov.uk/government/publications/families-first-partnership-programme",
    "oneLiner": "Delivery guide for Family Help, multi-agency child protection and FGDM reforms from April 2025, with quarterly programme data collections and fully operational services expected by March 2027.",
    "status": "published"
  },
  {
    "id": "entitlements-expansion-guidance",
    "title": "September 2025 early education and childcare entitlements expansion: local authority system guidance",
    "shortName": "Entitlements Expansion Guidance",
    "type": "guidance",
    "publisher": "Department for Education",
    "date": "2025-05",
    "url": "https://assets.publishing.service.gov.uk/media/683981d4c99c4f37ab4e86e3/September_2025_early_education_and_childcare_entitlements_expansion_-_local_authority_system_guidance_May_2025.pdf",
    "oneLiner": "System guidance for the 30-hours working-parent entitlement from September 2025: HMRC eligibility codes, DfE Eligibility Checking System verification, and a planned ECS replacement service.",
    "status": "published"
  },
  {
    "id": "ifate-transfer-act-2025",
    "title": "Institute for Apprenticeships and Technical Education (Transfer of Functions etc) Act 2025",
    "shortName": "IfATE Transfer Act",
    "type": "act",
    "publisher": "UK Parliament",
    "date": "2025-05",
    "url": "https://www.legislation.gov.uk/ukpga/2025/14",
    "oneLiner": "IfATE abolished 1 June 2025; occupational standards and assessment-plan functions transferred to the Secretary of State, delegated to Skills England (executive agency from 2 June 2025).",
    "status": "enacted"
  },
  {
    "id": "data-use-access-act-2025",
    "title": "Data (Use and Access) Act 2025",
    "shortName": "DUAA 2025",
    "type": "act",
    "publisher": "UK Parliament",
    "date": "2025-06",
    "url": "https://www.legislation.gov.uk/ukpga/2025/18",
    "oneLiner": "Royal Assent 19 June 2025: smart data schemes, statutory digital verification services, UK GDPR reforms (recognised legitimate interests, research, ADM) and ICO reform; main data-protection changes in force 5 Feb 2026.",
    "status": "enacted"
  },
  {
    "id": "devereux-review-ons",
    "title": "Independent review of the performance and culture of the ONS (Devereux Review)",
    "shortName": "Devereux Review",
    "type": "review",
    "publisher": "Cabinet Office",
    "date": "2025-06",
    "url": "https://www.gov.uk/government/publications/independent-review-of-the-performance-and-culture-of-the-office-for-national-statistics/independent-review-by-sir-robert-devereux-kcb-june-2025",
    "oneLiner": "Found deep-seated ONS quality problems (incl. errors from departmental data supply); triggered leadership split, a recovery plan and planned UKSA legislation change — raising the bar for supplier departments like DfE.",
    "status": "published"
  },
  {
    "id": "fsm-expansion-2026",
    "title": "Free school meals expansion to Universal Credit households",
    "shortName": "FSM Expansion",
    "type": "guidance",
    "publisher": "Department for Education",
    "date": "2025-06",
    "url": "https://www.gov.uk/government/news/over-half-a-million-more-children-to-get-free-school-meals",
    "oneLiner": "From September 2026 all pupils in Universal Credit households become FSM-eligible, supported by a rebuilt eligibility checking service (all LAs from 1 June 2026) verified against DWP/HMRC data.",
    "status": "published"
  },
  {
    "id": "rba-admin-guidance",
    "title": "Reception baseline assessment: administration guidance (2025 digital RBA)",
    "shortName": "Digital RBA Guidance",
    "type": "guidance",
    "publisher": "Standards and Testing Agency / DfE",
    "date": "2025-06",
    "url": "https://www.gov.uk/government/publications/reception-baseline-assessment-administration-guidance/2025-reception-baseline-assessment-administration-guidance",
    "oneLiner": "Statutory guidance for the fully digital reception baseline assessment from September 2025, administered via two DfE Sign-in assessment services.",
    "status": "published"
  },
  {
    "id": "spending-review-2025",
    "title": "Spending Review 2025",
    "shortName": "SR25",
    "type": "strategy",
    "publisher": "HM Treasury",
    "date": "2025-06",
    "url": "https://www.gov.uk/government/publications/spending-review-2025-document/spending-review-2025-html",
    "oneLiner": "SR25 (11 June 2025): £1.9bn to DSIT for cross-cutting digital priorities incl. the NDL and GOV.UK Wallet/App; all departments to deliver >=5% savings and >=11% real-terms admin cuts by 2028-29.",
    "status": "published"
  },
  {
    "id": "best-start-strategy",
    "title": "Giving every child the best start in life (CP 1362)",
    "shortName": "Best Start strategy",
    "type": "strategy",
    "publisher": "DfE / DHSC",
    "date": "2025-07",
    "url": "https://www.gov.uk/government/publications/giving-every-child-the-best-start-in-life/giving-every-child-the-best-start-in-life",
    "oneLiner": "Cross-government early years strategy: Best Start Family Hubs in every LA, a national Best Start digital service, workforce reform and a 75% good-level-of-development target by 2028.",
    "status": "published"
  },
  {
    "id": "ees-api-docs",
    "title": "Explore education statistics API documentation",
    "shortName": "EES API Docs",
    "type": "guidance",
    "publisher": "Department for Education",
    "date": "2025-07",
    "url": "https://api.education.gov.uk/statistics/docs/",
    "oneLiner": "REST API (v1) for programmatic access to EES open statistics datasets — summary, query and CSV-download endpoints; dataset coverage expanding.",
    "status": "published"
  },
  {
    "id": "ten-year-health-plan",
    "title": "Fit for the Future: 10 Year Health Plan for England",
    "shortName": "10-Year Health Plan",
    "type": "strategy",
    "publisher": "DHSC",
    "date": "2025-07",
    "url": "https://www.gov.uk/government/publications/10-year-health-plan-for-england-fit-for-the-future",
    "oneLiner": "The NHS's decade plan — single patient record, NHS App front door, neighbourhood health; the health side of every child-record join.",
    "status": "published"
  },
  {
    "id": "how-dfe-shares",
    "title": "How DfE shares personal data",
    "shortName": "DfE Data Sharing Guidance",
    "type": "guidance",
    "publisher": "Department for Education",
    "date": "2025-09",
    "url": "https://www.gov.uk/guidance/data-protection-how-we-collect-and-share-research-data",
    "oneLiner": "DfE's published approach to sharing personal data for research: ONS Secure Research Service as the default route; the ONS Integrated Data Service was removed as an access route in September 2025.",
    "status": "published"
  },
  {
    "id": "ofsted-eif-nov-2025",
    "title": "Education inspection framework: for use from November 2025 (report cards)",
    "shortName": "Ofsted EIF 2025",
    "type": "framework",
    "publisher": "Ofsted",
    "date": "2025-09",
    "url": "https://www.gov.uk/government/publications/education-inspection-framework/education-inspection-framework-for-use-from-november-2025",
    "oneLiner": "Renewed inspection framework in force 10 November 2025: report cards grading six areas on a 5-point scale replace single-word judgements; contextual data published alongside outcomes from September 2026.",
    "status": "published"
  },
  {
    "id": "school-accountability-reform-response",
    "title": "School accountability reform - school profiles, improvement and intervention: government consultation response",
    "shortName": "Accountability Reform Response",
    "type": "consultation",
    "publisher": "Department for Education",
    "date": "2025-09",
    "url": "https://www.gov.uk/government/consultations/school-accountability-reform",
    "oneLiner": "September 2025 response confirming digital school profiles as the central source of school performance information, piloted in 2025/26, plus expanded RISE intervention.",
    "status": "published"
  },
  {
    "id": "post16-white-paper",
    "title": "Post-16 Education and Skills White Paper (CP 1412)",
    "shortName": "Post-16 WP",
    "type": "white-paper",
    "publisher": "DfE / DWP / DSIT",
    "date": "2025-10",
    "url": "https://www.gov.uk/government/publications/post-16-education-and-skills-white-paper/post-16-education-and-skills-white-paper",
    "oneLiner": "Published 20 October 2025: three-part plan for skills, FE and HE — V Levels, Skills England data role, NEET tracking, LEO maximisation, HE regulation and franchising crackdown.",
    "status": "published"
  },
  {
    "id": "car-final-report",
    "title": "Curriculum and Assessment Review: Final Report",
    "shortName": "C&A Review",
    "type": "review",
    "publisher": "Curriculum and Assessment Review (chair: Prof Becky Francis)",
    "date": "2025-11",
    "url": "https://www.gov.uk/government/publications/curriculum-and-assessment-review-final-report",
    "oneLiner": "Independent review of England's national curriculum and statutory assessment, recommending evolution not revolution across 5-19; actioned via the government response.",
    "status": "published"
  },
  {
    "id": "car-government-response",
    "title": "Curriculum and Assessment Review Final Report: government response",
    "shortName": "C&A Review Response",
    "type": "strategy",
    "publisher": "Department for Education",
    "date": "2025-11",
    "url": "https://www.gov.uk/government/publications/curriculum-and-assessment-review-final-report-government-response",
    "oneLiner": "Government's accepted programme: new machine-readable curriculum spring 2027 (first teaching Sept 2028), Year 8 reading test, EBacc removal, Progress 8 reform, on-screen assessment steer.",
    "status": "published"
  },
  {
    "id": "child-poverty-strategy",
    "title": "Child Poverty Strategy",
    "shortName": "Child Poverty Strategy",
    "type": "strategy",
    "publisher": "Cabinet Office / DWP / DfE",
    "date": "2025-11",
    "url": "https://www.gov.uk/government/news/over-half-a-million-children-to-be-lifted-out-of-poverty-as-government-unveils-historic-child-poverty-strategy",
    "oneLiner": "Cross-government strategy folding in the FSM Universal Credit expansion, breakfast clubs and crisis support; frames the education-poverty data agenda (eligibility data, take-up).",
    "status": "published"
  },
  {
    "id": "op-encompass-duty",
    "title": "Duty on police to notify education settings of domestic abuse incidents (Operation Encompass)",
    "shortName": "Op Encompass duty",
    "type": "guidance",
    "publisher": "Home Office",
    "date": "2025-11",
    "url": "https://www.gov.uk/government/publications/information-sharing-duty-operation-encompass/duty-on-police-forces-in-england-and-wales-to-notify-education-establishments-of-domestic-abuse-incidents-operation-encompass-accessible",
    "oneLiner": "Statutory police-to-school notification of domestic abuse incidents, in force November 2025.",
    "status": "published"
  },
  {
    "id": "bsfh-guidance",
    "title": "Best Start Family Hubs and Healthy Babies: guidance for local authorities",
    "shortName": "BSFH Guidance",
    "type": "guidance",
    "publisher": "DfE / DHSC",
    "date": "2025-12",
    "url": "https://www.gov.uk/government/publications/best-start-family-hubs-and-healthy-babies-guidance-for-local-authorities",
    "oneLiner": "Guidance for delivering Best Start Family Hubs from April 2026, including quarterly management information, twice-yearly delivery returns and digital/data leadership expectations.",
    "status": "published"
  },
  {
    "id": "nccis-mi-2026-27",
    "title": "NCCIS Management Information Requirement 2026 to 2027",
    "shortName": "NCCIS MI 2026-27",
    "type": "guidance",
    "publisher": "Department for Education",
    "date": "2025-12",
    "url": "https://assets.publishing.service.gov.uk/media/6943ca108f4636fa2c547e25/NCCIS_management_information_requirement_2026_to_2027.pdf",
    "oneLiner": "Specification of the mandatory participation-status data local authorities must record and return monthly on academic-age 16-17 year olds via the National Client Caseload Information System.",
    "status": "published"
  },
  {
    "id": "ofqual-onscreen-consultation",
    "title": "Regulating on-screen assessment (Ofqual consultation)",
    "shortName": "On-screen Assessment Consultation",
    "type": "consultation",
    "publisher": "Ofqual",
    "date": "2025-12",
    "url": "https://www.gov.uk/government/consultations/regulating-on-screen-assessment/regulating-on-screen-assessment",
    "oneLiner": "12-week consultation (closed 5 March 2026) on the regulatory framework for on-screen GCSE/AS/A level exams; decisions and detailed rules due 2026.",
    "status": "in-consultation"
  },
  {
    "id": "ai-tutoring-announcement",
    "title": "450,000 disadvantaged pupils could benefit from AI tutoring tools",
    "shortName": "AI Tutoring Announcement",
    "type": "blog",
    "publisher": "Department for Education",
    "date": "2026-01",
    "url": "https://www.gov.uk/government/news/450000-disadvantaged-pupils-could-benefit-from-ai-tutoring-tools",
    "oneLiner": "26 Jan 2026 commitment to co-create, trial (autumn 2026) and roll out (end 2027) safe AI tutoring tools for FSM pupils in years 9-11, with quality/safety benchmarks.",
    "status": "announced"
  },
  {
    "id": "education-record-news",
    "title": "Government modernises exam records with new app",
    "shortName": "Education Record App",
    "type": "blog",
    "publisher": "Department for Education",
    "date": "2026-01",
    "url": "https://www.gov.uk/government/news/government-modernises-exam-records-with-new-app",
    "oneLiner": "National rollout of the Education Record app: every Year 11 in England gets GCSE results digitally from summer 2026, with GOV.UK Wallet linkage underway.",
    "status": "announced"
  },
  {
    "id": "roadmap-modern-digital-government-2026",
    "title": "A roadmap for modern digital government 2025-2030",
    "shortName": "Digital Gov Roadmap",
    "type": "roadmap",
    "publisher": "GDS / DSIT",
    "date": "2026-01",
    "url": "https://gds.blog.gov.uk/2026/01/20/our-roadmap-for-modern-digital-government/",
    "oneLiner": "Whole-public-sector action plan to 2030: GOV.UK App/Chat/Wallet rollout, One Login adoption, common API standards, 1-in-10 digital workforce target, published product roadmaps and metrics.",
    "status": "published"
  },
  {
    "id": "sen2-guide-2026",
    "title": "Special educational needs survey (SEN2 person level): guide 2026",
    "shortName": "SEN2 Guide 2026",
    "type": "guidance",
    "publisher": "Department for Education",
    "date": "2026-01",
    "url": "https://assets.publishing.service.gov.uk/media/6937018aa6fc97b81e5743a7/Special_educational_needs_survey_guide_2026.pdf",
    "oneLiner": "Guidance for the statutory person-level SEN2 return; the 2026 collection makes DSCO, request-source and phase-transfer/annual-review date items compulsory.",
    "status": "published"
  },
  {
    "id": "ks4-performance-consultation",
    "title": "Key stage 4 performance measures and targeted RISE extension (consultation)",
    "shortName": "KS4 Measures Consultation",
    "type": "consultation",
    "publisher": "Department for Education",
    "date": "2026-02",
    "url": "https://consult.education.gov.uk/school-accountability/key-stage-4-performance-measures-and-targeted-rise/",
    "oneLiner": "Consultation (closed 4 May 2026) on the improved Progress 8/Attainment 8 model with science and breadth slots, first applying to GCSEs sat in 2029.",
    "status": "in-consultation"
  },
  {
    "id": "local-outcomes-framework",
    "title": "Local Outcomes Framework (first edition)",
    "shortName": "Local Outcomes Fwk",
    "type": "framework",
    "publisher": "MHCLG",
    "date": "2026-02",
    "url": "https://www.gov.uk/government/publications/local-outcomes-framework/local-outcomes-framework",
    "oneLiner": "Sixteen national priority outcomes for local government — the child outcomes measured almost entirely with DfE data.",
    "status": "published"
  },
  {
    "id": "ndtfg-report-2026",
    "title": "The Neurodivergence Task and Finish Group: report",
    "shortName": "Neurodivergence TFG Report",
    "type": "review",
    "publisher": "Neurodivergence Task and Finish Group (commissioned by DfE)",
    "date": "2026-02",
    "url": "https://www.gov.uk/government/publications/neurodivergence-task-and-finish-group-report",
    "oneLiner": "Independent expert report (published 23 Feb 2026 with the white paper) on supporting neurodivergent children in mainstream settings without diagnosis-dependency, calling for better local data linkage.",
    "status": "published"
  },
  {
    "id": "rise-policy",
    "title": "Regional improvement for standards and excellence (RISE): policy statement",
    "shortName": "RISE Policy",
    "type": "guidance",
    "publisher": "Department for Education",
    "date": "2026-02",
    "url": "https://www.gov.uk/government/publications/regional-improvement-for-standards-and-excellence-rise/regional-improvement-for-standards-and-excellence-rise",
    "oneLiner": "RISE teams: universal service on four national priorities plus targeted intervention for schools identified through Ofsted inspection data, with a published eligible-schools list.",
    "status": "published"
  },
  {
    "id": "schools-white-paper-2026",
    "title": "Every Child Achieving and Thriving (Schools White Paper, CP 1508)",
    "shortName": "Schools WP 2026",
    "type": "white-paper",
    "publisher": "Department for Education",
    "date": "2026-02",
    "url": "https://www.gov.uk/government/publications/every-child-achieving-and-thriving",
    "oneLiner": "Ten-year schools and SEND reform vision (23 February 2026): attendance targets, AI-benchmarked expectations, school profiles, digital Individual Support Plans, tiered SEND support, analytics and evidence-based AI tools.",
    "status": "published"
  },
  {
    "id": "send-reform-consultation-2026",
    "title": "SEND reform: putting children and young people first",
    "shortName": "SEND Reform Consultation",
    "type": "consultation",
    "publisher": "Department for Education",
    "date": "2026-02",
    "url": "https://www.gov.uk/government/consultations/send-reform-putting-children-and-young-people-first",
    "oneLiner": "Consultation published alongside the Schools White Paper (closed 18 May 2026) detailing the reformed 0-25 SEND system; government response pending as of July 2026.",
    "status": "published"
  },
  {
    "id": "digital-id-scheme-consultation",
    "title": "Digital ID scheme: explainer and public consultation",
    "shortName": "Digital ID Consultation",
    "type": "consultation",
    "publisher": "HM Government (Cabinet Office / DSIT)",
    "date": "2026-03",
    "url": "https://www.gov.uk/government/publications/digital-id-scheme-explainer/digital-id-scheme-explainer",
    "oneLiner": "National digital ID: voluntary for citizens (mandatory-for-work plan dropped Jan 2026), but digital right-to-work checks to be legislated as mandatory; rollout targeted by end of Parliament.",
    "status": "in-consultation"
  },
  {
    "id": "cwsa-2026",
    "title": "Children's Wellbeing and Schools Act 2026 (c. 21)",
    "shortName": "CWSA 2026",
    "type": "act",
    "publisher": "UK Parliament (DfE sponsor)",
    "date": "2026-04",
    "url": "https://www.legislation.gov.uk/ukpga/2026/21/contents/enacted",
    "oneLiner": "Flagship children's social care and schools legislation (Royal Assent 29 April 2026): information-sharing duty, consistent identifier power, Children Not in School registers, MAT inspection, multi-agency child protection teams, provider financial oversight, admissions and FSM provisions.",
    "status": "enacted"
  },
  {
    "id": "lle-overview",
    "title": "Lifelong learning entitlement: what it is and how it will work",
    "shortName": "LLE Overview",
    "type": "guidance",
    "publisher": "Department for Education",
    "date": "2026-05",
    "url": "https://www.gov.uk/government/publications/lifelong-learning-entitlement-lle-overview/lifelong-learning-entitlement-overview",
    "oneLiner": "LLE policy overview: applications from September 2026 for courses/modules starting 1 January 2027; SLC-hosted personal account and standardised module transcripts.",
    "status": "published"
  },
  {
    "id": "moj-data-first",
    "title": "Ministry of Justice Data First — the MoJ–DfE linked dataset",
    "shortName": "MoJ Data First",
    "type": "evidence",
    "publisher": "MoJ",
    "date": "2026-05",
    "url": "https://www.gov.uk/guidance/ministry-of-justice-data-first",
    "oneLiner": "Justice records linked person-level to the NPD and social-care data — the flagship cross-department linkage.",
    "status": "published"
  },
  {
    "id": "post16-pathways-implementation-plan",
    "title": "Post-16 pathways: implementation plan",
    "shortName": "Post-16 Pathways Plan",
    "type": "action-plan",
    "publisher": "Department for Education",
    "date": "2026-05",
    "url": "https://www.gov.uk/government/publications/post-16-pathways-implementation-plan/post-16-pathways-implementation-plan",
    "oneLiner": "First V Levels taught from September 2027; every provider must submit a Strategic Transition Planning Statement by 6 July 2026; defunding list for 153 qualifications from August 2027.",
    "status": "published"
  },
  {
    "id": "franchise-arrangements-guidance",
    "title": "Franchise arrangements for higher education providers",
    "shortName": "HE Franchising Guidance",
    "type": "guidance",
    "publisher": "Department for Education",
    "date": "2026-06",
    "url": "https://www.gov.uk/government/publications/franchise-arrangements-for-higher-education-providers/franchise-arrangements-for-higher-education-providers",
    "oneLiner": "Implements the 2025 consultation decision: franchised providers with 300+ students must register with OfS from AY 2028/29; complements OfS Condition E10 subcontracting transparency.",
    "status": "published"
  },
  {
    "id": "ndl-plan-june-2026",
    "title": "Our plan for the National Data Library",
    "shortName": "NDL Plan",
    "type": "roadmap",
    "publisher": "DSIT / GDS",
    "date": "2026-06",
    "url": "https://www.data.gov.uk/roadmap/",
    "oneLiner": "June 2026 roadmap relaunching data.gov.uk as the NDL: curated collections (incl. an Early Years spotlight), data manual, then a 'single trusted gateway' to public-sector data.",
    "status": "published"
  },
  {
    "id": "skills-needs-assessments-2026",
    "title": "Skills England Annual Skills Report and Sectoral Skills Needs Assessments 2026",
    "shortName": "Skills England SNAs 2026",
    "type": "review",
    "publisher": "Skills England / DWP",
    "date": "2026-06",
    "url": "https://www.gov.uk/government/publications/skills-england-annual-skills-report-and-sectoral-skills-needs-assessments-2026/skills-needs-assessments-introduction",
    "oneLiner": "First annual skills report plus 10 sectoral Skills Needs Assessments for Industrial Strategy sectors — the shared evidence base for local skills plans and Jobs Plans.",
    "status": "published"
  },
  {
    "id": "sui-statement-hcws115",
    "title": "Written ministerial statement HCWS115: single unique identifier implementation update",
    "shortName": "SUI Statement (Jun 2026)",
    "type": "roadmap",
    "publisher": "Department for Education",
    "date": "2026-06",
    "url": "https://questions-statements.parliament.uk/written-statements/detail/2026-06-16/hcws115",
    "oneLiner": "16 June 2026 statement on implementing the consistent identifier: test-and-learn pilots from April 2025 (starting Wigan), NHS-number matching, regulations intended by end of Parliament.",
    "status": "published"
  },
  {
    "id": "imf-methodology-2026",
    "title": "Inclusive mainstream fund for schools: methodology 2026 to 2027",
    "shortName": "IMF Methodology",
    "type": "guidance",
    "publisher": "Department for Education",
    "date": "2026-07",
    "url": "https://www.gov.uk/government/publications/inclusive-mainstream-fund-2026-to-2027/inclusive-mainstream-fund-for-schools-methodology-2026-to-2027",
    "oneLiner": "Published allocation methodology for the £500m+/yr Inclusive Mainstream Fund (census + APT low-prior-attainment formula) with the 31 December 2026 inclusion-strategy publication condition.",
    "status": "published"
  }
];

export const COMMITMENTS: Commitment[] = [
  {
    "id": "cwsa-consistent-identifier",
    "docId": "cwsa-2026",
    "title": "Consistent identifier (single unique identifier) for children",
    "what": "New section 16LC of the Children Act 2004 (inserted by s.4 CWSA) lets the Secretary of State specify by regulations a consistent identifier and designate the persons who must include it when processing information about a child for safeguarding and welfare purposes. Government's confirmed working assumption, tested in pilots, is the NHS number — enabling record-joining across school, GP, social care and other services, the join key the child-level data estate has always lacked.",
    "quote": "the designated person must include the consistent identifier in the information processed",
    "theme": "identifiers",
    "status": "legislated-not-commenced",
    "timeframe": "Royal Assent 29 April 2026; designation regulations intended by end of this Parliament; phased commencement from late 2026",
    "timeframeDate": "2029-06",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "dhsc",
        "to": "las",
        "what": "NHS numbers from the Personal Demographic Service matched to children's education and social care records"
      },
      {
        "from": "schools",
        "to": "las",
        "what": "child records tagged with the consistent identifier for safeguarding and welfare purposes"
      },
      {
        "from": "las",
        "to": "dfe",
        "what": "identifier-keyed child records reconciled against the school census and national datasets"
      }
    ],
    "newServices": [
      "national child-identifier matching capability linking school census, children's social care and NHS demographic records"
    ],
    "identifiers": [
      "consistent identifier / single unique identifier (expected NHS number)",
      "NHS number",
      "UPN and LA child IDs to be reconciled"
    ],
    "standards": [
      "designation regulations specifying the identifier and required users",
      "matching-quality standards"
    ],
    "partners": [
      "NHS England",
      "DHSC",
      "local authorities",
      "schools",
      "police",
      "Wigan Council (pilot)"
    ],
    "strategyImplication": "The single most consequential identifier decision in the children's system: DfE must govern NHS-number use outside health, sequence agency onboarding, and layer the identifier onto its UPN-based estate with matching services and data-quality remediation.",
    "eli5": "Every child will get one shared number - probably their health number - so schools, doctors and councils all know they are talking about the same child.",
    "capabilityIds": [
      "interoperability",
      "sharing"
    ],
    "pressureIds": [
      "agency-coordination",
      "consistent-child-identifier"
    ],
    "aliases": [
      "consistent identifier",
      "single unique identifier",
      "SUI",
      "16LC",
      "NHS number for children",
      "child identifier"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.legislation.gov.uk/ukpga/2026/21/section/4/enacted",
      "https://www.legislation.gov.uk/ukpga/2026/21/contents",
      "https://questions-statements.parliament.uk/written-statements/detail/2026-06-16/hcws115",
      "https://www.gov.uk/government/publications/keeping-children-safe-helping-families-thrive",
      "https://assets.publishing.service.gov.uk/media/695e578a8ab0677c14afdfc9/childrens_wellbeing_and_schools_bill_2024_policy_summary_notes.pdf",
      "https://www.gov.uk/government/news/families-to-save-up-to-1000-as-childrens-reforms-become-law",
      "https://defenddigitalme.org/2025/06/14/nhs-number-to-be-national-id-mandated-in-childrens-wellbeing-and-schools-bill/"
    ]
  },
  {
    "id": "sui-pilots-implementation",
    "docId": "sui-statement-hcws115",
    "title": "Single unique identifier pilots, matching service and implementation roadmap",
    "what": "DfE is running test-and-learn pilots (from April 2025, starting with Wigan, with NHS England and DHSC) testing the NHS number as the single unique identifier: LA access to NHS numbers and match rates between school census, children's social care and NHS Personal Demographic Service records. The programme's public architecture is a federated record-locator — a PDS-adapter matching service, get-an-identifier, find-a-record (record pointers, not case content) and fetch-a-record APIs — with LA dissemination anticipated during 2026 and regulations committed by end of Parliament.",
    "quote": "bring forward regulations at the earliest opportunity and by the end of this parliament",
    "theme": "identifiers",
    "status": "in-delivery",
    "timeframe": "Pilots from April 2025; LA dissemination during 2026; regulations by end of Parliament",
    "timeframeDate": "2029-06",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "dhsc",
        "to": "las",
        "what": "NHS numbers from the Personal Demographic Service for matching to children's records in pilot areas"
      },
      {
        "from": "las",
        "to": "dfe",
        "what": "match-rate and data-quality results from test-and-learn pilots"
      },
      {
        "from": "las",
        "to": "dfe",
        "what": "record pointers and metadata for the find-a-record locator (not case content)"
      }
    ],
    "newServices": [
      "SUI matching service (PDS adapter)",
      "get-an-identifier API",
      "find-a-record locator",
      "fetch-a-record resolution service"
    ],
    "identifiers": [
      "NHS number as candidate single unique identifier"
    ],
    "standards": [
      "data minimisation / no central case store design principle",
      "audit logging and role-based access",
      "match-rate and data-quality metrics from pilots"
    ],
    "partners": [
      "NHS England",
      "DHSC",
      "Wigan Council and successor pilot LAs"
    ],
    "strategyImplication": "A federated record-locator (pointers, not a central database) is DfE's emerging pattern for the child data spine; the strategy must reserve delivery capacity and legal gateways for rollout and decide how the census/NPD estate carries the NHS-number-based identifier alongside UPNs.",
    "eli5": "The government is testing, in a few places first, whether using each child's health number lets councils and schools find and connect a child's records without building one giant database.",
    "capabilityIds": [
      "interoperability",
      "platform"
    ],
    "pressureIds": [
      "consistent-child-identifier"
    ],
    "aliases": [
      "SUI pilots",
      "Wigan pilot",
      "NHS number matching",
      "find-a-record",
      "record locator",
      "Personal Demographic Service adapter"
    ],
    "confidence": "medium",
    "sourceUrls": [
      "https://questions-statements.parliament.uk/written-statements/detail/2026-06-16/hcws115",
      "https://www.socialworktoday.co.uk/News/government-pilots-unique-number-for-every-child-to-join-up-data-between-agencies",
      "https://github.com/DFE-Digital/single-unique-identifier",
      "https://www.ukauthority.com/articles/wigan-council-trials-nhs-number-as-identifier-for-child-protection",
      "https://www.ccinform.co.uk/practice-guidance/childrens-social-care-reforms/"
    ]
  },
  {
    "id": "cwsa-information-sharing-duty",
    "docId": "cwsa-2026",
    "title": "Statutory duty to share information for safeguarding and welfare",
    "what": "Section 4 CWSA inserts new sections 16LA-16LD into the Children Act 2004, placing a duty on safeguarding partners (LAs, ICBs, NHS trusts, police, probation, youth justice) and designated education/childcare agencies to disclose information relevant to a child's safeguarding or welfare where it may facilitate another agency's functions, unless disclosure would be more detrimental to the child. Framed as giving 'absolute clarity' on the legal basis to share, tackling practitioner over-caution; statutory guidance and sector/supplier standards work will govern its operation.",
    "quote": "we will introduce a new duty that provides absolute clarity on the legal basis to share information for the purposes of safeguarding children",
    "theme": "data-sharing",
    "status": "legislated-not-commenced",
    "timeframe": "Enacted April 2026; commencement aimed 2027 alongside child-protection provisions, with statutory guidance",
    "timeframeDate": "2027-01",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "schools",
        "to": "las",
        "what": "child-level information relevant to safeguarding or welfare"
      },
      {
        "from": "las",
        "to": "schools",
        "what": "reciprocal safeguarding-relevant information back to education and childcare agencies"
      },
      {
        "from": "dhsc",
        "to": "las",
        "what": "health-held safeguarding-relevant information under the statutory disclosure duty"
      },
      {
        "from": "home-office",
        "to": "las",
        "what": "police-held safeguarding-relevant information under the statutory disclosure duty"
      }
    ],
    "newServices": [],
    "identifiers": [
      "consistent identifier (s.16LC) to accompany shared records"
    ],
    "standards": [
      "statutory information-sharing guidance under s.16LA(6)",
      "planned sector/supplier data standards to fix information-flow problems between case-management systems"
    ],
    "partners": [
      "local authorities",
      "NHS England / ICBs",
      "police",
      "probation and youth justice",
      "schools and colleges",
      "childcare providers",
      "ICO"
    ],
    "strategyImplication": "Shifts safeguarding data sharing from permissive to expected: schools become active parties to a legal duty, and DfE owns the guidance, the supplier standards work and the demand for standardised, identifier-keyed exchange infrastructure.",
    "eli5": "People who work with children - teachers, doctors, police, social workers - will be required by law to tell each other things that help keep a child safe, instead of worrying about whether they are allowed to.",
    "capabilityIds": [
      "sharing",
      "governance"
    ],
    "pressureIds": [
      "agency-coordination",
      "public-trust"
    ],
    "aliases": [
      "duty to share information",
      "information sharing duty",
      "16LA",
      "safeguarding information sharing",
      "absolute clarity on the legal basis"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.legislation.gov.uk/ukpga/2026/21/section/4/enacted",
      "https://www.legislation.gov.uk/ukpga/2026/21/contents",
      "https://www.gov.uk/government/publications/keeping-children-safe-helping-families-thrive",
      "https://bills.parliament.uk/bills/3909",
      "https://assets.publishing.service.gov.uk/media/695e578a8ab0677c14afdfc9/childrens_wellbeing_and_schools_bill_2024_policy_summary_notes.pdf",
      "https://www.gov.uk/government/news/families-to-save-up-to-1000-as-childrens-reforms-become-law"
    ]
  },
  {
    "id": "cwsa-cnis-registers",
    "docId": "cwsa-2026",
    "title": "Children Not in School: compulsory LA registers with national data flows to DfE",
    "what": "Section 38 CWSA inserts sections 436B-436G into the Education Act 1996: every English LA must maintain a register of eligible children not in school (home-educated and otherwise), holding prescribed content including names, addresses, parents' details, providers used and flags such as SEND, child protection and looked-after status; parents must supply and update information within 15 days. New s.436F requires LAs to provide register information to the Secretary of State when directed — enabling a national CNIS collection — and permits sharing with safeguarding bodies and inspectorates, with a s.436T disclosure shield so authorised disclosures do not breach confidentiality.",
    "quote": "maintain a register of children who are eligible to be registered by the authority",
    "theme": "register",
    "status": "legislated-not-commenced",
    "timeframe": "Not commenced as of July 2026; phased rollout anticipated late 2026 into 2027 after regulations and statutory guidance",
    "timeframeDate": "2027-01",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "parents",
        "to": "las",
        "what": "registration details, education arrangements and changes within 15 days"
      },
      {
        "from": "las",
        "to": "dfe",
        "what": "children-not-in-school register data on direction, enabling a national picture"
      },
      {
        "from": "las",
        "to": "ofsted",
        "what": "register information shared with inspectorates and safeguarding bodies for child welfare purposes"
      }
    ],
    "newServices": [
      "statutory local children-not-in-school registers in every LA",
      "prospective national CNIS data collection and statistics"
    ],
    "identifiers": [
      "register entries joinable to UPN and the consistent identifier once commenced"
    ],
    "standards": [
      "regulations prescribing register content and format (s.436C)",
      "directions specifying format and frequency of national returns"
    ],
    "partners": [
      "local authorities",
      "home-educating families",
      "out-of-school education providers",
      "Ofsted",
      "Welsh Government"
    ],
    "strategyImplication": "Closes the biggest coverage gap in the education record — children outside school rolls — creating a wholly new statutory child-level dataset; DfE must specify the national data standard, collection mechanism and linkage into attendance, census and safeguarding data before commencement.",
    "eli5": "Councils will keep a list of every child who is not in school, such as children taught at home, so no child can disappear from view.",
    "capabilityIds": [
      "platform",
      "quality"
    ],
    "aliases": [
      "children not in school",
      "CNIS register",
      "home education register",
      "436B register",
      "elective home education data",
      "school attendance orders"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.legislation.gov.uk/ukpga/2026/21/section/38/enacted",
      "https://www.legislation.gov.uk/ukpga/2026/21/section/40/enacted",
      "https://educationhub.blog.gov.uk/2026/05/the-childrens-wellbeing-bill-what-parents-need-to-know/",
      "https://www.legislation.gov.uk/ukpga/2026/21/enacted",
      "https://www.gov.uk/government/news/families-to-save-up-to-1000-as-childrens-reforms-become-law",
      "https://schoolsweek.co.uk/childrens-wellbeing-and-schools-act-the-policies-signed-into-law/",
      "https://bills.parliament.uk/bills/3909"
    ]
  },
  {
    "id": "cwsa-mat-inspections",
    "docId": "cwsa-2026",
    "title": "Ofsted inspection of academy trusts (academy proprietors)",
    "what": "Section 57 CWSA provides for inspection of academy proprietors, giving Ofsted a role inspecting multi-academy trusts for the first time. This creates a new trust-level accountability dataset — inspection outcomes, evidence and management information about trusts rather than individual schools — that DfE oversight and intervention functions will consume.",
    "quote": "Inspection of Academy proprietors",
    "theme": "accountability",
    "status": "legislated-not-commenced",
    "timeframe": "Framework and methodology to be developed; no inspection start date as of July 2026",
    "dfeRole": "partner",
    "flows": [
      {
        "from": "schools",
        "to": "ofsted",
        "what": "trust-level governance, finance and performance evidence for MAT inspection"
      },
      {
        "from": "ofsted",
        "to": "dfe",
        "what": "trust inspection outcomes informing regional/RISE intervention"
      }
    ],
    "newServices": [
      "trust-level inspection reporting"
    ],
    "identifiers": [
      "trust identifiers (Companies House number, trust UID in GIAS)"
    ],
    "standards": [
      "future MAT inspection framework"
    ],
    "partners": [
      "Ofsted",
      "academy trusts"
    ],
    "strategyImplication": "Trust-level data aggregation (roll-ups across schools within a trust) becomes a first-class accountability object that must be aligned between GIAS, school profiles and Ofsted systems.",
    "eli5": "The schools inspector will now also inspect the organisations that run groups of schools, not just each school on its own.",
    "capabilityIds": [
      "quality",
      "value"
    ],
    "aliases": [
      "academy trust inspection",
      "MAT inspection",
      "inspection of academy proprietors",
      "trust-level accountability"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.legislation.gov.uk/ukpga/2026/21/section/57/enacted",
      "https://www.brownejacobson.com/insights/legal-views-on-the-childrens-wellbeing-and-schools-act-2026"
    ]
  },
  {
    "id": "cwsa-admissions-place-planning",
    "docId": "cwsa-2026",
    "title": "Admissions and place planning: co-operation duties and adjudicator role on PANs",
    "what": "Sections 61-64 CWSA require maintained schools and academy proprietors to co-operate with local authorities on admissions and place planning, extend LA powers to direct admission to academies, and give the schools adjudicator functions over published admission numbers. Operating these duties depends on exchanging forecasts, capacity and admissions data between trusts, LAs and the adjudicator.",
    "quote": "must co-operate in the exercise of their respective functions",
    "theme": "data-sharing",
    "status": "legislated-not-commenced",
    "timeframe": "Commencement phased from 2026; guidance expected",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "schools",
        "to": "las",
        "what": "admissions, capacity and PAN information for place planning"
      },
      {
        "from": "las",
        "to": "dfe",
        "what": "PAN objections and place-sufficiency evidence to the Office of the Schools Adjudicator"
      }
    ],
    "newServices": [],
    "identifiers": [],
    "standards": [
      "School Admissions Code updates"
    ],
    "partners": [
      "local authorities",
      "academy trusts",
      "Office of the Schools Adjudicator"
    ],
    "strategyImplication": "DfE needs consistent, timely place-planning data (capacity, PANs, forecasts) shared across LA/trust boundaries; school capacity data should be treated as shared infrastructure rather than locally held spreadsheets.",
    "eli5": "Schools and councils must work together and share their numbers on how many school places exist and who is applying, so every child can get a place.",
    "capabilityIds": [
      "sharing",
      "quality"
    ],
    "aliases": [
      "published admission numbers",
      "PAN objections",
      "place planning data",
      "admissions co-operation duty",
      "schools adjudicator"
    ],
    "confidence": "medium",
    "sourceUrls": [
      "https://www.legislation.gov.uk/ukpga/2026/21/section/61/enacted",
      "https://www.legislation.gov.uk/ukpga/2026/21/section/64/enacted"
    ]
  },
  {
    "id": "cwsa-macpt",
    "docId": "cwsa-2026",
    "title": "Multi-agency child protection teams (MACPTs) in every local area",
    "what": "Section 3 CWSA creates a duty on local authorities to establish multi-agency child protection teams, with ICBs and police required to contribute staff, building on the Families First for Children Pathfinder model. The aim is for provisions to come into force in 2027. Teams depend on shared case information across social care, police, health and education, and on national monitoring of multi-agency child protection activity.",
    "quote": "create a new legal duty for local authorities to establish multi-agency child protection teams",
    "theme": "safeguarding",
    "status": "legislated-not-commenced",
    "timeframe": "Aim to come into force in 2027; regulations informed by pathfinder evaluation",
    "timeframeDate": "2027-01",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "home-office",
        "to": "las",
        "what": "police staff and case information contributed to joint child protection teams"
      },
      {
        "from": "dhsc",
        "to": "las",
        "what": "health staff and case information contributed to MACPTs"
      },
      {
        "from": "schools",
        "to": "las",
        "what": "education input to child protection enquiries"
      },
      {
        "from": "las",
        "to": "dfe",
        "what": "implementation and effectiveness monitoring data via FFP quarterly collections"
      }
    ],
    "newServices": [
      "multi-agency child protection teams in every local authority area"
    ],
    "identifiers": [
      "consistent identifier expected to underpin cross-agency case matching"
    ],
    "standards": [
      "regulations specifying team composition and expectations"
    ],
    "partners": [
      "police",
      "ICBs / NHS",
      "schools",
      "local authorities"
    ],
    "strategyImplication": "Institutionalises multi-agency case data sharing at the sharpest end of the system; DfE must specify what MACPTs record and how their activity is monitored nationally.",
    "eli5": "Social workers, police officers, health staff and schools will sit in one shared team in every area, looking at the same information when a child might be in danger.",
    "capabilityIds": [
      "sharing",
      "ethics"
    ],
    "pressureIds": [
      "agency-coordination"
    ],
    "aliases": [
      "multi-agency child protection teams",
      "MACPT",
      "joint child protection team",
      "families first pathfinder"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.legislation.gov.uk/ukpga/2026/21/contents/enacted",
      "https://assets.publishing.service.gov.uk/media/695e578a8ab0677c14afdfc9/childrens_wellbeing_and_schools_bill_2024_policy_summary_notes.pdf",
      "https://www.gov.uk/government/publications/keeping-children-safe-helping-families-thrive"
    ]
  },
  {
    "id": "cwsa-provider-financial-oversight",
    "docId": "cwsa-2026",
    "title": "Financial oversight scheme for difficult-to-replace care providers (plus profit-cap power)",
    "what": "Sections 16-20 CWSA establish a DfE-run financial oversight scheme for the most 'difficult to replace' children's home and fostering providers: providers submit financial information and recovery-and-resolution plans, DfE can commission independent business reviews, must warn LAs of likely failure, and gains information-sharing provisions (s.20). Section 17 adds a backstop power to cap providers' profits, which would require ongoing profit and financial reporting; Ofsted also gains provider-group accountability and monetary penalty powers.",
    "quote": "The scheme will increase financial and corporate transparency among the most 'difficult to replace' providers",
    "theme": "accountability",
    "status": "legislated-not-commenced",
    "timeframe": "Enacted April 2026; scheme details and commencement via regulations; profit cap held as last resort",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "cscp",
        "to": "dfe",
        "what": "financial and corporate structure data, recovery and resolution plans"
      },
      {
        "from": "dfe",
        "to": "las",
        "what": "advance warnings of likely provider failure"
      },
      {
        "from": "dfe",
        "to": "ofsted",
        "what": "information sharing under s.20 for oversight functions"
      }
    ],
    "newServices": [
      "DfE financial oversight scheme (market-oversight analogue for children's social care)"
    ],
    "identifiers": [
      "provider-group / parent-undertaking identification"
    ],
    "standards": [
      "financial reporting requirements for scheme members"
    ],
    "partners": [
      "Ofsted",
      "local authorities",
      "CMA (originating recommendation)"
    ],
    "strategyImplication": "DfE becomes a market-oversight data regulator, needing corporate-structure, financial-risk and profit data on private providers — a wholly new data domain for the department.",
    "eli5": "The government will keep a close eye on the money and finances of big companies that run children's homes, so councils get a warning if one might collapse.",
    "capabilityIds": [
      "governance",
      "quality"
    ],
    "aliases": [
      "financial oversight scheme",
      "difficult to replace providers",
      "profit cap power",
      "recovery and resolution plans",
      "provider group accountability"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.legislation.gov.uk/ukpga/2026/21/contents/enacted",
      "https://www.gov.uk/government/publications/keeping-children-safe-helping-families-thrive"
    ]
  },
  {
    "id": "cwsa-kinship-data-foundations",
    "docId": "cwsa-2026",
    "title": "Kinship and care-leaver data foundations: statutory definitions, local offers and the Kinship Allowance Pilot",
    "what": "Section 5 CWSA creates a duty on LAs to publish a kinship local offer and puts statutory definitions of kinship care and kinship carers into law for the first time, enabling consistent categorisation in national data; sections 7-8 require Staying Close consideration for care leavers to 25 and strengthen the published care-leaver local offer. In parallel the £40m Kinship Allowance Pilot (Nov 2025 - Mar 2029, seven 'kinship zones') pays weekly allowances to eligible kinship carers, forcing LAs to enumerate kinship populations and giving DfE its first structured allowance-level dataset on this historically data-poor group.",
    "quote": "The Kinship Allowance Pilot will fund selected local authorities to provide a weekly financial allowance to eligible kinship carers",
    "theme": "standards",
    "status": "in-delivery",
    "timeframe": "Definitions and offer duties enacted April 2026 (commencement to be set); pilot runs November 2025 to March 2029 with national evaluation",
    "timeframeDate": "2029-03",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "las",
        "to": "parents",
        "what": "published kinship local offer and care-leaver local offer information, including Staying Close support"
      },
      {
        "from": "las",
        "to": "dfe",
        "what": "kinship population estimates, allowance payment data and evaluation data from pilot areas"
      }
    ],
    "newServices": [],
    "identifiers": [],
    "standards": [
      "first statutory definitions of 'kinship care' and 'kinship carers' enabling consistent national data categories",
      "consistent eligibility definitions for kinship carers with SGO/CAO"
    ],
    "partners": [
      "local authorities",
      "National Kinship Care Ambassador",
      "independent evaluators"
    ],
    "strategyImplication": "Statutory definitions unlock countability: DfE can build kinship and care-leaver support measures into national collections on a consistent legal footing, with the pilot supplying the first allowance-level evidence base for national rollout decisions.",
    "eli5": "When grandparents or other relatives raise a child, the government is now defining that in law, telling councils to publish what help exists, and paying some of those families in a trial to learn what works.",
    "capabilityIds": [
      "quality",
      "governance"
    ],
    "aliases": [
      "kinship local offer",
      "kinship allowance pilot",
      "kinship zones",
      "Staying Close",
      "care leaver local offer",
      "statutory definition of kinship care"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.legislation.gov.uk/ukpga/2026/21/contents/enacted",
      "https://assets.publishing.service.gov.uk/media/695e578a8ab0677c14afdfc9/childrens_wellbeing_and_schools_bill_2024_policy_summary_notes.pdf",
      "https://www.gov.uk/government/publications/keeping-children-safe-helping-families-thrive",
      "https://www.gov.uk/government/publications/apply-to-become-a-kinship-allowance-pilot-provider",
      "https://www.gov.uk/government/news/government-launches-investment-in-support-for-kinship-carers"
    ]
  },
  {
    "id": "attendance-daily-collection",
    "docId": "attendance-data-guidance",
    "title": "Mandatory daily pupil-level attendance data collection (attendance data solution)",
    "what": "Since academic year 2024/25 all state schools must share pupil-level attendance data with DfE daily, extracted automatically (twice daily) from school MIS via the Wonde-operated route under the amended 2013 pupil-information regulations. DfE, LAs and trusts get near-real-time reports (Monitor your school attendance; View Your Education Data) and DfE publishes fortnightly national statistics. This is the flagship operating data flow the White Paper's attendance ambitions build on and the template for census modernisation.",
    "quote": "mandatory for schools to share their attendance data with the Department for Education",
    "theme": "data-sharing",
    "status": "statutory-duty",
    "timeframe": "In force since September 2024; ongoing",
    "timeframeDate": "2024-09",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "schools",
        "to": "dfe",
        "what": "pupil-level attendance codes extracted automatically from MIS twice daily (via Wonde)"
      },
      {
        "from": "dfe",
        "to": "schools",
        "what": "benchmarked attendance reports and near-real-time dashboards"
      },
      {
        "from": "dfe",
        "to": "las",
        "what": "attendance dashboards and comparators for LAs and trusts"
      }
    ],
    "newServices": [
      "Monitor your school attendance",
      "View Your Education Data",
      "pupil attendance fortnightly statistics on EES"
    ],
    "identifiers": [
      "UPN linking daily attendance to census records"
    ],
    "standards": [
      "revised attendance codes under the School Attendance (Pupil Registration) (England) Regulations 2024",
      "Education (Information About Individual Pupils) (England) Regulations 2013 as amended 2024"
    ],
    "partners": [
      "Wonde",
      "MIS suppliers",
      "local authorities",
      "multi-academy trusts"
    ],
    "strategyImplication": "Daily attendance is DfE's proof-of-concept for near-real-time operational data: the strategy should codify this pattern (automated MIS-to-DfE flows, give-back dashboards) as the template for future collections.",
    "eli5": "Every school's register is sent to the government computer twice a day automatically, and schools get useful charts back showing how their attendance compares.",
    "capabilityIds": [
      "sharing",
      "platform"
    ],
    "pressureIds": [
      "attendance-data",
      "burden-on-schools"
    ],
    "aliases": [
      "daily attendance data",
      "attendance data solution",
      "share your daily school attendance",
      "Monitor your school attendance",
      "twice daily extraction",
      "Wonde attendance feed"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/guidance/share-your-daily-school-attendance-data",
      "https://www.gov.uk/government/publications/monitor-your-school-attendance-user-guide/monitor-your-school-attendance-user-guide",
      "https://explore-education-statistics.service.gov.uk/find-statistics/pupil-attendance-in-schools/2026-week-21",
      "https://explore-education-statistics.service.gov.uk/find-statistics/pupil-attendance-in-schools/2024-week-47"
    ]
  },
  {
    "id": "wp-attendance-target-abies",
    "docId": "schools-white-paper-2026",
    "title": "National attendance target and AI-benchmarked school improvement expectations (ABIEs)",
    "what": "The White Paper sets a national target to raise attendance by 1.3 percentage points to over 94% by 2028/29 (20 million more school days a year). Each school gets a personalised minimum attendance improvement expectation (Attendance Baseline Improvement Expectation), generated by AI benchmarking against similar schools using the daily attendance data, used to target support (including RISE) rather than for formal accountability.",
    "quote": "the attendance rate will rise by 1.3 percentage points compared to the 2023 to 2024 academic year, to over 94%",
    "theme": "ai",
    "status": "in-delivery",
    "timeframe": "Expectations from 2026; national goal by the 2028/29 academic year",
    "timeframeDate": "2028-09",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "dfe",
        "to": "schools",
        "what": "AI-generated similar-school benchmarks and personalised attendance improvement expectations"
      }
    ],
    "newServices": [
      "AI attendance benchmarking/reporting tool"
    ],
    "identifiers": [],
    "standards": [
      "similar-schools comparator methodology"
    ],
    "partners": [
      "RISE teams",
      "schools and trusts"
    ],
    "strategyImplication": "DfE's first at-scale AI-on-operational-data service: the strategy needs a published methodology, model governance and accuracy assurance for AI-set expectations schools will be measured against, plus clarity that they stay out of formal accountability.",
    "eli5": "A computer compares each school with similar schools and sets it a fair attendance goal, as part of a national push to get more children into class every day.",
    "capabilityIds": [
      "value",
      "ethics"
    ],
    "pressureIds": [
      "ai-in-education",
      "attendance-data"
    ],
    "aliases": [
      "attendance baseline improvement expectation",
      "ABIE",
      "AI attendance benchmarking",
      "94% attendance target",
      "similar schools attendance expectation"
    ],
    "confidence": "medium",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/every-child-achieving-and-thriving/every-child-achieving-and-thriving-html-version",
      "https://www.tes.com/magazine/news/general/dfe-sets-ai-attendance-targets-for-schools"
    ]
  },
  {
    "id": "nccis-participation-tracking",
    "docId": "nccis-mi-2026-27",
    "title": "Mandatory participation-status tracking of 16-17 year olds (NCCIS)",
    "what": "Local authorities have a statutory duty (Education and Skills Act 2008) to identify and support young people not participating in education or training, recording each young person's participation status and returning specified data monthly to DfE via the National Client Caseload Information System. The 2026-27 Management Information Requirement specifies the mandatory data items for academic-age 16 and 17 year olds.",
    "quote": "collect information to identify young people who are not participating, or at risk of not doing so",
    "theme": "data-sharing",
    "status": "statutory-duty",
    "timeframe": "Ongoing; 2026-27 MI requirement applies from academic year 2026/27",
    "timeframeDate": "2026-09",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "las",
        "to": "dfe",
        "what": "monthly participation status, NEET and activity data on 16-17 year olds via NCCIS"
      },
      {
        "from": "schools",
        "to": "las",
        "what": "enrolment and leaver information supporting participation tracking"
      },
      {
        "from": "colleges",
        "to": "las",
        "what": "post-16 enrolment data supporting participation tracking"
      }
    ],
    "newServices": [],
    "identifiers": [
      "UPN and local client IDs across the school-to-post-16 transition"
    ],
    "standards": [
      "NCCIS Management Information Requirement 2026-27 (mandatory field specification)"
    ],
    "partners": [
      "local authorities",
      "post-16 providers",
      "careers services"
    ],
    "strategyImplication": "Participation/NEET tracking spans a known data gap at the school/post-16 boundary; the strategy should link NCCIS, school census and ILR data (and eventually the SUI) so participation status derives from live enrolment data rather than manual tracking.",
    "eli5": "Councils must keep monthly track of what every 16 and 17 year old is doing - studying, training or neither - and report it to the government so nobody slips through the cracks.",
    "capabilityIds": [
      "sharing",
      "quality"
    ],
    "pressureIds": [
      "neet-tracking"
    ],
    "aliases": [
      "NCCIS",
      "national client caseload information system",
      "participation status",
      "16-17 NEET data",
      "management information requirement"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://assets.publishing.service.gov.uk/media/6943ca108f4636fa2c547e25/NCCIS_management_information_requirement_2026_to_2027.pdf",
      "https://explore-education-statistics.service.gov.uk/methodology/participation-in-education-training-and-neet-age-16-to-17-by-local-authority"
    ]
  },
  {
    "id": "school-profiles-service",
    "docId": "school-accountability-reform-response",
    "title": "Digital school profiles service (one-stop shop for school information)",
    "what": "Following the 2025 accountability consultation, DfE confirmed it will build online school profiles as the central, parent-facing source of up-to-date information about every school, bringing together Ofsted report cards, attendance, attainment, enrichment and other performance data now spread across multiple services. A pilot ran in 2025/26; the White Paper commits to profiles giving parents 'a rounded picture', and DfE is considering extending profiles to FE providers.",
    "quote": "introducing school profiles to give parents a rounded picture of their child's education",
    "theme": "new-service",
    "status": "in-delivery",
    "timeframe": "Pilot in 2025/26; rollout before the end of the Parliament",
    "timeframeDate": "2029-06",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "ofsted",
        "to": "dfe",
        "what": "report card outcomes feeding school profiles"
      },
      {
        "from": "dfe",
        "to": "parents",
        "what": "consolidated, comparable school information (attendance, attainment, enrichment, characteristics)"
      }
    ],
    "newServices": [
      "school profiles digital service (successor/companion to GIAS and Compare School Performance)"
    ],
    "identifiers": [
      "URN/UKPRN as joining keys across source systems"
    ],
    "standards": [
      "consistent presentation standards for performance and enrichment data"
    ],
    "partners": [
      "Ofsted",
      "schools and trusts"
    ],
    "strategyImplication": "School profiles force a single canonical, timely version of every school-level metric; the strategy must rationalise overlapping services (GIAS, CSP, EES) and set data freshness and quality SLAs for public presentation.",
    "eli5": "Parents will get one official webpage for each school showing everything that matters - inspection results, attendance, exam results - instead of hunting across lots of sites.",
    "capabilityIds": [
      "platform",
      "value"
    ],
    "aliases": [
      "school profiles",
      "digital school profile",
      "one-stop shop for school information",
      "rounded picture of every school"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/consultations/school-accountability-reform",
      "https://assets.publishing.service.gov.uk/media/68beea01c771153e08e0dd4f/school-accountability-reform-government-response.pdf",
      "https://feweek.co.uk/dfe-considers-extending-school-profile-plans-to-fe-providers/"
    ]
  },
  {
    "id": "ofsted-report-cards-contextual-data",
    "docId": "ofsted-eif-nov-2025",
    "title": "Ofsted report cards plus contextual data published alongside inspection outcomes",
    "what": "From 10 November 2025, Ofsted inspections of state schools use report cards instead of single headline grades: a 5-point scale (including 'exceptional') across six evaluation areas, with safeguarding judged met/not met; outcomes feed DfE intervention triggers and school profiles. From September 2026 Ofsted also publishes data alongside inspection outcomes for the first time, using a new statistical model grouping similar schools to contextualise achievement over time.",
    "quote": "A new 5-point grading scale, including the new 'exceptional' grade",
    "theme": "accountability",
    "status": "in-delivery",
    "timeframe": "Report cards from 10 November 2025; contextual data for inspections from September 2026",
    "timeframeDate": "2025-11",
    "dfeRole": "partner",
    "flows": [
      {
        "from": "ofsted",
        "to": "dfe",
        "what": "multi-dimensional report card grades replacing single headline grades in intervention logic"
      },
      {
        "from": "ofsted",
        "to": "parents",
        "what": "published report cards with comparative contextual detail"
      },
      {
        "from": "dfe",
        "to": "ofsted",
        "what": "achievement, attendance and context data presented alongside inspection outcomes"
      }
    ],
    "newServices": [
      "report card publication format"
    ],
    "identifiers": [
      "URN"
    ],
    "standards": [
      "renewed education inspection framework and toolkits",
      "similar-schools statistical grouping methodology"
    ],
    "partners": [
      "Ofsted",
      "DfE regions group / RISE",
      "DfE statisticians"
    ],
    "strategyImplication": "DfE systems keyed to single Ofsted grades (eligibility rules, statistics, profiles) must be re-engineered around six graded areas, and Ofsted republishing DfE data demands one agreed similar-schools methodology and synchronised releases so services never show conflicting numbers for the same school.",
    "eli5": "Instead of one word like 'good', schools now get a report card with several grades, published alongside background numbers that help parents compare similar schools fairly.",
    "capabilityIds": [
      "quality",
      "value"
    ],
    "aliases": [
      "report cards",
      "5-point grading scale",
      "single-word judgements replaced",
      "education inspection framework 2025",
      "contextual data alongside inspection",
      "similar schools model"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/education-inspection-framework/education-inspection-framework-for-use-from-november-2025",
      "https://www.gov.uk/government/news/ofsted-confirms-changes-to-education-inspection-and-unveils-new-look-report-cards",
      "https://educationinspection.blog.gov.uk/2026/06/12/what-you-need-to-know-about-the-september-2026-updates-to-education-inspections/"
    ]
  },
  {
    "id": "rise-data-targeting",
    "docId": "rise-policy",
    "title": "RISE teams: data-driven targeting and published eligibility statistics",
    "what": "RISE teams provide universal support on four national priorities (attainment, inclusion, reception quality, attendance) and targeted intervention for 'stuck' schools identified through Ofsted inspection outcomes. DfE publishes the list of eligible schools as official statistics on Explore Education Statistics, updated from Ofsted management information; attendance-expectation progress will also be used to target RISE support.",
    "quote": "Eligibility for targeted RISE intervention is determined through Ofsted inspections",
    "theme": "analytics",
    "status": "in-delivery",
    "timeframe": "Targeted support from February 2025; expanded universal offer from 2026",
    "timeframeDate": "2025-02",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "ofsted",
        "to": "dfe",
        "what": "inspection outcomes and management information identifying schools eligible for intervention"
      },
      {
        "from": "dfe",
        "to": "parents",
        "what": "published official statistics listing schools eligible for RISE intervention"
      }
    ],
    "newServices": [
      "Schools eligible for RISE intervention official statistics series"
    ],
    "identifiers": [
      "URN"
    ],
    "standards": [
      "published eligibility criteria (stuck schools definition)"
    ],
    "partners": [
      "Ofsted",
      "supporting organisations/hubs",
      "academy trusts"
    ],
    "strategyImplication": "RISE institutionalises data-triggered intervention: the strategy must guarantee the timeliness and contestability of the pipeline (Ofsted MI to eligibility list to publication) that now determines which schools face intervention.",
    "eli5": "The government uses inspection data to spot schools that are stuck and sends in expert help, publishing the list of which schools qualify.",
    "capabilityIds": [
      "value",
      "quality"
    ],
    "aliases": [
      "RISE teams",
      "stuck schools",
      "targeted intervention eligibility",
      "regional improvement for standards and excellence",
      "RISE eligibility statistics"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/regional-improvement-for-standards-and-excellence-rise/regional-improvement-for-standards-and-excellence-rise",
      "https://explore-education-statistics.service.gov.uk/find-statistics/schools-eligible-for-rise-intervention/2025"
    ]
  },
  {
    "id": "fsm-uc-expansion-ecs",
    "docId": "fsm-expansion-2026",
    "title": "FSM expansion to all Universal Credit households and rebuilt eligibility checking service",
    "what": "From September 2026, all pupils in households receiving Universal Credit are eligible for free school meals (removing the £7,400 earned-income cap), an expansion of 500,000+ pupils legislatively supported by s.32 CWSA. A rebuilt FSM eligibility checking service is available to all LAs from 1 June 2026, with a flexible model letting schools run checks directly; eligibility splits into targeted and expanded FSM, verified against DWP, HMRC and Home Office data. DfE is working with DSIT and DWP on data and digital means to proactively identify eligible children from spring 2026.",
    "quote": "The new FSM eligibility checking service (ECS) will be available for all local authorities to use from 1 June 2026",
    "theme": "new-service",
    "status": "in-delivery",
    "timeframe": "ECS from 1 June 2026; expanded eligibility from September 2026",
    "timeframeDate": "2026-09",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "dwp",
        "to": "dfe",
        "what": "Universal Credit receipt data for eligibility verification"
      },
      {
        "from": "hmrc",
        "to": "dfe",
        "what": "earnings data for eligibility verification"
      },
      {
        "from": "home-office",
        "to": "dfe",
        "what": "immigration status data used in eligibility checking"
      },
      {
        "from": "dfe",
        "to": "schools",
        "what": "targeted/expanded FSM eligibility confirmations to schools and LAs"
      },
      {
        "from": "schools",
        "to": "dfe",
        "what": "FSM status via school census, feeding pupil premium funding and statistics"
      }
    ],
    "newServices": [
      "rebuilt FSM eligibility checking service with direct school access"
    ],
    "identifiers": [
      "parent NI numbers matched to benefit records",
      "pupil UPN"
    ],
    "standards": [
      "targeted vs expanded FSM eligibility categories"
    ],
    "partners": [
      "DWP",
      "HMRC",
      "Home Office",
      "DSIT",
      "local authorities",
      "schools"
    ],
    "strategyImplication": "FSM checking is DfE's largest cross-department benefits data flow; the strategy should treat the ECS as reusable eligibility infrastructure (for pupil premium, auto-enrolment options and poverty analytics) with clear DWP/HMRC data-sharing agreements.",
    "eli5": "Any child whose family gets Universal Credit will qualify for free school lunches, and a new checking system talks to the benefits computers so families do not have to prove it themselves.",
    "capabilityIds": [
      "platform",
      "sharing",
      "value"
    ],
    "aliases": [
      "free school meals expansion",
      "eligibility checking service",
      "ECS rebuild",
      "universal credit FSM",
      "FSM eligibility"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/news/over-half-a-million-more-children-to-get-free-school-meals",
      "https://www.gov.uk/government/publications/free-school-meals-guidance-for-schools-and-local-authorities/free-school-meals-guidance-for-local-authorities-local-authority-maintained-schools-academies-and-free-schools",
      "https://educationhub.blog.gov.uk/2025/06/expanding-free-school-meals-what-parents-need-to-know/",
      "https://www.gov.uk/government/publications/dfe-update-13-may-2026/dfe-update-local-authorities-13-may-2026",
      "https://www.publictechnology.net/2025/04/28/society-and-welfare/free-school-meals-dsit-and-dwp-support-work-on-data-and-digital-means-to-identify-eligibility/",
      "https://www.gov.uk/government/publications/our-children-our-future-tackling-child-poverty/our-children-our-future-tackling-child-poverty"
    ]
  },
  {
    "id": "fsm-auto-enrolment",
    "docId": "child-poverty-strategy",
    "title": "FSM auto-enrolment (under consideration, not yet a firm commitment)",
    "what": "Campaigners, the LGA and a Private Member's Bill press for automatic FSM registration using government-held benefits data; some councils already auto-enrol locally. As of July 2026 the government's confirmed position is to simplify sign-up via the improved eligibility checking service and the UC expansion rather than a formal national auto-enrolment commitment.",
    "quote": "updating the Eligibility Checking System, making it quicker and easier for families",
    "theme": "data-sharing",
    "status": "proposed",
    "timeframe": "No date; contingent on future decisions/legislation",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "dwp",
        "to": "dfe",
        "what": "proactive identification of eligible children without parental application (potential)"
      },
      {
        "from": "hmrc",
        "to": "dfe",
        "what": "household earnings data enabling proactive entitlement matching (potential)"
      }
    ],
    "newServices": [
      "potential national auto-enrolment mechanism built on the ECS"
    ],
    "identifiers": [
      "household-to-pupil matching (NI number to UPN)"
    ],
    "standards": [],
    "partners": [
      "DWP",
      "HMRC",
      "local authorities",
      "CPAG / LGA (advocates)"
    ],
    "strategyImplication": "The strategy should state a position on proactive-entitlement data use: the ECS plus UC expansion makes auto-enrolment technically feasible, so the blocker is policy/legal, and DfE should decide whether to build for it.",
    "eli5": "Instead of parents filling in a form for free school lunches, the government could use the information it already has to sign eligible children up automatically - it is thinking about it but has not promised.",
    "capabilityIds": [
      "sharing",
      "value"
    ],
    "aliases": [
      "FSM auto-enrolment",
      "automatic registration of eligible children",
      "proactive entitlement",
      "auto-enrol free school meals"
    ],
    "confidence": "low",
    "sourceUrls": [
      "https://www.local.gov.uk/parliament/briefings-and-responses/free-school-meals-automatic-registration-eligible-children-bill",
      "https://educationhub.blog.gov.uk/2026/03/5-things-we-are-doing-to-tackle-child-poverty/"
    ]
  },
  {
    "id": "wp-digital-isps",
    "docId": "schools-white-paper-2026",
    "title": "Digital Individual Support Plans for every child with identified SEND",
    "what": "The White Paper and SEND consultation commit to a duty on nurseries, schools and colleges to record and monitor special educational needs in a digital Individual Support Plan — a live record of needs, day-to-day support and provision, co-designed with parents, accessible to teachers and parents, and travelling with the child across transitions. Phased from the 2026/27 academic year; the statutory duty requires future legislation, with the new system operative from September 2029.",
    "quote": "a new, digital 'Individual Support Plan' (ISP), which will be provided by their school, college or early years setting",
    "theme": "new-service",
    "status": "announced",
    "timeframe": "Phased from the 2026/27 academic year; legislation late 2026-2028; system operative from Sept 2029",
    "timeframeDate": "2026-09",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "schools",
        "to": "parents",
        "what": "shared live digital record of needs, support and provision co-designed with parents"
      },
      {
        "from": "ey-settings",
        "to": "schools",
        "what": "portable ISP records following the child across settings and phase transfers"
      },
      {
        "from": "schools",
        "to": "dhsc",
        "what": "ISP data speeding access to health professionals"
      }
    ],
    "newServices": [
      "national digital ISP platform/record standard for every child with identified SEND"
    ],
    "identifiers": [
      "child identifier enabling ISP portability across settings (candidate SUI use case)"
    ],
    "standards": [
      "standard national ISP format and content model",
      "AI/SEND identification tools subject to DPA and Public Sector Equality Duty"
    ],
    "partners": [
      "schools",
      "early years settings",
      "colleges",
      "parents",
      "local authorities",
      "NHS/ICBs",
      "MIS and edtech suppliers"
    ],
    "strategyImplication": "Digital ISPs are the biggest new child-level education data asset since the school census: DfE must own the data standard, hosting/interoperability model and the identifier that lets plans follow children between settings and into health — interoperability with MIS suppliers and LA systems is the design battleground.",
    "eli5": "Every child who needs extra help at school will get a digital plan that parents and teachers can both see, and it follows the child when they change schools.",
    "capabilityIds": [
      "platform",
      "interoperability"
    ],
    "pressureIds": [
      "send-data"
    ],
    "aliases": [
      "individual support plan",
      "digital ISP",
      "ISP duty",
      "digital support plan for SEND"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/every-child-achieving-and-thriving/every-child-achieving-and-thriving-html-version",
      "https://www.local.gov.uk/parliament/briefings-and-responses/schools-white-paper-every-child-achieving-and-thriving-lga",
      "https://www.gov.uk/government/consultations/send-reform-putting-children-and-young-people-first/send-reform-putting-children-and-young-people-first-html-version",
      "https://educationhub.blog.gov.uk/2026/05/schools-white-paper-what-parents-need-to-know-about-changes-to-the-send-system/"
    ]
  },
  {
    "id": "wp-belonging-engagement-monitoring",
    "docId": "schools-white-paper-2026",
    "title": "Every school monitoring pupil belonging and engagement by 2029",
    "what": "The White Paper expects every school to monitor children's sense of belonging and engagement by 2029, with national and international surveys tracking progress. This implies new survey instruments or data collections on wellbeing/belonging alongside the attendance data estate.",
    "quote": "By 2029, we expect every school to monitor children's sense of belonging and engagement",
    "theme": "analytics",
    "status": "announced",
    "timeframe": "By 2029",
    "timeframeDate": "2029-01",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "schools",
        "to": "dfe",
        "what": "belonging/engagement survey measures and system-level wellbeing benchmarks from national/international surveys"
      }
    ],
    "newServices": [
      "possible national belonging measurement instrument or endorsed tools"
    ],
    "identifiers": [],
    "standards": [
      "comparable belonging/engagement metrics"
    ],
    "partners": [
      "survey providers",
      "international studies (e.g. PISA wellbeing measures)"
    ],
    "strategyImplication": "The strategy should decide whether belonging becomes a standardised national collection or a school-owned measure with survey-based national tracking — and set privacy expectations for pupil-voice data either way.",
    "eli5": "Schools will regularly ask pupils whether they feel they belong and are engaged at school, and track the answers like they track attendance.",
    "capabilityIds": [
      "value"
    ],
    "aliases": [
      "belonging and engagement",
      "sense of belonging monitoring",
      "pupil wellbeing measure",
      "belonging survey"
    ],
    "confidence": "medium",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/every-child-achieving-and-thriving/every-child-achieving-and-thriving-html-version"
    ]
  },
  {
    "id": "wp-analytics-ai-tools",
    "docId": "schools-white-paper-2026",
    "title": "School-facing analytics and evidence-based AI tools for teaching",
    "what": "The White Paper commits DfE to giving schools a range of analytics so they can prioritise data-driven interventions (e.g. the Compare your GLD report already live), and to supporting safe AI tools for teaching and learning underpinned by an extensive evidence programme. This extends DfE's give-back model — returning benchmarked insight to schools from data DfE already collects.",
    "quote": "range of analytics so that schools can prioritise data driven interventions with greatest impact",
    "theme": "analytics",
    "status": "announced",
    "timeframe": "Rolling from 2026 across the Parliament",
    "timeframeDate": "2026-01",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "dfe",
        "to": "schools",
        "what": "benchmarked analytics (early years GLD, attendance, attainment) returned to schools, trusts and LAs"
      }
    ],
    "newServices": [
      "expanded school-facing analytics suite",
      "AI-in-education evidence programme"
    ],
    "identifiers": [],
    "standards": [
      "safety/evidence standards for AI tools in schools"
    ],
    "partners": [
      "edtech suppliers",
      "research organisations (e.g. EEF)"
    ],
    "strategyImplication": "The strategy should formalise the 'collect once, give back with benchmarks' pattern and pair every AI-tool commitment with data-access rules, evaluation datasets and procurement-grade safety standards.",
    "eli5": "The government will turn the data it already collects from schools into helpful comparison charts for teachers, and back trustworthy computer tools that help with teaching.",
    "capabilityIds": [
      "value"
    ],
    "pressureIds": [
      "ai-in-education"
    ],
    "aliases": [
      "compare your GLD",
      "school-facing analytics",
      "data driven interventions",
      "give-back analytics",
      "evidence-based AI tools"
    ],
    "confidence": "medium",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/every-child-achieving-and-thriving/every-child-achieving-and-thriving-html-version"
    ]
  },
  {
    "id": "send-specialist-provision-packages",
    "docId": "send-reform-consultation-2026",
    "title": "Specialist Provision Packages guiding digitised EHCPs",
    "what": "Evidence-based Specialist Provision Packages, developed and reviewed by an independent expert panel, will define provision for the most complex needs and guide what goes into future EHCPs, which will be reserved for complex cases and digitised. From 2029-30 EHCPs will be reassessed at phase transitions; existing plans are protected on transitional terms.",
    "quote": "Each Package will offer a full range of support ... and will guide what is included in an EHCP",
    "theme": "standards",
    "status": "proposed",
    "timeframe": "Assessments for the new system from Sept 2029; no EHCP support changes before at least Sept 2030; steady state by 2035",
    "timeframeDate": "2029-09",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "dfe",
        "to": "las",
        "what": "standard package definitions grounded in evidence (via the independent expert panel)"
      },
      {
        "from": "las",
        "to": "parents",
        "what": "digitised EHCPs including health and personal care information"
      },
      {
        "from": "las",
        "to": "schools",
        "what": "package-coded provision expectations for settings"
      }
    ],
    "newServices": [
      "digital EHCP records",
      "national library of Specialist Provision Packages"
    ],
    "identifiers": [],
    "standards": [
      "package taxonomy standardising provision descriptions",
      "digital EHCP content standard"
    ],
    "partners": [
      "local authorities",
      "NHS/ICBs",
      "special and mainstream schools",
      "independent expert panel"
    ],
    "strategyImplication": "Standardised package definitions create, for the first time, comparable structured data on specialist provision and cost — enabling national analytics on need, provision and expenditure, but requiring a canonical reference-data set DfE must own and version.",
    "eli5": "For children with the most complex needs, support will come in standard well-tested packages, and their support plans will be digital instead of piles of paper.",
    "capabilityIds": [
      "interoperability",
      "quality"
    ],
    "pressureIds": [
      "send-data"
    ],
    "aliases": [
      "specialist provision packages",
      "digitised EHCP",
      "EHCP digitisation",
      "package taxonomy",
      "reformed EHC plans"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/consultations/send-reform-putting-children-and-young-people-first/send-reform-putting-children-and-young-people-first-html-version",
      "https://educationhub.blog.gov.uk/2026/05/schools-white-paper-what-parents-need-to-know-about-changes-to-the-send-system/",
      "https://schoolsweek.co.uk/schools-white-paper-the-key-send-reform-policies/"
    ]
  },
  {
    "id": "national-inclusion-standards",
    "docId": "schools-white-paper-2026",
    "title": "National Inclusion Standards with a funded evidence base",
    "what": "DfE will invest up to £15m by 2028 to build the evidence base for, then publish, National Inclusion Standards setting out for the first time the support that should be available at each tier in every setting. These replace the 2023 plan's 'national standards' and will anchor Ofsted's inclusion judgements and updated school performance measures.",
    "quote": "By 2028, we will have invested up to £15 million to build the evidence base for, and then provide, National Inclusion Standards",
    "theme": "standards",
    "status": "in-delivery",
    "timeframe": "Evidence base to 2028; standards in force with the reformed system from 2029",
    "timeframeDate": "2029-09",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "dfe",
        "to": "schools",
        "what": "published standards defining expected provision per tier of support"
      },
      {
        "from": "schools",
        "to": "ofsted",
        "what": "evidence of inclusive practice against the standards via inspection and updated performance measures"
      }
    ],
    "newServices": [],
    "identifiers": [],
    "standards": [
      "National Inclusion Standards",
      "updated school performance measures recognising inclusive mainstream schools"
    ],
    "partners": [
      "Ofsted",
      "research/evidence bodies",
      "schools and colleges"
    ],
    "strategyImplication": "The standards become the reference framework against which inclusion data (ISPs, performance measures, inspection evidence) is coded — DfE needs a machine-readable publication of the standards to avoid divergent local encodings.",
    "eli5": "The government is writing a clear national rulebook for what help every school must offer children who need extra support, and inspectors will check schools against it.",
    "capabilityIds": [
      "interoperability",
      "quality"
    ],
    "pressureIds": [
      "send-data"
    ],
    "aliases": [
      "national inclusion standards",
      "NIS",
      "inclusion standards evidence base",
      "support at each tier"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/consultations/send-reform-putting-children-and-young-people-first/send-reform-putting-children-and-young-people-first-html-version",
      "https://www.gov.uk/government/publications/every-child-achieving-and-thriving"
    ]
  },
  {
    "id": "school-inclusion-strategy-duty",
    "docId": "schools-white-paper-2026",
    "title": "Every school to publish an inclusion strategy (first deadline 31 Dec 2026)",
    "what": "The white paper replaces SEN information reports with an annual school inclusion strategy duty. As a condition of the £500m+/yr Inclusive Mainstream Fund, every primary and secondary school must publish an inclusion strategy statement by 31 December 2026, setting out how funding identifies and meets cohort needs across defined inclusive-practice areas; Ofsted will assess how leaders embed it.",
    "quote": "Schools must publish their inclusion strategy statement by 31 December 2026",
    "theme": "accountability",
    "status": "in-delivery",
    "timeframe": "First statements by 31 Dec 2026; statutory duty to follow in reform legislation",
    "timeframeDate": "2026-12",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "schools",
        "to": "parents",
        "what": "published inclusion strategy statements"
      },
      {
        "from": "dfe",
        "to": "schools",
        "what": "IMF allocations computed from census counts and low-prior-attainment data"
      },
      {
        "from": "schools",
        "to": "ofsted",
        "what": "evidence of how leaders embed the inclusion strategy"
      }
    ],
    "newServices": [],
    "identifiers": [],
    "standards": [
      "common structure for inclusion strategy statements (seven inclusive-practice areas)"
    ],
    "partners": [
      "schools",
      "Ofsted",
      "local authorities"
    ],
    "strategyImplication": "Creates ~20,000 new annually published school-level inclusion documents plus a formula-driven funding stream — an obvious candidate for a structured (not PDF) publication standard and for linking IMF spend to inclusion outcomes data.",
    "eli5": "Every school must publish a yearly plan explaining how it helps children who need extra support, or it will not get its share of a big new fund.",
    "capabilityIds": [
      "quality",
      "value"
    ],
    "pressureIds": [
      "send-data"
    ],
    "aliases": [
      "inclusion strategy statement",
      "school inclusion strategy",
      "SEN information report replacement",
      "inclusive practice areas"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/inclusive-mainstream-fund-2026-to-2027/inclusive-mainstream-fund-for-schools-methodology-2026-to-2027",
      "https://schoolsweek.co.uk/schools-white-paper-the-key-send-reform-policies/",
      "https://www.sec-ed.co.uk/content/news/inclusive-mainstream-fund-dfe-inclusion-strategy-deadline"
    ]
  },
  {
    "id": "imf-allocation-methodology",
    "docId": "imf-methodology-2026",
    "title": "Published data-driven allocation methodology for the Inclusive Mainstream Fund",
    "what": "DfE has published the full allocation methodology for the Inclusive Mainstream Fund (over £500m/yr, £400m/yr to schools): a £3,000 lump sum plus per-pupil and low-prior-attainment rates with an area cost adjustment, computed from October 2025 school census counts and the 2025-26 authority proforma tool. This shifts early SEND support funding onto transparent, published formulae rather than opaque high-needs top-ups.",
    "quote": "We will use pupil counts from the October 2025 census and LPA proportions from the 2025 to 2026 authority proforma tool (APT)",
    "theme": "funding",
    "status": "in-delivery",
    "timeframe": "2026-27 allocations onward; methodology updated 1 July 2026",
    "timeframeDate": "2026-04",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "schools",
        "to": "dfe",
        "what": "pupil counts and low-prior-attainment proportions (census/APT) driving allocations"
      },
      {
        "from": "dfe",
        "to": "schools",
        "what": "published per-school allocation methodology, rates and funding"
      }
    ],
    "newServices": [],
    "identifiers": [],
    "standards": [
      "published funding formula (lump sum + per-pupil + LPA rates + area cost adjustment)"
    ],
    "partners": [
      "ESFA/DfE funding teams",
      "local authorities",
      "schools"
    ],
    "strategyImplication": "Anchors SEND funding transparency in existing census/APT pipelines — future inclusion outcome measures can be joined to IMF inputs at school level, but low prior attainment is a coarse SEND proxy the department will be pressed to refine.",
    "eli5": "The money schools get to help children with extra needs is now worked out from a published formula using school data, so everyone can see why each school gets what it gets.",
    "capabilityIds": [
      "governance",
      "value"
    ],
    "pressureIds": [
      "send-data"
    ],
    "aliases": [
      "inclusive mainstream fund",
      "IMF allocation methodology",
      "low prior attainment formula",
      "authority proforma tool"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/inclusive-mainstream-fund-2026-to-2027/inclusive-mainstream-fund-for-schools-methodology-2026-to-2027"
    ]
  },
  {
    "id": "send-2023-plan-stalled-data-commitments",
    "docId": "send-ap-improvement-plan-2023",
    "title": "2023 SEND & AP Improvement Plan data commitments (stalled, superseded by the 2026 reforms)",
    "what": "The 2023 Improvement Plan promised a standard national EHCP template and digitised EHC process (paused July 2025, never completed), local and national inclusion dashboards (still only tested across 32 LAs by 2025, never publicly released), tailored lists of suitable settings for families (testing only), a national AP performance framework with three-tier metrics (not published; Feb 2025 guidance requires documented reintegration plans instead), and national funding bands and tariffs (not implemented). The 2026 white paper's digital ISPs, digitised EHCPs, updated performance measures and new funding model supersede them.",
    "quote": "develop reformed templates and guidance to deliver a nationally consistent education, health and care plan process",
    "theme": "standards",
    "status": "announced",
    "timeframe": "Original delivery 2023-2025; paused/superseded by the 2026 white paper programme",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "las",
        "to": "parents",
        "what": "EHCPs in a nationally consistent digital template (never delivered)"
      },
      {
        "from": "dfe",
        "to": "las",
        "what": "local and national inclusion dashboard metrics across education, health and care (testing only)"
      }
    ],
    "newServices": [
      "digitised EHC plan process (not delivered)",
      "inclusion dashboard service (unreleased)",
      "tailored-list placement information service (pilot only)"
    ],
    "identifiers": [],
    "standards": [
      "national EHCP template (never finalised)",
      "common local-area SEND performance metric set",
      "AP outcome metric set (undelivered)",
      "national tariff/band definitions (undelivered)"
    ],
    "partners": [
      "local authorities",
      "case-management system suppliers",
      "ICBs/NHS England",
      "AP settings",
      "Ofsted/CQC"
    ],
    "strategyImplication": "Three years of standardisation effort produced no adopted template, dashboard or tariff — the lesson for the ISP/digital-EHCP programme is that standardisation without a mandated data standard and supplier alignment stalls; successor measures should build on statutory collections (SEN2, census) rather than bespoke aggregation, and AP outcomes still depend on fixing placement-level data collection first.",
    "eli5": "An earlier plan promised shared digital paperwork and public scoreboards for children with special educational needs, but most of it never got built - the new 2026 plan is trying again.",
    "capabilityIds": [
      "interoperability",
      "quality"
    ],
    "pressureIds": [
      "send-data"
    ],
    "aliases": [
      "EHCP template",
      "inclusion dashboards",
      "tailored list of settings",
      "AP performance framework",
      "funding bands and tariffs",
      "change programme"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/send-and-alternative-provision-improvement-plan/send-and-alternative-provision-roadmap",
      "https://www.specialneedsjungle.com/digital-standardised-ehcps-ditched-labour-aiming-kill-statutory-send-provision/",
      "https://committees.parliament.uk/committee/203/education-committee/news/209313/solving-the-send-crisis-report-calls-for-culture-shift-and-funding-to-make-mainstream-education-genuinely-inclusive/",
      "https://www.gov.uk/government/news/young-people-with-send-to-benefit-from-new-guidance-on-inclusion",
      "https://schoolsweek.co.uk/schools-white-paper-the-key-send-reform-policies/"
    ]
  },
  {
    "id": "sen2-person-level-expansion",
    "docId": "sen2-guide-2026",
    "title": "SEN2 person-level statutory return expanded for 2026 (incl. mandatory DSCO reporting)",
    "what": "SEN2, the statutory LA return covering every EHC plan and needs assessment (person-level since 2023), gains new compulsory items in 2026: source of EHC assessment request, date the draft amended plan was sent after annual review, phase-transfer review due date and final-plan-issued date. The Designated Social Care Officer indicator also moves from voluntary to mandatory, giving DfE national coverage data on whether social care is structurally wired into EHC decision-making — process-timeliness telemetry across the whole statutory EHCP journey.",
    "quote": "SEN2 is a statutory return that collects data about children and young people who the local authority is responsible for under section 24",
    "theme": "analytics",
    "status": "statutory-duty",
    "timeframe": "2026 collection onward; items voluntary in 2025 now mandatory",
    "timeframeDate": "2026-01",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "las",
        "to": "dfe",
        "what": "person-level EHCP records incl. request source, annual-review draft dates, phase-transfer dates and DSCO/DMO/DCO indicators"
      }
    ],
    "newServices": [],
    "identifiers": [
      "person-level records used for data matching"
    ],
    "standards": [
      "SEN2 person-level technical specification 2026",
      "DSCO role definition mirrored against SEND Code of Practice DMO/DCO functions"
    ],
    "partners": [
      "local authorities",
      "case-management system suppliers",
      "Council for Disabled Children",
      "ICBs (DMO/DCO counterparts)"
    ],
    "strategyImplication": "SEN2 is quietly becoming the operational-performance dataset the inclusion dashboards never were — the new date fields let DfE measure annual-review and phase-transfer timeliness nationally and will baseline the 2029 reform transition; mandatory DSCO reporting is a soft lever to universalise the role without legislating.",
    "eli5": "Councils already send the government details about every child with a special-needs plan; from 2026 they must also report key dates and whether a social care expert is involved, so delays can be spotted.",
    "capabilityIds": [
      "value",
      "quality"
    ],
    "pressureIds": [
      "send-data"
    ],
    "aliases": [
      "SEN2",
      "person level SEN2 return",
      "EHCP timeliness data",
      "designated social care officer",
      "DSCO indicator",
      "phase transfer review dates"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://assets.publishing.service.gov.uk/media/6937018aa6fc97b81e5743a7/Special_educational_needs_survey_guide_2026.pdf",
      "https://assets.publishing.service.gov.uk/media/67923b4cde39a2da43572d20/SEN2_person_level_2026_-_technical_specification.pdf",
      "https://councilfordisabledchildren.org.uk/sites/default/files/uploads/attachments/DSCO%20Handbook%20-%20Implementing%20the%20role%20of%20the%20Designated%20Social%20Care%20Officer%20for%20SEND.pdf"
    ]
  },
  {
    "id": "experts-at-hand-health-flows",
    "docId": "schools-white-paper-2026",
    "title": "Experts at Hand: health and specialist professionals wrapped around mainstream settings",
    "what": "A £1.8bn, three-year national offer placing educational psychologists, speech and language therapists and occupational therapists around mainstream settings, with ICBs engaged in local SEND clusters and health input built into specialist package design. Operationally this requires referral, caseload and outcome data to flow between schools, LA services and NHS providers within clusters.",
    "quote": "invest £1.8 billion over the next three years to create a new national offer called 'Experts at Hand'",
    "theme": "new-service",
    "status": "announced",
    "timeframe": "Funded from 2026-27 over three years; precedes full 2029 system",
    "timeframeDate": "2026-04",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "schools",
        "to": "dhsc",
        "what": "referrals and child-level need information (no diagnosis required) to Experts at Hand professionals"
      },
      {
        "from": "dhsc",
        "to": "las",
        "what": "health advice, caseload and outcome data into SEND clusters and specialist package design"
      }
    ],
    "newServices": [
      "Experts at Hand national service"
    ],
    "identifiers": [],
    "standards": [
      "cluster-level commissioning and information-sharing arrangements with ICBs"
    ],
    "partners": [
      "NHS England / ICBs",
      "educational psychology services",
      "therapy services",
      "school clusters"
    ],
    "strategyImplication": "The first funded mechanism making health professionals part of the everyday school data environment — needs an information-governance template (and ideally the SUI) so therapy input reaches ISPs/EHCPs without 153 bespoke data-sharing agreements.",
    "eli5": "Speech therapists, psychologists and other specialists will work directly with groups of ordinary schools, so children get expert help without waiting for a formal diagnosis.",
    "capabilityIds": [
      "platform",
      "sharing"
    ],
    "pressureIds": [
      "agency-coordination",
      "send-data"
    ],
    "aliases": [
      "experts at hand",
      "SEND clusters",
      "educational psychologists in schools",
      "speech and language therapists offer",
      "1.8 billion national offer"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/consultations/send-reform-putting-children-and-young-people-first/send-reform-putting-children-and-young-people-first-html-version",
      "https://schoolsweek.co.uk/schools-white-paper-the-key-send-reform-policies/"
    ]
  },
  {
    "id": "ndtfg-assessment-tools-data-linkage",
    "docId": "ndtfg-report-2026",
    "title": "Neurodivergence group: diagnosis-independent assessment tools and local data linkage",
    "what": "The Neurodivergence Task and Finish Group (published 23 Feb 2026, feeding the white paper) recommends free, validated, evidence-based assessment tools for all mainstream settings so educational need is identified without clinical diagnosis, plus a commissioning model built on local population data across education, health and social care — explicitly requiring better local data collection, linkage, demographic recording and long-term outcome capture.",
    "quote": "This necessitates better data collection and linkage at a local level, capturing long-term outcomes across public services",
    "theme": "analytics",
    "status": "announced",
    "timeframe": "Recommendations accepted into the 2026 reform programme; delivery via the NIS evidence base and Experts at Hand from 2026-28",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "schools",
        "to": "las",
        "what": "strengths-and-needs assessment results feeding support plans and local commissioning"
      },
      {
        "from": "dhsc",
        "to": "las",
        "what": "linked prevalence, need and outcome data (incl. demographics) for population-based commissioning"
      }
    ],
    "newServices": [
      "free national suite of validated educational assessment tools"
    ],
    "identifiers": [],
    "standards": [
      "validated, developmentally appropriate assessment instruments",
      "demographic recording standards in needs data"
    ],
    "partners": [
      "NHS England",
      "local authorities",
      "mainstream settings",
      "research community"
    ],
    "strategyImplication": "Shifts identification data from clinical diagnosis records to education-held assessment data at population scale — creating a new sensitive child-level dataset (screening-like results) that needs governance before tools are distributed.",
    "eli5": "Schools will get free, well-tested checklists to work out what help a child needs without waiting for a doctor's label, and areas will join up their numbers to plan services.",
    "capabilityIds": [
      "value",
      "ethics"
    ],
    "pressureIds": [
      "send-data"
    ],
    "aliases": [
      "neurodivergence task and finish group",
      "diagnosis-independent assessment",
      "validated assessment tools",
      "local data linkage for neurodivergence"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/neurodivergence-task-and-finish-group-report",
      "https://assets.publishing.service.gov.uk/media/69984861339ee33f3ad0b9d0/The_Neurodivergence_Task_and_Finish_Group_report.pdf"
    ]
  },
  {
    "id": "best-start-digital-service",
    "docId": "best-start-strategy",
    "title": "National Best Start digital service linked to 'My Children' in the NHS App",
    "what": "A new national digital front door for parents, bringing trusted advice into one place and linking families to their local Best Start Family Hub. It will connect to 'My Children' in the NHS App (the digital successor to the 'red book'), let parents check funded-childcare eligibility directly, and explore safe use of AI to help parents find information. The Best Start in Life campaign and parent hub launched in autumn 2025.",
    "quote": "a new national Best Start digital service, linked to 'My Children' on the NHS app",
    "theme": "new-service",
    "status": "in-delivery",
    "timeframe": "Campaign launched autumn 2025; digital parenting hub follows, linking to NHS App 'My Children' over time",
    "timeframeDate": "2025-09",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "dfe",
        "to": "dhsc",
        "what": "linked parent-facing child records, guidance and journeys into 'My Children' in the NHS App"
      },
      {
        "from": "las",
        "to": "dfe",
        "what": "local service and hub location data for signposting"
      },
      {
        "from": "hmrc",
        "to": "dfe",
        "what": "streamlined checking of funded-childcare-hours eligibility by parents"
      }
    ],
    "newServices": [
      "Best Start digital service / Best Start in Life parent hub",
      "'My Children' in the NHS App (digital red book successor)"
    ],
    "identifiers": [
      "NHS login / NHS number (via NHS App integration)"
    ],
    "standards": [
      "shared data standards and interoperable systems for the national-local digital offer"
    ],
    "partners": [
      "DHSC",
      "NHS England",
      "HMRC",
      "local authorities"
    ],
    "strategyImplication": "DfE becomes co-owner of a citizen-facing cross-government digital service whose value depends on health-education data interoperability and NHS App integration.",
    "eli5": "Parents of babies and young children will get one trusted website and app - joined to the health service app - to find advice, local family hubs and free childcare checks.",
    "capabilityIds": [
      "platform",
      "value"
    ],
    "aliases": [
      "best start digital service",
      "My Children NHS App",
      "digital red book",
      "best start in life hub",
      "family hubs digital front door"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/giving-every-child-the-best-start-in-life/giving-every-child-the-best-start-in-life",
      "https://beststartinlife.gov.uk/",
      "https://www.nhs.uk/best-start-in-life/"
    ]
  },
  {
    "id": "bsfh-mi-reporting",
    "docId": "bsfh-guidance",
    "title": "Best Start Family Hubs: mandatory MI, delivery returns and data leadership",
    "what": "Every local authority receives Best Start Family Hubs and Healthy Babies funding (2026-29, £500m+) and must report against it: quarterly management information on reach, activity, outcomes and workforce; twice-yearly delivery returns linked to funding milestones; an annual financial statement; an annual maturity self-assessment; and participation in national evaluations. LAs must publish delivery plans by 31 March 2026 and identify dedicated digital and data leadership.",
    "quote": "Quarterly management information: who is being reached, activity delivered, outcomes, and workforce capability.",
    "theme": "analytics",
    "status": "in-delivery",
    "timeframe": "Funding and reporting run financial years 2026-27 to 2028-29; plans published by 31 March 2026",
    "timeframeDate": "2026-04",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "las",
        "to": "dfe",
        "what": "quarterly MI (reach, demographics, activity, outcomes), twice-yearly delivery returns and annual financial statements"
      },
      {
        "from": "las",
        "to": "researchers",
        "what": "evaluation data and access to service users for national evaluations from late 2026"
      }
    ],
    "newServices": [
      "Best Start Family Hubs network (all LAs, up to ~1,000 hubs by 2028)"
    ],
    "identifiers": [],
    "standards": [
      "management-information definition of what counts as a Best Start Family Hub",
      "shared data standards and interoperable systems expectation"
    ],
    "partners": [
      "DHSC",
      "local authorities",
      "NHS/health visiting services"
    ],
    "strategyImplication": "Creates a new recurring LA-to-DfE early-years MI pipeline; DfE needs collection infrastructure, definitions and publication plans (Family Hubs MI is already published as official statistics).",
    "eli5": "Councils running the new family hubs must send the government regular numbers on who they helped and what happened, in exchange for the funding.",
    "capabilityIds": [
      "value",
      "governance"
    ],
    "aliases": [
      "best start family hubs",
      "family hubs management information",
      "delivery returns",
      "hub maturity self-assessment"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/best-start-family-hubs-and-healthy-babies-guidance-for-local-authorities",
      "https://www.gov.uk/government/publications/family-hubs-and-start-for-life-management-information-2022-to-2025"
    ]
  },
  {
    "id": "gld-priority-metric-targets",
    "docId": "best-start-strategy",
    "title": "Good level of development as priority metric plus statutory local targets",
    "what": "The Best Start strategy anchors delivery to the Plan for Change milestone of 75% of five-year-olds reaching a good level of development (GLD) by 2028. The draft Local Government Outcomes Framework makes GLD a priority metric for local government, to be followed by specific statutory targets for each local area using Childcare Act 2006 Part 1 powers.",
    "quote": "makes the proportion of children achieving a good level of development at the end of reception a priority metric for local government",
    "theme": "accountability",
    "status": "consulting",
    "timeframe": "LGOF in draft consultation 2025; statutory local targets to follow; 75% GLD milestone set for 2028",
    "timeframeDate": "2028-07",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "schools",
        "to": "dfe",
        "what": "EYFS profile GLD outcomes data used as an accountability metric"
      },
      {
        "from": "dfe",
        "to": "mhclg",
        "what": "GLD outcomes as a priority metric in the Local Government Outcomes Framework"
      },
      {
        "from": "dfe",
        "to": "cabinet-office",
        "what": "GLD results as the Plan for Change school-ready milestone metric"
      }
    ],
    "newServices": [],
    "identifiers": [],
    "standards": [
      "EYFS profile / GLD measure as an accountability metric"
    ],
    "partners": [
      "MHCLG",
      "local authorities",
      "schools"
    ],
    "strategyImplication": "Elevates an existing DfE statistical measure into a cross-government accountability instrument, raising the bar on timeliness, granularity and comparability of early-years outcome data.",
    "eli5": "The government wants three out of four five-year-olds ready for school by 2028, and every council will get its own legally set target measured with school readiness data.",
    "capabilityIds": [
      "quality",
      "value"
    ],
    "aliases": [
      "good level of development",
      "GLD 75% target",
      "local government outcomes framework",
      "statutory local targets for early years",
      "school-ready milestone"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/giving-every-child-the-best-start-in-life/giving-every-child-the-best-start-in-life",
      "https://www.gov.uk/government/publications/plan-for-change"
    ]
  },
  {
    "id": "ey-professional-register",
    "docId": "best-start-strategy",
    "title": "New professional register for the early years workforce",
    "what": "DfE will work with the sector to co-design and introduce a professional register for early years workers, to raise status, create career-progression pathways and drive up standards. A register implies a new national dataset of practitioners, qualifications and settings, complementing existing early years workforce surveys and the Ofsted-held registers of providers.",
    "quote": "co-design and introduce a new professional register to put early years workers on a more professional footing",
    "theme": "register",
    "status": "announced",
    "timeframe": "Co-design with sector announced July 2025; no launch date set",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "ey-settings",
        "to": "dfe",
        "what": "registration, qualifications and workforce status data for the national register"
      }
    ],
    "newServices": [
      "national early years professional register"
    ],
    "identifiers": [
      "practitioner-level identifiers on a national register"
    ],
    "standards": [
      "qualification and registration data standards for the EY workforce"
    ],
    "partners": [
      "early years sector bodies",
      "Ofsted"
    ],
    "strategyImplication": "A new person-level register DfE must design, host and govern — the early-years analogue of the teacher record — with obvious linkage potential to workforce and quality data.",
    "eli5": "People who work in nurseries and childminding will go on an official national list, like teachers and nurses have, showing their training and qualifications.",
    "capabilityIds": [
      "platform",
      "quality"
    ],
    "aliases": [
      "early years professional register",
      "early years workforce register",
      "practitioner register",
      "EY register co-design"
    ],
    "confidence": "medium",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/giving-every-child-the-best-start-in-life/giving-every-child-the-best-start-in-life"
    ]
  },
  {
    "id": "ofsted-ey-group-reporting",
    "docId": "best-start-strategy",
    "title": "Ofsted group-level reporting on nursery chains and faster inspection cycle",
    "what": "DfE will fund Ofsted to inspect all new early years providers within 18 months of opening and move to inspecting all providers at least every four years (from six), and will work with Ofsted to introduce reporting on larger nursery chains so issues spanning a provider group can be addressed. Ofsted report cards for early years settings accompany this; it requires linking registered settings to parent groups in Ofsted's childcare registers.",
    "quote": "introduce reporting on larger nursery chains so issues that span a group of providers can be addressed",
    "theme": "accountability",
    "status": "in-delivery",
    "timeframe": "Inspection frequency funding from April 2026; group inspection approach being developed with Ofsted",
    "timeframeDate": "2026-04",
    "dfeRole": "partner",
    "flows": [
      {
        "from": "ofsted",
        "to": "parents",
        "what": "more frequent inspection outcomes, report cards and new group-level reporting on nursery chains"
      },
      {
        "from": "ofsted",
        "to": "dfe",
        "what": "group-level quality signals informing early years policy and market oversight"
      }
    ],
    "newServices": [
      "group-level inspection reporting for nursery chains",
      "Ofsted early years report cards"
    ],
    "identifiers": [
      "provider-group identifiers linking settings on the Early Years/Childcare Registers"
    ],
    "standards": [],
    "partners": [
      "Ofsted"
    ],
    "strategyImplication": "Ofsted's provider registers must model corporate group structures, mirroring the CWSA provider-group accountability approach in social care; richer, fresher inspection data feeds parent choice services.",
    "eli5": "Nurseries will be inspected more often, and big chains that run lots of nurseries will get a report on the whole chain, not just each building.",
    "capabilityIds": [
      "quality",
      "value"
    ],
    "aliases": [
      "nursery chain reporting",
      "group-level inspection",
      "early years inspection frequency",
      "childcare register groups"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/giving-every-child-the-best-start-in-life/giving-every-child-the-best-start-in-life"
    ]
  },
  {
    "id": "childcare-entitlement-ecs-flows",
    "docId": "entitlements-expansion-guidance",
    "title": "30-hours entitlement: HMRC-DfE-LA eligibility code flows and ECS replacement",
    "what": "From September 2025 eligible working parents of children from 9 months get 30 funded hours. Parents apply via HMRC's digital Childcare Service; HMRC checks eligibility and issues an 11-digit code; local authorities and providers verify codes through DfE's Eligibility Checking System, with parents reconfirming every 3 months. DfE also committed to a replacement service for the ECS, migrating entitlement checks (starting with the Free School Meals Service) over 2025.",
    "quote": "The local authority will continue to verify the code through DfE's Eligibility Checking System (ECS)",
    "theme": "data-sharing",
    "status": "in-delivery",
    "timeframe": "Expansion live from 1 September 2025; ECS replacement migration began during 2025",
    "timeframeDate": "2025-09",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "parents",
        "to": "hmrc",
        "what": "applications, income/work status and 3-monthly reconfirmations via the Childcare Service"
      },
      {
        "from": "hmrc",
        "to": "dfe",
        "what": "eligibility determinations logged as 11-digit codes in the ECS"
      },
      {
        "from": "las",
        "to": "dfe",
        "what": "code validation queries (ECS API) before funding places"
      }
    ],
    "newServices": [
      "replacement service for the Eligibility Checking System (ECS)"
    ],
    "identifiers": [
      "11-digit childcare eligibility codes (per child, persistent to compulsory school age)"
    ],
    "standards": [
      "ECS API specification for LA management systems"
    ],
    "partners": [
      "HMRC",
      "local authorities",
      "childcare providers",
      "software suppliers"
    ],
    "strategyImplication": "One of DfE's highest-volume operational data exchanges with another department; the ECS replacement is live shared eligibility infrastructure that FSM and childcare checks will both ride on.",
    "eli5": "When parents apply for free childcare hours, the tax office checks they qualify and issues a code, which nurseries and councils verify through a government computer before the free hours start.",
    "capabilityIds": [
      "sharing",
      "platform"
    ],
    "aliases": [
      "30 hours entitlement",
      "childcare eligibility code",
      "11-digit code",
      "eligibility checking system replacement",
      "working parent entitlement data"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://assets.publishing.service.gov.uk/media/683981d4c99c4f37ab4e86e3/September_2025_early_education_and_childcare_entitlements_expansion_-_local_authority_system_guidance_May_2025.pdf",
      "https://www.gov.uk/free-childcare-if-working"
    ]
  },
  {
    "id": "ffp-quarterly-data",
    "docId": "ffp-guide",
    "title": "Families First Partnership quarterly programme data collections",
    "what": "From April 2025 all LAs and safeguarding partners deliver Family Help, multi-agency child protection and family network reforms (including family group decision-making, now a CWSA duty to offer before care proceedings) under the FFP programme. LAs must return data quarterly on set-up, delivery and outcomes of reformed services — including FGDM offers and uptake; the 2026-27 collection was revised for reliability, headline indicators monitor fidelity, and from April 2026 DfE also surveys safeguarding partners' perceptions quarterly. Services must be fully operational by March 2027.",
    "quote": "required to return data on the set up, delivery and outcomes of reformed services through quarterly FFP programme data collections",
    "theme": "analytics",
    "status": "in-delivery",
    "timeframe": "Quarterly from 2025-26; revised item list from Q1 2026-27; full operation expected by March 2027",
    "timeframeDate": "2027-03",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "las",
        "to": "dfe",
        "what": "quarterly programme data on Family Help, MACPT, family networks and FGDM offers/uptake, plus quarterly partner-perception surveys from April 2026"
      }
    ],
    "newServices": [],
    "identifiers": [],
    "standards": [
      "published quarterly data item list on the FFP Knowledge Hub",
      "headline monitoring indicators as leading measures"
    ],
    "partners": [
      "safeguarding partners (police, health)",
      "Ofsted (ILACS alignment)",
      "family courts/Cafcass (context)"
    ],
    "strategyImplication": "A parallel, faster-cadence national collection sitting alongside the statutory censuses — a live test of quarterly LA reporting that any future consolidated social-care collection would build on, and the vehicle for evidencing the new FGDM duty.",
    "eli5": "Councils changing how they help struggling families must send the government a progress report every three months showing what they set up and whether it is working.",
    "capabilityIds": [
      "value",
      "governance"
    ],
    "aliases": [
      "families first partnership",
      "FFP programme data",
      "family help data",
      "quarterly social care collections",
      "family group decision-making data"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/families-first-partnership-programme",
      "https://assets.publishing.service.gov.uk/media/6825b992a60aeba5ab34e006/The_families_first_partnership_programme_guide.pdf",
      "https://www.legislation.gov.uk/ukpga/2026/21/contents/enacted"
    ]
  },
  {
    "id": "agency-social-worker-return",
    "docId": "agency-data-return",
    "title": "Quarterly statutory data return on agency child and family social workers",
    "what": "Statutory guidance in force from 31 October 2024 requires LAs to submit quarterly data to DfE on the use and pay of agency child and family social workers (first return covered Jan-Mar 2025), via assignments and general data templates, with price-cap data from Q4 2025 and agreed regional price caps published in August 2025. CWSA s.21 provides regulation-making powers to extend agency-worker rules to the wider children's social care workforce.",
    "quote": "the quarterly statutory data collection on the use and pay of agency child and family social workers",
    "theme": "workforce",
    "status": "statutory-duty",
    "timeframe": "Guidance in force 31 Oct 2024; first return spring 2025; price-cap data from Q4 2025; CWSA s.21 regulations to follow",
    "timeframeDate": "2024-10",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "las",
        "to": "dfe",
        "what": "quarterly agency-worker assignments, usage and pay data; price-cap compliance data"
      }
    ],
    "newServices": [],
    "identifiers": [],
    "standards": [
      "assignments and general data return templates",
      "regional price-cap framework"
    ],
    "partners": [
      "local authorities",
      "agencies/managed service providers"
    ],
    "strategyImplication": "Extends DfE's workforce evidence base from annual census to quarterly operational monitoring, directly steering a price-cap intervention — a model for data-backed market rules.",
    "eli5": "Councils must report every three months how many temporary social workers they hire and what they pay, so the government can stop prices spiralling.",
    "capabilityIds": [
      "skills",
      "governance"
    ],
    "aliases": [
      "agency social workers data return",
      "agency rules",
      "social worker price caps",
      "quarterly workforce return"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/agency-child-and-family-social-workers-data-return-and-price-caps",
      "https://assets.publishing.service.gov.uk/media/670e59e9080bdf716392f380/Agency_Rules_-_statutory_guidance_for_local_authorities_on_the_use_of_agency_child_and_family_social_workers.pdf"
    ]
  },
  {
    "id": "csc-data-strategy-dashboard",
    "docId": "csc-data-digital-strategy",
    "title": "Children's social care dashboard, standard dataset and collection modernisation",
    "what": "DfE's children's social care data and digital strategy (Dec 2023, reaffirmed by KCSHFT) commits to a national CSC dashboard bringing data together in one place; funding LAs to create a standard children's social care dataset for collaborative analysis (via Data to Insight / the Data and Digital Solutions Fund); developing open data and technology standards; exploring automated collections to cut burden; improving CP-IS; and piloting linkage of DfE data with MoJ family courts data. The annual CIN census and SSDA903 continue with iterative improvements; no consolidated single collection has been announced.",
    "quote": "publish a children's social care dashboard which will bring children's social care data together in one place",
    "theme": "infrastructure",
    "status": "in-delivery",
    "timeframe": "Strategy published December 2023; dashboard live and evolving; standards and automated-collection work ongoing through 2025+",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "las",
        "to": "dfe",
        "what": "CIN census, SSDA903 and workforce census indicators consolidated into the dashboard and EES"
      },
      {
        "from": "moj",
        "to": "dfe",
        "what": "family courts data (special guardianship, child arrangement orders) piloted for linkage with DfE data"
      }
    ],
    "newServices": [
      "children's social care national dashboard",
      "standard local CSC dataset (Data to Insight / DDSF)"
    ],
    "identifiers": [
      "NHS number tested as consistent identifier via NHS Spine"
    ],
    "standards": [
      "CSC data and technology open standards",
      "responsible data analytics guidance for CSC"
    ],
    "partners": [
      "Data to Insight",
      "Ministry of Justice",
      "NHS England",
      "Ofsted",
      "local authorities"
    ],
    "strategyImplication": "This is the substrate for everything else in children's social care data: dashboarding, open standards and automated-collection work determine whether the statutory censuses can evolve toward the more frequent, event-based collection the CWSA reforms will demand.",
    "eli5": "The government is putting all its numbers about children's social care in one dashboard, and helping councils record things the same way so the data can be compared and joined up.",
    "capabilityIds": [
      "platform",
      "interoperability"
    ],
    "aliases": [
      "children's social care dashboard",
      "standard CSC dataset",
      "data to insight",
      "CIN census improvement",
      "SSDA903",
      "CP-IS improvement"
    ],
    "confidence": "medium",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/childrens-social-care-data-and-digital-strategy/childrens-social-care-data-and-digital-strategy",
      "https://www.gov.uk/guidance/children-in-need-census",
      "https://www.gov.uk/guidance/children-looked-after-return-guide-to-submitting-data",
      "https://www.datatoinsight.org/ddsf"
    ]
  },
  {
    "id": "neet-risk-indicator-sharing",
    "docId": "post16-white-paper",
    "title": "NEET identification: 'Risk of NEET' indicator tools and reformed data sharing on young people",
    "what": "DfE will enable local authorities, Strategic Authorities, schools and FE providers to identify, track and share data about young people more effectively, and will build new 'Risk of NEET' indicator (RONI-style) tools and guidance, explicitly using AI to enhance the approach. The December 2025 Youth Guarantee expansion attached £34m to the risk-indicator work, alongside automatic-enrolment pilots with FE providers for young people without a post-16 place; expanding Strategic Authorities' 16-19 powers is to be 'underpinned by reforms to data sharing'.",
    "quote": "We will enable local authorities, Strategic Authorities, schools and further education providers to identify, track and share data about young people more effectively.",
    "theme": "data-sharing",
    "status": "in-delivery",
    "timeframe": "White paper Oct 2025; £34m announced 6 Dec 2025; tools and guidance rolling out from 2026",
    "timeframeDate": "2026-01",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "schools",
        "to": "las",
        "what": "attendance, enrolment and risk-characteristic data on young people at risk of NEET"
      },
      {
        "from": "colleges",
        "to": "las",
        "what": "FE enrolment and engagement data for NEET risk tracking"
      },
      {
        "from": "dfe",
        "to": "las",
        "what": "Risk of NEET indicator outputs, tools and guidance"
      }
    ],
    "newServices": [
      "Risk of NEET indicator tools (AI-enhanced)",
      "automatic enrolment pilots with FE providers"
    ],
    "identifiers": [],
    "standards": [
      "guidance standardising NEET risk-characteristic identification"
    ],
    "partners": [
      "local authorities",
      "Strategic Authorities",
      "schools",
      "FE providers",
      "DWP"
    ],
    "strategyImplication": "Creates a cross-tier young-person tracking layer (school to post-16) that any DfE data strategy must treat as a core data-sharing product, with AI/algorithmic-risk-scoring governance implications.",
    "eli5": "Schools, colleges and councils will share information - helped by computer predictions - to spot teenagers likely to end up with no job or course, and step in early.",
    "capabilityIds": [
      "sharing",
      "value",
      "ethics"
    ],
    "pressureIds": [
      "ai-in-education",
      "neet-tracking"
    ],
    "aliases": [
      "risk of NEET indicator",
      "RONI",
      "NEET tracking tools",
      "automatic enrolment pilots",
      "identify track and share"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/post-16-education-and-skills-white-paper/post-16-education-and-skills-white-paper",
      "https://www.gov.uk/government/news/almost-a-million-young-people-to-benefit-from-expanded-support-new-training-and-work-experience-opportunities"
    ]
  },
  {
    "id": "fe-attendance-tracking",
    "docId": "post16-white-paper",
    "title": "16-19 attendance tracking extended into further education",
    "what": "Government will work with all 16-19 providers to track student attendance and intervene early when it declines, importing best practice (and implicitly the data machinery) from the schools attendance data collection into FE. The December 2025 Youth Guarantee package funded enhanced attendance monitoring and early-warning analytics as part of NEET prevention.",
    "quote": "We will work with all 16 to 19 education providers to track attendance by students and intervene early when attendance starts to decline.",
    "theme": "analytics",
    "status": "in-delivery",
    "timeframe": "White paper Oct 2025; early-warning attendance work funded Dec 2025; no statutory collection date yet",
    "timeframeDate": "2026-01",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "colleges",
        "to": "dfe",
        "what": "student-level attendance data for early-intervention analytics (modelled on the schools daily collection)"
      },
      {
        "from": "colleges",
        "to": "las",
        "what": "attendance decline signals supporting local NEET prevention"
      }
    ],
    "newServices": [
      "FE attendance tracking / early-warning capability"
    ],
    "identifiers": [],
    "standards": [
      "school attendance data practice extended to FE settings"
    ],
    "partners": [
      "FE colleges",
      "sixth forms",
      "local authorities"
    ],
    "strategyImplication": "Likely successor to the schools daily attendance feed for the FE estate — a new near-real-time collection burden on colleges and a candidate for a shared attendance data standard across phases.",
    "eli5": "Colleges will track whether students are turning up, the way schools now do, so someone notices quickly when a student starts drifting away.",
    "capabilityIds": [
      "value",
      "sharing"
    ],
    "pressureIds": [
      "attendance-data",
      "neet-tracking"
    ],
    "aliases": [
      "16-19 attendance tracking",
      "FE attendance data",
      "college attendance monitoring",
      "early-warning attendance analytics"
    ],
    "confidence": "medium",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/post-16-education-and-skills-white-paper/post-16-education-and-skills-white-paper",
      "https://www.gov.uk/government/news/almost-a-million-young-people-to-benefit-from-expanded-support-new-training-and-work-experience-opportunities"
    ]
  },
  {
    "id": "course-outcomes-transparency",
    "docId": "post16-white-paper",
    "title": "Data-led outcome information for every education and training course",
    "what": "Government will publish data-led information for individuals about the outcomes of each education and training course, plus 'clear maps to success in different occupations'. In HE, the white paper wants Discover Uni-style graduate outcomes and completion rates embedded on UCAS course pages alongside offer rates and historic grades — the consumer-facing surface of LEO and destinations data.",
    "quote": "We will provide data-led information for individuals about the outcomes of each education and training course.",
    "theme": "analytics",
    "status": "announced",
    "timeframe": "White paper Oct 2025; phased with IAG reform and UCAS page changes, dates unconfirmed",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "dfe",
        "to": "parents",
        "what": "course-level earnings, continuation and completion outcomes surfaced to learners via careers services"
      },
      {
        "from": "dfe",
        "to": "he",
        "what": "graduate outcomes and completion rates for embedding on UCAS/Discover Uni course pages"
      }
    ],
    "newServices": [
      "course-level outcomes information service / occupation maps for learners"
    ],
    "identifiers": [],
    "standards": [
      "consistent course-outcome metrics across FE and HE provision"
    ],
    "partners": [
      "UCAS",
      "OfS (Discover Uni)",
      "Skills England",
      "National Careers Service / jobs and careers service"
    ],
    "strategyImplication": "Demands course-level outcome linkage at publication quality across FE and HE — a heavy ask of LEO/ILR/HESA plumbing and a flagship 'data as public product' commitment.",
    "eli5": "Before choosing a course, anyone will be able to see real numbers on what past students went on to earn and do.",
    "capabilityIds": [
      "value"
    ],
    "pressureIds": [
      "neet-tracking"
    ],
    "aliases": [
      "course-level outcomes",
      "outcomes of each course",
      "occupation maps",
      "discover uni on UCAS",
      "graduate outcomes transparency"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/post-16-education-and-skills-white-paper/post-16-education-and-skills-white-paper",
      "https://wonkhe.com/blogs/what-is-in-the-post-16-education-and-skills-white-paper-for-higher-education/"
    ]
  },
  {
    "id": "leo-maximise-linking",
    "docId": "post16-white-paper",
    "title": "Maximise LEO and expand cross-government person-level data linking",
    "what": "The Post-16 White Paper commits to maximising value from the Longitudinal Education Outcomes dataset (NPD + Longitudinal ILR + HESA linked to HMRC earnings and DWP benefits, ~38m people) and linking data across departments to test whether the system gets people into good jobs. Delivery is visible: LEO SRS Iteration 2.1 standard extract released via ONS SRS in May 2026, a low-fidelity synthetic LEO built with UCL/ADR UK for research planning, at-least-annual refreshes, and LEO extension work with other UK nations.",
    "quote": "maximising the value drawn from the department's best data sources such as the Longitudinal Education Outcomes dataset, and linking data from across government departments",
    "theme": "infrastructure",
    "status": "in-delivery",
    "timeframe": "Ongoing; LEO Iteration 2.1 released May 2026; annual refresh cadence",
    "timeframeDate": "2026-05",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "hmrc",
        "to": "dfe",
        "what": "individual-level earnings and tax records linked to education histories"
      },
      {
        "from": "dwp",
        "to": "dfe",
        "what": "benefits and employment records linked to education histories"
      },
      {
        "from": "dfe",
        "to": "researchers",
        "what": "de-identified person-level linked extracts and synthetic LEO via the ONS Secure Research Service"
      }
    ],
    "newServices": [
      "synthetic LEO dataset for researcher onboarding"
    ],
    "identifiers": [
      "de-identified person keys linking NPD/ILR/HESA/HMRC/DWP records"
    ],
    "standards": [
      "Digital Economy Act 2017 accredited research",
      "Five Safes framework"
    ],
    "partners": [
      "HMRC",
      "DWP",
      "ONS SRS",
      "ADR UK",
      "HESA/Jisc",
      "devolved administrations"
    ],
    "strategyImplication": "LEO is DfE's proof that cross-department person-level linkage works at scale and is positioned as the backbone outcomes asset; the strategy must fund its refresh cadence, cross-departmental legal gateways and researcher access model.",
    "eli5": "The government connects school records with later tax and benefits records - with names removed for researchers - to learn which courses actually lead to good jobs.",
    "capabilityIds": [
      "platform",
      "value",
      "sharing"
    ],
    "aliases": [
      "longitudinal education outcomes",
      "LEO dataset",
      "synthetic LEO",
      "LEO iteration 2.1",
      "cross-government data linking"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/post-16-education-and-skills-white-paper/post-16-education-and-skills-white-paper",
      "https://www.gov.uk/government/collections/longitudinal-education-outcomes-leo-collection",
      "https://reports.adruk.org/annual-report-2024-2025/our-data/new-and-emerging-datasets/longitudinal-education-outcomes-leo/",
      "https://www.adruk.org/data-access/flagship-datasets/longitudinal-education-outcomes/",
      "https://www.gov.uk/government/publications/longitudinal-education-outcomes-leo-dataset/longitudinal-education-outcomes-leo-data"
    ]
  },
  {
    "id": "chep25-participation-metric",
    "docId": "post16-white-paper",
    "title": "CHEP25: cohort-based higher education participation measure",
    "what": "The white paper adopts a new headline analytic — Cohort-based Higher Education Participation (CHEP25) — tracking HE participation by school cohort up to age 25, as the success measure for its ambition that two-thirds participate in higher-level learning (HE or apprenticeships) by 25. It requires sustained cohort linkage of school census, ILR, HESA and apprenticeship records.",
    "quote": "We will measure this using Cohort-based Higher Education Participation (CHEP25), which tracks higher education participation by school cohort up to age 25.",
    "theme": "accountability",
    "status": "announced",
    "timeframe": "From Oct 2025; reported through official statistics cycles",
    "timeframeDate": "2025-10",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "he",
        "to": "dfe",
        "what": "HESA participation records for longitudinal cohort linkage to age 25"
      },
      {
        "from": "colleges",
        "to": "dfe",
        "what": "ILR and apprenticeship records feeding the cohort participation measure"
      }
    ],
    "newServices": [],
    "identifiers": [
      "cohort-level person matching across school, FE, HE and apprenticeship records"
    ],
    "standards": [
      "CHEP25 metric definition"
    ],
    "partners": [
      "HESA/Jisc",
      "OfS"
    ],
    "strategyImplication": "A named, cohort-linked KPI baked into government targets — locks in long-run identifier continuity across phases (school to 25) as a strategic requirement.",
    "eli5": "The government will follow each year-group of pupils until age 25 to count how many go on to university or an apprenticeship, aiming for two in every three.",
    "capabilityIds": [
      "quality",
      "value"
    ],
    "pressureIds": [
      "neet-tracking"
    ],
    "aliases": [
      "CHEP25",
      "cohort-based higher education participation",
      "two-thirds participation by 25",
      "cohort tracking to 25"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/post-16-education-and-skills-white-paper/post-16-education-and-skills-white-paper",
      "https://commonslibrary.parliament.uk/research-briefings/cbp-10388/"
    ]
  },
  {
    "id": "skills-passports-exploration",
    "docId": "post16-white-paper",
    "title": "Skills England to explore skills passports",
    "what": "Skills England will work with industry to explore skills passports — portable records documenting individuals' skills and competencies so they can be endorsed and transferred between employers and sectors. If pursued, this implies a personal, verifiable skills record with standardised skill descriptors, likely anchored to occupational standards.",
    "quote": "Skills England will engage with industry and other partners to explore the development of skills passports, reviewing best practice and learning from previous initiatives.",
    "theme": "standards",
    "status": "proposed",
    "timeframe": "Exploration from late 2025; no delivery date",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "skills-england",
        "to": "parents",
        "what": "portable, endorsed records of skills and competencies for individuals (exploratory)"
      }
    ],
    "newServices": [
      "potential skills passport service"
    ],
    "identifiers": [
      "potential lifelong personal skills record"
    ],
    "standards": [
      "standardised skills/competency descriptors (occupational-standards aligned)"
    ],
    "partners": [
      "employers",
      "sector bodies",
      "Skills England"
    ],
    "strategyImplication": "The nearest thing to a lifelong learner record commitment in the landscape — watch for convergence with LLE personal accounts, the Education Record and V Level occupational-standards tagging.",
    "eli5": "You could one day carry an official digital record of everything you can do at work, which employers trust and which moves with you between jobs.",
    "capabilityIds": [
      "interoperability",
      "value"
    ],
    "aliases": [
      "skills passport",
      "portable skills record",
      "transferable competencies record",
      "skills wallet"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/post-16-education-and-skills-white-paper/post-16-education-and-skills-white-paper"
    ]
  },
  {
    "id": "skills-england-intelligence",
    "docId": "skills-needs-assessments-2026",
    "title": "Skills England as the authoritative skills-needs evidence base (SNAs + AI labour-market intelligence)",
    "what": "Skills England — which absorbed the Unit for Future Skills' analytical function — is committed to be 'the single authoritative voice' on current and future skills needs. It delivered the 'Assessment of priority skills to 2030' (Aug 2025) and, jointly with DWP, an Annual Skills Report plus 10 sectoral Skills Needs Assessments (June 2026) feeding Strategic Authorities' local skills plans and Industrial Strategy Jobs Plans. It will harness AI and data analytics — extracting insight from job postings, employer intelligence and forecasts — and shares data through the Labour Market Evidence Group with the Industrial Strategy Advisory Council and Migration Advisory Committee.",
    "quote": "By offering a shared, authoritative evidence base, the SNAs will enable government and industry to co-create solutions, target investment effectively",
    "theme": "analytics",
    "status": "in-delivery",
    "timeframe": "First annual cycle delivered June 2026; methods 'experimental', iterated annually; LMEG operating across 2025-26",
    "timeframeDate": "2026-06",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "skills-england",
        "to": "mhclg",
        "what": "skills-needs insights enhancing Strategic Authorities' local labour market intelligence"
      },
      {
        "from": "skills-england",
        "to": "dwp",
        "what": "sectoral skills needs assessments underpinning Jobs Plans"
      },
      {
        "from": "skills-england",
        "to": "home-office",
        "what": "shared labour-market evidence informing migration policy via the LMEG"
      }
    ],
    "newServices": [
      "Annual Skills Report and sectoral SNA publication cycle",
      "AI-driven skills forecasting capability"
    ],
    "identifiers": [],
    "standards": [
      "common occupation-to-course pathway mapping methodology"
    ],
    "partners": [
      "DWP",
      "Strategic Authorities",
      "Employer Representative Bodies",
      "Industrial Strategy Advisory Council",
      "Migration Advisory Committee"
    ],
    "strategyImplication": "Establishes a recurring national skills-intelligence product that DfE data strategy must feed (ILR, apprenticeships, LEO) and consume (funding prioritisation, qualification approval) — and commits DfE's agency to production AI on third-party labour-market data, with provenance, licensing and assurance obligations.",
    "eli5": "A government skills agency studies job adverts and industry data - with computer help - to predict which skills the country will need, and shares the answers with everyone planning courses.",
    "capabilityIds": [
      "value"
    ],
    "aliases": [
      "skills needs assessments",
      "annual skills report",
      "labour market evidence group",
      "AI labour market intelligence",
      "priority skills to 2030"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/skills-england-annual-skills-report-and-sectoral-skills-needs-assessments-2026/skills-needs-assessments-introduction",
      "https://www.gov.uk/government/publications/assessment-of-priority-skills-to-2030/assessment-of-priority-skills-to-2030",
      "https://www.gov.uk/government/publications/post-16-education-and-skills-white-paper/post-16-education-and-skills-white-paper",
      "https://skillsengland.blog.gov.uk/2025/11/11/building-the-skills-system-britain-needs-skills-englands-role-in-post-16-reform-by-tessa-griffiths-and-sarah-maclean/"
    ]
  },
  {
    "id": "ifate-occupational-standards-register",
    "docId": "ifate-transfer-act-2025",
    "title": "Occupational standards and assessment plans transferred to Skills England as a canonical register",
    "what": "The Act (Royal Assent 15 May 2025; IfATE abolished 1 June 2025) transfers preparation, approval and review of occupational standards and apprenticeship assessment plans to the Secretary of State, exercised through Skills England from 2 June 2025. Skills England now maintains the occupational standards corpus and the occupational maps (15 routes) with a public API — the reference data spine for apprenticeships, T Levels and forthcoming V Levels.",
    "quote": "to transfer the functions of the Institute for Apprenticeships and Technical Education, and its property, rights and liabilities, to the Secretary of State",
    "theme": "register",
    "status": "statutory-duty",
    "timeframe": "Commenced June 2025 (SI 2025/598); annual report to Parliament on exercise of functions",
    "timeframeDate": "2025-06",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "skills-england",
        "to": "colleges",
        "what": "occupational standards, assessment plans and occupational maps data (including via public API)"
      },
      {
        "from": "skills-england",
        "to": "ofqual",
        "what": "standards and assessment plans underpinning regulated technical qualifications"
      }
    ],
    "newServices": [
      "Skills England occupational maps service and API"
    ],
    "identifiers": [
      "occupational standard reference codes"
    ],
    "standards": [
      "occupational standards as the canonical taxonomy for technical qualifications"
    ],
    "partners": [
      "awarding organisations",
      "Ofqual",
      "employers/trailblazer groups"
    ],
    "strategyImplication": "Brings the technical-education reference-data register inside the department — the data strategy should treat occupational standards/maps as a managed canonical register with API service levels.",
    "eli5": "The official list describing what every trade and technical job requires now lives inside the government's own skills agency, and computers can read it directly.",
    "capabilityIds": [
      "platform",
      "quality"
    ],
    "aliases": [
      "occupational standards",
      "occupational maps",
      "IfATE transfer",
      "apprenticeship assessment plans",
      "skills england API"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.legislation.gov.uk/ukpga/2025/14",
      "https://occupational-maps.skillsengland.education.gov.uk/",
      "https://www.gov.uk/government/publications/a-report-on-the-exercise-of-ifates-relevant-functions/institute-for-apprenticeships-and-technical-education-transfer-of-functions-etc-act-2025-report-on-exercise-of-the-secretary-of-states-functions"
    ]
  },
  {
    "id": "youth-guarantee-data-flows",
    "docId": "get-britain-working",
    "title": "Youth Guarantee (18-21): cross-boundary data to identify and track young people",
    "what": "The Youth Guarantee commits that all 18-21s in England can access education, training or help into work, delivered through eight £45m trailblazers led by Strategic Authorities. It explicitly rests on better local data: integrating DWP's Youth Offer data with DfE's September Guarantee data, and trailblazers building data sharing agreements to track young people into, through and out of the guarantee. The £820m December 2025 expansion added the Jobs Guarantee — funded six-month placements for young people on Universal Credit 18+ months, live in 6 areas from spring 2026 and 25 areas from autumn 2026, with DWP referral data flowing to delivery partners and outcome reporting back.",
    "quote": "The government wants local areas to have improved data to understand local population needs",
    "theme": "data-sharing",
    "status": "in-delivery",
    "timeframe": "Trailblazers live from spring 2025; £820m expansion Dec 2025; Jobs Guarantee national rollout from autumn 2026",
    "timeframeDate": "2025-04",
    "dfeRole": "partner",
    "flows": [
      {
        "from": "dwp",
        "to": "mhclg",
        "what": "Universal Credit claimant data on 18-21s for trailblazer outreach and matching to opportunities"
      },
      {
        "from": "las",
        "to": "mhclg",
        "what": "September Guarantee and participation (NEET/RPA) data on young people"
      },
      {
        "from": "mhclg",
        "to": "dwp",
        "what": "outcome and tracking data at key transition points for evaluation"
      }
    ],
    "newServices": [
      "local youth-guarantee tracking arrangements underpinned by new data sharing agreements",
      "Jobs Guarantee grant administration and placement-matching arrangements"
    ],
    "identifiers": [],
    "standards": [],
    "partners": [
      "DWP",
      "Strategic Authorities / GLA",
      "local authorities",
      "colleges and training providers",
      "employers"
    ],
    "strategyImplication": "The clearest live test of DWP-DfE-local person-level data sharing for 18-21s — lessons here (legal gateways, matching quality) will shape any national participation data service; joining placement outcomes to education histories via LEO is the obvious evaluation ask.",
    "eli5": "Job centres, councils and colleges are pooling what they know about 18 to 21 year olds so every young person gets offered training or work, and nobody gets lost between systems.",
    "capabilityIds": [
      "sharing",
      "value"
    ],
    "pressureIds": [
      "agency-coordination",
      "neet-tracking"
    ],
    "aliases": [
      "youth guarantee",
      "trailblazers 18-21",
      "September guarantee data",
      "jobs guarantee",
      "youth offer data integration"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/get-britain-working-white-paper/get-britain-working-white-paper",
      "https://commonslibrary.parliament.uk/research-briefings/cbp-10827/",
      "https://www.london.gov.uk/who-we-are/governance-and-spending/promoting-good-governance/decision-making/decisions/md3348-london-get-britain-working-trailblazers-2025-26",
      "https://www.gov.uk/government/publications/jobs-guarantee/jobs-guarantee-grant-guidance",
      "https://www.gov.uk/government/news/almost-a-million-young-people-to-benefit-from-expanded-support-new-training-and-work-experience-opportunities"
    ]
  },
  {
    "id": "jobs-careers-service-digital",
    "docId": "get-britain-working",
    "title": "New jobs and careers service: Jobcentre Plus + National Careers Service merger with an AI-enabled digital offer",
    "what": "Get Britain Working committed to merge Jobcentre Plus and the National Careers Service in England into a single jobs and careers service ('digital, universal and fully inclusive'), starting with a £55m pathfinder, and to test a radically improved digital offer using the latest technologies and AI for jobs and skills information. This moves careers data (a DfE-sponsored service) into a DWP-led digital platform. NCS contracts transferred DfE→DWP in April 2026; the merged service launches 1 October 2026 with real-time data access between work coaches and careers advisers (replacing the manual January-2025 data-sharing agreement), and the platform will generate real-time salary, skills and vacancy-location intelligence.",
    "quote": "test, trial and develop a radically improved digital offer, using the latest technologies and AI to provide up to date information on jobs, skills",
    "theme": "new-service",
    "status": "in-delivery",
    "timeframe": "merged service from 1 Oct 2026",
    "dfeRole": "partner",
    "flows": [
      {
        "from": "dfe",
        "to": "dwp",
        "what": "careers guidance content, customer records and skills information from the National Careers Service"
      },
      {
        "from": "dwp",
        "to": "parents",
        "what": "AI-assisted, up-to-date jobs and skills information for users"
      }
    ],
    "newServices": [
      "jobs and careers service digital platform (pathfinder-tested)"
    ],
    "identifiers": [],
    "standards": [],
    "partners": [
      "DWP",
      "DfE",
      "Skills England (labour market intelligence)"
    ],
    "strategyImplication": "DfE loses direct control of a citizen-facing careers data channel but must supply it (course outcomes, occupational maps) — interface contracts and shared standards with DWP become strategic; DfE should secure durable reciprocal access to the new real-time skills and salary intelligence before the October 2026 cutover.",
    "eli5": "The job centre and the careers advice service are becoming one modern service, with a smart website that helps people find jobs and the right training.",
    "capabilityIds": [
      "platform",
      "value"
    ],
    "aliases": [
      "jobs and careers service",
      "jobcentre plus merger",
      "national careers service merger",
      "careers service pathfinder"
    ],
    "confidence": "medium",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/get-britain-working-white-paper/get-britain-working-white-paper",
      "https://publications.parliament.uk/pa/cm5901/cmselect/cmworpen/1493/report.html",
      "https://www.gov.uk/government/publications/get-britain-working-an-update-on-the-jobs-and-careers-service/get-britain-working-an-update-on-the-jobs-and-careers-service",
      "https://www.gov.uk/government/publications/dwp-and-dfe-data-sharing-agreement-with-the-national-careers-service-and-jobcentre-plus/dwp-and-dfe-data-sharing-agreement-with-the-national-careers-service-and-jobcentre-plus"
    ],
    "timeframeDate": "2026-10"
  },
  {
    "id": "lle-slc-personal-account",
    "docId": "lle-overview",
    "title": "Lifelong Learning Entitlement: SLC-hosted personal account and single funding data system",
    "what": "The LLE replaces HE student finance and Advanced Learner Loans with a single entitlement (four years' equivalent funding to age 60). Applications open September 2026 for courses and modules starting on/after 1 January 2027. The Student Loans Company will host a digital service where learners see their remaining entitlement balance, track applications and get guidance — a personal, longitudinal funding record spanning FE and HE, modular and full courses.",
    "quote": "Users will be able to login to this SLC digital service to obtain their LLE tuition fee loan balance tailored to their specific circumstances.",
    "theme": "new-service",
    "status": "in-delivery",
    "timeframe": "Applications from Sep 2026; first funded courses/modules from 1 Jan 2027",
    "timeframeDate": "2026-09",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "colleges",
        "to": "slc",
        "what": "course and module registration data to draw down LLE funding"
      },
      {
        "from": "he",
        "to": "slc",
        "what": "course and module registration data to draw down LLE funding"
      },
      {
        "from": "slc",
        "to": "parents",
        "what": "personal entitlement balance, application status and guidance for learners"
      },
      {
        "from": "slc",
        "to": "dfe",
        "what": "take-up and funding data for a unified tertiary funding view"
      }
    ],
    "newServices": [
      "SLC LLE personal account digital service"
    ],
    "identifiers": [
      "lifelong per-person entitlement record spanning FE and HE study"
    ],
    "standards": [],
    "partners": [
      "Student Loans Company",
      "HE providers",
      "FE colleges",
      "OfS"
    ],
    "strategyImplication": "First genuinely tertiary-wide personal funding ledger — a lifelong identifier-anchored account that other services (skills passports, careers, the Education Record) will want to hook into.",
    "eli5": "Every adult gets a learning money pot lasting four years of study to use any time before age 60, with an online account showing how much is left.",
    "capabilityIds": [
      "platform",
      "value"
    ],
    "aliases": [
      "lifelong learning entitlement",
      "LLE personal account",
      "entitlement balance",
      "SLC digital service",
      "tertiary funding ledger"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/lifelong-learning-entitlement-lle-overview/lifelong-learning-entitlement-overview",
      "https://www.gov.uk/student-finance-on-or-after-1-january-2027"
    ]
  },
  {
    "id": "lle-modular-data-standard",
    "docId": "lle-overview",
    "title": "Modular study data: standardised transcripts and HESA Student return changes for LLE",
    "what": "Providers approved for LLE-funded modular courses must issue a standardised transcript on completion of each module, supporting credit transfer and recognition of prior learning. In parallel, the post-Data Futures HESA Student return adds a new COURSEINITID valid entry from 2026/27 to flag all modular provision, with fuller module/credit changes from 2027/28 so funders and regulators can see completions and credits; OfS intends to explore a modular completion measure.",
    "quote": "Providers with approval to deliver LLE-funded modular courses must make a standardised transcript available on completion of each module.",
    "theme": "standards",
    "status": "in-delivery",
    "timeframe": "HESA 2026/27 return flag from Jan 2027 launch; expanded module/credit data from 2027/28",
    "timeframeDate": "2027-01",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "he",
        "to": "parents",
        "what": "standardised module transcripts for learners enabling credit transfer"
      },
      {
        "from": "he",
        "to": "ofs",
        "what": "modular provision flags, module completions and credits via the HESA Student return"
      }
    ],
    "newServices": [],
    "identifiers": [],
    "standards": [
      "standardised module transcript",
      "HESA Student return COURSEINITID modular flag (2026/27), extended module/credit fields (2027/28)",
      "consistent credit transfer and RPL processes"
    ],
    "partners": [
      "HESA/Jisc",
      "OfS",
      "SLC",
      "HE and FE providers"
    ],
    "strategyImplication": "The concrete post-Data Futures commitment in this landscape: the HE data model is being reshaped around modularity and credit — a prerequisite for any tertiary records/credit-portability ambition.",
    "eli5": "When someone finishes a short chunk of a course, they get a standard certificate that other colleges recognise, so learning adds up like building blocks.",
    "capabilityIds": [
      "interoperability"
    ],
    "aliases": [
      "standardised module transcript",
      "modular study data",
      "COURSEINITID",
      "credit transfer data",
      "HESA student return changes"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.hesa.ac.uk/blog/22-01-2026/lifelong-learning-entitlement-what-it-means-for-you",
      "https://www.gov.uk/government/publications/lifelong-learning-entitlement-lle-overview/lifelong-learning-entitlement-overview"
    ]
  },
  {
    "id": "he-franchising-oversight",
    "docId": "franchise-arrangements-guidance",
    "title": "HE franchising oversight: mandatory OfS registration (300+ students) and Condition E10 transparency",
    "what": "Following NAO/PAC loan-fraud findings, franchised providers teaching 300+ students on designated courses must register with OfS as a condition of their students' access to public student finance from AY 2028/29 (applications due 1 July 2026), with thresholds determined by DfE using OfS 'subcontractual partnership size and shape' data. Complementing this, OfS Condition E10 (in force 31 March 2026) requires lead providers with 100+ subcontracted students to maintain a Subcontracting Information Source and disclose per-partnership average tuition-fee retention percentages in audited accounts.",
    "quote": "higher education providers delivering courses through franchise arrangements will be required to be registered with OfS where they have 300 or more franchised students",
    "theme": "register",
    "status": "in-delivery",
    "timeframe": "E10 in force 31 Mar 2026; registration applications by 1 Jul 2026; requirement effective AY 2028/29",
    "timeframeDate": "2028-09",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "ofs",
        "to": "dfe",
        "what": "subcontractual partnership size and shape data used to determine which providers cross the 300-student threshold"
      },
      {
        "from": "he",
        "to": "ofs",
        "what": "full regulatory returns from newly registered franchised providers, Subcontracting Information Sources and fee-retention disclosures"
      },
      {
        "from": "ofs",
        "to": "slc",
        "what": "registration status gating student finance designation for new students"
      }
    ],
    "newServices": [],
    "identifiers": [
      "OfS register entries for previously unregistered delivery partners"
    ],
    "standards": [
      "OfS 'subcontractual partnership' size and shape data definitions",
      "Subcontracting Information Source minimum content requirements",
      "accounts direction fee-retention disclosure"
    ],
    "partners": [
      "OfS",
      "SLC",
      "lead providers",
      "franchised delivery partners",
      "auditors"
    ],
    "strategyImplication": "Closes the loan-fraud data blindspot by pulling most students at unregistered franchisees onto the OfS register and creating a public dataset on franchising money flows — register data becomes the gatekeeper for public funding, usable by DfE for risk analytics alongside SLC loan data.",
    "eli5": "Colleges that teach university courses on another university's behalf must now sign the official register and show where the tuition fee money goes, to stop fraud.",
    "capabilityIds": [
      "platform",
      "quality"
    ],
    "aliases": [
      "franchised providers registration",
      "300 franchised students",
      "condition E10",
      "subcontracting information source",
      "fee retention disclosure",
      "franchising oversight"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/franchise-arrangements-for-higher-education-providers/franchise-arrangements-for-higher-education-providers",
      "https://publications.parliament.uk/pa/cm5804/cmselect/cmpubacc/455/report.html",
      "https://www.officeforstudents.org.uk/publications/consultation-outcomes-new-requirements-for-the-oversight-of-subcontractual-arrangements-in-english-higher-education/",
      "https://www.officeforstudents.org.uk/news-blog-and-events/press-and-media/new-tighter-controls-of-subcontractual-courses-to-protect-the-interests-of-students-and-taxpayer-money/"
    ]
  },
  {
    "id": "onscreen-exams-first-wave",
    "docId": "ofqual-onscreen-consultation",
    "title": "Enable a regulated first wave of on-screen GCSE/A level exams",
    "what": "Government accepted the Curriculum and Assessment Review's steer on digital assessment and will work with Ofqual and awarding organisations on wider use of on-screen exams. Ofqual's Dec 2025 consultation proposes each of the 4 exam boards may introduce up to 2 on-screen specifications (accredited, sub-100,000-entry subjects only), delivered as separate qualifications from paper versions, on centre-provided devices, with platform expectations for usability, accessibility, security and technical support. Detailed rules are due in 2026; first live on-screen exams are not expected before ~2030.",
    "quote": "any wider use of on-screen assessment in GCSEs and A levels is introduced in a way that is fair, proportionate and manageable",
    "theme": "new-service",
    "status": "consulting",
    "timeframe": "Consultation closed 5 Mar 2026; Ofqual rules/guidance due 2026; first on-screen exams ~2030 at earliest",
    "timeframeDate": "2030-06",
    "dfeRole": "partner",
    "flows": [
      {
        "from": "schools",
        "to": "ofqual",
        "what": "digital candidate responses, item-level assessment data and mode-effect/comparability evidence flowing via exam boards to the regulator"
      }
    ],
    "newServices": [
      "exam-board on-screen assessment platforms in schools",
      "Ofqual accreditation process for on-screen specifications"
    ],
    "identifiers": [
      "candidate numbers",
      "new qualification/specification codes for on-screen variants"
    ],
    "standards": [
      "Ofqual platform expectations: usability, accessibility, security, technical support",
      "secure and reliable assessment delivery requirements (cyber-security, malpractice, data integrity)"
    ],
    "partners": [
      "Ofqual",
      "AQA, Pearson, OCR, WJEC/Eduqas",
      "schools and colleges"
    ],
    "strategyImplication": "Creates a new high-stakes digital assessment data estate (item-level response data, school device/infrastructure readiness data) that DfE and Ofqual must standardise before scale-up; school connectivity and device data become delivery-critical.",
    "eli5": "Some GCSE and A level exams will eventually be taken on computers instead of paper, and the rules are being written now to make sure that is fair and secure.",
    "capabilityIds": [
      "platform",
      "quality"
    ],
    "aliases": [
      "on-screen assessment",
      "on-screen exams",
      "digital GCSE exams",
      "on-screen specifications",
      "exam digitisation"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://assets.publishing.service.gov.uk/media/690b2a4a14b040dfe82922ea/Government_response_to_the_Curriculum_and_Assessment_Review.pdf",
      "https://www.gov.uk/government/consultations/regulating-on-screen-assessment/regulating-on-screen-assessment",
      "https://www.gov.uk/government/news/ofqual-launches-consultation-to-protect-standards-in-on-screen-exams"
    ]
  },
  {
    "id": "year8-reading-test-ks3-data",
    "docId": "car-government-response",
    "title": "Statutory Year 8 reading test plus a strengthened KS3 data layer (incl. KS2 question-level insights)",
    "what": "A new statutory national test of reading fluency and comprehension for all Year 8 pupils, planned from the 2028-29 academic year. School-level results will not be published (phonics-check model), but schools receive their pupils' results with national/regional/LA benchmarks, and data is available to government and Ofsted. Schools will also be expected to assess Year 8 writing and maths using approved commercial tools, and DfE will test how schools can extract more value from KS2 test question-level data to strengthen KS2-to-KS3 transition — all part of the KS3 Alliance data programme.",
    "quote": "introduce a new statutory reading test for all children to be taken in Year 8, designed to check both fluency and comprehension",
    "theme": "analytics",
    "status": "announced",
    "timeframe": "Reading test from the 2028-29 academic year; KS3 Alliance launched early 2026; KS2 QLD piloting from 2026",
    "timeframeDate": "2028-09",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "schools",
        "to": "dfe",
        "what": "pupil-level Year 8 reading fluency and comprehension results (new national collection)"
      },
      {
        "from": "dfe",
        "to": "schools",
        "what": "national/regional/LA benchmarks plus KS2 question-level data repackaged as transition and diagnostic insight"
      },
      {
        "from": "dfe",
        "to": "ofsted",
        "what": "reading test data to inform inspection (school results not published)"
      }
    ],
    "newServices": [
      "national Year 8 reading assessment and results/benchmarking service",
      "KS3 Alliance data and best-practice programme",
      "KS2 question-level data insight tooling (pilot)"
    ],
    "identifiers": [
      "UPN (pupil-level statutory assessment records extended into key stage 3)"
    ],
    "standards": [
      "quality criteria for commercial Year 8 writing/maths assessment products"
    ],
    "partners": [
      "Standards and Testing Agency",
      "Ofsted",
      "commercial assessment tool and data-product providers",
      "KS3 Alliance"
    ],
    "strategyImplication": "First new statutory national data collection in secondary assessment for a decade — extends the pupil-level assessment record into KS3, creates a benchmarking service, repurposes existing KS2 item-level data as an analytics product, and spawns a quasi-regulated market of commercial assessment data products.",
    "eli5": "All 12-13 year olds will take a national reading check, and schools will get better data about how pupils are doing in the often-ignored early secondary years.",
    "capabilityIds": [
      "value",
      "quality"
    ],
    "aliases": [
      "year 8 reading test",
      "reading fluency and comprehension test",
      "KS3 alliance",
      "key stage 3 data",
      "question-level data insights"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://assets.publishing.service.gov.uk/media/690b2a4a14b040dfe82922ea/Government_response_to_the_Curriculum_and_Assessment_Review.pdf",
      "https://www.gov.uk/government/news/focus-on-reading-in-secondary-years-to-drive-up-standards"
    ]
  },
  {
    "id": "digital-machine-readable-curriculum",
    "docId": "car-government-response",
    "title": "Digital, machine-readable national curriculum",
    "what": "The new national curriculum (published spring 2027, first teaching September 2028) will be delivered as a digital and machine-readable artefact, not just a PDF. This is intended to support teachers in sequencing school curricula, link key stages, and underpin AI/edtech tools (including Oak resources and the content store) that consume curriculum structure as data.",
    "quote": "We will introduce a new digital and machine-readable national curriculum to support teachers to more easily sequence their school curricula",
    "theme": "standards",
    "status": "announced",
    "timeframe": "New curriculum published spring 2027; first teaching September 2028",
    "timeframeDate": "2027-04",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "dfe",
        "to": "schools",
        "what": "structured, machine-readable curriculum content and metadata"
      },
      {
        "from": "dfe",
        "to": "oak",
        "what": "curriculum structure as data underpinning Oak resources and AI tools"
      }
    ],
    "newServices": [
      "digitised national curriculum service/platform"
    ],
    "identifiers": [
      "curriculum content identifiers (subjects, key stages, statements) as structured data"
    ],
    "standards": [
      "machine-readable curriculum data model/schema (open format expected)"
    ],
    "partners": [
      "Oak National Academy",
      "edtech and AI tool developers"
    ],
    "strategyImplication": "Curriculum becomes a canonical open data asset — the reference dataset that AI lesson tools, the content store and assessment products will key against; DfE must own the schema, versioning and identifiers.",
    "eli5": "The national curriculum will be published in a format computers can read directly, so teaching apps and lesson tools always know exactly what children should learn.",
    "capabilityIds": [
      "interoperability"
    ],
    "pressureIds": [
      "ai-in-education"
    ],
    "aliases": [
      "machine-readable curriculum",
      "digital national curriculum",
      "curriculum as data",
      "curriculum schema"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://assets.publishing.service.gov.uk/media/690b2a4a14b040dfe82922ea/Government_response_to_the_Curriculum_and_Assessment_Review.pdf"
    ]
  },
  {
    "id": "ks4-measures-reform",
    "docId": "ks4-performance-consultation",
    "title": "Reform KS4 headline measures: EBacc removal (2026) and an improved Progress 8 / Attainment 8 (2029)",
    "what": "Government is replacing the EBacc/open bucket structure of Progress 8 and Attainment 8 with a model retaining double-weighted English and maths, adding two dedicated science slots and four breadth/choice slots; consultation ran 23 Feb - 4 May 2026 and the new measure first applies to GCSEs sat in 2029. In advance, EBacc entry and achievement measures are removed from school accountability, effective for the 2025-26 KS4 performance measures published autumn 2026 — deleting a headline series from performance tables and Explore Education Statistics.",
    "quote": "develop and consult on an improved version of Progress 8 and Attainment 8 that balances a strong academic core with breadth",
    "theme": "accountability",
    "status": "consulting",
    "timeframe": "EBacc measures removed for 2025-26 measures (published autumn 2026); consultation closed 4 May 2026; new measure first applies to GCSEs sat 2029",
    "timeframeDate": "2029-06",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "schools",
        "to": "dfe",
        "what": "KS4 results mapped to the new slot/category structure for headline measures"
      },
      {
        "from": "dfe",
        "to": "parents",
        "what": "performance tables and statistics with EBacc measures discontinued from autumn 2026"
      }
    ],
    "newServices": [],
    "identifiers": [
      "qualification/subject category codings (humanities, creative, languages, science) for measure eligibility"
    ],
    "standards": [
      "revised Progress 8/Attainment 8 calculation methodology and subject-bucket taxonomy",
      "revised KS4 accountability measure definitions and statistics methodology"
    ],
    "partners": [
      "Ofqual",
      "awarding organisations",
      "schools",
      "Ofsted",
      "FFT/analytics sector consuming performance data"
    ],
    "strategyImplication": "Every downstream consumer of KS4 performance data (compare-school-performance, MAT dashboards, researchers, RISE targeting) must re-base time series when the measure changes in 2029, and DfE must manage series discontinuation and archive continuity for the 2026 EBacc removal — a major versioning problem for DfE statistics.",
    "eli5": "The main scoreboard used to judge secondary schools is being redesigned - one old measure disappears this year and a fairer new one arrives for exams taken in 2029.",
    "capabilityIds": [
      "quality",
      "value"
    ],
    "aliases": [
      "progress 8 reform",
      "attainment 8 model",
      "EBacc removal",
      "breadth slots",
      "science slots",
      "KS4 headline measures"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://assets.publishing.service.gov.uk/media/690a8e5388a98da87e2922cb/Progress_8_and_Attainment_8_-_an_explanation_of_the_proposed_improved_model.pdf",
      "https://consult.education.gov.uk/school-accountability/key-stage-4-performance-measures-and-targeted-rise/",
      "https://assets.publishing.service.gov.uk/media/690b2a4a14b040dfe82922ea/Government_response_to_the_Curriculum_and_Assessment_Review.pdf",
      "https://www.gov.uk/government/news/new-curriculum-to-give-young-people-the-skills-for-life-and-work"
    ]
  },
  {
    "id": "rba-digital-assessment",
    "docId": "rba-admin-guidance",
    "title": "Fully digital reception baseline assessment via DfE assessment services",
    "what": "From September 2025 the statutory reception baseline assessment is fully digital: schools administer it on a minimum of two devices using two DfE services ('Assessment service: start an assessment' and 'manage your school's assessments') accessed through DfE Sign-in, replacing the Baseline ePortal. Pupil responses are captured digitally and held by DfE to form the baseline for school-level KS2 progress measures; schools receive narrative statements rather than scores.",
    "quote": "statutory for all reception pupils registered at state-funded maintained schools",
    "theme": "new-service",
    "status": "statutory-duty",
    "timeframe": "Live from September 2025; underpins future KS2 progress measures",
    "timeframeDate": "2025-09",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "schools",
        "to": "dfe",
        "what": "pupil-level RBA responses captured digitally in the first 6 weeks of reception"
      },
      {
        "from": "dfe",
        "to": "schools",
        "what": "narrative performance statements per pupil (no numerical scores)"
      }
    ],
    "newServices": [
      "Assessment service: start an assessment",
      "Assessment service: manage your school's assessments (via DfE Sign-in)"
    ],
    "identifiers": [
      "UPN-linked pupil records from age 4-5 forming the progress baseline cohort"
    ],
    "standards": [
      "RBA IT/device requirements for schools (minimum 2 compliant devices)"
    ],
    "partners": [
      "Standards and Testing Agency",
      "schools",
      "DfE Sign-in platform"
    ],
    "strategyImplication": "First fully digital statutory assessment at national scale — a working precedent (device requirements, DfE Sign-in identity, central response capture) for later digitisation of other statutory tests and on-screen exams.",
    "eli5": "When children start school aged four, their first little check of words and numbers now happens on a tablet or computer, and the results go straight to the government system.",
    "capabilityIds": [
      "platform",
      "quality"
    ],
    "aliases": [
      "reception baseline assessment",
      "digital RBA",
      "baseline ePortal replacement",
      "start an assessment service"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/reception-baseline-assessment-administration-guidance/2025-reception-baseline-assessment-administration-guidance",
      "https://www.gov.uk/government/publications/how-to-try-out-the-2025-reception-baseline-assessment-service/how-to-try-out-the-2025-reception-baseline-assessment-services",
      "https://www.gov.uk/government/collections/reception-baseline-assessment"
    ]
  },
  {
    "id": "v-levels-qualification-data",
    "docId": "post16-pathways-implementation-plan",
    "title": "V Levels and streamlined 16-19 qualification landscape: qualification data changes",
    "what": "The post-16 landscape is being consolidated into A levels, T Levels and new V Levels at level 3 (first V Levels in education, finance and digital taught from September 2027), with new level 2 pathways; the transition plan was published 10 March 2026 and every provider must submit a Strategic Transition Planning Statement by 6 July 2026, with 153 qualifications defunded from August 2027. On the data side this means new Ofqual-regulated qualification records, funding-approval lists and defunding schedules, plus revised 16-18 English/maths progress measures and qualification achievement rates.",
    "quote": "a simple framework of A levels, T Levels and V Levels at level 3",
    "theme": "accountability",
    "status": "in-delivery",
    "timeframe": "Transition plan Mar 2026; first V Level teaching Sept 2027; defunding from Aug 2027",
    "timeframeDate": "2027-09",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "ofqual",
        "to": "dfe",
        "what": "new V Level and level 2 pathway qualification records feeding funding-approval and defunding lists"
      },
      {
        "from": "colleges",
        "to": "dfe",
        "what": "enrolment and achievement data (ILR) recoded to the new A/T/V framework; revised progress measures and QARs"
      }
    ],
    "newServices": [],
    "identifiers": [
      "new qualification numbers/codes for V Levels and level 2 pathways in the Ofqual register and funding lists"
    ],
    "standards": [
      "revised 16-18 accountability measure and qualification achievement rate methodologies"
    ],
    "partners": [
      "Ofqual",
      "awarding organisations",
      "colleges and school sixth forms",
      "Skills England"
    ],
    "strategyImplication": "Qualification reference data churns hard 2026-2030: registers, funding lists, ILR codings and 16-18 performance time series all need managed transitions as legacy qualifications are defunded and V Levels phase in.",
    "eli5": "Hundreds of confusing college courses are being replaced by a simple menu of three qualification types, so all the official course lists and results systems must be rewritten.",
    "capabilityIds": [
      "quality",
      "interoperability"
    ],
    "aliases": [
      "V levels",
      "qualification defunding",
      "strategic transition planning statement",
      "A T V framework",
      "level 2 pathways"
    ],
    "confidence": "medium",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/post-16-pathways-implementation-plan/post-16-pathways-implementation-plan",
      "https://www.gov.uk/government/news/first-v-levels-subjects-revealed-as-part-of-landmark-reforms",
      "https://www.gov.uk/government/consultations/post-16-level-3-and-below-pathways/outcome/transition-plan-to-the-reformed-16-to-19-qualifications-landscape",
      "https://assets.publishing.service.gov.uk/media/690b2a4a14b040dfe82922ea/Government_response_to_the_Curriculum_and_Assessment_Review.pdf"
    ]
  },
  {
    "id": "education-content-store",
    "docId": "content-store-announcement",
    "title": "Education content store: curated government data to train education AI tools",
    "what": "DfE and DSIT committed £3m (August 2024) to a content store pooling curriculum guidance, teaching standards, lesson plans and anonymised pupil assessments as training/grounding data for education AI tools, plus £1m Innovate UK tool prizes. DfE published evidence that grounding models in this data raised accuracy from 67% to 92%. The store is live at aicontentstore.education.gov.uk with 16 edtech providers building on it, is cited by the AI Action Plan One Year On and NDL updates as exemplar national data infrastructure, and underpins the AI tutoring programme.",
    "quote": "The content store will enable AI companies to produce highly accurate tools for the education sector in a more efficient way.",
    "theme": "ai",
    "status": "in-delivery",
    "timeframe": "Announced Aug 2024; prototype tested June 2025; operational and feeding AI tutoring co-creation from 2026",
    "timeframeDate": "2024-09",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "oak",
        "to": "dfe",
        "what": "quality-assured curriculum-aligned content contributed to the store corpus"
      },
      {
        "from": "dfe",
        "to": "dsit",
        "what": "exemplar AI-ready education data asset showcased through the AI Action Plan and National Data Library"
      }
    ],
    "newServices": [
      "AI Content Store (aicontentstore.education.gov.uk)"
    ],
    "identifiers": [],
    "standards": [
      "anonymisation of pupil assessment material",
      "rights/licensing framework for government education content reuse in AI training"
    ],
    "partners": [
      "DSIT",
      "Innovate UK",
      "The Open University",
      "Faculty AI",
      "ImpactEd",
      "16 edtech providers"
    ],
    "strategyImplication": "Positions DfE as curator of a sovereign education training-data asset and the pattern-setter for supplying government data to model builders; anonymisation standards, licensing and pupil-work provenance become core data-governance obligations, with civil-society scrutiny already active.",
    "eli5": "The government built a library of lesson plans, curriculum documents and anonymous pupil work that companies can use to teach their education computer programs to be accurate.",
    "capabilityIds": [
      "value",
      "ethics"
    ],
    "pressureIds": [
      "ai-in-education",
      "national-data-library"
    ],
    "aliases": [
      "content store",
      "AI content store",
      "education content store",
      "training data for education AI",
      "anonymised pupil assessments"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/news/teachers-to-get-more-trustworthy-ai-tech-as-generative-tools-learn-from-new-bank-of-lesson-plans-and-curriculums-helping-them-mark-homework-and-save",
      "https://roadmap-for-modern-digital-government.campaign.gov.uk/ai/ai-in-education/",
      "https://ai.gov.uk/knowledge-hub/tools/content-education-store/",
      "https://aicontentstore.education.gov.uk/",
      "https://schoolsweek.co.uk/3m-government-ai-content-store-to-help-teachers-plan-lessons/",
      "https://www.gov.uk/government/publications/ai-opportunities-action-plan-one-year-on/ai-opportunities-action-plan-one-year-on",
      "https://www.gov.uk/government/publications/national-data-library-progress-update-january-2026/national-data-library-progress-update-january-2026"
    ]
  },
  {
    "id": "genai-safety-expectations",
    "docId": "genai-product-safety",
    "title": "Generative AI product safety expectations for education suppliers",
    "what": "DfE published (22 January 2025) outcome-focused expectations that generative AI products used in schools and colleges should meet: effective filtering of harmful content, robust activity logging, security against misuse, privacy/data protection and administrator permission controls. Updated 19 January 2026 with additional standards on cognitive development, emotional/social development, mental health and manipulation; government is also developing 'sovereign education benchmarks' to evaluate UK education AI tools. Referenced by KCSIE 2025 and procurement guidance.",
    "quote": "the capabilities and features that generative AI products and systems should meet to be considered safe",
    "theme": "safeguarding",
    "status": "in-delivery",
    "timeframe": "Published 22 Jan 2025; expanded 19 Jan 2026; benchmarks in development 2026",
    "timeframeDate": "2025-01",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "schools",
        "to": "dfe",
        "what": "assurance and activity-logging evidence that AI products used with pupils meet the safety expectations"
      }
    ],
    "newServices": [
      "sovereign education AI benchmarks/evaluation framework (in development)"
    ],
    "identifiers": [],
    "standards": [
      "Generative AI product safety expectations (filtering, logging, security, privacy, data protection, monitoring, anthropomorphism, IP)",
      "Jan 2026 additions: cognitive development, emotional/social development, mental health, manipulation"
    ],
    "partners": [
      "edtech developers and suppliers",
      "schools and colleges",
      "DSIT",
      "safety-tech providers"
    ],
    "strategyImplication": "A de facto assurance standard for AI products handling pupil data — the natural hook for any future DfE AI product register or certification scheme, the compliance baseline for AI tutoring procurement, and the lever shaping what pupil-interaction data edtech must capture and retain.",
    "eli5": "The government wrote safety rules for artificial intelligence programs used in classrooms - they must block harmful content, keep records of use and protect children's information.",
    "capabilityIds": [
      "ethics",
      "quality"
    ],
    "pressureIds": [
      "ai-in-education",
      "public-trust"
    ],
    "aliases": [
      "generative AI product safety expectations",
      "AI safety expectations for education",
      "sovereign education benchmarks",
      "AI filtering and logging standards"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/generative-ai-product-safety-expectations",
      "https://www.gov.uk/government/publications/generative-ai-product-safety-expectations/generative-ai-product-safety-expectations",
      "https://roadmap-for-modern-digital-government.campaign.gov.uk/ai/ai-in-education/"
    ]
  },
  {
    "id": "ai-tutoring-tools-benchmarks",
    "docId": "ai-tutoring-announcement",
    "title": "AI tutoring tools for disadvantaged pupils, with safety and quality benchmarks",
    "what": "Announced 26 January 2026: DfE will co-create (with teachers, AI labs and eight 'Pioneer' companies), trial from autumn 2026, and make available to schools by end of 2027 AI tutoring tools offering one-to-one support in English, maths, science and MFL for up to 450,000 FSM pupils in years 9-11. The tools must align to the national curriculum, be robustly safety-tested, and government committed to robust benchmarks so parents and teachers can judge pupil-facing AI tools; a supplier invitation followed in April 2026.",
    "quote": "Robust benchmarks will also be developed so parents and teachers can be confident that AI tools for use by pupils are high quality",
    "theme": "ai",
    "status": "in-delivery",
    "timeframe": "Co-creation summer term 2026; secondary school trials autumn 2026; tools available to schools by end 2027",
    "timeframeDate": "2027-12",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "schools",
        "to": "dfe",
        "what": "pupil interaction, progress and attainment data from tutoring trials with disadvantaged cohorts, for evaluation"
      },
      {
        "from": "dfe",
        "to": "schools",
        "what": "curriculum-aligned, safety-benchmarked AI tutoring tools targeted using FSM eligibility flags"
      }
    ],
    "newServices": [
      "national AI tutoring tools programme and trial infrastructure",
      "AI tool quality/safety benchmark framework"
    ],
    "identifiers": [
      "FSM eligibility flags used to target the 450,000-pupil cohort"
    ],
    "standards": [
      "generative AI product safety expectations as procurement baseline",
      "national curriculum alignment requirements"
    ],
    "partners": [
      "AI labs and edtech 'Pioneers' (8 selected)",
      "teachers/schools",
      "DSIT"
    ],
    "strategyImplication": "The first DfE-run service processing pupil-level learning interaction data through commercial AI at national scale — demands DPIAs, FSM-based targeting governance, evaluation data pipelines and benchmark publication.",
    "eli5": "Thousands of teenagers from lower-income families will get a carefully tested computer tutor for one-to-one help with subjects like maths and English.",
    "capabilityIds": [
      "value",
      "ethics"
    ],
    "pressureIds": [
      "ai-in-education",
      "public-trust"
    ],
    "aliases": [
      "AI tutoring tools",
      "tutoring for disadvantaged pupils",
      "450000 pupils AI",
      "pioneer companies",
      "AI tutor benchmarks"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/news/450000-disadvantaged-pupils-could-benefit-from-ai-tutoring-tools",
      "https://www.gov.uk/government/news/edtech-and-ai-companies-invited-to-help-build-safe-ai-tutoring-tools-for-disadvantaged-pupils",
      "https://roadmap-for-modern-digital-government.campaign.gov.uk/ai/ai-in-education/"
    ]
  },
  {
    "id": "oak-open-content-api",
    "docId": "car-government-response",
    "title": "Oak National Academy: curriculum-aligned open content, Aila and open API",
    "what": "Government committed that Oak (a DfE arm's-length body) will provide fully adaptable digital curriculum materials for ages 5-16 updated to the refreshed curriculum, and continue developing AI tools including the Aila lesson assistant. Oak exposes its quality-assured, curriculum-aligned content (lessons, videos, quizzes, transcripts) as open educational resources through a free API for edtech and AI developers; an EEF Teacher Choices trial of Aila reports in autumn 2026.",
    "quote": "Oak will continue to develop a range of AI tools and curriculum materials",
    "theme": "ai",
    "status": "in-delivery",
    "timeframe": "Materials updated for the new curriculum ahead of Sept 2028; Aila live since Sept 2024; EEF Aila evaluation autumn 2026",
    "timeframeDate": "2028-09",
    "dfeRole": "deliverer",
    "flows": [
      {
        "from": "oak",
        "to": "schools",
        "what": "adaptable curriculum materials and the Aila AI lesson assistant"
      },
      {
        "from": "oak",
        "to": "researchers",
        "what": "Aila usage and trial outcome data for EEF evaluation"
      }
    ],
    "newServices": [
      "Oak open content API",
      "Aila AI lesson assistant"
    ],
    "identifiers": [
      "Oak curriculum content identifiers (units, lessons) reused by third-party tools"
    ],
    "standards": [
      "OGL/open licensing of curriculum content",
      "curriculum-alignment metadata"
    ],
    "partners": [
      "Oak National Academy",
      "Education Endowment Foundation",
      "edtech developers"
    ],
    "strategyImplication": "Oak is the delivery vehicle turning the machine-readable curriculum into open content infrastructure — its API and licensing choices effectively set the interoperability standard for curriculum data across the AI tools programme.",
    "eli5": "A government-backed lesson library gives teachers free ready-made lessons and a helpful planning assistant, and lets app makers plug into it for free.",
    "capabilityIds": [
      "platform",
      "value"
    ],
    "pressureIds": [
      "ai-in-education"
    ],
    "aliases": [
      "Oak national academy",
      "Aila lesson assistant",
      "open content API",
      "curriculum-aligned open resources"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://assets.publishing.service.gov.uk/media/690b2a4a14b040dfe82922ea/Government_response_to_the_Curriculum_and_Assessment_Review.pdf",
      "https://www.thenational.academy/ai",
      "https://educationendowmentfoundation.org.uk/projects-and-evaluation/projects/aila-teacher-choices-trial"
    ]
  },
  {
    "id": "duaa-dvs-gateway",
    "docId": "data-use-access-act-2025",
    "title": "Operate within the statutory digital verification services (DVS) framework and its information gateway",
    "what": "DUAA Part 2 (in force from 1 December 2025) puts the UK digital identity and attributes trust framework and a DVS provider register on a statutory footing, and creates an information gateway allowing public authorities to disclose personal data to registered DVS providers for identity and eligibility verification. As a major holder of citizen records (qualifications, teacher status, entitlements), DfE must decide how it will serve verification queries through this gateway and ensure disclosures follow the framework.",
    "quote": "commencement of most of the measures on digital verification services in Part 2",
    "theme": "identifiers",
    "status": "statutory-duty",
    "timeframe": "Part 2 substantially in force 1 December 2025; register and framework operational from then",
    "timeframeDate": "2025-12",
    "dfeRole": "complier",
    "flows": [],
    "newServices": [
      "verification query interfaces against DfE-held records"
    ],
    "identifiers": [
      "verified identity attributes; learner and workforce records used as authoritative evidence"
    ],
    "standards": [
      "UK digital identity and attributes trust framework (statutory)"
    ],
    "partners": [
      "DSIT (Office for Digital Identities and Attributes)",
      "certified DVS providers"
    ],
    "strategyImplication": "A DfE data strategy must designate which DfE datasets are authoritative attribute sources for digital verification, and set the governance for gateway disclosures to registered DVS providers.",
    "eli5": "Private identity-checking companies can now legally ask government for confirmation of facts about you - like your qualifications - so the education department must decide how to answer safely.",
    "capabilityIds": [
      "interoperability",
      "governance"
    ],
    "aliases": [
      "digital verification services",
      "DVS register",
      "digital identity trust framework",
      "DVS information gateway",
      "attribute verification"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.legislation.gov.uk/ukpga/2025/18",
      "https://www.gov.uk/guidance/data-use-and-access-act-2025-plans-for-commencement"
    ]
  },
  {
    "id": "duaa-recognised-legitimate-interests",
    "docId": "data-use-access-act-2025",
    "title": "Comply with (and exploit) the DUAA reforms to UK GDPR: recognised legitimate interests, research, ADM",
    "what": "The majority of DUAA Part 5 data-protection changes commenced on 5 February 2026: a new 'recognised legitimate interests' lawful ground (covering safeguarding, crime prevention, emergencies), a clarified scientific-research regime with broad consent, relaxed purpose-limitation for compatible reuse, a more permissive automated-decision-making framework with safeguards, and reform of the ICO into an Information Commission. DfE must update its lawful-basis mapping, DPIAs, privacy notices and ADM controls, and can rely on the new grounds for safeguarding data shares and research reuse of education data.",
    "quote": "the majority of the data protection and privacy provisions in Part 5",
    "theme": "data-sharing",
    "status": "statutory-duty",
    "timeframe": "Royal Assent 19 June 2025; main provisions in force 5 February 2026; ICO governance reform completing during 2026",
    "timeframeDate": "2026-02",
    "dfeRole": "complier",
    "flows": [
      {
        "from": "dfe",
        "to": "las",
        "what": "personal data shared with safeguarding partners under the new recognised-legitimate-interests ground"
      },
      {
        "from": "dfe",
        "to": "home-office",
        "what": "personal data shared for crime prevention under recognised legitimate interests"
      },
      {
        "from": "dfe",
        "to": "researchers",
        "what": "wider research reuse of longitudinal datasets (NPD, LEO) under clarified scientific-research provisions"
      }
    ],
    "newServices": [],
    "identifiers": [],
    "standards": [
      "UK GDPR/DPA 2018 as amended by DUAA",
      "Information Commission codes and guidance"
    ],
    "partners": [
      "Information Commissioner's Office / Information Commission",
      "DSIT"
    ],
    "strategyImplication": "The strategy must re-baseline DfE's data-protection posture on the amended UK GDPR — refreshed lawful bases, ADM transparency for algorithmic decisions, and an explicit position on using the new research and safeguarding grounds.",
    "eli5": "The data protection law changed, making it clearly legal to share information to protect children or for research - so the education department must update its rulebooks and can share more confidently.",
    "capabilityIds": [
      "sharing",
      "governance"
    ],
    "pressureIds": [
      "agency-coordination"
    ],
    "aliases": [
      "recognised legitimate interests",
      "DUAA data protection reforms",
      "automated decision-making safeguards",
      "scientific research provisions",
      "Information Commission"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.legislation.gov.uk/uksi/2025/1213/made",
      "https://www.gov.uk/guidance/data-use-and-access-act-2025-plans-for-commencement",
      "https://www.gov.uk/guidance/data-use-and-access-act-2025-data-protection-and-privacy-changes"
    ]
  },
  {
    "id": "blueprint-join-up-once-only",
    "docId": "blueprint-modern-digital-government",
    "title": "Join up DfE services with the rest of the public sector, including a 'once only' rule for citizen data",
    "what": "The blueprint's first plank commits the whole public sector to joined-up, proactive services built around life events, including a 'once only' expectation that information given to government is reused across services with safeguards. For DfE this means its citizen- and provider-facing services (admissions data, teacher services, funding services) must be designed for cross-department reuse rather than departmental silos, responding to the State of Digital Government Review's finding of siloed data.",
    "quote": "Join up public sector services",
    "theme": "new-service",
    "status": "in-delivery",
    "timeframe": "Blueprint January 2025; delivery sequenced through the roadmap for modern digital government to 2030",
    "timeframeDate": "2030-01",
    "dfeRole": "deliverer",
    "flows": [
      {
        "from": "parents",
        "to": "dfe",
        "what": "information provided once and reused across government services with safeguards"
      },
      {
        "from": "dfe",
        "to": "dsit",
        "what": "DfE service content and data surfaced through GOV.UK App and Chat"
      }
    ],
    "newServices": [
      "GOV.UK App and GOV.UK Chat surfaces for DfE content and services"
    ],
    "identifiers": [
      "GOV.UK One Login identity as the common citizen key"
    ],
    "standards": [
      "GOV.UK service standards; common design and data patterns"
    ],
    "partners": [
      "GDS",
      "DSIT",
      "other departments sharing life-event journeys"
    ],
    "strategyImplication": "Cross-government reuse becomes a design requirement — data models, consent and metadata that let DfE data be safely consumed by other services, and vice versa.",
    "eli5": "You should only have to tell the government something once - different departments will then reuse it carefully instead of asking you again and again.",
    "capabilityIds": [
      "platform",
      "interoperability"
    ],
    "pressureIds": [
      "cddo-data-mission"
    ],
    "aliases": [
      "once only rule",
      "join up public services",
      "life events services",
      "GOV.UK App",
      "proactive government services"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/a-blueprint-for-modern-digital-government/a-blueprint-for-modern-digital-government-html",
      "https://www.gov.uk/government/publications/state-of-digital-government-review"
    ]
  },
  {
    "id": "wallet-digital-credentials",
    "docId": "blueprint-modern-digital-government",
    "title": "Issue digital verified credentials (GOV.UK Wallet) alongside every paper credential by end of 2027",
    "what": "The blueprint requires services issuing paper or card credentials or proofs of entitlement to also issue a digital verified credential in the GOV.UK Wallet by the end of 2027 (Wallet live with the Veteran Card since October 2025; driving licence in testing). DfE issues credential-like artefacts — QTS/induction certificates, exam certificates via awarding bodies, childcare entitlement codes — and work is already underway to link the Education Record to the Wallet so exam results sit alongside other government credentials.",
    "quote": "Require services to issue a digital verified credential alongside any paper/card based credential or proof of entitlement eligibility by the end of 2027",
    "theme": "identifiers",
    "status": "in-delivery",
    "timeframe": "By end of 2027; Wallet live October 2025; Education Record linkage announced January 2026 (no delivery date)",
    "timeframeDate": "2027-12",
    "dfeRole": "deliverer",
    "flows": [
      {
        "from": "dfe",
        "to": "dsit",
        "what": "digitally signed credentials (teacher status, qualifications, exam results, entitlements) issued into GOV.UK Wallet"
      }
    ],
    "newServices": [
      "DfE credential issuance into GOV.UK Wallet",
      "education credentials (Education Record) in GOV.UK Wallet"
    ],
    "identifiers": [
      "verified credentials bound to GOV.UK One Login identity"
    ],
    "standards": [
      "GOV.UK Wallet credential standards",
      "UK digital identity and attributes trust framework",
      "cross-government verifiable credential standards"
    ],
    "partners": [
      "GDS",
      "DSIT",
      "awarding organisations",
      "DBS (Home Office)"
    ],
    "strategyImplication": "The strategy needs an inventory of DfE-issued credentials/entitlements and a pipeline to make each issuable as a Wallet credential by end-2027, with the underlying registers treated as authoritative sources — qualifications become portable, verifiable credentials keyed to One Login identity.",
    "eli5": "Certificates the government gives you - like exam results or teaching qualifications - will also live in an official phone wallet app so you can prove them instantly.",
    "capabilityIds": [
      "interoperability",
      "platform"
    ],
    "pressureIds": [
      "cddo-data-mission"
    ],
    "aliases": [
      "GOV.UK wallet",
      "digital verified credential",
      "wallet credentials",
      "digital exam certificates",
      "credential issuance 2027"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/a-blueprint-for-modern-digital-government/a-blueprint-for-modern-digital-government-html",
      "https://gds.blog.gov.uk/2026/01/21/making-the-governments-first-digital-wallet-a-reality/",
      "https://www.gov.uk/government/news/government-modernises-exam-records-with-new-app"
    ]
  },
  {
    "id": "one-login-adoption",
    "docId": "roadmap-modern-digital-government-2026",
    "title": "Adopt GOV.UK One Login as the single sign-in for all DfE citizen-facing services",
    "what": "GDS has stated that by the end of 2027 One Login will become the only way to access central government services, with Government Gateway phased out (13m+ users across 120+ services as of January 2026; reported delivery pressure suggests some slippage to 2028). DfE committed from 2023-24 to replace DfE Sign-in and DfE Identity with One Login for citizen-facing services, starting with Teaching Regulation Agency services; organisation-facing DfE Sign-in continues in parallel for school/LA users.",
    "quote": "GOV.UK One Login has been used by over 13 million people to access more than 120 government services",
    "theme": "identifiers",
    "status": "in-delivery",
    "timeframe": "All central government services by end of 2027 (reports of revision toward 2028); TRA services migrating since 2024",
    "timeframeDate": "2027-12",
    "dfeRole": "complier",
    "flows": [
      {
        "from": "dsit",
        "to": "dfe",
        "what": "verified citizen identity assertions replacing service-specific accounts and DfE-held credentials"
      }
    ],
    "newServices": [
      "One Login-authenticated DfE citizen services (TRA services first)"
    ],
    "identifiers": [
      "One Login subject identifier as the common citizen identifier",
      "matching One Login identities to TRN and learner records"
    ],
    "standards": [
      "One Login onboarding and identity-proofing standards (GPG 45)",
      "GDS identity assurance standards"
    ],
    "partners": [
      "GDS",
      "DSIT",
      "Teaching Regulation Agency"
    ],
    "strategyImplication": "The strategy must commit to a One Login migration path for every DfE citizen-facing service and plan for identity-matching between One Login identities and DfE's existing learner/workforce identifiers, while keeping organisational identity (DfE Sign-in) coherent alongside.",
    "eli5": "Everyone will use one single government username to sign in to all education services, instead of a different account for each website.",
    "capabilityIds": [
      "interoperability",
      "platform"
    ],
    "pressureIds": [
      "cddo-data-mission"
    ],
    "aliases": [
      "GOV.UK one login",
      "one login migration",
      "single sign-in for government",
      "DfE sign-in replacement",
      "government gateway phase-out"
    ],
    "confidence": "medium",
    "sourceUrls": [
      "https://gds.blog.gov.uk/2026/01/20/our-roadmap-for-modern-digital-government/",
      "https://www.thinkdigitalpartners.com/news/2025/10/06/government-eyes-full-adoption-of-gov-uk-one-login-by-2027/",
      "https://www.publictechnology.net/2025/08/01/science-technology-and-research/excl-one-login-delivery-date-revised-to-2028-with-hundreds-of-millions-of-extra-spending-set-to-be-committed/",
      "https://design-histories.education.gov.uk/access-your-teaching-qualifications/using-govuk-one-login-with-tra-services",
      "https://gds.blog.gov.uk/2023/12/20/department-for-education-our-experience-of-joining-gov-uk-one-login/"
    ]
  },
  {
    "id": "open-apis-by-default",
    "docId": "blueprint-modern-digital-government",
    "title": "Open APIs by default: cross-government mandate plus DfE's single API management platform",
    "what": "The blueprint mandates publication of standard APIs and events by public sector organisations, with an expectation that every new central-government service has an open API; common cross-government API standards are in development. DfE already runs public APIs (EES, Teaching Vacancies, GIAS) and its own technical standard (August 2025, annual conformance) mandates that all DfE APIs be accessed and managed within Find and Use an API — a single catalogue with subscription keys and sandbox/production environments.",
    "quote": "Mandate the publication of a standard set of APIs and events by public sector organisations",
    "theme": "standards",
    "status": "in-delivery",
    "timeframe": "Expectation applies to every new central-government service; DfE API Management standard effective August 2025; common standards development through 2026",
    "timeframeDate": "2025-08",
    "dfeRole": "deliverer",
    "flows": [
      {
        "from": "dfe",
        "to": "las",
        "what": "machine-readable data and events via standard open APIs"
      },
      {
        "from": "dfe",
        "to": "schools",
        "what": "catalogued APIs behind one gateway (Find and Use an API) for MIS and edtech suppliers"
      }
    ],
    "newServices": [
      "open APIs and event streams on new DfE services by default",
      "Find and Use an API developer hub"
    ],
    "identifiers": [
      "per-client API subscription keys, OAuth 2.0"
    ],
    "standards": [
      "cross-government API and event standards",
      "DfE API Management standard (annual conformance)"
    ],
    "partners": [
      "GDS",
      "DSIT",
      "edtech and MIS suppliers as API consumers"
    ],
    "strategyImplication": "DfE should adopt 'API by default' for its data assets with a published catalogue and conformance to emerging cross-government standards — the API front door is the precondition for an external data-access strategy and supplier integration at scale.",
    "eli5": "Government computer systems will offer standard plugs so other systems can connect automatically, and the education department is putting all its plugs in one well-labelled cabinet.",
    "capabilityIds": [
      "interoperability",
      "platform"
    ],
    "pressureIds": [
      "cddo-data-mission"
    ],
    "aliases": [
      "open APIs mandate",
      "API by default",
      "find and use an API",
      "API management standard",
      "standard APIs and events"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/a-blueprint-for-modern-digital-government/a-blueprint-for-modern-digital-government-html",
      "https://gds.blog.gov.uk/2026/01/20/our-roadmap-for-modern-digital-government/",
      "https://standards.education.gov.uk/standard/api-management",
      "https://find-and-use-an-api.education.gov.uk/documentation"
    ]
  },
  {
    "id": "blueprint-outcome-metrics",
    "docId": "blueprint-modern-digital-government",
    "title": "Publish annual metrics on service performance, value for money, resilience, digital inclusion and AI adoption",
    "what": "The blueprint commits government to require departments to publish outcome metrics at least annually, covering service performance, value for money, resilience, digital inclusion and AI adoption; the January 2026 roadmap adds published product roadmaps for major products and consistent service-performance measurement. DfE will need instrumented services and a data pipeline to produce and publish these metrics.",
    "quote": "Require departments to publish metrics at least annually on the outcomes they achieve",
    "theme": "accountability",
    "status": "announced",
    "timeframe": "Annual publication; measurement framework being established via the 2025-2030 roadmap",
    "timeframeDate": "2026-01",
    "dfeRole": "complier",
    "flows": [
      {
        "from": "dfe",
        "to": "dsit",
        "what": "annual outcome, performance and AI-adoption metrics under the cross-government framework"
      },
      {
        "from": "dfe",
        "to": "parents",
        "what": "published product roadmaps and performance dashboards"
      }
    ],
    "newServices": [
      "published DfE product roadmaps and performance dashboards"
    ],
    "identifiers": [],
    "standards": [
      "cross-government service performance measurement framework"
    ],
    "partners": [
      "GDS",
      "DSIT"
    ],
    "strategyImplication": "The strategy needs a measurement layer: consistent service KPIs, AI-adoption tracking and publication pipelines so DfE can meet annual transparency reporting without bespoke effort each year.",
    "eli5": "Every year the department must publish honest numbers on how well its digital services work, what they cost and how much they use artificial intelligence.",
    "capabilityIds": [
      "quality",
      "value"
    ],
    "aliases": [
      "annual outcome metrics",
      "published product roadmaps",
      "service performance metrics",
      "digital inclusion reporting"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/a-blueprint-for-modern-digital-government/a-blueprint-for-modern-digital-government-html",
      "https://gds.blog.gov.uk/2026/01/20/our-roadmap-for-modern-digital-government/"
    ]
  },
  {
    "id": "ai-governance-compliance",
    "docId": "ai-playbook-uk-government",
    "title": "Operate AI under the government assurance regime: AI Playbook principles plus mandatory ATRS records",
    "what": "The AI Playbook (February 2025) gives departments 10 principles for lawful, secure, human-controlled AI use across the full lifecycle, combined with the Action Plan's Scan>Pilot>Scale adoption model. Separately, since the December 2024 mandatory scope policy, all ministerial departments must publish Algorithmic Transparency Recording Standard records for algorithmic tools that significantly influence decisions or interact with the public (125+ records published, backlog cleared by end 2025). DfE must run its AI experimentation (tutoring tools, ABIEs, casework assistants) within this assurance framework.",
    "quote": "You have meaningful human control at the right stages",
    "theme": "ai",
    "status": "in-delivery",
    "timeframe": "Playbook live February 2025; ATRS mandatory now with continuous obligation for new tools",
    "timeframeDate": "2025-02",
    "dfeRole": "complier",
    "flows": [
      {
        "from": "dfe",
        "to": "parents",
        "what": "published algorithmic transparency records describing each in-scope tool, its data and its oversight"
      }
    ],
    "newServices": [],
    "identifiers": [],
    "standards": [
      "AI Playbook 10 principles",
      "Algorithmic Transparency Recording Standard",
      "data protection under amended UK GDPR"
    ],
    "partners": [
      "GDS",
      "DSIT (Responsible Technology Adoption Unit / AI Opportunities Unit)",
      "Incubator for AI (i.AI)"
    ],
    "strategyImplication": "The strategy must embed the playbook as DfE's AI operating standard — an AI use-case register, lifecycle assurance, human-in-the-loop requirements — with a gating process so any new DfE model or AI tool triggers an ATRS record before beta/production.",
    "eli5": "When the government uses artificial intelligence, it must follow safety rules, keep a human in charge, and publish a public note explaining what each computer tool does.",
    "capabilityIds": [
      "ethics",
      "governance"
    ],
    "pressureIds": [
      "ai-in-education"
    ],
    "aliases": [
      "AI playbook",
      "algorithmic transparency recording standard",
      "ATRS records",
      "scan pilot scale",
      "meaningful human control"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/ai-playbook-for-the-uk-government",
      "https://gds.blog.gov.uk/2025/02/10/launching-the-artificial-intelligence-playbook-for-the-uk-government/",
      "https://www.gov.uk/government/publications/algorithmic-transparency-recording-standard-mandatory-scope-and-exemptions-policy/algorithmic-transparency-recording-standard-atrs-mandatory-scope-and-exemptions-policy",
      "https://dataingovernment.blog.gov.uk/2025/05/08/making-the-algorithmic-transparency-recording-standard-atrs-mandatory-across-government/"
    ]
  },
  {
    "id": "ndl-ai-ready-datasets",
    "docId": "ai-opportunities-action-plan",
    "title": "Contribute DfE data to the National Data Library and release high-impact AI-ready datasets",
    "what": "The AI Opportunities Action Plan commits government to rapidly identify at least five high-impact public datasets for AI researchers and innovators and to publish AI-ready data guidelines (now published). The NDL (>£100m from SR25) is being built as a 'trusted gateway' to public-sector data, mobilising departmental CDOs, running kickstarter projects, and relaunching data.gov.uk with curated collections; the January 2026 update showcases the DfE Content Store as exemplar infrastructure. DfE, holding some of government's richest longitudinal data, is expected to nominate, curate and expose high-value education datasets — though the June 2026 roadmap explicitly does not mandate publication.",
    "quote": "Rapidly identify at least 5 high-impact public datasets it will seek to make available to AI researchers and innovators",
    "theme": "infrastructure",
    "status": "in-delivery",
    "timeframe": "Plan January 2025; AI-ready guidelines live by January 2026; NDL delivery plan June 2026; gateway build-out to follow",
    "timeframeDate": "2026-06",
    "dfeRole": "deliverer",
    "flows": [
      {
        "from": "dfe",
        "to": "dsit",
        "what": "high-value, AI-ready education datasets and metadata (EES, GIAS, Content Store) into NDL / data.gov.uk curated collections"
      },
      {
        "from": "dfe",
        "to": "researchers",
        "what": "high-impact education datasets released for AI researchers and innovators with clear licensing"
      }
    ],
    "newServices": [
      "curated education/early-years data collections on the NDL"
    ],
    "identifiers": [],
    "standards": [
      "NDL AI-ready dataset guidelines",
      "data manual guidance on creating, managing and using data",
      "data licensing frameworks"
    ],
    "partners": [
      "DSIT",
      "GDS",
      "cross-government CDO Council",
      "UKRI/research community"
    ],
    "strategyImplication": "The strategy needs a dataset-release pipeline — candidate high-impact datasets, AI-readiness remediation, licensing positions and privacy safeguards — and should position DfE (via the Content Store) as an NDL exemplar rather than a passive supplier.",
    "eli5": "The government is building one big trusted catalogue of public data, and the education department is expected to polish up its best datasets and put them on the shelves.",
    "capabilityIds": [
      "platform",
      "value"
    ],
    "pressureIds": [
      "national-data-library"
    ],
    "aliases": [
      "national data library",
      "AI-ready datasets",
      "high-impact public datasets",
      "data.gov.uk relaunch",
      "trusted data gateway"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/ai-opportunities-action-plan/ai-opportunities-action-plan",
      "https://www.gov.uk/government/publications/ai-opportunities-action-plan-one-year-on/ai-opportunities-action-plan-one-year-on",
      "https://www.gov.uk/government/publications/national-data-library-progress-update-january-2026/national-data-library-progress-update-january-2026",
      "https://www.data.gov.uk/roadmap/"
    ]
  },
  {
    "id": "ndl-early-years-kickstarter",
    "docId": "ndl-plan-june-2026",
    "title": "NDL Early Years Kickstarter: linking health, education and childcare data for school-readiness",
    "what": "Launched 4-5 June 2026 with Leeds City Council, LB Hammersmith & Fulham and Liverpool City Region, this GDS/DSIT-led kickstarter — with DfE involved — explores connecting health visiting, education and childcare data so professionals see a full picture of a child's development and children arrive school-ready (32% currently start school without basic skills). The NDL added an 'Early years' spotlight data collection alongside it.",
    "quote": "Too many children are arriving at school without the skills they need",
    "theme": "data-sharing",
    "status": "in-delivery",
    "timeframe": "Launched June 2026; exploratory phase with three local-authority areas, informing national scale-up",
    "timeframeDate": "2026-06",
    "dfeRole": "partner",
    "flows": [
      {
        "from": "dhsc",
        "to": "las",
        "what": "health visiting records linked into a shared cross-service view of child development"
      },
      {
        "from": "ey-settings",
        "to": "las",
        "what": "childcare and early-years records linked for authorised professionals"
      },
      {
        "from": "dfe",
        "to": "dsit",
        "what": "early-years datasets (EYFSP, childcare entitlements) curated into the NDL Early Years spotlight collection"
      }
    ],
    "newServices": [
      "cross-service child development view piloted in three localities"
    ],
    "identifiers": [
      "child-level identifiers matched across health, education and childcare systems"
    ],
    "standards": [
      "NDL data-sharing safeguards and data-protection standards"
    ],
    "partners": [
      "GDS",
      "DSIT",
      "DHSC/NHS",
      "Leeds City Council",
      "LB Hammersmith & Fulham",
      "Liverpool City Region Combined Authority"
    ],
    "strategyImplication": "DfE's strategy must make early-years data linkable across health and childcare boundaries (consistent child identifiers, sharing agreements), since this kickstarter is the template for national join-up of children's data.",
    "eli5": "In three test areas, health visitors, nurseries and schools are joining up their records so grown-ups helping a young child can see the whole picture and get them ready for school.",
    "capabilityIds": [
      "sharing",
      "interoperability"
    ],
    "pressureIds": [
      "agency-coordination",
      "national-data-library"
    ],
    "aliases": [
      "early years kickstarter",
      "school readiness data linkage",
      "health visiting data",
      "NDL early years spotlight"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/news/faster-support-for-children-to-get-school-ready-as-tech-sec-vows-to-better-connect-public-services",
      "https://www.globalgovernmentforum.com/uk-launches-national-data-library-with-early-years-kickstarter-project/"
    ]
  },
  {
    "id": "sr25-digital-efficiencies",
    "docId": "spending-review-2025",
    "title": "Deliver SR25 efficiency targets substantially through digital, data and AI (DfE: £248m/yr by 2028-29)",
    "what": "SR25 requires all departments to deliver at least 5% savings and efficiencies by 2028-29 and cut administration budgets by at least 11% in real terms, with digital transformation and AI adoption as the principal lever; £1.9bn goes to DSIT for cross-cutting digital priorities including the NDL and GOV.UK Wallet/App. DfE's published efficiency plan commits to £248m of efficiencies per year by 2028-29, using AI and digital tools, contract aggregation and insourcing digital/data/technology roles.",
    "quote": "All departments will deliver at least 5% savings and efficiencies by 2028-29",
    "theme": "funding",
    "status": "in-delivery",
    "timeframe": "SR period to 2028-29 (admin reductions of 16% by 2029-30); Office for Value for Money tracking progress",
    "timeframeDate": "2029-03",
    "dfeRole": "deliverer",
    "flows": [],
    "newServices": [
      "AI and automation tools replacing manual administrative processing in DfE"
    ],
    "identifiers": [],
    "standards": [],
    "partners": [
      "HM Treasury",
      "DSIT/GDS",
      "Office for Value for Money"
    ],
    "strategyImplication": "The data strategy must carry an explicit efficiency narrative: which data/AI investments produce the £248m/yr, and the measurement basis for attributing savings to digital transformation.",
    "eli5": "The education department must save about a quarter of a billion pounds every year by using computers and artificial intelligence to do work that people currently do by hand.",
    "capabilityIds": [
      "governance",
      "value"
    ],
    "aliases": [
      "spending review efficiencies",
      "248 million efficiencies",
      "departmental efficiency plan",
      "admin budget cuts",
      "digital-driven savings"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/spending-review-2025-document/spending-review-2025-html",
      "https://assets.publishing.service.gov.uk/media/68492799d0ca5d7801e4e709/Efficiency_delivery_plans_-_supplementary_document_-_FINAL.pdf"
    ]
  },
  {
    "id": "evaluation-registry-mandate",
    "docId": "evaluation-registry-guidance",
    "title": "Register all DfE evaluations on the public Evaluation Registry",
    "what": "Since the Registry's public launch in March 2025, all ministerial departments must register every planned, live and completed evaluation signed off from 1 April 2024 onwards, entering plans no later than first data collection and publishing findings by default. For DfE this covers its extensive programme evaluations (tutoring, early years, skills) and creates a public accountability dataset about DfE's own evidence base.",
    "quote": "All planned, live, and completed Government evaluations from 1st April 2024 onwards must be registered on the Government Evaluation Registry",
    "theme": "accountability",
    "status": "in-delivery",
    "timeframe": "Mandatory from launch (March 2025), applying retrospectively to evaluations from 1 April 2024; ETF monitors compliance",
    "timeframeDate": "2025-03",
    "dfeRole": "complier",
    "flows": [
      {
        "from": "dfe",
        "to": "cabinet-office",
        "what": "metadata and reports for all impact, process and value-for-money evaluations, published on the registry"
      }
    ],
    "newServices": [],
    "identifiers": [],
    "standards": [
      "Magenta Book evaluation definitions",
      "GSR publication protocol"
    ],
    "partners": [
      "Evaluation Task Force (Cabinet Office / HM Treasury)"
    ],
    "strategyImplication": "The strategy's evidence chapter should wire Registry registration into DfE programme governance, and exploit the Registry as a discoverable index of DfE's evaluation data assets.",
    "eli5": "Every time the department tests whether one of its programmes works, it must record the test and its results on a public list anyone can check.",
    "capabilityIds": [
      "quality",
      "value"
    ],
    "aliases": [
      "evaluation registry",
      "evaluation task force mandate",
      "register evaluations",
      "publish findings by default"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/guidance/guidance-on-using-the-evaluation-registry",
      "https://civilservice.blog.gov.uk/2025/03/31/public-launch-of-the-evaluation-registry/"
    ]
  },
  {
    "id": "ons-critical-data-supply",
    "docId": "devereux-review-ons",
    "title": "Meet tightened expectations as a critical data supplier to ONS and cross-government statistics",
    "what": "The Devereux Review (June 2025) found ONS quality failures partly rooted in late or erroneous data supplied by departments, and an opportunity cost in the Integrated Data Service; the joint UKSA-Cabinet Office response accepted its recommendations, split ONS leadership roles, and signalled changes to UKSA's underpinning legislation. ONS's resulting end-to-end approach to critical data sources raises expectations on supplier departments — DfE supplies education, children's services and workforce data to ONS and shares de-identified data for accredited research.",
    "quote": "change the primary legislation underpinning the UKSA to adopt a more appropriate model of governance",
    "theme": "analytics",
    "status": "in-delivery",
    "timeframe": "Review and response June 2025; ONS improvement plan through 2026; UKSA legislation change pending parliamentary time",
    "timeframeDate": "2026-12",
    "dfeRole": "partner",
    "flows": [
      {
        "from": "dfe",
        "to": "ons",
        "what": "administrative education data supplied for national statistics and accredited linked-data research, under stricter quality and timeliness expectations"
      }
    ],
    "newServices": [],
    "identifiers": [],
    "standards": [
      "ONS end-to-end critical data source management",
      "Statistics and Registration Service Act data-sharing framework"
    ],
    "partners": [
      "ONS",
      "UK Statistics Authority",
      "Cabinet Office"
    ],
    "strategyImplication": "The strategy should formalise DfE's role as a statistical data supplier — named critical feeds to ONS with quality SLAs, and a position on expanding education data available for cross-government linkage.",
    "eli5": "The national statistics office got in trouble partly because departments sent it late or wrong numbers, so the education department now has to supply its data on time and correct.",
    "capabilityIds": [
      "quality",
      "sharing"
    ],
    "aliases": [
      "devereux review",
      "critical data sources",
      "integrated data service",
      "statistics supply quality",
      "UKSA reform"
    ],
    "confidence": "medium",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/independent-review-of-the-performance-and-culture-of-the-office-for-national-statistics/independent-review-by-sir-robert-devereux-kcb-june-2025",
      "https://www.gov.uk/government/publications/independent-review-of-the-performance-and-culture-of-the-office-for-national-statistics/joint-uk-statistics-authority-cabinet-office-response-to-the-review-by-sir-robert-devereux",
      "https://www.ons.gov.uk/aboutus/ourstrategyandplans/onsimprovementplans/onsstrategicimprovementupdatedecember2025"
    ]
  },
  {
    "id": "digital-workforce-leadership",
    "docId": "roadmap-modern-digital-government-2026",
    "title": "Grow DfE's digital and data workforce (1-in-10 target) with board-level digital leadership",
    "what": "The Prime Minister has set a target for one in ten civil servants to work in technology and digital roles by 2030, delivered through the Government Digital and Data profession, its capability framework (extended to senior roles including CDO briefs), a digital pay framework, and a Digital Workforce 2030 Delivery Plan due in 2026. The blueprint also requires a digital leader on every executive committee and a digital non-executive director on every board by 2026; DfE's efficiency plan commits to insourcing digital, data and technology managed services into permanent roles.",
    "quote": "one in 10 civil servants to work in technology and digital roles by 2030",
    "theme": "workforce",
    "status": "announced",
    "timeframe": "Board-level leadership by 2026; workforce target by 2030; Digital Workforce 2030 Delivery Plan publishing 2026",
    "timeframeDate": "2030-01",
    "dfeRole": "deliverer",
    "flows": [],
    "newServices": [],
    "identifiers": [],
    "standards": [
      "Government Digital and Data Profession Capability Framework",
      "digital pay framework",
      "GDD senior role definitions (CDO/CDIO briefs)"
    ],
    "partners": [
      "GDS",
      "Cabinet Office",
      "DSIT"
    ],
    "strategyImplication": "The strategy needs a workforce chapter — DfE's trajectory to the 1-in-10 ratio, adoption of GDD role standards including a senior data officer cadre, the insourcing plan — and should be explicitly owned at executive-committee level by the digital leader this mandate requires.",
    "eli5": "By 2030 one in every ten government workers should have a technology job, and the education department must put a technology expert at its top leadership table.",
    "capabilityIds": [
      "skills",
      "governance"
    ],
    "aliases": [
      "one in ten digital roles",
      "digital workforce 2030",
      "GDD capability framework",
      "digital leader on executive committee",
      "insourcing digital roles"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://gds.blog.gov.uk/2026/01/20/our-roadmap-for-modern-digital-government/",
      "https://ddat-capability-framework.service.gov.uk/",
      "https://assets.publishing.service.gov.uk/media/68492799d0ca5d7801e4e709/Efficiency_delivery_plans_-_supplementary_document_-_FINAL.pdf",
      "https://www.gov.uk/government/publications/a-blueprint-for-modern-digital-government/a-blueprint-for-modern-digital-government-html"
    ]
  },
  {
    "id": "digital-id-scheme",
    "docId": "digital-id-scheme-consultation",
    "title": "Track and prepare for the national digital ID scheme and mandatory digital right-to-work checks",
    "what": "Government consulted (spring 2026) on a national digital ID, free and voluntary for citizens after the mandatory-for-work plan was dropped in January 2026 — but it still intends to legislate so right-to-work evidence must be checked digitally, and to roll digital ID out by the end of the Parliament. DfE is affected as steward of the school and children's workforce (employment checks by schools/trusts) and as a service owner whose entitlement checks could consume the credential.",
    "quote": "proposing to legislate so that evidence must be checked digitally as part of a prescribed right to work check",
    "theme": "identifiers",
    "status": "consulting",
    "timeframe": "Consultation ran to May/June 2026; rollout targeted by end of this Parliament (2029)",
    "timeframeDate": "2029-06",
    "dfeRole": "partner",
    "flows": [
      {
        "from": "dsit",
        "to": "schools",
        "what": "digitally verified identity and right-to-work evidence (via GOV.UK Wallet) for school workforce recruitment checks"
      }
    ],
    "newServices": [],
    "identifiers": [
      "national digital ID credential",
      "One Login-bound identity"
    ],
    "standards": [
      "UK digital identity and attributes trust framework",
      "prescribed digital right-to-work check rules"
    ],
    "partners": [
      "Cabinet Office",
      "DSIT/GDS",
      "Home Office",
      "DBS"
    ],
    "strategyImplication": "The strategy should anticipate digital ID as a future common identifier in school workforce and entitlement processes, and position DfE guidance for schools as employers once digital checks become prescribed.",
    "eli5": "The country may get an official digital identity card on your phone, and schools would use it to check that new staff are who they say they are and allowed to work.",
    "capabilityIds": [
      "interoperability",
      "ethics"
    ],
    "aliases": [
      "digital ID scheme",
      "digital right to work checks",
      "national digital identity",
      "identity checks for school workforce"
    ],
    "confidence": "medium",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/digital-id-scheme-explainer/digital-id-scheme-explainer",
      "https://commonslibrary.parliament.uk/research-briefings/cbp-10369/",
      "https://www.pinsentmasons.com/out-law/news/uk-scales-back-digital-id-right-work"
    ]
  },
  {
    "id": "education-record-app",
    "docId": "education-record-news",
    "title": "National rollout of the Education Record app — a digital education record for every Year 11",
    "what": "Following pilots in Greater Manchester and the West Midlands, DfE committed (8 January 2026) that every Year 11 student in England can see GCSE results in the Education Record app from summer 2026. DfE creates a digital education record per pupil from school and awarding-body data, shared with post-16 providers via QR code to smooth enrolment (including SEND, FSM and English/maths continuation data).",
    "quote": "This app will give young people instant access to their results whenever they need them.",
    "theme": "new-service",
    "status": "in-delivery",
    "timeframe": "National availability for GCSE results from August 2026",
    "timeframeDate": "2026-08",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "schools",
        "to": "dfe",
        "what": "exam results and pupil characteristics for Year 11 (with awarding-body results data) building the education record"
      },
      {
        "from": "dfe",
        "to": "parents",
        "what": "instant digital access to results for young people via the app"
      },
      {
        "from": "parents",
        "to": "colleges",
        "what": "learner-shared verified education record (QR code) incl. SEND and FSM flags at enrolment"
      }
    ],
    "newServices": [
      "Education Record app",
      "issue-education-record and view-education-record services"
    ],
    "identifiers": [
      "learner record identity, QR-code-based sharing"
    ],
    "standards": [
      "verifiable digital credentials for exam results"
    ],
    "partners": [
      "awarding organisations",
      "colleges",
      "Association of Colleges"
    ],
    "strategyImplication": "The closest thing to DfE's public 'single view of a learner' — a citizen-facing record built on DfE-held data, likely to expand beyond GCSEs to a lifelong learner record, and the natural anchor for Wallet credentials.",
    "eli5": "Teenagers get their exam results in an official phone app and can show a code to their new college to prove their grades instantly.",
    "capabilityIds": [
      "platform",
      "value"
    ],
    "aliases": [
      "education record app",
      "digital exam results",
      "GCSE results app",
      "QR code record sharing",
      "view education record"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/news/government-modernises-exam-records-with-new-app",
      "https://view-education-record.education.gov.uk/",
      "https://issue-education-record.education.gov.uk/about/index"
    ]
  },
  {
    "id": "automated-collections-ambition",
    "docId": "attendance-dpia",
    "title": "Stated ambition to extend automated, attendance-style data collection to other school data",
    "what": "In its published principles for requesting daily data from state-funded schools and the attendance DPIA, DfE frames daily attendance as the first step of a wider move to automated collections, stating an ambition to introduce more automated data collection in future to reduce burden versus census-style returns. No specific next collection has been formally announced.",
    "quote": "part of our ambition to introduce more automated data collection in the future",
    "theme": "infrastructure",
    "status": "announced",
    "timeframe": "Open-ended; principles published September 2023, DPIA September 2024, restated since",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "schools",
        "to": "dfe",
        "what": "further pupil/school data domains via automated daily MIS extraction (candidates: exclusions, admissions, workforce)"
      }
    ],
    "newServices": [
      "future automated collections replacing parts of the school census"
    ],
    "identifiers": [
      "pupil-level records"
    ],
    "standards": [
      "published principles for daily data requests from state-funded schools"
    ],
    "partners": [
      "MIS suppliers",
      "Wonde"
    ],
    "strategyImplication": "Signals eventual retirement of the termly school census in favour of continuous MIS-integrated collection — a foundational shift in how the department's core datasets are built.",
    "eli5": "Instead of schools filling in big forms a few times a year, the government wants more data to flow automatically from school computers, saving teachers time.",
    "capabilityIds": [
      "platform"
    ],
    "pressureIds": [
      "burden-on-schools"
    ],
    "aliases": [
      "automated data collection",
      "census modernisation",
      "daily data collections",
      "MIS-integrated collection",
      "reduce school data burden"
    ],
    "confidence": "medium",
    "sourceUrls": [
      "https://assets.publishing.service.gov.uk/media/66d83f677a73423428aa2f14/School_attendance_data_collection_DPIA.pdf",
      "https://assets.publishing.service.gov.uk/media/6511356b2f404b0014c3d820/Requesting_daily_data_from_state-funded_schools_principles_for_collection_and_DfE_use__1_.pdf",
      "https://www.axd.agency/post/what-is-the-dfe-doing-with-attendance-data"
    ]
  },
  {
    "id": "ees-open-data-api",
    "docId": "ees-api-docs",
    "title": "Explore Education Statistics public API for machine-readable official statistics",
    "what": "DfE operates and is expanding a public REST API (v1) on its EES dissemination platform, giving programmatic access to published statistics datasets: dataset summaries, versioned queryable data and CSV downloads, with SDKs. Coverage is growing but not all EES datasets are API-accessible yet; the API is catalogued on DfE's Find and Use an API and the cross-government API catalogue.",
    "quote": "a way to directly consume published data",
    "theme": "analytics",
    "status": "in-delivery",
    "timeframe": "API live with v1 endpoints; docs maintained through 2025; dataset coverage expanding",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "dfe",
        "to": "researchers",
        "what": "machine-readable aggregate statistics via a versioned public API"
      },
      {
        "from": "dfe",
        "to": "las",
        "what": "programmatic access to published education statistics for local analysis"
      }
    ],
    "newServices": [
      "EES public API v1",
      "API SDKs"
    ],
    "identifiers": [],
    "standards": [
      "REST/JSON, dataset versioning"
    ],
    "partners": [
      "dfe-analytical-services (open source on GitHub)"
    ],
    "strategyImplication": "DfE's concrete open-data commitment: statistics-as-a-service, making aggregate education data a dependable public data product rather than ad-hoc spreadsheet downloads.",
    "eli5": "Anyone's computer program can now ask the government's education statistics website for numbers directly, instead of a person downloading spreadsheets by hand.",
    "capabilityIds": [
      "platform",
      "value"
    ],
    "aliases": [
      "explore education statistics API",
      "EES API",
      "statistics as a service",
      "machine-readable statistics"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://api.education.gov.uk/statistics/docs/",
      "https://www.api.gov.uk/dfe/explore-education-statistics-api/",
      "https://github.com/dfe-analytical-services/explore-education-statistics"
    ]
  },
  {
    "id": "teaching-record-system",
    "docId": "trs-repo",
    "title": "Modernise the Database of Qualified Teachers into the Teaching Record System",
    "what": "DfE is transforming the legacy Database of Qualified Teachers (DQT) into the Teaching Record System (TRS), the primary source of teaching records keyed by the Teacher Reference Number (TRN), refactored into discrete digital services with APIs consumed by Check a Teacher's Record and Access Your Teaching Qualifications. Addresses the known gap that DfE lacks a single accurate database of all UK teachers (DQT only covers QTS holders).",
    "quote": "the primary source of teaching records for DfE",
    "theme": "workforce",
    "status": "in-delivery",
    "timeframe": "Ongoing 2023-2026; incremental service-by-service migration",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "dfe",
        "to": "schools",
        "what": "qualification, QTS, induction and prohibition status via Check a Teacher's Record"
      },
      {
        "from": "he",
        "to": "dfe",
        "what": "teacher training events from ITT providers feeding the TRS"
      }
    ],
    "newServices": [
      "Teaching Record System APIs",
      "Check a teacher's record",
      "Access your teaching qualifications",
      "Find a lost TRN"
    ],
    "identifiers": [
      "Teacher Reference Number (TRN)"
    ],
    "standards": [],
    "partners": [
      "Teaching Regulation Agency",
      "ITT providers"
    ],
    "strategyImplication": "The workforce analogue of the learner record: one authoritative teacher record with service APIs — a building block for workforce planning and teacher identity services.",
    "eli5": "The government is rebuilding its master list of teachers so schools can instantly check someone's qualifications and that they are allowed to teach.",
    "capabilityIds": [
      "skills",
      "platform"
    ],
    "aliases": [
      "teaching record system",
      "TRS",
      "database of qualified teachers",
      "teacher reference number",
      "check a teacher's record"
    ],
    "confidence": "medium",
    "sourceUrls": [
      "https://github.com/DFE-Digital/teaching-record-system",
      "https://www.gov.uk/guidance/check-a-teachers-record",
      "https://github.com/DFE-Digital/database-of-qualified-teachers"
    ]
  },
  {
    "id": "srs-default-research-route",
    "docId": "how-dfe-shares",
    "title": "ONS Secure Research Service as the default route for sharing DfE personal data with researchers",
    "what": "DfE's published data-sharing guidance establishes the ONS Secure Research Service as the default platform for researcher access to DfE personal data (NPD, LEO, HE data), with direct transfers as the exception. In the 11 September 2025 update DfE removed the ONS Integrated Data Service as an access route — a notable retreat from the cross-government IDS migration path.",
    "quote": "project applications are managed through the ONS Secure Research Service (SRS)",
    "theme": "data-sharing",
    "status": "in-delivery",
    "timeframe": "Ongoing policy; IDS route removed September 2025",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "dfe",
        "to": "ons",
        "what": "de-identified personal datasets (NPD, LEO, HE data) deposited into the Secure Research Service environment"
      },
      {
        "from": "dfe",
        "to": "researchers",
        "what": "accredited researcher access to de-identified personal data in a trusted research environment"
      }
    ],
    "newServices": [
      "Find NPD data catalogue (find-npd-data.education.gov.uk)"
    ],
    "identifiers": [],
    "standards": [
      "Digital Economy Act research provisions",
      "ONS Approved/Accredited Researcher scheme",
      "Five Safes"
    ],
    "partners": [
      "ONS",
      "ADR UK"
    ],
    "strategyImplication": "DfE consolidating on SRS while dropping IDS signals caution about the cross-government Integrated Data Service — relevant to any strategy assuming IDS becomes the single analytical environment.",
    "eli5": "Researchers who want to study pupil data must use one locked-down government computer room where names are removed and nothing can be taken out.",
    "capabilityIds": [
      "sharing",
      "governance"
    ],
    "aliases": [
      "secure research service default",
      "SRS access route",
      "IDS route removed",
      "researcher access to NPD",
      "find NPD data"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/guidance/data-protection-how-we-collect-and-share-research-data",
      "https://www.gov.uk/guidance/apply-for-department-for-education-dfe-personal-data",
      "https://defenddigitalme.org/2026/04/15/national-pupil-data-distribution-a-2026-review-and-how-to-fix-it/"
    ]
  },
  {
    "id": "dhsc-single-patient-record",
    "docId": "ten-year-health-plan",
    "title": "The single patient record — one health record per child",
    "what": "DHSC and NHS England are building a single, secure, authoritative patient record for every person — including every child — surfaced through the NHS App. For children it becomes the canonical health record any school-linked health service would read, making it the health-side anchor for education–health record joins.",
    "quote": "give patients real control over a single, secure and authoritative account of their data",
    "theme": "infrastructure",
    "status": "in-delivery",
    "timeframe": "phased over the plan decade; early delivery this Parliament",
    "dfeRole": "partner",
    "flows": [
      {
        "from": "dhsc",
        "to": "parents",
        "what": "a single authoritative health record per child, accessible via the NHS App"
      }
    ],
    "newServices": [
      "Single patient record",
      "NHS App as front door"
    ],
    "identifiers": [
      "NHS number"
    ],
    "standards": [
      "DUAA 2025 mandatory health & care information standards"
    ],
    "partners": [
      "DHSC",
      "NHS England",
      "DSIT"
    ],
    "strategyImplication": "Treat the single patient record as fixed health-side architecture: design education–health joins (identifiers, consent, safeguarding views) against it rather than building parallel child records.",
    "eli5": "The NHS is building one health record for every child. DfE should plan to connect to it, not copy it.",
    "capabilityIds": [
      "interoperability",
      "sharing"
    ],
    "pressureIds": [
      "consistent-child-identifier",
      "health-social-care-link"
    ],
    "aliases": [
      "single patient record",
      "NHS App record",
      "authoritative patient record"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/10-year-health-plan-for-england-fit-for-the-future",
      "https://www.gov.uk/government/publications/10-year-health-plan-for-england-fit-for-the-future/fit-for-the-future-10-year-health-plan-for-england-executive-summary"
    ]
  },
  {
    "id": "dhsc-my-children-red-book",
    "docId": "ten-year-health-plan",
    "title": "'My Children' in the NHS App — the digital red book",
    "what": "The 10-Year Health Plan commits to a 'My Children' area of the NHS App as the digital successor to the paper red book — vaccinations, development checks and health visiting in one parental view. It creates the first mainstream digital child-development record parents actually hold.",
    "quote": "parents will be able to use My Children to access their children's health information",
    "theme": "new-service",
    "status": "announced",
    "timeframe": "during this Parliament",
    "dfeRole": "partner",
    "flows": [
      {
        "from": "dhsc",
        "to": "parents",
        "what": "child health and development records (vaccinations, reviews) in a parental digital view"
      }
    ],
    "newServices": [
      "My Children (NHS App)"
    ],
    "identifiers": [
      "NHS number"
    ],
    "standards": [],
    "partners": [
      "DHSC",
      "NHS England"
    ],
    "strategyImplication": "The 2–2.5-year review and health-visiting data behind the digital red book is exactly what school-readiness work needs; DfE should negotiate the education-side view (with consent) rather than commissioning a rival record.",
    "eli5": "The paper red book parents get for babies is going digital in the NHS App — useful for knowing if children are on track before school.",
    "capabilityIds": [
      "sharing",
      "interoperability"
    ],
    "pressureIds": [
      "health-social-care-link"
    ],
    "aliases": [
      "My Children",
      "digital red book",
      "red book"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/10-year-health-plan-for-england-fit-for-the-future"
    ]
  },
  {
    "id": "dhsc-mhst-full-coverage",
    "docId": "ten-year-health-plan",
    "title": "Mental Health Support Teams in every school and college",
    "what": "Government has committed to expand NHS Mental Health Support Teams to 100% of schools and colleges by 2029/30 (confirmed at the 2025 Spending Review). Every school gains a standing NHS service inside it — with referral, caseload and outcome data flowing routinely between education and health.",
    "quote": "expand mental health support teams to reach full coverage",
    "theme": "new-service",
    "status": "in-delivery",
    "timeframe": "full coverage by 2029/30",
    "timeframeDate": "2029-09",
    "dfeRole": "partner",
    "flows": [
      {
        "from": "schools",
        "to": "dhsc",
        "what": "referrals and pupil context to school-based mental health teams"
      },
      {
        "from": "dhsc",
        "to": "schools",
        "what": "support plans, caseload and outcome data from MHSTs"
      }
    ],
    "newServices": [
      "Mental Health Support Teams (full rollout)"
    ],
    "identifiers": [],
    "standards": [],
    "partners": [
      "DHSC",
      "NHS England",
      "schools"
    ],
    "strategyImplication": "A routine education–health operational data interface at national scale needs common consent, identifier and recording practice — a concrete early use-case for the consistent identifier.",
    "eli5": "NHS mental-health teams will work inside every school by 2030, so schools and the NHS will constantly swap information about the same children.",
    "capabilityIds": [
      "sharing"
    ],
    "pressureIds": [
      "health-social-care-link"
    ],
    "aliases": [
      "mental health support teams",
      "MHST",
      "mental health teams in schools"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/10-year-health-plan-for-england-fit-for-the-future",
      "https://www.england.nhs.uk/mental-health/cyp/trailblazers/"
    ]
  },
  {
    "id": "cpt-poverty-monitoring-baseline",
    "docId": "child-poverty-strategy",
    "title": "Child-poverty monitoring framework baselined on DfE indicators",
    "what": "The Child Poverty Strategy commits to a cross-government monitoring and evaluation framework: two headline metrics (relative low income after housing costs plus a new deep material poverty measure), a baseline report in summer 2026 and annual reporting. Tracking the strategy's pillars needs DfE's FSM, early-years development and attainment-gap data joined with DWP and HMRC income data.",
    "quote": "robust approach to monitoring and evaluation so that we can understand how well this is working",
    "theme": "accountability",
    "status": "announced",
    "timeframe": "baseline summer 2026, then annual",
    "timeframeDate": "2026-08",
    "dfeRole": "partner",
    "flows": [
      {
        "from": "dfe",
        "to": "cabinet-office",
        "what": "FSM take-up, early-years development and attainment-gap indicators for poverty-strategy monitoring"
      },
      {
        "from": "dwp",
        "to": "cabinet-office",
        "what": "headline poverty metrics including the new deep material poverty measure"
      }
    ],
    "newServices": [],
    "identifiers": [],
    "standards": [
      "deep material poverty metric (13 essential items)"
    ],
    "partners": [
      "Cabinet Office",
      "DWP",
      "HMRC",
      "ONS"
    ],
    "strategyImplication": "DfE indicators become accountability lines in a No.10-visible framework from summer 2026 — agree definitions (especially the post-expansion FSM measure) before the baseline locks them in.",
    "eli5": "Government will publish a yearly scorecard on child poverty, and several of its numbers come from DfE's data.",
    "capabilityIds": [
      "value",
      "quality"
    ],
    "pressureIds": [
      "evidence-based-policy"
    ],
    "aliases": [
      "child poverty strategy",
      "deep material poverty",
      "poverty baseline",
      "poverty monitoring"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/our-children-our-future-tackling-child-poverty/our-children-our-future-tackling-child-poverty"
    ]
  },
  {
    "id": "mhclg-local-outcomes-framework",
    "docId": "local-outcomes-framework",
    "title": "The Local Outcomes Framework runs on DfE data",
    "what": "MHCLG's first Local Outcomes Framework (February 2026) sets sixteen national priority outcomes for central-local delivery. Its three child-focused outcomes are measured almost entirely with DfE-sourced metrics — GLD, the FSM-GLD gap, disadvantage attainment gaps, absence, NEET and children's social care indicators — alongside MoJ and DHSC child metrics, with a supporting digital tool from April 2026.",
    "quote": "Percentage point difference between the proportion of children eligible or not eligible for Free School Meals achieving a Good Level of Development",
    "theme": "accountability",
    "status": "in-delivery",
    "timeframe": "first edition Feb 2026; digital tool from April 2026",
    "timeframeDate": "2026-04",
    "dfeRole": "partner",
    "flows": [
      {
        "from": "dfe",
        "to": "mhclg",
        "what": "standing LA-level metric feeds (GLD, attainment gaps, absence, NEET, social care) for three priority outcomes"
      },
      {
        "from": "mhclg",
        "to": "las",
        "what": "the outcomes framework and digital tool local authorities are held to"
      }
    ],
    "newServices": [
      "LOF digital tool"
    ],
    "identifiers": [],
    "standards": [
      "nationally consistent outcome metric definitions"
    ],
    "partners": [
      "MHCLG",
      "DHSC",
      "MoJ",
      "local authorities"
    ],
    "strategyImplication": "DfE statistics are now local government's accountability dashboard: timely, LA-level, openly licensed feeds — and a DfE say in metric definitions — become obligations, not favours.",
    "eli5": "Councils will be judged against a national scoreboard, and most of the children's numbers on it come from DfE.",
    "capabilityIds": [
      "value",
      "quality",
      "interoperability"
    ],
    "pressureIds": [
      "evidence-based-policy",
      "la-data-sharing"
    ],
    "aliases": [
      "local outcomes framework",
      "priority outcomes",
      "LOF"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/local-outcomes-framework/local-outcomes-framework",
      "https://www.gov.uk/government/publications/local-outcomes-framework/local-outcomes-framework-priority-outcomes-and-metrics--2"
    ]
  },
  {
    "id": "mhclg-mayoral-data-council",
    "docId": "english-devolution-wp",
    "title": "Mayoral Data Council and central–local data partnership",
    "what": "The English Devolution White Paper commits to a Mayoral Data Council bringing strategic-authority data leaders into central decision-making, co-developed data partnership principles for lawful central-local sharing, and broadened Digital Economy Act 2017 powers. Education and skills data is squarely what strategic authorities will ask DfE for.",
    "quote": "Establish a new Mayoral Data Council to integrate senior data leaders from Mayoral Strategic Authorities",
    "theme": "data-sharing",
    "status": "in-delivery",
    "timeframe": "white paper Dec 2024; Act in force from mid-2026",
    "timeframeDate": "2026-06",
    "dfeRole": "complier",
    "flows": [
      {
        "from": "dfe",
        "to": "mhclg",
        "what": "skills, post-16 and labour-market data shared with strategic authorities under the partnership principles"
      }
    ],
    "newServices": [
      "Mayoral Data Council"
    ],
    "identifiers": [],
    "standards": [
      "data partnership principles",
      "DEA 2017 gateway expansion"
    ],
    "partners": [
      "MHCLG",
      "DSIT",
      "strategic authorities"
    ],
    "strategyImplication": "Standing, structured demands for granular skills and 16-19 data from statutory strategic authorities are coming — build one devolution data product rather than forty bespoke shares.",
    "eli5": "Regional mayors are getting a formal seat at the data table and will expect a steady feed of education and skills data.",
    "capabilityIds": [
      "sharing",
      "governance"
    ],
    "pressureIds": [
      "la-data-sharing"
    ],
    "aliases": [
      "mayoral data council",
      "data partnership principles",
      "devolution data"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/english-devolution-white-paper-power-and-partnership-foundations-for-growth/english-devolution-white-paper"
    ]
  },
  {
    "id": "mhclg-skills-devolution",
    "docId": "english-devolution-wp",
    "title": "Skills devolution: ILR-keyed data flows to strategic authorities",
    "what": "The white paper — underpinned by the English Devolution and Community Empowerment Act 2026 (Royal Assent 29 April 2026) — devolves most of the Adult Skills Fund to mayoral strategic authorities, gives them joint ownership of Local Skills Improvement Plans, and moves funding into integrated settlements monitored through a single agreed outcomes framework. Each element needs recurring DfE data flows: learner records, provider performance, 16-19 destinations and NEET data.",
    "quote": "Strategic Authorities will take on joint ownership of the Local Skills Improvement Plan model",
    "theme": "data-sharing",
    "status": "in-delivery",
    "timeframe": "Act April 2026; settlements rolling out from 2025/26",
    "timeframeDate": "2026-04",
    "dfeRole": "owner",
    "flows": [
      {
        "from": "dfe",
        "to": "mhclg",
        "what": "ILR learner, provider and outcomes data for devolved adult-skills management by strategic authorities"
      },
      {
        "from": "mhclg",
        "to": "dfe",
        "what": "outcomes reporting under integrated-settlement frameworks"
      }
    ],
    "newServices": [
      "integrated settlements",
      "jointly owned LSIPs"
    ],
    "identifiers": [
      "ULN"
    ],
    "standards": [
      "single agreed outcomes framework per settlement"
    ],
    "partners": [
      "MHCLG",
      "Skills England",
      "strategic authorities",
      "employer representative bodies"
    ],
    "strategyImplication": "Devolution turns DfE from sole skills commissioner into data steward for ten-plus strategic authorities: ILR access, ULN-keyed outcome feeds and comparable LSIP evidence bases become core DfE data products.",
    "eli5": "Regional authorities now run much of adult skills, so DfE has to supply them with learner and college data routinely.",
    "capabilityIds": [
      "sharing",
      "value"
    ],
    "pressureIds": [
      "neet-tracking"
    ],
    "aliases": [
      "adult skills fund",
      "integrated settlements",
      "skills devolution",
      "LSIP"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/english-devolution-white-paper-power-and-partnership-foundations-for-growth/english-devolution-white-paper",
      "https://www.legislation.gov.uk/ukpga/2026/23/contents/enacted"
    ]
  },
  {
    "id": "ho-operation-encompass",
    "docId": "op-encompass-duty",
    "title": "Statutory police-to-school domestic-abuse notifications (Operation Encompass)",
    "what": "From November 2025, police in England and Wales are under a statutory duty (s.20 Victims and Prisoners Act 2024, inserting s.49A Domestic Abuse Act 2021) to notify a child's school before the next school day when officers attend a domestic-abuse incident involving that child. Notifications carry name, date of birth, incident details and context — a routine, person-level police-to-school safeguarding flow with no national identifier or secure channel specified.",
    "quote": "The notification should be made before the start of the next school day.",
    "theme": "safeguarding",
    "status": "statutory-duty",
    "timeframe": "in force since November 2025",
    "timeframeDate": "2025-11",
    "dfeRole": "partner",
    "flows": [
      {
        "from": "home-office",
        "to": "schools",
        "what": "child-level domestic-abuse notifications (name, DOB, incident context) before the next school day"
      }
    ],
    "newServices": [
      "force-level Encompass notification processes"
    ],
    "identifiers": [
      "child name + date of birth (no national identifier specified)"
    ],
    "standards": [
      "Home Office statutory guidance (Nov 2025)"
    ],
    "partners": [
      "Home Office",
      "police forces",
      "Operation Encompass charity"
    ],
    "strategyImplication": "Schools now receive statutory police data daily with no common identifier or secure national channel — the education-side half of the interface (KCSIE guidance, secure transport, retention standards) is DfE's to specify.",
    "eli5": "If police attend a domestic-abuse incident at a child's home, they must tell the child's school by the next morning — by law.",
    "capabilityIds": [
      "sharing",
      "ethics"
    ],
    "pressureIds": [
      "agency-coordination"
    ],
    "aliases": [
      "Operation Encompass",
      "domestic abuse notification",
      "police notification to schools"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/government/publications/information-sharing-duty-operation-encompass/duty-on-police-forces-in-england-and-wales-to-notify-education-establishments-of-domestic-abuse-incidents-operation-encompass-accessible"
    ]
  },
  {
    "id": "moj-dfe-linked-dataset",
    "docId": "moj-data-first",
    "title": "The MoJ–DfE linked dataset keeps growing",
    "what": "MoJ's Data First programme links criminal-history data (Police National Computer, courts, prisons) person-level with 23 DfE datasets — attainment, absence, exclusions, children in need, looked-after children — with new analytical outputs into 2026 and researcher access via the ONS Secure Research Service. It is the flagship model for cross-department person-level linkage of DfE data.",
    "quote": "criminal history data from the Police National Computer (PNC) has been linked to education and social care data",
    "theme": "analytics",
    "status": "in-delivery",
    "timeframe": "ongoing; latest output May 2026",
    "dfeRole": "partner",
    "flows": [
      {
        "from": "dfe",
        "to": "moj",
        "what": "23 education and social-care datasets linked person-level to justice records"
      },
      {
        "from": "moj",
        "to": "researchers",
        "what": "de-identified linked justice–education data via the ONS Secure Research Service"
      }
    ],
    "newServices": [],
    "identifiers": [
      "PNC–NPD person-level matching"
    ],
    "standards": [
      "DEA 2017 research powers",
      "ONS SRS accreditation"
    ],
    "partners": [
      "MoJ",
      "ADR UK",
      "ONS"
    ],
    "strategyImplication": "The proven template for person-level linkage with another department — and a source of findings (exclusions, care, offending) that will drive demand for operational, not just research, justice–education joins.",
    "eli5": "Justice records and school records are already joined up for research — and the results will make people want the join used day-to-day.",
    "capabilityIds": [
      "value",
      "sharing"
    ],
    "pressureIds": [
      "agency-coordination",
      "researcher-access"
    ],
    "aliases": [
      "Data First",
      "MoJ linked dataset",
      "justice education linkage",
      "BOLD"
    ],
    "confidence": "high",
    "sourceUrls": [
      "https://www.gov.uk/guidance/ministry-of-justice-data-first",
      "https://www.adruk.org/data-access/flagship-datasets/ministry-of-justice-department-for-education-linked-dataset-england/"
    ]
  }
];

export const DOCUMENTS_BY_ID: Record<string, PolicyDocument> = Object.fromEntries(DOCUMENTS.map((d) => [d.id, d]));

export const COMMITMENTS_BY_DOC: Record<string, Commitment[]> = COMMITMENTS.reduce(
  (acc, c) => {
    (acc[c.docId] ??= []).push(c);
    return acc;
  },
  {} as Record<string, Commitment[]>,
);

/** Statutory + in-delivery commitments, hardest-binding first — the strategy's must-answer list. */
export const MUST_ANSWER: Commitment[] = COMMITMENTS.filter((c) =>
  ['statutory-duty', 'legislated-not-commenced', 'in-delivery'].includes(c.status),
).sort((a, b) => STATUS_META[a.status].rank - STATUS_META[b.status].rank);
