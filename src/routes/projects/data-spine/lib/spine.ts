// spine.ts — what the DfE data spine IS: the announcement verbatim, a five-layer
// anatomy, the spine-vs-identifier distinction, and the long timeline that explains
// why trust is the binding constraint. Honesty rules (mirrors policy-engine №4):
//  - The data spine is an ANNOUNCED COMMITMENT, not a built system. As of July 2026
//    there is no published architecture, procurement or delivery plan.
//  - The data spine and the consistent identifier are DISTINCT instruments.
import type { Confidence } from './types';

// ---- The commitment, verbatim ----
export interface SpineQuote { text: string; who: string; where: string; date: string; url: string }
export const QUOTES: SpineQuote[] = [
  {
    text: 'We will develop a new data spine — a secure, privacy-respecting and streamlined way to connect and share information across different systems in education.',
    who: 'Department for Education',
    where: '“Every Child Achieving and Thriving” White Paper, CP 1508-I, p.98',
    date: '23 Feb 2026',
    url: 'https://assets.publishing.service.gov.uk/media/69972c02bfdab2546272c007/Every_child_achieving_and_thriving_print_ready_version.pdf',
  },
  {
    text: 'A new data spine and open data standards — unlocking insights previously trapped in closed systems.',
    who: 'Bridget Phillipson, Secretary of State',
    where: 'Bett Show keynote — fourth of five AI & digital goals',
    date: '21 Jan 2026',
    url: 'https://www.gov.uk/government/speeches/education-secretary-speech-at-the-bett-show-2026',
  },
  {
    text: 'Data should flow seamlessly, not be locked within individual systems — giving schools more immediate insight about the effectiveness of interventions.',
    who: 'White Paper framing',
    where: 'CP 1508-I — pupil records, attendance, progress and assessment named as in-scope',
    date: 'Feb 2026',
    url: 'https://www.gov.uk/government/publications/every-child-achieving-and-thriving/every-child-achieving-and-thriving-html-version',
  },
];

export const STATUS = {
  headline: 'Announced, not built',
  detail:
    'One paragraph on p.98 of a white paper, with no published architecture, owner, budget, procurement or delivery date. Proposals go to consultation in summer 2026. Every verb in the commitment is future tense. The white paper’s own phasing puts full implementation at 2028–29.',
  eli5: 'The government has promised to build it and said roughly why — but nobody has yet said what it is, who runs it, or what it costs. That all gets decided from summer 2026.',
  confidence: 'fact' as Confidence,
};

// ---- Five-layer anatomy ----
// A "spine" is not one thing. Decomposing it into layers is what makes the pros/cons
// and the privacy design discussable — each layer has different options and risks.
export interface SpineLayer {
  id: string;
  no: number;
  name: string;
  question: string;
  today: string;
  withSpine: string;
  eli5: string;
}
export const LAYERS: SpineLayer[] = [
  {
    id: 'identifier', no: 1, name: 'Identifier',
    question: 'Who is this child?',
    today: 'UPN in schools (13-char, not lifetime, replaceable), ULN post-14 (Learning Records Service), NHS number in health, LA-local IDs in social care. Joins between them fail at every seam — the UPN is legally restricted from non-educational use.',
    withSpine: 'The CWSA 2026 consistent identifier (ss.16LA–16LD Children Act 2004, inserted) — the NHS number is the working assumption, piloted in Wigan, but the Act deliberately does not name it. Regulations set it later.',
    eli5: 'Every service currently uses a different number for the same child, so their records don’t line up. Step one is agreeing one number (probably the NHS number).',
  },
  {
    id: 'index', no: 2, name: 'Index & locator',
    question: 'Where are their records?',
    today: 'Nowhere, systematically. A school knows its own MIS; a new school waits for a CTF file; a social worker rings around. The NPD is a slow statistical copy, not a live index.',
    withSpine: 'The SUI pilots’ published architecture is a federated record-locator: get-an-identifier, find-a-record (pointers, NOT case content) and fetch-a-record APIs — the NHS PDS/National Record Locator pattern, not a central database.',
    eli5: 'Instead of one giant filing cabinet, a phone book: it tells an authorised professional which service holds a record, and they fetch it from there.',
  },
  {
    id: 'exchange', no: 3, name: 'Exchange',
    question: 'How does data move?',
    today: 'Termly school census (~400 items/child/year) via COLLECT; CTF files on transfer; and a parallel commercial pipe — Wonde and Groupcall Xporter extract from the MIS for edtech and now for DfE’s own daily attendance feed.',
    withSpine: 'Standardised APIs replacing bulk termly returns — the daily attendance solution (mandatory since 2024/25, zero marginal burden on schools) is the live proof that feed-based collection works at national scale.',
    eli5: 'Today data moves in big termly form-filling exercises. A spine would move it continuously through plumbing, the way attendance already flows every day.',
  },
  {
    id: 'standards', no: 4, name: 'Standards',
    question: 'Do the words mean the same thing everywhere?',
    today: 'Census schemas and the Common Transfer File define a de-facto standard for statutory returns; everything else (assessment, SEND, safeguarding notes) is vendor-shaped. The CMA investigated MIS switching barriers in 2024.',
    withSpine: '“Open data standards” are named alongside the spine in both the Bett speech and the white paper — schemas any MIS or edtech tool must speak, loosening vendor lock-in.',
    eli5: 'Rules so every system describes a child’s data the same way — like agreeing on plug shapes so anything can connect.',
  },
  {
    id: 'governance', no: 5, name: 'Governance',
    question: 'Who may see what — and who checks?',
    today: 'A patchwork: UK GDPR public-task basis, the 2012 prescribed-persons regulations (2,385+ NPD distributions since), DEA 2017 research gateways, per-service MoUs. The ICO’s 2020 audit found the DfE in breach on most of it.',
    withSpine: 'Entirely undecided — and the layer everything else depends on. The white paper promises “secure, privacy-respecting”; the consultation will have to say who accesses, for what purposes, under whose audit.',
    eli5: 'The rulebook and the referee. This is the least-designed layer — and the one the whole thing lives or dies on.',
  },
];

