// jigsawIntel.ts — the information-jigsaw field study: who holds which piece of the
// picture of a child, their purposes and informational challenges, where DfE can help
// and where it can't, the RACI of information jobs, the connective-tissue standards
// layer, and the named gaps. The flipside of the Monitoring study: DfE as ONE node in
// a distributed information system. Research dossier compiled 2026-06-10. Self-contained.

// ---------------------------------------------------------------------------
// 1 · The headline
// ---------------------------------------------------------------------------
export const JIGSAW_HERO = {
  big: '81%',
  label: 'of serious child-safeguarding incidents involved failures of co-ordination or handover between services — including information sharing — across the 330 rapid reviews analysed by the national Child Safeguarding Practice Review Panel (2023–24).',
  labelEli5: 'In four out of five of the most serious cases where children died or were badly harmed, the services around them failed to join up what they each knew.',
  kicker: {
    research: 'The pieces almost always existed. The Panel’s 2024 national review of intra-familial sexual abuse found that in a third of cases the abuser had a KNOWN history of sexual offending — recorded, somewhere, in a system. The jigsaw fails at the joins, not the pieces. And the Panel’s own caution: the new unique identifier “will not, by itself, address the wider systemic and cultural challenges” — plumbing is necessary, not sufficient.',
    eli5: 'The information was nearly always written down somewhere — in a third of the worst sexual-abuse cases, the abuser’s history was already known to a service. The system doesn’t fail because nobody knew; it fails because the people who knew never met.',
  },
};

// ---------------------------------------------------------------------------
// 2 · The map — who holds which piece (the child at the centre; DfE is not)
// ---------------------------------------------------------------------------
export type Ring = 1 | 2 | 3; // 1 = universal sighting · 2 = local statutory · 3 = national

export const RING_META: Record<Ring, { label: string; eli5: string; colour: string }> = {
  1: { label: 'Universal sighting — sees the child', eli5: 'Sees the child every week', colour: '#2f7d4f' },
  2: { label: 'Local statutory — acts on the child’s behalf', eli5: 'Steps in when something’s wrong', colour: '#2f6f97' },
  3: { label: 'National — funds, counts, sets the rules', eli5: 'Westminster and the big databases', colour: '#7a5aa6' },
};

export interface Holder {
  id: string;
  name: string;
  ring: Ring;
  purpose: string;        // why they exist (informationally)
  holds: string;          // the jigsaw piece
  challenge: string;      // their informational problem
  dfeCan: string;         // where DfE could help
  dfeCant: string;        // where DfE can't (or shouldn't)
}

