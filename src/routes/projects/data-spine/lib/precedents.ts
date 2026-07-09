// precedents.ts — data spines elsewhere: four architectural archetypes and the
// national/departmental systems that embody them. The comparative record is the
// project's strongest evidence base: every UK precedent punishes the central store
// and rewards the index/federation patterns.
import type { Confidence } from './types';

export type ArchetypeId = 'store' | 'locator' | 'federated' | 'identifier';

export interface Archetype {
  id: ArchetypeId;
  no: number;
  name: string;
  short: string;
  how: string;
  strengths: string[];
  weaknesses: string[];
  record: string;         // the empirical track record
  eli5: string;
}

export const ARCHETYPES: Archetype[] = [
  {
    id: 'store', no: 1, name: 'Central record store',
    short: 'Copy everything into one national database.',
    how: 'Records (or rich summaries) about every child are collected into a single system that professionals query directly. One place, one custodian, one giant liability.',
    strengths: ['Simplest mental model — one place to look', 'Fast queries once built', 'Single point of data-quality control'],
    weaknesses: ['Honeypot: one breach exposes everyone', 'Politically fragile — a universal child database is a headline, not a system', 'Custodian must anticipate every access rule centrally', 'Chills participation (families avoid services that feed it)'],
    record: 'ContactPoint: £224m, all 11m children indexed, switched off within a year of full operation (2010). No UK universal child store has survived contact with politics.',
    eli5: 'One giant filing cabinet for every child in the country. Britain built one — and shredded it a year later.',
  },
  {
    id: 'locator', no: 2, name: 'Central index + locator',
    short: 'A national phone book; the records stay where they are.',
    how: 'A demographic index resolves identity (who), a record locator stores pointers (where records live) — but case content stays in local systems, fetched point-to-point under access rules. The NHS pattern: PDS + National Record Locator.',
    strengths: ['No central case content — smaller honeypot', 'Identity resolution solved once, nationally', 'Local custodians keep their duties and context', 'Proven at 44,000-system NHS scale'],
    weaknesses: ['Index itself is sensitive (who is known to which services)', 'Still a national programme with national delivery risk', 'Every endpoint must implement the APIs'],
    record: 'NHS Spine (PDS, EPS, NRL) has run for two decades across 26,000 organisations. CP-IS — the targeted, NHS-number-keyed child-protection flag — outlived ContactPoint. The SUI pilots’ published shape (get-an-identifier, find-a-record, fetch-a-record) is exactly this.',
    eli5: 'A phone book plus a forwarding service: it knows who you are and which offices hold your files, and fetches them on request. The actual files never move house.',
  },
  {
    id: 'federated', no: 3, name: 'Federated exchange',
    short: 'No centre at all — standardised, signed, logged queries between systems.',
    how: 'Each organisation keeps its own database and answers queries over a common secure protocol. Every request is authenticated, encrypted and immutably logged; the "once-only" principle stops duplicate collection. Estonia’s X-Road.',
    strengths: ['No central database to breach or politicise', 'Citizens can see every access (Estonia’s log)', 'Organisational autonomy preserved', 'Open-source, internationally reused'],
    weaknesses: ['Hardest to govern: interoperability is mostly legal/institutional agreements, not code', 'Slow queries across many sources', 'Requires every participant to run capable infrastructure — thousands of schools is a very long tail'],
    record: 'X-Road has run Estonia’s public sector for 20+ years and is exported worldwide. But Estonia is 1.3m people with one civil register; England’s education system alone has 24,000+ providers.',
    eli5: 'No filing cabinet and no phone book — everyone keeps their own files and answers questions through a secure letterbox that stamps and records every request.',
  },
  {
    id: 'identifier', no: 4, name: 'Identifier + register linkage',
    short: 'Agree one number; link the registers you already have.',
    how: 'A lifetime identifier issued early (birth or first enrolment) keys every register; linkage happens analytically (for statistics/research) or transactionally (service by service). Denmark’s CPR, Netherlands’ BSN/onderwijsnummer, NZ’s NSN, Australia’s USI.',
    strengths: ['Cheapest: no new runtime infrastructure', 'Powers research and planning superbly (Nordic register studies)', 'Each service keeps its own system'],
    weaknesses: ['Does nothing for real-time operations by itself', 'A universal person-number has civil-liberties politics of its own', 'Linkage quality depends on disciplined issuance from birth'],
    record: 'Denmark’s CPR (since 1968) makes whole-population education/health/income research routine. NZ’s NSN and Australia’s USI show education-scoped lifetime IDs working without a spine. England is a latecomer: UPN (not lifetime) + ULN (14+) + NHS number, none joined.',
    eli5: 'Skip the plumbing; just give everyone one number for life and match the lists when needed. Great for research, useless in an emergency.',
  },
];

export interface Precedent {
  id: string;
  name: string;
  where: string;
  archetype: ArchetypeId;
  what: string;
  scale: string;
  fate: 'live' | 'dead' | 'cautionary';
  lesson: string;
  eli5: string;
  confidence: Confidence;
  url: string;
}

