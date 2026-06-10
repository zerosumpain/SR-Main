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
    research: 'The pieces almost always existed. The Panel’s 2024 national review of intra-familial sexual abuse found that in a third of cases the abuser had a KNOWN history of sexual offending — recorded, somewhere, in a system. The jigsaw fails at the joins, not the pieces. And the sector’s own caution — the RCPCH, in backing the NHS number as the new child identifier, warned that the identifier alone is insufficient without “national and cross-sector agreement on what, when and how information is shared”. Plumbing is necessary, not sufficient. (The Panel’s exact wording, para 3.85: “lack of co-ordination or handover between services featured in 81% of incidents”, with information-sharing failures a named component — and in 14% of those incidents, GOOD practice was also found. The figure measures joins, not villains.)',
    eli5: 'The information was nearly always written down somewhere — in a third of the worst sexual-abuse cases, the abuser’s history was already known to a service. The system doesn’t fail because nobody knew; it fails because the people who knew never met. Even the doctors who support the new child ID number say the number alone won’t fix that.',
  },
  refs: [
    { label: 'CSPRP Annual Report 2023–24, para 3.85', url: 'https://assets.publishing.service.gov.uk/media/67c97b1dd0fba2f1334cf300/Child_Safeguarding_Practice_Review_Panel_annual_report_2023_to_2024.pdf' },
    { label: '“I wanted them all to notice” (2024)', url: 'https://assets.publishing.service.gov.uk/media/67446a8a81f809b32c8568d3/CSPRP_-_I_wanted_them_all_to_notice.pdf' },
    { label: 'RCPCH — NHS number as the identifier', url: 'https://www.rcpch.ac.uk/resources/nhs-number-single-unique-identifier-children-position-statement' },
  ],
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

export interface Ref { label: string; url: string }