export const HOLDERS: Holder[] = [
  // ---- ring 1: universal sighting ----
  {
    id: 'school', name: 'School & DSL', ring: 1,
    purpose: 'The most frequent sighting of every school-age child; the Designated Safeguarding Lead is the system’s front-line sensor.',
    holds: 'Daily attendance, behaviour, attainment, and the safeguarding log (CPOMS/MyConcern) — the richest running narrative of a child anywhere.',
    challenge: 'The safeguarding file is deliberately EXCLUDED from the Common Transfer File: when a child moves school it follows manually within 5 days, and cross-vendor transfer only works if both schools bought the same product. The richest record breaks at every move.',
    dfeCan: 'Set a cross-vendor safeguarding-record transfer standard — cheap, unowned, high-impact. DfE already specifies the CTF; it has simply never specified this.',
    dfeCant: 'Read or hold the safeguarding log itself — DSL judgement is local by design, and central custody of concern-level records is the ContactPoint road.',
  },
  {
    id: 'gp', name: 'GP', ring: 1,
    purpose: 'The only longitudinal health record that follows the child everywhere.',
    holds: 'The richest individual health history, including safeguarding codes.',
    challenge: 'Sits outside almost every multi-agency flow; GP participation in child-protection conferences is chronically thin; the record is built for clinical care, not for the safeguarding system that needs fragments of it.',
    dfeCan: 'Nothing directly — and that is the point of this page.',
    dfeCant: 'Touch primary-care records. The lever is NHS England’s, via the safeguarding-partner duty and record standards (PRSB).',
  },
  {
    id: 'hv', name: 'Health visiting (0–5)', ring: 1,
    purpose: 'The universal service for the years before school — the last guaranteed sighting before reception.',
    holds: 'Birth data, development reviews — where they happen: median LA coverage of the 2–2.5-year review is 81.5%, and in nearly half of LAs more than a fifth of children have no recorded review at all.',
    challenge: 'A workforce nearly halved since 2015 (11,200 → ~6,300) means the data gap IS a visibility gap: for many children, nobody universal sees them between birth registration and the school gate.',
    dfeCan: 'Consume the signal: link the 2–2.5-year review into reception planning and Best Start family hubs — the early-years half of its own estate.',
    dfeCant: 'Fix the coverage — that is a health-workforce problem owned by DHSC/NHSE.',
  },
  {
    id: 'ey', name: 'Early years settings', ring: 1,
    purpose: 'Daily sighting of funded two-to-four-year-olds.',
    holds: 'Attendance and EYFS development data, in mostly private and voluntary settings with minimal data infrastructure.',
    challenge: 'Thousands of small businesses with no MIS-equivalent estate; Working Together 2026 strengthens their safeguarding role faster than their data capability is growing.',
    dfeCan: 'Extend the standards and tooling it already funds for schools down the age range — the early-years census proves the pipe exists.',
    dfeCant: 'Mandate enterprise-grade systems onto village preschools.',
  },
  // ---- ring 2: local statutory ----
  {
    id: 'lacsc', name: 'LA children’s social care', ring: 2,
    purpose: 'The statutory safety net: referrals, assessment, protection, care.',
    holds: 'The case record — in one of three vendor systems (Liquidlogic >41% of LAs, Mosaic, Eclipse) designed around statutory returns rather than practice; 60% of social workers report weekly disruption from their own case system.',
    challenge: 'Records what Ofsted inspects and DfE collects; the recording burden crowds out the relationships the Panel says actually protect children. Loses sight of care leavers at 18 — there are no official statistics on care-leaver unemployment or homelessness.',
    dfeCan: 'Publish the dashboard and Annex A specs as open standards so sector tools (the D2I pattern) can flourish; keep the “continually reduce burdens” promise in the CSC data strategy.',
    dfeCant: 'Procure or run the case systems — sector ownership of tooling is the one part of this market that works (ChAT, ~150 LAs).',
  },
  {
    id: 'mash', name: 'MASH (the front door)', ring: 2,
    purpose: 'Multi-agency triage where police, social care, health and education pool what they know about a referral.',
    holds: 'The fused picture — briefly, manually. Most LAs run one; there is no statutory model and no national data specification.',
    challenge: 'Information is RE-KEYED between police, health and LA systems by hand; governance and consent practice vary hub by hub. The single place where the consistent identifier and a matching standard would bite hardest — and it has never had either.',
    dfeCan: 'Co-author (with the Home Office and NHSE) the missing MASH data specification, and make the Wigan identifier pilot’s lessons a national matching standard.',
    dfeCant: 'Own it — the front door belongs to the three statutory partners; DfE is not one of them.',
  },
  {
    id: 'police', name: 'Police', ring: 2,
    purpose: 'Statutory safeguarding partner; first responder to the incidents that generate the most urgent information.',
    holds: 'Incident and intelligence records, missing-children reports (the NCA unit logs ~140k+ child missing reports a year), PNC history.',
    challenge: 'Force systems don’t interoperate with LA or health systems — police information enters MASH manually. Yet the police side also produced the system’s best flow: Operation Encompass, the statutory next-morning notification to the DSL after a domestic-abuse callout.',
    dfeCan: 'Generalise the Encompass pattern — push-based, deadline-bound, purpose-narrow flows are the proven template.',
    dfeCant: 'Reach into policing data; that is Home Office and NPCC terrain.',
  },
  {
    id: 'icb', name: 'ICB / CAMHS', ring: 2,
    purpose: 'The third statutory safeguarding partner; commissioner of the children’s health services whose data the system needs.',
    holds: 'Referral and waiting data (949,200 children referred to CAMHS in one year; 39% closed before being seen), designated safeguarding doctors and nurses, community health records.',
    challenge: 'Information fails to flow even WITHIN health (hospital ↔ community ↔ CAMHS ↔ GP) — the Panel’s most common health finding. No routine published CYP waiting standard; a third of referral reasons recorded as “unknown”.',
    dfeCan: 'Make the education side of every joint flow trivially easy (SEND health advice, EHCP timelines — only 46% of decisions hit the 20-week statutory deadline), and keep proving the value of linkage through ECHILD, which DfE co-owns.',
    dfeCant: 'Fix NHS-internal interoperability — that is NHSE/PRSB/FHIR work, decades deep.',
  },
  {
    id: 'housing', name: 'Housing authority', ring: 2,
    purpose: 'Places homeless families — and thereby moves children, often out of borough.',
    holds: 'Temporary-accommodation placements: 42,080 households placed OUTSIDE their home LA (June 2025); 22% of homeless children move school multiple times.',
    challenge: 'No notification flows to the school or GP when a child enters temporary accommodation — the Commons HCLG Committee recommended exactly that; government pointed to the identifier as its answer. The child vanishes administratively at the moment of maximum risk.',
    dfeCan: 'Specify the TA→school notification as an Encompass-pattern flow the moment the identifier lands — a named, buildable join.',
    dfeCant: 'Change placement practice or supply — MHCLG’s problem, and money’s.',
  },
  {
    id: 'yot', name: 'Youth justice (YOT/YJB)', ring: 2,
    purpose: 'Assessment and supervision of children in the justice system.',
    holds: 'AssetPlus — one assessment record that genuinely follows the child through the system (a rarity worth copying), feeding YJB national statistics.',
    challenge: 'Heavy assessment burden; weak joins to education data despite school exclusion being the canonical pathway in.',
    dfeCan: 'Wire exclusion/AP data to YOT flows; the MoJ–DfE research linkage already exists — operationalise its lessons.',
    dfeCant: 'Reform AssetPlus — MoJ/YJB own it.',
  },
  {
    id: 'vcs', name: 'Charities & VCS', ring: 2,
    purpose: 'Food banks, family support, youth work — often the FIRST place hardship shows.',
    holds: 'Early-warning signals no statutory body sees, in no shareable form.',
    challenge: 'Connected to nothing: the only standards bridge is Open Referral UK (service directories), which tells families what exists but carries no signal back.',
    dfeCan: 'Fund the directory standard properly (it underpins its own family hubs) and design referral loops that let VCS signal in without becoming data processors.',
    dfeCant: 'Demand data from civil society — the trust that makes VCS effective is precisely its independence.',
  },
  // ---- ring 3: national ----
  {
    id: 'dfe', name: 'DfE', ring: 3,
    purpose: 'Funds and regulates education; counts the school system; owns the NPD, the daily attendance feed, and (with partners) ECHILD and LEO.',
    holds: 'The deepest LONGITUDINAL records (census → attainment → destinations → earnings) — research-grade, years in arrears. The irony of the ecosystem: DfE can link a child’s hospital record to their GCSEs for research, while the MASH down the road re-keys the same child’s name between three screens.',
    challenge: 'Sees the school system in extraordinary detail and the CHILD’s wider life barely at all; its instruments are built for funding and accountability, not for the safeguarding joins this page maps.',
    dfeCan: 'Be the system’s STEWARD rather than its collector: standards, identifiers, funded sector tooling, Encompass-pattern flow specifications, and the convening power no one else has.',
    dfeCant: 'Hold the whole jigsaw. Every attempt to (ContactPoint) has been dismantled — and the Panel says the failures are cultural as much as technical.',
  },
  {
    id: 'nhse', name: 'NHS England / DHSC', ring: 3,
    purpose: 'Owns the NHS number — the only identifier issued to virtually every child at birth — and the health half of every join.',
    holds: 'Hospital episodes, community health, the Personal Demographics Service the Wigan identifier pilot runs on.',
    challenge: 'Its number is becoming the spine of the children’s system while its own internal flows (the Panel’s finding) remain the weakest link.',
    dfeCan: 'Co-design the identifier rollout so match-rate lessons from Wigan become shared infrastructure, not a health-side asset.',
    dfeCant: 'Govern the NHS number. DfE is a tenant on health’s identifier.',
  },
  {
    id: 'dwp', name: 'DWP & HMRC', ring: 3,
    purpose: 'Hold the household economics: Universal Credit, benefits, Child Benefit (historically the nearest thing to a register of every child).',
    holds: 'The poverty signal — already piped to DfE weekly through the FSM Eligibility Checking Service.',
    challenge: 'The flows are PULL (parents must apply) rather than PUSH (auto-enrolment), so eligible children go unfed and unweighted in funding; Child Benefit’s register-of-children role is decaying as take-up falls.',
    dfeCan: 'Flip FSM to auto-enrolment using the pipe that already exists — the single most concrete welfare-data win available.',
    dfeCant: 'Access household data beyond the gateway purposes — and shouldn’t want to.',
  },
  {
    id: 'cafcass', name: 'MoJ / Cafcass (family courts)', ring: 3,
    purpose: 'Represents children in family proceedings — ~80,000 children entering cases a year, 46,501 on open cases.',
    holds: 'The family-court record: total overlap with the social-care cohort, poorly joined to education or social care data.',
    challenge: 'Court timescales and outcomes are invisible to the schools and services holding the same children day-to-day.',
    dfeCan: 'Research linkage exists (SAIL, MoJ–DfE) — push for an operational notification join at case milestones.',
    dfeCant: 'Touch judicial process or court records directly.',
  },
  {
    id: 'cco', name: 'Children’s Commissioner', ring: 3,
    purpose: 'The only actor with statutory power to demand data from ANY public body (s.2F Children Act 2004).',
    holds: 'Whatever she asks for: the Attendance Audit found LAs “do not have an accurate figure of how many children there are in England”; her school survey is now a census of its own.',
    challenge: 'The power is episodic — each audit is a one-off expedition into gaps that should be standing statistics.',
    dfeCan: 'Treat her audits as a requirements list: each one names a join the standing system should make routine.',
    dfeCant: 'Direct her — independence is the asset.',
  },
  {
    id: 'ofsted', name: 'Ofsted', ring: 3,
    purpose: 'Inspects the institutions; its data demands shape what LAs and schools record.',
    holds: 'Inspection evidence, the Annex A child-level specification, and the unregistered-settings caseload (284 unregistered-school investigations in 2024/25; ~900 suspected unregistered children’s homes in a year).',
    challenge: 'Has flagged “invisible children” in SEVEN consecutive annual reports — the regulator can see the gap but holds no lever to close it.',
    dfeCan: 'Align its collections with inspection demands so the same data serves both (the ChAT model proved it works).',
    dfeCant: 'Set inspection frameworks — and shouldn’t blur the regulator’s independence.',
  },
];