export const PRECEDENTS: Precedent[] = [
  {
    id: 'nhs-spine', name: 'NHS Spine', where: 'England — health', archetype: 'locator',
    what: 'National messaging + index infrastructure: Personal Demographics Service (demographics keyed on NHS number), e-prescriptions, Summary Care Record, National Record Locator (pointers, not records). Every national patient API must first resolve the NHS number via PDS.',
    scale: '44,000+ IT systems across 26,000 organisations', fate: 'live',
    lesson: 'Identity resolution + locator + standard messaging works at national scale — and the records can stay local. The strongest template for an education spine, and the comparison the DfE itself invites by choosing the word “spine”.',
    eli5: 'The health service’s switchboard: it knows who you are and where your records are, and passes messages — without keeping your medical notes itself.',
    confidence: 'fact', url: 'https://digital.nhs.uk/services/spine',
  },
  {
    id: 'contactpoint', name: 'ContactPoint', where: 'England — children', archetype: 'store',
    what: 'Universal index of all ~11m children (identifiers, services in contact), built under the Children Act 2004 after the Climbié inquiry. Shielding for vulnerable children judged inadequate; 330k intended users.',
    scale: '11m children · £224m build · £41m/yr to run', fate: 'dead',
    lesson: 'The universal child database is the one design with a proven failure mode in England: built 2009, politically executed 2010. Meanwhile its targeted sibling CP-IS (child-protection flags keyed on NHS number) quietly survived — targeted beats universal.',
    eli5: 'Britain already built a “every child in one database” system. A new government switched it off within a year, on principle.',
    confidence: 'fact', url: 'https://researchbriefings.files.parliament.uk/documents/SN05171/SN05171.pdf',
  },
  {
    id: 'xroad', name: 'X-Road', where: 'Estonia — whole state', archetype: 'federated',
    what: 'Open-source data-exchange layer: data stays where it is created; standardised, signed, encrypted, logged queries between agencies; once-only collection; citizens can inspect who accessed their data.',
    scale: 'Entire Estonian public sector, 20+ years, exported to 20+ countries', fate: 'live',
    lesson: 'You can have joined-up government with NO central database — but the hard part is institutional agreements, and Estonia is 1.3m people with a single civil register. The citizen-visible access log is the transparency pattern worth stealing regardless of architecture.',
    eli5: 'Estonia never built the big database — just secure letterboxes between offices, with a receipt the citizen can read every time anyone looks.',
    confidence: 'fact', url: 'https://e-estonia.com/solutions/interoperability-services/x-road/',
  },
  {
    id: 'verify', name: 'GOV.UK Verify → One Login', where: 'UK — cross-government', archetype: 'locator',
    what: 'Cross-government identity: Verify cost £200m+, hit 48% verification success against a 90% forecast, was adopted by only 27 services and cancelled; One Login is now consolidating ~190 sign-in systems.',
    scale: '£200m+ spent; 27 of hundreds of services adopted', fate: 'cautionary',
    lesson: 'Cross-government infrastructure fails on adoption, not architecture. A spine no MAT, LA or MIS vendor wants to plug into is Verify again. Incentives (does it save the school work on day one?) decide everything.',
    eli5: 'The government built a shared front door and almost nobody used it. Plumbing only counts if people actually connect their pipes.',
    confidence: 'fact', url: 'https://www.computerweekly.com/news/252462967/Govuk-Verify-has-failed-users-and-its-leaders-lack-accountability-say-MPs',
  },
  {
    id: 'cpr', name: 'CPR number', where: 'Denmark', archetype: 'identifier',
    what: 'Universal civil registration number since 1968, keying every national register — education, income, health — enabling whole-population linkage for administration and research via Statistics Denmark.',
    scale: 'Whole population, 55+ years', fate: 'live',
    lesson: 'A lifetime universal identifier makes register linkage trivially easy and world-class research routine — but it grew up with the welfare state over decades, inside a high-trust settlement England does not currently have.',
    eli5: 'Danes get one number at birth and it follows them everywhere. Researchers can study whole generations — because everyone long ago accepted the number.',
    confidence: 'fact', url: 'https://ncrr.au.dk/danish-registers/the-danish-civil-registration-system-cpr',
  },
  {
    id: 'bsn', name: 'BSN / onderwijsnummer', where: 'Netherlands', archetype: 'identifier',
    what: 'The citizen service number doubles as the education number, tracked in DUO’s registers from primary school to university — one identity across the learner’s whole journey.',
    scale: 'All Dutch learners', fate: 'live',
    lesson: 'Reusing the general civic identifier in education (exactly what England intends with the NHS number) is a normal, working pattern elsewhere — with the caveat that the Netherlands wraps it in a strong statutory register regime.',
    eli5: 'The Dutch use their national ID number for school records too. It works — inside strict rules about who reads what.',
    confidence: 'fact', url: 'https://www.government.nl/topics/personal-data/citizen-service-number-bsn',
  },
  {
    id: 'nsn', name: 'National Student Number', where: 'New Zealand', archetype: 'identifier',
    what: 'Lifetime learner identifier from the National Student Index, allocated at first enrolment (early childhood onward), statutory under the Education and Training Act 2020.',
    scale: 'All NZ learners, lifetime', fate: 'live',
    lesson: 'An education-scoped lifetime number (rather than reusing a health/civic ID) is the privacy-conservative alternative England mostly skipped past — it joins the learner journey without joining it to everything else.',
    eli5: 'New Zealand gives learners one school number for life — a number that means “student”, not “citizen”, which keeps it boring. Boring is safe.',
    confidence: 'fact', url: 'https://www.education.govt.nz/our-work/about-us/education-new-zealand/about-national-student-numbers',
  },
  {
    id: 'attendance', name: 'Daily attendance solution', where: 'England — DfE', archetype: 'locator',
    what: 'Automated daily extraction of attendance from school MIS via Wonde; mandatory since 2024/25; powers weekly national statistics and same-day dashboards for schools, trusts and LAs. Stood up in months, free to schools.',
    scale: 'All state schools, twice-daily batch', fate: 'live',
    lesson: 'The DfE has already built one vertebra of the spine — and it worked because it created zero new burden and gave schools something back (dashboards) on day one. Also proof the “spine” will likely ride on commercial brokers unless deliberately designed otherwise.',
    eli5: 'Attendance already flows to the DfE every day, automatically. The spine is essentially a promise to do that for everything else.',
    confidence: 'fact', url: 'https://www.gov.uk/guidance/share-your-daily-school-attendance-data',
  },
  {
    id: 'education-record', name: 'Education Record app', where: 'England — DfE', archetype: 'locator',
    what: 'National service giving Year 11 pupils a digital record (schools attended, GCSE results, support needs) to share with sixth forms/colleges; piloted in Greater Manchester and the West Midlands, national for August 2026 results.',
    scale: 'National rollout 2026 · claimed £30m/yr admin saving', fate: 'live',
    lesson: 'The second live vertebra — and notably LEARNER-HELD: the young person carries and shares their own record. A spine that ships value through the citizen’s hands is far harder to paint as surveillance.',
    eli5: 'School leavers now get their results and school history in an app they control and show to colleges themselves — a mini-spine where the child holds the record.',
    confidence: 'fact', url: 'https://www.gov.uk/government/news/government-modernises-exam-records-with-new-app',
  },
];