export interface Holder {
  id: string;
  name: string;
  ring: Ring;
  purpose: string;        // why they exist (informationally)
  holds: string;          // the jigsaw piece
  challenge: string;      // their informational problem
  dfeCan: string;         // where DfE could help
  dfeCant: string;        // where DfE can't (or shouldn't)
  refs?: Ref[];           // citations for the load-bearing facts above
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
    refs: [{ label: 'KCSIE — the CP file & the 5-day duty', url: 'https://www.gov.uk/government/publications/keeping-children-safe-in-education--2' }, { label: 'CTF 25 technical specification (DfE)', url: 'https://assets.publishing.service.gov.uk/media/6914b1eddb01ecfcf96fc880/CTF_25_technical_specification_v1.1.pdf' }],
  },
  {
    id: 'gp', name: 'GP', ring: 1,
    purpose: 'The only longitudinal health record that follows the child everywhere.',
    holds: 'The richest individual health history, including safeguarding codes.',
    challenge: 'Sits outside almost every multi-agency flow; GP participation in child-protection conferences is chronically thin; the record is built for clinical care, not for the safeguarding system that needs fragments of it.',
    dfeCan: 'Nothing directly — and that is the point of this page.',
    dfeCant: 'Touch primary-care records. The lever is NHS England’s, via the safeguarding-partner duty and record standards (PRSB).',
    refs: [{ label: 'PRSB record standards', url: 'https://theprsb.org/standards/healthychildrecordstandard/' }],
  },
  {
    id: 'hv', name: 'Health visiting (0–5)', ring: 1,
    purpose: 'The universal service for the years before school — the last guaranteed sighting before reception.',
    holds: 'Birth data, development reviews — where they happen: median LA coverage of the 2–2.5-year review is 81.5%, and in nearly half of LAs more than a fifth of children have no recorded review at all.',
    challenge: 'A workforce nearly halved since 2015 (11,200 → ~6,300) means the data gap IS a visibility gap: for many children, nobody universal sees them between birth registration and the school gate.',
    dfeCan: 'Consume the signal: link the 2–2.5-year review into reception planning and Best Start family hubs — the early-years half of its own estate.',
    dfeCant: 'Fix the coverage — that is a health-workforce problem owned by DHSC/NHSE.',
    refs: [{ label: 'UCL — health-visitor workforce & review coverage', url: 'https://www.ucl.ac.uk/news/2026/mar/number-health-visitors-england-falls-fifth-over-five-years' }],
  },
  {
    id: 'ey', name: 'Early years settings', ring: 1,
    purpose: 'Daily sighting of funded two-to-four-year-olds.',
    holds: 'Attendance and EYFS development data, in mostly private and voluntary settings with minimal data infrastructure.',
    challenge: 'Thousands of small businesses with no MIS-equivalent estate; Working Together 2026 strengthens their safeguarding role faster than their data capability is growing.',
    dfeCan: 'Extend the standards and tooling it already funds for schools down the age range — the early-years census proves the pipe exists.',
    dfeCant: 'Mandate enterprise-grade systems onto village preschools.',
    refs: [{ label: 'Working Together to Safeguard Children 2026', url: 'https://assets.publishing.service.gov.uk/media/69c2c4ce380a2a73a7cf9df4/Working_together_to_safeguard_children_2026.pdf' }],
  },
  // ---- ring 2: local statutory ----
  {
    id: 'lacsc', name: 'LA children’s social care', ring: 2,
    purpose: 'The statutory safety net: referrals, assessment, protection, care.',
    holds: 'The case record — in one of three vendor systems (Liquidlogic >41% of LAs, Mosaic, Eclipse) designed around statutory returns rather than practice; 60% of social workers report weekly disruption from their own case system.',
    challenge: 'Records what Ofsted inspects and DfE collects; the recording burden crowds out the relationships the Panel says actually protect children. Loses sight of care leavers at 18 — there are no official statistics on care-leaver unemployment or homelessness.',
    dfeCan: 'Publish the dashboard and Annex A specs as open standards so sector tools (the D2I pattern) can flourish; keep the “continually reduce burdens” promise in the CSC data strategy.',
    dfeCant: 'Procure or run the case systems — sector ownership of tooling is the one part of this market that works (ChAT, ~150 LAs).',
    refs: [{ label: 'Rees Centre — ChAT in ~150 LAs', url: 'https://www.education.ox.ac.uk/rees-centre/news/using-data-tools-in-local-authority-childrens-services/' }, { label: 'CSC National Framework (DfE, 2023)', url: 'https://assets.publishing.service.gov.uk/media/657c538495bf650010719097/Children_s_Social_Care_National_Framework__December_2023.pdf' }],
  },
  {
    id: 'mash', name: 'MASH (the front door)', ring: 2,
    purpose: 'Multi-agency triage where police, social care, health and education pool what they know about a referral.',
    holds: 'The fused picture — briefly, manually. Most LAs run one; there is no statutory model and no national data specification.',
    challenge: 'Information is RE-KEYED between police, health and LA systems by hand; governance and consent practice vary hub by hub. The single place where the consistent identifier and a matching standard would bite hardest — and it has never had either.',
    dfeCan: 'Co-author (with the Home Office and NHSE) the missing MASH data specification, and make the Wigan identifier pilot’s lessons a national matching standard.',
    dfeCant: 'Own it — the front door belongs to the three statutory partners; DfE is not one of them.',
    refs: [{ label: 'DfE — using a consistent identifier', url: 'https://www.gov.uk/government/publications/using-a-consistent-identifier-education-and-childrens-services' }],
  },
  {
    id: 'police', name: 'Police', ring: 2,
    purpose: 'Statutory safeguarding partner; first responder to the incidents that generate the most urgent information.',
    holds: 'Incident and intelligence records, missing-children reports (the NCA unit logs ~140k+ child missing reports a year), PNC history.',
    challenge: 'Force systems don’t interoperate with LA or health systems — police information enters MASH manually. Yet the police side also produced the system’s best flow: Operation Encompass, the next-morning notification to the DSL after a domestic-abuse callout (~2,000 notifications a day; a statutory duty on all 43 forces since November 2025).',
    dfeCan: 'Generalise the Encompass pattern — push-based, deadline-bound, purpose-narrow flows are the proven template.',
    dfeCant: 'Reach into policing data; that is Home Office and NPCC terrain.',
    refs: [{ label: 'Encompass statutory guidance (Home Office)', url: 'https://www.gov.uk/government/publications/information-sharing-duty-operation-encompass/duty-on-police-forces-in-england-and-wales-to-notify-education-establishments-of-domestic-abuse-incidents-operation-encompass-accessible' }, { label: 'Commencement SI 2025/1168', url: 'https://www.legislation.gov.uk/uksi/2025/1168/regulation/2/made' }, { label: 'Operation Encompass evidence to Parliament', url: 'https://bills.parliament.uk/publications/58799/documents/5942' }],
  },
  {
    id: 'icb', name: 'ICB / CAMHS', ring: 2,
    purpose: 'The third statutory safeguarding partner; commissioner of the children’s health services whose data the system needs.',
    holds: 'Referral and waiting data (949,200 children referred to CAMHS in one year; 39% closed before being seen), designated safeguarding doctors and nurses, community health records.',
    challenge: 'Information fails to flow even WITHIN health (hospital ↔ community ↔ CAMHS ↔ GP) — the Panel’s most common health finding. No routine published CYP waiting standard; a third of referral reasons recorded as “unknown”.',
    dfeCan: 'Make the education side of every joint flow trivially easy (SEND health advice, EHCP timelines — only 46% of decisions hit the 20-week statutory deadline), and keep proving the value of linkage through ECHILD, which DfE co-owns.',
    dfeCant: 'Fix NHS-internal interoperability — that is NHSE/PRSB/FHIR work, decades deep.',
    refs: [{ label: 'CP-IS — the live NHS safeguarding exchange', url: 'https://digital.nhs.uk/services/child-protection-information-sharing-project' }],
  },
  {
    id: 'housing', name: 'Housing authority', ring: 2,
    purpose: 'Places homeless families — and thereby moves children, often out of borough.',
    holds: 'Temporary-accommodation placements: 42,080 households placed OUTSIDE their home LA (June 2025); 22% of homeless children move school multiple times.',
    challenge: 'No notification flows to the school or GP when a child enters temporary accommodation — the Commons HCLG Committee recommended exactly that; government pointed to the identifier as its answer. The child vanishes administratively at the moment of maximum risk.',
    dfeCan: 'Specify the TA→school notification as an Encompass-pattern flow the moment the identifier lands — a named, buildable join.',
    dfeCant: 'Change placement practice or supply — MHCLG’s problem, and money’s.',
    refs: [{ label: 'HCLG Committee — England\u2019s homeless children', url: 'https://publications.parliament.uk/pa/cm5901/cmselect/cmcomloc/338/report.html' }],
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
    refs: [{ label: 'Open Referral UK', url: 'https://openreferraluk.org/' }],
  },
  // ---- ring 3: national ----
  {
    id: 'dfe', name: 'DfE', ring: 3,
    purpose: 'Funds and regulates education; counts the school system; owns the NPD, the daily attendance feed, and (with partners) ECHILD and LEO.',
    holds: 'The deepest LONGITUDINAL records (census → attainment → destinations → earnings) — research-grade, years in arrears. The irony of the ecosystem: DfE can link a child’s hospital record to their GCSEs for research, while the MASH down the road re-keys the same child’s name between three screens.',
    challenge: 'Sees the school system in extraordinary detail and the CHILD’s wider life barely at all; its instruments are built for funding and accountability, not for the safeguarding joins this page maps.',
    dfeCan: 'Be the system’s STEWARD rather than its collector: standards, identifiers, funded sector tooling, Encompass-pattern flow specifications, and the convening power no one else has.',
    dfeCant: 'Hold the whole jigsaw. Every attempt to (ContactPoint) has been dismantled — and the Panel says the failures are cultural as much as technical.',
    refs: [{ label: 'ADR UK — ECHILD flagship dataset', url: 'https://www.adruk.org/data-access/flagship-datasets/education-and-child-health-insights-from-linked-data-england/' }],
  },
  {
    id: 'nhse', name: 'NHS England / DHSC', ring: 3,
    purpose: 'Owns the NHS number — the only identifier issued to virtually every child at birth — and the health half of every join.',
    holds: 'Hospital episodes, community health, the Personal Demographics Service the Wigan identifier pilot runs on.',
    challenge: 'Its number is becoming the spine of the children’s system while its own internal flows (the Panel’s finding) remain the weakest link.',
    dfeCan: 'Co-design the identifier rollout so match-rate lessons from Wigan become shared infrastructure, not a health-side asset.',
    dfeCant: 'Govern the NHS number. DfE is a tenant on health’s identifier.',
    refs: [{ label: 'RCPCH — NHS number position statement', url: 'https://www.rcpch.ac.uk/resources/nhs-number-single-unique-identifier-children-position-statement' }, { label: 'Digital Child Health FHIR standard', url: 'https://digital.nhs.uk/developer/api-catalogue/digital-child-health-fhir' }],
  },
  {
    id: 'dwp', name: 'DWP & HMRC', ring: 3,
    purpose: 'Hold the household economics: Universal Credit, benefits, Child Benefit (historically the nearest thing to a register of every child).',
    holds: 'The poverty signal — already piped to DfE weekly through the FSM Eligibility Checking Service.',
    challenge: 'The flows are PULL (parents must apply) rather than PUSH (auto-enrolment): ~11% of FSM-eligible children — roughly 215,000 — are unregistered, unfed and unweighted in funding. Child Benefit’s register-of-children role is decaying as take-up falls.',
    dfeCan: 'Flip FSM to auto-enrolment using the pipe that already exists — the single most concrete welfare-data win available.',
    dfeCant: 'Access household data beyond the gateway purposes — and shouldn’t want to.',
    refs: [{ label: 'Commons Library CBP-10206 — FSM auto-registration', url: 'https://commonslibrary.parliament.uk/research-briefings/cbp-10206/' }],
  },
  {
    id: 'cafcass', name: 'MoJ / Cafcass (family courts)', ring: 3,
    purpose: 'Represents children in family proceedings — ~80,000 children entering cases a year, 46,501 on open cases.',
    holds: 'The family-court record: total overlap with the social-care cohort, poorly joined to education or social care data.',
    challenge: 'Court timescales and outcomes are invisible to the schools and services holding the same children day-to-day.',
    dfeCan: 'Research linkage exists (SAIL, MoJ–DfE) — push for an operational notification join at case milestones.',
    dfeCant: 'Touch judicial process or court records directly.',
    refs: [{ label: 'Cafcass — our data', url: 'https://www.cafcass.gov.uk/about-us/our-data' }],
  },
  {
    id: 'cco', name: 'Children’s Commissioner', ring: 3,
    purpose: 'The only actor with statutory power to demand data from ANY public body (s.2F Children Act 2004).',
    holds: 'Whatever she asks for: the Attendance Audit found LAs “do not have an accurate figure of how many children there are in England”; her school survey is now a census of its own.',
    challenge: 'The power is episodic — each audit is a one-off expedition into gaps that should be standing statistics.',
    dfeCan: 'Treat her audits as a requirements list: each one names a join the standing system should make routine.',
    dfeCant: 'Direct her — independence is the asset.',
    refs: [{ label: 'The Attendance Audit', url: 'https://www.childrenscommissioner.gov.uk/resource/where-are-englands-children-interim-findings-from-the-childrens-commissioners-attendance-audit/' }],
  },
  {
    id: 'ofsted', name: 'Ofsted', ring: 3,
    purpose: 'Inspects the institutions; its data demands shape what LAs and schools record.',
    holds: 'Inspection evidence, the Annex A child-level specification, and the unregistered-settings caseload (284 unregistered-school investigations in 2024/25; ~900 suspected unregistered children’s homes in a year).',
    challenge: 'Has flagged “invisible children” in SEVEN consecutive annual reports — the regulator can see the gap but holds no lever to close it.',
    dfeCan: 'Align its collections with inspection demands so the same data serves both (the ChAT model proved it works).',
    dfeCant: 'Set inspection frameworks — and shouldn’t blur the regulator’s independence.',
    refs: [{ label: 'ILACS framework — Annex A', url: 'https://www.gov.uk/government/publications/inspecting-local-authority-childrens-services-from-2018' }],
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
    gap: 'SOLVED — for one signal. Operation Encompass (a statutory duty on all 43 forces since November 2025; ~2,000 notifications a day) is the template: push-based, deadline-bound, purpose-narrow. A&E attendances and TA placements have no equivalent.',
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
export type TissueKind = 'standards' | 'pipes' | 'sector' | 'research';

export const TISSUE_KIND_META: Record<TissueKind, { label: string; eli5: string }> = {
  standards: { label: 'Who writes the common rules', eli5: 'The rule-writers' },
  pipes:     { label: 'Live pipes & working tools', eli5: 'Things that already move information' },
  sector:    { label: 'The sector organising itself', eli5: 'Councils helping each other' },
  research:  { label: 'The evidence layer', eli5: 'The people who check what works' },
};

export interface Tissue {
  name: string;
  kind: TissueKind;
  status: string;
  what: string;
  fragility: string;
  url: string;
  colour: string;
}

export const TISSUE: Tissue[] = [
  // ---- who writes the common rules ----
  {
    name: 'iStandUK', kind: 'standards', status: 'Accountable body: Tameside MBC', colour: '#2f6f97',
    what: 'The local public-services data-standards body (part of the iNetwork family): data, API and information-governance standards for councils. Its steering board spans LAs, Whitehall departments, the LGA, Socitm, the ICO and industry — the closest thing the local system has to a standards institution.',
    fragility: 'Not statutory, no enforcement power, chaired part-time by serving council officers, hosted by one metropolitan borough. The keystone of the arch is a side-project.',
    url: 'https://istanduk.org/about-us/',
  },
  {
    name: 'SAVVI', kind: 'standards', status: '£190k MHCLG grant · phase 4', colour: '#3f7d6e',
    what: 'Scalable Approach to Vulnerability Via Interoperability — a vulnerability data catalogue, a define→find→assess→act process model, and API standards for lawfully assembling multi-source “find the vulnerable” datasets. Born of the COVID shielding scramble; run by iStandUK; March 2026 MHCLG pilot with Greater Manchester CA and BCP Council; a techUK supplier working group.',
    fragility: 'Exactly the standard a “find the vulnerable children” capability needs — funded in ~£190k rounds, adoption voluntary, lives or dies on MHCLG renewal.',
    url: 'https://mhclgdigital.blog.gov.uk/2026/03/11/new-pilot-to-help-councils-identify-and-support-residents-at-risk-to-vulnerability-earlier/',
  },
  {
    name: 'Open Referral UK', kind: 'standards', status: 'DSA-endorsed open standard (2022)', colour: '#9a7b1f',
    what: 'The service-directory standard — how family hubs, Family Information Services and SEND local offers describe what help exists, machine-readably. Defined by four councils through MHCLG’s Open Community project (~£250k beta), then ~£600k behind adoption; the only government-endorsed local-services data standard.',
    fragility: 'Underpins DfE’s own family-hub ambitions; maintained by a tiny community, endorsed but never required.',
    url: 'https://openreferraluk.org/',
  },
  {
    name: 'PRSB', kind: 'standards', status: 'Royal-college-owned, NHSE-funded', colour: '#7a5aa6',
    what: 'The Professional Record Standards Body defines what goes INSIDE health and care records: the Healthy Child Record standard (the digital red book), the Digital Child Health event definitions, and the About Me standard for person-held “what matters to me” information — the child-voice layer, standardised.',
    fragility: 'Health-only. Child education and social-care records have no equivalent body — the asymmetry this act exists to name.',
    url: 'https://theprsb.org/standards/healthychildrecordstandard/',
  },
  {
    name: 'NHS interoperability (FHIR UK Core)', kind: 'standards', status: 'NHS England technical standards', colour: '#7a5aa6',
    what: 'The technical half of health’s standards stack: FHIR UK Core for all new NHS interoperability, and the Digital Child Health standard — birth notifications, immunisations, screening and health-visiting events published nationally so child-health systems stay in sync. The pattern education has never built.',
    fragility: 'Decades deep and properly governed — but health-side only, and the Panel still finds health’s internal flows the weakest link.',
    url: 'https://digital.nhs.uk/developer/api-catalogue/digital-child-health-fhir',
  },
  {
    name: 'DEA 2017 & the Data Standards Authority', kind: 'standards', status: 'Central government plumbing', colour: '#5a5a7a',
    what: 'The legal and standards plumbing of the centre: Digital Economy Act 2017 Part 5 gateways (public-service delivery, research, statistics) under which ECHILD-style access operates, and the Data Standards Authority function (now in DSIT) that endorsed Open Referral UK.',
    fragility: 'The ICO’s 2023 review found the public-service-delivery powers nearly unused — only ONE new data-sharing objective ever progressed. The gateway exists; almost nobody walks through it.',
    url: 'https://ico.org.uk/media2/migrated/4024606/ico-review-dea-20230314.pdf',
  },
  // ---- live pipes & working tools ----
  {
    name: 'CP-IS', kind: 'pipes', status: 'Live NHS England service', colour: '#2f7d4f',
    what: 'Child Protection – Information Sharing: the live national exchange that flags children on child-protection plans or in care to unscheduled care (A&E, walk-in centres) — and tells the LA when such a child attends. The only operational national safeguarding data exchange between councils and the NHS.',
    fragility: 'Proof the operational join CAN be built nationally — but it covers one narrow flow, and the Panel’s 2022 review cited it as the success to BUILD ON, not the finished job.',
    url: 'https://digital.nhs.uk/services/child-protection-information-sharing-project',
  },
  {
    name: 'NCER / Nexus', kind: 'pipes', status: 'Consortium of 150+ LAs', colour: '#b4632e',
    what: 'The quiet giant: a community-interest consortium owned by essentially every English LA, running Nexus (with Angel Solutions) — analysis of all statutory assessment data EYFSP→KS5 plus vulnerable-group reporting, delivering national benchmarks months before DfE publishes, and Perspective Lite for school↔LA data exchange.',
    fragility: 'Structurally the strongest body on this card wall — member-owned, subscription-funded — and almost invisible in policy debates about the very pipes it runs.',
    url: 'https://www.ncer.org/PublicResources/Nexus.aspx',
  },
  {
    name: 'FFT / Education Datalab', kind: 'pipes', status: 'Non-profit · 15,000+ schools · ~90 staff', colour: '#b4632e',
    what: 'FFT Aspire’s target-setting and pupil tracking run much of the school system’s self-evaluation, built on statistical models over national administrative data; Education Datalab is its independent research arm, widely cited in policy.',
    fragility: 'Private but systemic: a large share of how schools understand their own data flows through one non-profit’s models.',
    url: 'https://ffteducationdatalab.org.uk/',
  },
  {
    name: 'Family Context (Social Finance)', kind: 'pipes', status: 'Open-source · Leeds & Stockport', colour: '#2f7d4f',
    what: 'One search showing a social worker which OTHER services know a family — education, adult social care, housing — and who the lead practitioner is. Service-involvement metadata, not case content: that design choice is what makes the information governance tractable. Saved ~2.5 hours per new referral in evaluation; cited by the ICO’s Data Sharing Code as exemplary.',
    fragility: 'The existence proof for “share who’s involved, not what they know” — built on Local Digital grants, spread by goodwill.',
    url: 'https://www.socialfinance.org.uk/projects/family-context',
  },
  // ---- the sector organising itself ----
  {
    name: 'Data to Insight (D2I)', kind: 'sector', status: 'Hosted by East Sussex CC · ~150 LAs', colour: '#b4632e',
    what: '“Not a software supplier” — the sector’s own national data service for children’s services: the Ofsted-ready ChAT analysis tool (built on Annex A, used by ~150 LAs), CIN census and SSDA903 validators, demand-modelling tools, a shared GitHub code library and an analyst-apprenticeship pipeline. Incubated with Social Finance; works with ADCS, DfE, MHCLG and Ofsted.',
    fragility: 'The proof that centre-funds-sector-owns works — and it is grant-dependent and hosted inside one county council. Enormous leverage, thin institutional base.',
    url: 'https://www.datatoinsight.org/',
  },
  {
    name: 'ADCS', kind: 'sector', status: 'Membership body of DCSs', colour: '#2f6f97',
    what: 'The directors’ association — and keeper of the sector’s longest demand time-series: Safeguarding Pressures, phases 1–9 (2007/08–2023/24), built from voluntary returns by 124 LAs; phase 9 found initial contacts up 122% since 2007/08. Also the legitimacy engine behind regional improvement alliances and D2I.',
    fragility: 'Unmatched standing with directors; a small secretariat producing periodic research, not continuous statistics.',
    url: 'https://www.adcs.org.uk/adcs-safeguarding-pressures-p9-report-pr/',
  },
  {
    name: 'LGA — LG Inform', kind: 'sector', status: 'Sector-owned benchmarking', colour: '#2f6f97',
    what: 'The councils’ own benchmarking service: 12,500+ local-level metrics including children’s services indicators, free to every council — plus the convening seat on most of the boards on this wall.',
    fragility: 'Stable and politically legitimate; a benchmarker and convener, not a standards-setter.',
    url: 'https://www.local.gov.uk/our-support/research-and-data/lg-inform-data-benchmarking',
  },
  {
    name: 'LIIA — London Child Level Data', kind: 'sector', status: 'RIIA hosted by London Councils', colour: '#2f6f97',
    what: 'The most ambitious regional pooling effort in England: London’s improvement alliance building the legal, ethical and technical infrastructure to share child-level data across all 33 London LAs, plus the London Data Group and workforce dashboards. One of nine regional alliances — the template the other eight could copy.',
    fragility: 'Regional goodwill plus programme funding; if it cracks the cross-LA information-governance problem, that artefact is worth more than the data.',
    url: 'https://www.liia.london/child-level-data-project/',
  },
  // ---- the evidence layer ----
  {
    name: 'ADR UK / ECHILD', kind: 'research', status: 'ESRC-funded (£168m+ continuation)', colour: '#7a5aa6',
    what: 'The research-access route for government administrative data, and home of the flagship children’s linkages: ECHILD (NPD + hospital episodes, ~20m people, led by UCL), GRADE (exams), and the MoJ–DfE offending × education linkage — accredited researchers only, in secure environments under DEA 2017.',
    fragility: 'World-class linkage that by design never touches operations — the capability gap this page’s switchboard exists to close.',
    url: 'https://www.adruk.org/data-access/flagship-datasets/education-and-child-health-insights-from-linked-data-england/',
  },
  {
    name: 'Foundations (What Works Centre)', kind: 'research', status: 'DfE-commissioned WWC', colour: '#7a5aa6',
    what: 'The What Works Centre for Children & Families (the 2023 EIF + WWCSC merger): practice guides for the Families First reforms, RCTs and evaluations in children’s social care — the “does sharing actually help” layer that should sit over every wire on the switchboard.',
    fragility: 'Evidence synthesis and trials, not infrastructure; its findings bind nobody.',
    url: 'https://foundations.org.uk/about-us/',
  },
];

export const GRAVEYARD = {
  title: 'The graveyard — institutional amnesia, documented',
  research: 'ContactPoint — the post-Climbié national index of all 11 million children, £224m to build and £41m a year to run — was switched off on 6 August 2010 on civil-liberties grounds. The Centre of Excellence for Information Sharing — ~17 staff in Leicester, funded by four Whitehall departments to work on exactly the cultural barriers the Panel still finds — closed in June 2018 when the funding stopped, leaving a legacy website. Each generation builds the information-sharing machinery, dismantles it, and then commissions a review into why information wasn’t shared. The 81% is what the amnesia costs.',
  eli5: 'Britain has built this twice before: a national index of every child (cost £224 million, scrapped in 2010) and a whole team dedicated to helping services share information (closed in 2018 when its funding ran out). We keep deleting the answer and then holding inquiries into the question.',
  refs: [
    { label: 'ContactPoint shutdown (Aug 2010)', url: 'https://ukhumanrightsblog.com/2010/08/06/contact-point-switched-off-but-child-welfare-concerns-remain/' },
    { label: 'Centre of Excellence — closure notice', url: 'https://informationsharing.org.uk/changes_to_the_centre/' },
  ] as Ref[],
};

// ---------------------------------------------------------------------------
// 5 · The named gaps
// ---------------------------------------------------------------------------
export const JIGSAW_GAPS: { gap: string; detail: string; eli5: string; refs?: Ref[] }[] = [
  {
    gap: 'The invisible children',
    detail: '126,000 home-educated and 34,700 missing education on one census day (autumn 2025 — and 175,900 / 143,500 at some point during 2024/25); ~132,818 kinship-care children, visible only through Census-2021 analysis (Centre for Care, for the charity Kinship) — no administrative collection exists; rising unregistered-settings caseloads; under-5s unseen where health visiting has collapsed. Ofsted has flagged “invisible children” in seven consecutive annual reports.',
    eli5: 'Hundreds of thousands of children are known to no service at all — and the schools inspector has warned about it seven years running.',
    refs: [
      { label: 'DfE — EHE statistics, autumn 2025', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/elective-home-education/2025-26-autumn-term' },
      { label: 'DfE — children missing education', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/children-missing-education' },
      { label: 'Kinship — the 132,818 estimate', url: 'https://kinship.org.uk/our-work-and-impact/policy-and-influencing/policy-tracker/data-and-research/' },
    ],
  },
  {
    gap: 'The record breaks at every move',
    detail: 'School moves (safeguarding files outside the CTF, no cross-vendor standard), housing moves (no TA→school notification), service moves (children’s→adults’ at 18, care leavers untracked). Mobility is the system’s blind spot — and the most at-risk children move most.',
    eli5: 'Every time a child moves — school, house, or into adulthood — their story gets left behind. The children in most danger move the most.',
    refs: [
      { label: 'KCSIE — transferring the CP file', url: 'https://www.gov.uk/government/publications/keeping-children-safe-in-education--2' },
      { label: 'HCLG Committee — TA notification recommendation', url: 'https://publications.parliament.uk/pa/cm5901/cmselect/cmcomloc/338/report.html' },
    ],
  },
  {
    gap: 'The consent myth is now provably cultural',
    detail: 'The ICO has said it plainly (“you do not need consent to share a child’s data for safeguarding”), DfE’s 2024 practitioner advice says consent “should not be seen as the default lawful basis” in a child-safeguarding context, and the CWS Act 2026 now puts a duty to share in statute — yet the Panel’s 2024 review still found practitioners not understanding it. Three layers of permission have not fixed a confidence problem.',
    eli5: 'Workers still wrongly believe they need permission to share worries about a child. The law has now said “you don’t” three times — the fear persists anyway.',
    refs: [
      { label: 'ICO — 10 steps to safeguarding sharing', url: 'https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-sharing/a-10-step-guide-to-sharing-information-to-safeguard-children/' },
      { label: 'DfE — information-sharing advice (2024)', url: 'https://assets.publishing.service.gov.uk/media/66320b06c084007696fca731/Info_sharing_advice_content_May_2024.pdf' },
      { label: 'CWS Act 2026', url: 'https://www.legislation.gov.uk/ukpga/2026/21/contents/enacted' },
    ],
  },
  {
    gap: 'Research-grade linkage, operational-grade chaos',
    detail: 'ECHILD links 20 million children’s education and hospital records with 99% match rates — for research, years in arrears. The MASH re-keys the same child between three screens, today. The capability gap between DfE’s research estate and the frontline is the central irony of the ecosystem.',
    eli5: 'For researchers, the government can perfectly match a child’s school and hospital records. For the team deciding tonight whether that child is safe, someone retypes names between systems.',
    refs: [
      { label: 'ADR UK — ECHILD', url: 'https://www.adruk.org/data-access/flagship-datasets/education-and-child-health-insights-from-linked-data-england/' },
      { label: 'ECHILD data-resource profile (IJE)', url: 'https://academic.oup.com/ije/article/51/1/17/6425590' },
    ],
  },
  {
    gap: 'The standards layer is funded like a parish newsletter',
    detail: 'iStandUK is accountable to one borough council; SAVVI runs on a £190k grant; Open Referral UK is volunteer-maintained. Health funds the PRSB properly; nothing equivalent exists for education or children’s social care records.',
    eli5: 'The common rules that would let all these systems talk are kept alive by a handful of people on tiny grants — while the NHS funds its version properly.',
    refs: [
      { label: 'iStandUK — accountable body', url: 'https://istanduk.org/about-us/' },
      { label: 'SAVVI phase 4 — the £190k', url: 'https://www.ukauthority.com/articles/savvi-vulnerability-data-project-enters-phase-four/' },
    ],
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

// ---------------------------------------------------------------------------
// 7 · The switchboard — opportunities wired into the data spine
// ---------------------------------------------------------------------------
export type SpineVia = 'spine' | 'direct';
export type SpineStatus = 'live' | 'now' | 'identifier' | 'policy';

export const SPINE_STATUS_META: Record<SpineStatus, { label: string; eli5: string; colour: string }> = {
  live:       { label: 'Live today — the proof', eli5: 'Already working', colour: '#2f7d4f' },
  now:        { label: 'Buildable now — no new law needed', eli5: 'Could start tomorrow', colour: '#2f6f97' },
  identifier: { label: 'Unlocked by the identifier (CWS Act)', eli5: 'Waiting on the new child ID', colour: '#9a7b1f' },
  policy:     { label: 'Needs a policy decision', eli5: 'Needs a minister to say yes', colour: '#7a5aa6' },
};

export interface SpineOpp {
  id: string;
  title: string;
  titleEli5: string;
  from: string[];          // holder ids (sources)
  to: string[];            // holder ids (receivers)
  via: SpineVia;           // through the spine, or a direct Encompass-pattern push
  status: SpineStatus;
  what: string;            // what actually moves
  whatEli5: string;
  mechanism: string;       // the pattern: push / standard / matching / auto-enrolment
  gives: string;           // what the source puts in
  getsBack: string;        // what flows back out — the anti-paternal test
  blockedBy: string;       // what stops it today
  precedent: string;       // proof the shape works
  cost: '£' | '££' | '£££';
  move: number;            // which value-offer move it advances (0 = the template itself)
}

export const SPINE_OPPS: SpineOpp[] = [
  {
    id: 'encompass', title: 'Operation Encompass — the template', titleEli5: 'Police warn the school by morning',
    from: ['police'], to: ['school'], via: 'direct', status: 'live',
    what: 'A next-morning notification to the DSL after police attend a domestic-abuse incident involving the child.',
    whatEli5: 'If police are called to trouble at home overnight, the school knows before the child walks in.',
    mechanism: 'Push-based, deadline-bound, purpose-narrow — and note: it never touches a national database.',
    gives: 'One incident flag, minimum detail, time-boxed.',
    getsBack: 'A teacher who knows to be gentle today — the entire point of the flow.',
    blockedBy: 'Nothing. A statutory duty on all 43 forces in England and Wales since 7 November 2025 (Victims and Prisoners Act 2024) — running at ~2,000 notifications a day.',
    precedent: 'It IS the precedent — every other wire on this board copies its shape.',
    cost: '£', move: 0,
  },
  {
    id: 'ctf-safeguarding', title: 'Safeguarding file follows the child', titleEli5: 'The worry-file moves when the child moves',
    from: ['school'], to: ['school'], via: 'spine', status: 'now',
    what: 'A cross-vendor transfer standard for the DSL’s safeguarding record (CPOMS ↔ MyConcern ↔ rest), with the spine resolving WHERE the child went.',
    whatEli5: 'When a child changes school, the safeguarding notes arrive too — whichever software each school bought.',
    mechanism: 'A DfE-specified transfer standard (the CTF precedent), spine as address book only — the file moves school-to-school, never through the centre.',
    gives: 'Destination-school lookup; conformance with one open spec.',
    getsBack: 'The richest record in the system stops breaking at every move — KCSIE’s 5-day duty becomes mechanically easy.',
    blockedBy: 'Nobody has ever written the spec. Vendors have no commercial incentive to interoperate unprompted.',
    precedent: 'The Common Transfer File itself — DfE has specified school-to-school transfer since 2002; it simply excluded the safeguarding file.',
    cost: '£', move: 1,
  },
  {
    id: 'match-service', title: 'Identity resolution at the front door', titleEli5: 'One child, one match — instantly',
    from: ['nhse'], to: ['mash'], via: 'spine', status: 'identifier',
    what: 'The consistent identifier as a national matching service the MASH can call: “is this the same child?” answered in seconds, not by re-keying names between three screens.',
    whatEli5: 'The team deciding tonight whether a child is safe gets a button that says “show me everything we hold on this exact child”.',
    mechanism: 'NHS-number-based matching (the Wigan pilot’s lessons) exposed as infrastructure — ECHILD-grade linkage moved from research to operations.',
    gives: 'PDS demographics; match-confidence scores.',
    getsBack: 'Triage minutes back per referral, and an end to wrong-child errors — the front door’s biggest quiet risk.',
    blockedBy: 'Identifier rollout timetable; education and social-care systems don’t yet hold the NHS number.',
    precedent: 'ECHILD matches 20m children at research grade; Wigan piloted the operational form.',
    cost: '£££', move: 4,
  },
  {
    id: 'ta-school', title: 'Temporary accommodation → school', titleEli5: 'School finds out the family was moved',
    from: ['housing'], to: ['school'], via: 'spine', status: 'identifier',
    what: 'An Encompass-pattern notification to the school (and GP) when a child enters temporary accommodation or is placed out-of-borough.',
    whatEli5: 'When the council moves a family into emergency housing, the school is told — automatically, fast.',
    mechanism: 'Push flow triggered by the housing placement record; spine resolves which school holds the child.',
    gives: 'One placement event; no household detail beyond the move.',
    getsBack: 'The school keeps sight of the child at the moment of maximum risk — 22% of homeless children move school multiple times.',
    blockedBy: 'No identifier join between housing systems and school rolls; recommended by the HCLG Committee, answered with “wait for the identifier”.',
    precedent: 'Encompass — same shape, different trigger.',
    cost: '££', move: 2,
  },
  {
    id: 'ae-dsl', title: 'A&E attendance → DSL', titleEli5: 'Hospital visit, school knows',
    from: ['icb'], to: ['school'], via: 'spine', status: 'identifier',
    what: 'A safeguarding-relevant A&E attendance (violence, self-harm, repeat attendance) flagged to the DSL — the Cardiff Model’s safe, minimum-data form.',
    whatEli5: 'If a child turns up at A&E in a worrying way, someone at school finds out — with the bare minimum of medical detail.',
    mechanism: 'Coded flag only (attendance type, not clinical record); push to the DSL within days.',
    gives: 'A coded event from ECDS data hospitals already collect.',
    getsBack: 'The school sees the crisis its attendance data will otherwise only show as absence, weeks later.',
    blockedBy: 'Identifier match between hospital systems and school rolls; information-governance nerve.',
    precedent: 'The Cardiff Model has shared A&E violence data with partners since the 2000s and cut violence measurably.',
    cost: '££', move: 2,
  },
  {
    id: 'court-milestones', title: 'Family-court milestones → social care', titleEli5: 'The court keeps the social worker posted',
    from: ['cafcass'], to: ['lacsc'], via: 'spine', status: 'identifier',
    what: 'Case-milestone notifications (proceedings opened, orders made, case closed) flowing to the child’s social-care record — and the school where relevant.',
    whatEli5: 'When a judge makes a decision about a child, the people working with that child day-to-day hear about it.',
    mechanism: 'Milestone events, not court documents — purpose-narrow, like everything else on this board.',
    gives: 'Five-ish event types from systems Cafcass already runs.',
    getsBack: 'Court timescales stop being invisible to the services holding the same ~80,000 children.',
    blockedBy: 'No operational identifier join; judicial-independence sensitivities cap what can flow (documents never should).',
    precedent: 'The MoJ–DfE research linkage already joins these records — years later, for analysts.',
    cost: '££', move: 2,
  },
  {
    id: 'review-reception', title: '2½-year review → reception planning', titleEli5: 'Nursery knows what the health visitor saw',
    from: ['hv'], to: ['ey'], via: 'spine', status: 'now',
    what: 'The 2–2.5-year development review flowing to the early-years setting and into reception planning — the last universal sighting before school, currently lost to education.',
    whatEli5: 'What the health visitor learned about a toddler reaches the nursery and the reception teacher, instead of sitting in a health file.',
    mechanism: 'The PRSB Healthy Child Record standard already defines the record; the ask is a consume-side flow into DfE’s early-years estate.',
    gives: 'A structured review summary that already exists digitally (where the review happens at all).',
    getsBack: 'Reception teachers stop starting from zero; the review itself gains a reason to be done well — coverage is the scandal (81.5% median).',
    blockedBy: 'No education-side consumer has ever been specified; health-visiting collapse means the upstream data is patchy.',
    precedent: 'The digital red book (eRedbook) proves parents can already hold this record.',
    cost: '££', move: 2,
  },
  {
    id: 'registers-fuse', title: 'Children-not-in-school registers, fused', titleEli5: 'One national list of the missing children',
    from: ['lacsc'], to: ['dfe', 'ofsted'], via: 'spine', status: 'now',
    what: 'The CWS Act’s 153 local registers of home-educated and missing children fused into one national view — with kinship and unregistered-settings signals joined as they mature.',
    whatEli5: 'Every council now keeps a list of children not in school. Join the lists and you can finally see the whole picture.',
    mechanism: 'A collection standard for the new statutory registers; the spine de-duplicates children who move between LAs (the current lists can’t).',
    gives: 'Registers LAs are already legally required to keep.',
    getsBack: 'LAs see arrivals from other areas — today a child who moves council is a fresh mystery; Ofsted’s seven-year “invisible children” warning finally gets a denominator.',
    blockedBy: 'Registers are new (CWS Act); a fragmented 153-format landscape is being born right now — the standard is cheap today and expensive in five years.',
    precedent: 'The school census has fused 24,000 schools’ rolls into one picture since 2002.',
    cost: '£', move: 1,
  },
  {
    id: 'fsm-auto', title: 'FSM auto-enrolment', titleEli5: 'Free school meals happen automatically',
    from: ['dwp'], to: ['dfe', 'school'], via: 'spine', status: 'policy',
    what: 'Flip the existing DWP/HMRC eligibility pipe from parent-must-apply to enrolled-by-default — feeding children and correcting the disadvantage data every funding formula runs on.',
    whatEli5: 'Instead of parents filling in forms, eligible children just get free meals — the computer check already exists.',
    mechanism: 'The Eligibility Checking Service already verifies entitlement in real time; auto-enrolment reverses its direction.',
    gives: 'The same benefits match DWP already serves, run proactively.',
    getsBack: 'Schools: meals + pupil-premium funding for the ~215,000 eligible-but-unregistered (11%). DfE: the disadvantage measure underneath half its own statistics stops undercounting.',
    blockedBy: 'A policy decision: a Private Member’s Bill on automatic registration is before Parliament, and from September 2026 every Universal Credit household becomes eligible — making the entitlement trivially inferable from data DWP already holds.',
    precedent: 'Dozens of LAs already auto-enrol via local data matching (Policy in Practice found ~1,500 missed children across three boroughs; LOTI ran the cross-borough pilot); the pipe is national.',
    cost: '£', move: 5,
  },
];

export const VALUE_DONTS = {
  research: 'And the three don’ts the history teaches: don’t build the central child database (ContactPoint was dismantled for good reasons, and the Panel itself says the identifier won’t fix culture); don’t add collections without retiring others (the RAAC questionnaire-under-duress is the symptom of registry-by-crisis); and don’t nationalise the sector’s tooling — fund it, standardise it, and leave it owned by the people who use it. The value offer, in one sentence: DfE stops being the system’s biggest collector and becomes its standards body, its identity infrastructure, and its convenor — the steward of joins it never holds.',
  eli5: 'Three things NOT to do: don’t rebuild the giant national child database (it was scrapped for good reasons), don’t pile on new data demands without removing old ones, and don’t take over the tools councils built for themselves. The offer in one line: the department stops hoarding pieces and starts making the jigsaw fit together.',
};