// ---------------------------------------------------------------------------
// 3 · The RACI — information jobs × the system
// ---------------------------------------------------------------------------
export type RaciVal = 'R' | 'A' | 'C' | 'I' | '';

export interface RaciRow {
  job: string;
  eli5: string;
  cells: Record<string, RaciVal>;   // keyed by RACI_COLS ids
  gap?: string;                     // the honest annotation (esp. where A is missing)
}

export const RACI_COLS: { id: string; label: string }[] = [
  { id: 'school', label: 'School / trust' },
  { id: 'la', label: 'Local authority' },
  { id: 'police', label: 'Police' },
  { id: 'health', label: 'Health (ICB/NHS)' },
  { id: 'partnership', label: 'Safeguarding partnership / MASH' },
  { id: 'dfe', label: 'DfE' },
  { id: 'standards', label: 'Standards bodies' },
  { id: 'cco', label: 'Children’s Commissioner' },
];

export const RACI: RaciRow[] = [
  {
    job: 'Know every child exists', eli5: 'Keep a complete list of children',
    cells: { school: 'R', la: 'R', police: '', health: 'R', partnership: '', dfe: 'C', standards: '', cco: 'I' },
    gap: 'NO ACCOUNTABLE OWNER. Birth registration, Child Benefit, GP lists and the school census each cover most children; nobody is accountable for the whole. The Attendance Audit: LAs “do not have an accurate figure of how many children there are in England”. The CWS Act registers narrow this for the not-in-school slice only.',
  },
  {
    job: 'Spot a child at risk early', eli5: 'Notice the warning signs in time',
    cells: { school: 'R', la: 'A', police: 'R', health: 'R', partnership: 'R', dfe: 'I', standards: 'C', cco: 'I' },
    gap: 'Accountability is clear (the LA with its partners); the information job fails anyway — 81% of serious incidents involve co-ordination or handover failure.',
  },
  {
    job: 'Fuse what agencies know at the front door', eli5: 'Put the pieces together when someone raises the alarm',
    cells: { school: 'C', la: 'A', police: 'R', health: 'R', partnership: 'R', dfe: '', standards: '', cco: '' },
    gap: 'The MASH does this by hand: no national data specification, no shared system, information re-keyed between screens. The identifier helps; a spec is still missing.',
  },
  {
    job: 'Move the record when the child moves', eli5: 'Make the file follow the child',
    cells: { school: 'R', la: 'C', police: '', health: 'C', partnership: '', dfe: 'C', standards: 'C', cco: '' },
    gap: 'NO ACCOUNTABLE OWNER. Safeguarding files are excluded from the Common Transfer File; cross-vendor transfer doesn’t exist; housing moves trigger no notification at all. The clearest cheap fix on this page.',
  },
  {
    job: 'Tell school what happened last night', eli5: 'Warn the teacher before the child walks in',
    cells: { school: 'I', la: '', police: 'A', health: '', partnership: 'C', dfe: '', standards: '', cco: '' },
    gap: 'SOLVED — for one signal. Operation Encompass (statutory since 2024) is the template: push-based, deadline-bound, purpose-narrow. A&E attendances and TA placements have no equivalent.',
  },
  {
    job: 'Resolve “is this the same child?”', eli5: 'Tell that two records mean one child',
    cells: { school: 'R', la: 'R', police: 'R', health: 'A', partnership: 'R', dfe: 'C', standards: 'C', cco: 'I' },
    gap: 'Becoming health’s job by default: the NHS number is the chosen identifier (CWS Act; Wigan pilot). Education and social care systems historically don’t hold it — match rates are the open question.',
  },
  {
    job: 'Find the invisible children', eli5: 'Find the children no service can see',
    cells: { school: 'I', la: 'A', police: 'I', health: 'I', partnership: 'C', dfe: 'C', standards: '', cco: 'R' },
    gap: 'The LA duty is new (CWS Act registers) and only covers not-in-school; kinship care (~132,800 children, visible only in the census), unregistered settings and the under-5s coverage gap remain dark. The Commissioner’s episodic audits are the de-facto search party.',
  },
  {
    job: 'Identify and reach children in an emergency', eli5: 'Find every child fast when disaster strikes',
    cells: { school: 'R', la: 'R', police: 'R', health: 'R', partnership: 'C', dfe: 'I', standards: 'C', cco: '' },
    gap: 'NO STANDING CAPABILITY. Manchester Arena: the casualty bureau failed for 4.5 hours while families searched hospitals for children. COVID: vulnerable-children lists assembled ad hoc — the scramble SAVVI’s standards exist to prevent, on £190k of grant funding.',
  },
  {
    job: 'Set the standards for all of the above', eli5: 'Write the common rules so systems can talk',
    cells: { school: '', la: 'C', police: '', health: 'R', partnership: '', dfe: 'R', standards: 'R', cco: '' },
    gap: 'NO ACCOUNTABLE OWNER. Health has the PRSB; education/social care records have nobody. iStandUK is a programme accountable to one metropolitan borough council; SAVVI and Open Referral UK live grant to grant. The connective tissue of the children’s information system is funded like a parish newsletter.',
  },
  {
    job: 'Count the system and its outcomes', eli5: 'Keep the national score',
    cells: { school: 'R', la: 'R', police: 'I', health: 'R', partnership: 'I', dfe: 'A', standards: 'C', cco: 'I' },
    gap: 'The one job DfE unambiguously owns — and does at research grade (NPD, LEO, ECHILD). The gap is cadence and reach, not accountability (see the Monitoring study).',
  },
];