export const ARCHETYPE_META: Record<ArchetypeId, { label: string; color: string }> = {
  store: { label: 'Central store', color: '#8a2d3a' },
  locator: { label: 'Index + locator', color: 'var(--accent-ink)' },
  federated: { label: 'Federated', color: '#2f7d4f' },
  identifier: { label: 'Identifier-led', color: '#7a5aa6' },
};

// ---- Today-vs-spine flow (the plumbing diagram) ----
export interface FlowNode { id: string; label: string; sub?: string }
export interface FlowStage { title: string; nodes: FlowNode[]; note: string }
export const FLOW_TODAY: FlowStage[] = [
  { title: 'Schools', nodes: [{ id: 's', label: '24,000+ schools', sub: 'record in their MIS' }], note: 'A child’s record starts here — and fragments the moment they move.' },
  { title: 'MIS layer', nodes: [{ id: 'm', label: 'Arbor · SIMS · Bromcom', sub: '~92% of the market' }], note: 'Vendor-shaped data; CMA investigated switching barriers in 2024.' },
  { title: 'Brokers', nodes: [{ id: 'b', label: 'Wonde · Groupcall', sub: 'commercial API pipes' }], note: 'The de-facto national exchange layer already — 20,000+ schools each.' },
  { title: 'Collection', nodes: [{ id: 'c', label: 'Termly census · CTF · COLLECT', sub: '~400 items/child/yr' }, { id: 'd', label: 'Daily attendance feed', sub: 'via Wonde, mandatory' }], note: 'Statutory returns: slow, duplicative, burdensome — except the one automated feed.' },
  { title: 'Estate', nodes: [{ id: 'n', label: 'NPD (28m+ records)', sub: 'linked to DWP · HMRC · HO · MoJ' }], note: 'Longitudinal and rich — but a statistical copy, months to years behind the child.' },
];
export const FLOW_SPINE: FlowStage[] = [
  { title: 'Schools & services', nodes: [{ id: 's', label: 'Schools · colleges · LAs · health', sub: 'records stay at source' }], note: 'Local systems remain the custodians of case content.' },
  { title: 'Identity', nodes: [{ id: 'i', label: 'Consistent identifier', sub: 'CWSA 2026 · NHS number intent' }], note: 'One join key resolves the same child across services.' },
  { title: 'Spine', nodes: [{ id: 'l', label: 'Locator + open standards', sub: 'find-a-record · fetch-a-record' }], note: 'Pointers and APIs, not a database — IF the consultation lands on the federated pattern.' },
  { title: 'Uses', nodes: [{ id: 'u1', label: 'Operational', sub: 'attendance · FSM · transitions · safeguarding' }, { id: 'u2', label: 'Analytical', sub: 'TRE access, query-not-copy' }], note: 'Rapid-response services and research take different doors with different rules.' },
];