// ---- Spine vs consistent identifier — distinct instruments ----
export const SPINE_VS_ID = {
  intro:
    'They are steered together inside the DfE — but they are legally and operationally distinct. Confusing the two is the most common error in coverage of the policy.',
  spine: {
    name: 'The data spine',
    what: 'Connectivity + standards layer WITHIN education — pupil records, attendance, progress, assessment flowing between school systems, trusts and the department.',
    basis: 'White Paper commitment (Feb 2026). No statute, no architecture, no date.',
    status: 'Announced, not built.',
  },
  identifier: {
    name: 'The consistent identifier',
    what: 'Cross-service join key ACROSS education, health, social care and police — so agencies sharing safeguarding information resolve to the same child.',
    basis: 'Children’s Wellbeing and Schools Act 2026 (ss.16LA–16LD Children Act 2004). The number itself is set later by regulations; NHS number is the piloted intent.',
    status: 'In law; pilots running (Wigan, from Apr 2025); regulations committed by end of Parliament.',
  },
  eli5: 'The identifier is the shared number for a child. The spine is the plumbing that lets systems exchange records. You can have either without the other — England is attempting both at once.',
};

// ---- Timeline ----
export type TimelineTag = 'infrastructure' | 'identifier' | 'trust' | 'operational';
export interface TimelineEvent { date: string; year: number; title: string; detail: string; tag: TimelineTag; url?: string }
export const TIMELINE: TimelineEvent[] = [
  { date: '2002', year: 2002, tag: 'infrastructure', title: 'National Pupil Database begins', detail: 'Census-built longitudinal store; now 28m+ people’s records, linked to DWP, HMRC, Home Office and justice data. England’s de-facto education data estate — statistical, slow, and copied outward.' },
  { date: '2003', year: 2003, tag: 'identifier', title: 'Victoria Climbié inquiry', detail: 'Laming recommends a national children’s database after services repeatedly failed to join their records. The founding argument for every joined-up-child-data project since.' },
  { date: '2009', year: 2009, tag: 'trust', title: 'ContactPoint goes live', detail: 'Universal index of all ~11m children in England (identifiers + services-in-contact). £224m to build, £41m/yr to run, ~330k intended users.', url: 'https://researchbriefings.files.parliament.uk/documents/SN05171/SN05171.pdf' },
  { date: 'Aug 2010', year: 2010, tag: 'trust', title: 'ContactPoint switched off', detail: 'Scrapped by the Coalition within a year of full operation, on privacy and proportionality grounds. The targeted CP-IS (NHS-number-keyed child-protection flags) survived. THE cautionary precedent for a universal child index.' },
  { date: '2012', year: 2012, tag: 'trust', title: 'NPD opened to third parties', detail: 'Prescribed-persons regulations amended; identifiable extracts flow to researchers, commercial actors, even journalists. defenddigitalme counts 2,385+ distributions 2012–2025.', url: 'https://defenddigitalme.org/2026/04/15/national-pupil-data-distribution-a-2026-review-and-how-to-fix-it/' },
  { date: '2015–18', year: 2015, tag: 'trust', title: 'Home Office MoU', detail: 'Monthly matching of pupil records for immigration enforcement (1,836 records supplied); nationality collected in the census 2016–18 amid the Against Borders for Children boycott, then abandoned and deleted.' },
  { date: 'Feb 2020', year: 2020, tag: 'trust', title: 'ICO audits the DfE', detail: 'Found breaches of data-protection law: no record of processing, “no clear picture of what data is held”, no IG oversight. 139 recommendations, over 60% urgent or high priority. Full report never published.', url: 'https://schoolsweek.co.uk/dfe-broke-pupil-data-protection-laws-damning-ico-audit-reveals/' },
  { date: 'Mar 2022', year: 2022, tag: 'infrastructure', title: '“Opportunity for all” white paper', detail: 'Commits to a national attendance data solution and a children-not-in-school register. The register falls with the axed Schools Bill; attendance survives and becomes the template.' },
  { date: 'May 2022', year: 2022, tag: 'identifier', title: 'MacAlister care review', detail: 'Independent Review of Children’s Social Care recommends a single unique identifier so professionals can build a clearer picture of a child’s life.', url: 'https://www.gov.uk/government/publications/independent-review-of-childrens-social-care-final-report' },
  { date: 'Nov 2022', year: 2022, tag: 'trust', title: 'LRS / Trustopia reprimand', detail: 'ICO reprimands DfE after a screening firm used Learning Records Service access (28m records exposed) for gambling-industry age checks.' },
  { date: 'Sep 2024', year: 2024, tag: 'operational', title: 'Daily attendance feed mandatory', detail: 'Automated daily MIS extraction via Wonde for all state schools — near-real-time national data, school/trust/LA dashboards, no extra burden. The spine’s live proof-of-concept.', url: 'https://www.gov.uk/guidance/share-your-daily-school-attendance-data' },
  { date: 'Apr 2025', year: 2025, tag: 'identifier', title: 'SUI pilots begin (Wigan)', detail: 'Test-and-learn pilots with NHS England and DHSC: NHS-number matching via a PDS-adapter service — get-an-identifier, find-a-record, fetch-a-record. A federated record-locator, not a database.' },
  { date: 'Jun 2025', year: 2025, tag: 'trust', title: 'Data (Use and Access) Act 2025', detail: 'New “recognised legitimate interests” basis (safeguarding included, no balancing test), broad research definition, lighter notice duties — the legal plumbing a spine would run on, and critics’ next battleground.' },
  { date: 'Jan 2026', year: 2026, tag: 'infrastructure', title: 'Bett speech names the spine', detail: 'Phillipson: “a new data spine and open data standards” — fourth of five AI & digital goals.' },
  { date: 'Feb 2026', year: 2026, tag: 'infrastructure', title: 'White paper commitment', detail: '“Every Child Achieving and Thriving” (CP 1508-I) commits to the data spine in one paragraph on p.98. Consultation promised for summer 2026.' },
  { date: 'Apr 2026', year: 2026, tag: 'identifier', title: 'CWSA 2026 Royal Assent', detail: 'Consistent identifier becomes law (ss.16LA–16LD Children Act 2004); compulsory children-not-in-school registers. The Act does not name the NHS number — regulations will.' },
  { date: 'Jun 2026', year: 2026, tag: 'identifier', title: 'HCWS115 implementation statement', detail: 'Wigan pilots confirmed, NHS-number matching, LA dissemination anticipated during 2026, regulations intended by end of Parliament.' },
  { date: 'Summer 2026', year: 2026, tag: 'infrastructure', title: 'Spine consultation (announced)', detail: 'The custody question — connect (locator/federation) vs collect (central store) — is still entirely open. This consultation is where the architecture gets decided.' },
];

export const TAG_META: Record<TimelineTag, { label: string; color: string }> = {
  infrastructure: { label: 'Spine', color: 'var(--accent-ink)' },
  identifier: { label: 'Identifier', color: '#7a5aa6' },
  trust: { label: 'Trust', color: '#8a2d3a' },
  operational: { label: 'Operational', color: '#2f7d4f' },
};