// ---------------------------------------------------------------------------
// 4 · The connective tissue — and the graveyard
// ---------------------------------------------------------------------------
export interface Tissue {
  name: string;
  status: string;
  what: string;
  fragility: string;
  url: string;
  colour: string;
}

export const TISSUE: Tissue[] = [
  {
    name: 'iStandUK', status: 'Programme, accountable body: Tameside MBC', colour: '#2f6f97',
    what: 'The local public services data-standards body (successor to LeGSB): data, API and information-governance standards for councils — the closest thing the local system has to a standards institution.',
    fragility: 'Not statutory, no enforcement power, hosted by one borough council. The keystone of the arch is a side-project.',
    url: 'https://istanduk.org/who-we-are/',
  },
  {
    name: 'SAVVI', status: '£190k MHCLG grant (Phase 4, Dec 2024)', colour: '#3f7d6e',
    what: 'Scalable Approach to Vulnerability Via Interoperability — the playbook and data standards for finding and supporting vulnerable people across organisations, born directly from the COVID shielding-list chaos. 2026 pilots with Greater Manchester and BCP; GDS now partnering.',
    fragility: 'Exactly the standard a “find the vulnerable children” capability needs — funded pilot to pilot, adoption voluntary.',
    url: 'https://istanduk.org/2024/12/19/a-new-phase-for-savvi/',
  },
  {
    name: 'Open Referral UK', status: 'CDDO-endorsed open standard (2022)', colour: '#9a7b1f',
    what: 'The service-directory standard — how family hubs and Family Information Services describe what help exists, machine-readably.',
    fragility: 'Underpins DfE’s own family-hub ambitions; maintained by a tiny community, endorsed but not required.',
    url: 'https://openreferraluk.org/',
  },
  {
    name: 'PRSB', status: 'NHS-funded professional standards body (est. 2013)', colour: '#7a5aa6',
    what: 'Clinically-assured record standards including the Healthy Child Record (the digital red book), aligned to HL7 FHIR — proof that a record-standards institution for children CAN exist.',
    fragility: 'Health-only. Child education and social-care records have no equivalent body — the asymmetry this act exists to name.',
    url: 'https://theprsb.org/standards/healthychildrecordstandard/',
  },
  {
    name: 'Data to Insight + ChAT', status: 'Sector-led, LA-hosted, ~150 LAs', colour: '#b4632e',
    what: 'The children’s-services analyst collective: shared tools, return validators, the Ofsted-ready ChAT analysis — the proof that centre-funds-sector-owns works (see Monitoring, act 7).',
    fragility: 'Funded “where goals align with government” — sustained goodwill, not settlement.',
    url: 'https://www.datatoinsight.org/what-we-do',
  },
];

export const GRAVEYARD = {
  title: 'The graveyard — institutional amnesia, documented',
  research: 'ContactPoint — the post-Climbié national index of every child — was switched off in 2010 on civil-liberties grounds. The Centre of Excellence for Information Sharing — ~17 staff working on exactly the cultural barriers the Panel still finds — was closed in 2018, leaving a legacy website. Each generation builds the information-sharing machinery, dismantles it, and then commissions a review into why information wasn’t shared. The 81% is what the amnesia costs.',
  eli5: 'Britain has built this twice before: a national child index (scrapped 2010) and a whole unit dedicated to helping services share information (closed 2018). We keep deleting the answer and then holding inquiries into the question.',
};

// ---------------------------------------------------------------------------
// 5 · The named gaps
// ---------------------------------------------------------------------------
export const JIGSAW_GAPS: { gap: string; detail: string; eli5: string }[] = [
  {
    gap: 'The invisible children',
    detail: '126,000 home-educated and 34,700 missing education on one census day; ~132,800 kinship-care children visible only in the census; rising unregistered-settings caseloads; under-5s unseen where health visiting has collapsed. Ofsted has flagged “invisible children” in seven consecutive annual reports.',
    eli5: 'Hundreds of thousands of children are known to no service at all — and the schools inspector has warned about it seven years running.',
  },
  {
    gap: 'The record breaks at every move',
    detail: 'School moves (safeguarding files outside the CTF, no cross-vendor standard), housing moves (no TA→school notification), service moves (children’s→adults’ at 18, care leavers untracked). Mobility is the system’s blind spot — and the most at-risk children move most.',
    eli5: 'Every time a child moves — school, house, or into adulthood — their story gets left behind. The children in most danger move the most.',
  },
  {
    gap: 'The consent myth is now provably cultural',
    detail: 'The ICO has said it plainly (“you do not need consent to share a child’s data for safeguarding”), DfE’s 2024 practitioner advice says it, and the CWS Act now puts the duty in statute — yet the Panel’s 2024 review still found practitioners not understanding it. Three layers of permission have not fixed a confidence problem.',
    eli5: 'Workers still wrongly believe they need permission to share worries about a child. The law has now said “you don’t” three times — the fear persists anyway.',
  },
  {
    gap: 'Research-grade linkage, operational-grade chaos',
    detail: 'ECHILD links 20 million children’s education and hospital records with 99% match rates — for research, years in arrears. The MASH re-keys the same child between three screens, today. The capability gap between DfE’s research estate and the frontline is the central irony of the ecosystem.',
    eli5: 'For researchers, the government can perfectly match a child’s school and hospital records. For the team deciding tonight whether that child is safe, someone retypes names between systems.',
  },
  {
    gap: 'The standards layer is funded like a parish newsletter',
    detail: 'iStandUK is accountable to one borough council; SAVVI runs on a £190k grant; Open Referral UK is volunteer-maintained. Health funds the PRSB properly; nothing equivalent exists for education or children’s social care records.',
    eli5: 'The common rules that would let all these systems talk are kept alive by a handful of people on tiny grants — while the NHS funds its version properly.',
  },
];

// ---------------------------------------------------------------------------
// 6 · The value offer — if DfE changed its support posture
// ---------------------------------------------------------------------------
export const VALUE_OFFER: { move: string; what: string; cost: string }[] = [
  { move: 'Set the missing standards', what: 'A cross-vendor safeguarding-record transfer standard; the MASH data specification (with Home Office/NHSE); record standards for education and social care to match the PRSB. DfE already runs standards.education.gov.uk — point it outward.', cost: 'Small — it is specification work, and the CTF precedent shows DfE can do it.' },
  { move: 'Generalise the Encompass pattern', what: 'Push-based, deadline-bound, purpose-narrow flows for the named joins: temporary accommodation → school, A&E attendance → DSL (the Cardiff Model shows the safe form), court milestones → social care. Each is one flow, not a database.', cost: 'Per-flow specification + the identifier the CWS Act already provides.' },
  { move: 'Fund the connective tissue properly', what: 'iStandUK, SAVVI, Open Referral UK and the D2I pattern collectively cost less than one national IT procurement. Endow the standards layer the way health endows the PRSB.', cost: 'Single-digit £m/yr — the cheapest line on any DfE budget with system-wide reach.' },
  { move: 'Close the research/operational gap', what: 'Let ECHILD-grade matching inform frontline systems: the Wigan pilot’s match-rate lessons become a national matching service the MASH can call — identity resolution as infrastructure, not heroics.', cost: 'The hard one — but the linkage capability already exists in-house.' },
  { move: 'Flip the welfare pipes to push', what: 'FSM auto-enrolment through the DWP/HMRC eligibility pipe that already runs weekly — the most concrete single win for both children and the accuracy of DfE’s own disadvantage data.', cost: 'Policy decision, not technology.' },
];

export const VALUE_DONTS = {
  research: 'And the three don’ts the history teaches: don’t build the central child database (ContactPoint was dismantled for good reasons, and the Panel itself says the identifier won’t fix culture); don’t add collections without retiring others (the RAAC questionnaire-under-duress is the symptom of registry-by-crisis); and don’t nationalise the sector’s tooling — fund it, standardise it, and leave it owned by the people who use it. The value offer, in one sentence: DfE stops being the system’s biggest collector and becomes its standards body, its identity infrastructure, and its convenor — the steward of joins it never holds.',
  eli5: 'Three things NOT to do: don’t rebuild the giant national child database (it was scrapped for good reasons), don’t pile on new data demands without removing old ones, and don’t take over the tools councils built for themselves. The offer in one line: the department stops hoarding pieces and starts making the jigsaw fit together.',
};
