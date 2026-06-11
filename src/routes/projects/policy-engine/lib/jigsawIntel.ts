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
  // PRECISION: the figure measures a "lack of co-ordination or handover between services"
  // theme — of which information-sharing failure is ONE named sub-component, not the whole.
  // It is a finding about the 330 serious-incident rapid reviews, not about all children,
  // and not specifically about information-sharing. Stated verbatim from CSPRP §3.85.
  label: 'of the 330 serious-incident rapid reviews in 2023–24 showed a lack of co-ordination or handover between services — a theme the national Child Safeguarding Practice Review Panel says “often included failures in information sharing”, alongside inconsistent record-keeping, role confusion, delayed responses and fragmented services (CSPRP, 2025, §3.85).',
  labelEli5: 'In about four out of five of the most serious cases reviewed in a year — where children died or were badly harmed — the Panel found the services around the child had not co-ordinated or handed over well between each other. Information-sharing failures were one part of that, not the whole of it.',
  kicker: {
    research: 'A precise reading matters here, because the figure is widely shortened to “81% information-sharing failures”, which over-claims. The Panel’s wording is broader: it is a co-ordination/handover theme, with information-sharing one named element within it — and the source notes that in 14% of incidents flagged with this issue, GOOD practice (effective information-sharing and multi-agency communication) was also identified. The denominator is the 330 rapid reviews (≈267 of 330), i.e. a serious-incident review population — the most serious cases, not all children. A companion theme in the same 330 — a lack of professional curiosity, the “failure to ask the second question” — features in 66%. Separately, the Panel’s 2024 review of intra-familial sexual abuse found that in around a third of cases the person who caused harm had a recorded history of sexual offending. On the identifier debate, the RCPCH (in supporting the NHS number as the child identifier) records that the identifier alone is insufficient without “national and cross-sector agreement on what, when and how information is shared” — i.e. a shared identifier is a necessary but not sufficient condition for the joins to work.',
    eli5: 'It is worth being exact: people often shorten this to “81% had information-sharing failures”, but the Panel’s number is broader — it covers co-ordination and hand-overs in general, with information-sharing as one part. And in some of those same cases, the Panel also found things being done well. The information was often written down somewhere — in about a third of the worst sexual-abuse cases reviewed, the person’s history was already known to a service. Even the doctors who support the new child ID number say the number alone will not fix the joins.',
  },
  refs: [
    { label: 'CSPRP Annual Report 2023–24, §3.85', url: 'https://assets.publishing.service.gov.uk/media/67c97b1dd0fba2f1334cf300/Child_Safeguarding_Practice_Review_Panel_annual_report_2023_to_2024.pdf' },
    { label: 'NSPCC — CASPAR summary of the 2023–24 report', url: 'https://learning.nspcc.org.uk/research-resources/2025/summary-child-safeguarding-practice-review-panel-csprp-annual-report-2023-24' },
    { label: 'RCPCH — NHS number as the identifier', url: 'https://www.rcpch.ac.uk/resources/nhs-number-single-unique-identifier-children-position-statement' },
  ],
  // A precise restatement the page can render verbatim near the big number.
  precise: 'What the 81% measures: a “lack of co-ordination or handover between services”, which the Panel says often included information-sharing failures — but also inconsistent record-keeping, role confusion, delayed responses and fragmented services. It is a finding about the 330 serious-incident reviews (≈267 of 330), not about all children, and not specifically about information-sharing.',
  preciseEli5: 'In plain terms: the 81% is about services not joining up in general — hand-overs, records, roles, delays — and information-sharing is one piece of that. It counts the most serious cases that were reviewed, not every child.',
};

// ---------------------------------------------------------------------------
// 1b · The privacy counter-thesis — the proportionality ceiling, evidenced
// ---------------------------------------------------------------------------
// The case for "joining the data up" runs into a documented record of large
// child-data systems being curtailed on privacy and proportionality grounds.
// This is a legal and ethical constraint with case-law force, not a fringe
// objection — presented here at its full weight so the balance can be stated
// neutrally afterwards.

export interface PrivacyPrecedent {
  id: string;
  name: string;
  period: string;
  summary: string;        // what it was / what happened
  finding: string;        // the privacy/proportionality point, attributed
  eli5: string;
  refs: Ref[];
}

export const PRIVACY_PRECEDENTS: PrivacyPrecedent[] = [
  {
    id: 'contactpoint',
    name: 'ContactPoint — the national children’s index',
    period: 'Built 2009 · switched off 6 August 2010',
    summary: 'Created under the Children Act 2004 after the Victoria Climbié inquiry, ContactPoint was an index of basic details and service contacts for around 11 million children in England, reaching ~150 local authorities and an estimated 330,000–390,000 authorised users. It was intended to let a practitioner see who else was working with a child. It cost ~£224m to build and ~£41m/yr to run (government figures); the Information Commissioner put lifetime cost nearer £1bn (a figure the government contested).',
    finding: 'The incoming government switched it off in August 2010 on cost-and-civil-liberties grounds. Documented objections gave it weight beyond cost: a Foundation for Information Policy Research review commissioned by the ICO (2006) argued it did not adequately respect privacy and proportionality; a Deloitte security review reportedly concluded the system could not be made fully secure; and concerns were raised about “shielded” records for at-risk children (e.g. those fleeing abuse) being identifiable, and about function-creep risk. The Joint Committee on Human Rights flagged it as a serious interference with ECHR Article 8 that was hard to justify.',
    eli5: 'Britain once built a list of every child — 11 million of them — so workers could see who else was helping. It cost hundreds of millions of pounds and was switched off in 2010 because of cost and privacy worries, including the fear that children hiding from an abusive parent could be found through it.',
    refs: [
      { label: 'ContactPoint — cost, reach, shutdown (overview)', url: 'https://en.wikipedia.org/wiki/ContactPoint' },
      { label: 'ContactPoint switched off (Aug 2010)', url: 'https://ukhumanrightsblog.com/2010/08/06/contact-point-switched-off-but-child-welfare-concerns-remain/' },
    ],
  },
  {
    id: 'named-person',
    name: 'The Scottish “Named Person” scheme — Christian Institute v Lord Advocate [2016] UKSC 51',
    period: 'Legislated 2014 · UK Supreme Court ruling 28 July 2016',
    summary: 'Part of Scotland’s Getting It Right For Every Child (GIRFEC) policy, the Children and Young People (Scotland) Act 2014 would have assigned a “named person” to every child to oversee wellbeing, with associated information-sharing provisions.',
    finding: 'The UK Supreme Court (unanimous, five justices) held that the information-sharing provisions — not the named-person concept itself — were incompatible with ECHR Article 8 and therefore outside the legislative competence of the Scottish Parliament. The Court accepted the legitimate aim (child wellbeing) but found the data-sharing regime failed the “in accordance with the law” and proportionality tests: it was not sufficiently foreseeable or clear, risked overriding confidentiality (e.g. health data) without adequate safeguards, and gave parents no real way to know about or object to sharing. The Court’s much-quoted line — “The first thing that a totalitarian regime tries to do is to get at the children…” — was used to make the point that benign intentions do not exempt a scheme from rule-of-law limits. The statutory scheme was subsequently abandoned; the Scottish Government moved to repeal the relevant parts in 2019.',
    eli5: 'Scotland tried to give every child a “named person” to watch over their wellbeing, with rules letting services share information about the child. In 2016 the UK’s highest court struck the information-sharing rules down: the aim was fine, but the data-sharing was too vague and gave families no way to know or object, so it broke the right to private and family life. This is the leading UK case on the limits of bulk child-data-sharing.',
    refs: [
      { label: 'UKSC — Christian Institute v Lord Advocate [2016] UKSC 51', url: 'https://www.supremecourt.uk/cases/uksc-2015-0216' },
      { label: 'Clan Childlaw — case note (Art.8 incompatibility)', url: 'https://www.clanchildlaw.org/the-christian-institute-and-others-v-the-lord-advocate-2016-uksc-51/' },
    ],
  },
  {
    id: 'ico-current',
    name: 'Current data-protection critiques of the new English duty',
    period: '2025–26',
    summary: 'The new English statutory information-sharing duty and single child identifier (Children’s Wellbeing and Schools Act 2026) have drawn a continuation of these objections, set out by groups including defenddigitalme and clinical bodies. The government’s position is that the new duty provides a clearer lawful basis and safeguards; the points below are the critics’ framings, recorded here at face value.',
    finding: 'Critics point to: function-creep risk (the legislation reportedly disapplies certain confidentiality obligations, and ministers have indicated possible uses beyond safeguarding); a deterrence concern that extracting NHS-number identifiers for non-health matching could discourage vulnerable families from registering with a GP — which would reduce, not increase, early safeguarding contact; transparency gaps (pilots concede parents “will not necessarily be aware” of the processing); and an enforcement gap (no published cost-benefit against cheaper alternatives such as training, and a critique that an unpublished 2020 ICO audit of the DfE went unactioned). The underlying point is that data-protection law constrains a join only as far as it is enforced.',
    eli5: 'The new law that lets services share children’s data and gives every child one ID number has its critics too. They worry the data could later be used for things other than safeguarding, that some families might avoid the doctor to stay off the list, that parents often won’t be told, and that the rules only work if someone actually enforces them. The government says the new law makes the legal basis clearer and adds safeguards.',
    refs: [
      { label: 'defenddigitalme — critique of the single-identifier duty', url: 'https://defenddigitalme.org/2025/06/14/nhs-number-to-be-national-id-mandated-in-childrens-wellbeing-and-schools-bill/' },
      { label: 'ICO — children and the UK GDPR', url: 'https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/children-and-the-uk-gdpr/' },
    ],
  },
];

// The balance, stated neutrally — a criterion that can be APPLIED, not a recommendation.
export const PRIVACY_BALANCE = {
  title: 'Holding the two findings together',
  research: 'Two evidenced findings sit in tension. On one side, the CSPRP review population shows co-ordination and hand-over failures (including information-sharing) are pervasive in the most serious cases. On the other, the legal record (Christian Institute v Lord Advocate; the ContactPoint reversal) establishes that bulk, mandatory child-data-sharing must be lawful, foreseeable and proportionate under ECHR Article 8 — a constraint with case-law force, not a preference. The two are not symmetric rhetorical positions to be split down the middle: the safeguarding finding is about a review population (the most serious cases), and the legal finding is a binding ceiling on any design that applies to all children. A way to state the trade-off as an evaluable criterion rather than a position: each increment of coverage (how much data is joined, on how many children) can be assessed for the safeguarding signal it adds AND the proportionality cost it incurs — and a design is admissible only if it is targeted, foreseeable, and bounded enough to pass the Article 8 proportionality test the courts have already applied. Targeted, purpose-narrow, push-based flows (the Operation Encompass shape) sit comfortably within that ceiling; a standing national index of all children (the ContactPoint shape) has twice been judged not to.',
  eli5: 'Both things are true at once. Services not joining up does harm children in the worst cases. AND the courts have ruled that you cannot just join up everything about every child — it has to be targeted, clear, and proportionate, or it breaks the right to a private family life. So the test is not “share more” or “share less” but “does this particular join add enough safeguarding value to justify its privacy cost, and is it targeted enough to be lawful?” Narrow, specific alerts pass that test; a giant database of every child has twice failed it.',
  refs: [
    { label: 'CSPRP Annual Report 2023–24, §3.85', url: 'https://assets.publishing.service.gov.uk/media/67c97b1dd0fba2f1334cf300/Child_Safeguarding_Practice_Review_Panel_annual_report_2023_to_2024.pdf' },
    { label: 'UKSC — Christian Institute v Lord Advocate [2016] UKSC 51', url: 'https://www.supremecourt.uk/cases/uksc-2015-0216' },
  ] as Ref[],
};

// ---------------------------------------------------------------------------
// 1c · Illustrative model parameters — clearly labelled, NOT measured rates
// ---------------------------------------------------------------------------
// Order-of-magnitude figures to ground the two illustrative interactives. Each
// is a labelled modelling assumption, not a national rate. Where no defensible
// figure exists, that is stated. Sourced from the research dossier (2026-06-11).

export const ILLUSTRATIVE_PARAMS = {
  // Agencies holding data on one safeguarding-involved child. No published mean exists.
  agenciesPerChild: {
    low: 4, high: 8,
    note: 'A safeguarding-involved child’s data is typically held across roughly 4–8 services (e.g. GP/health, school, children’s social care, police, plus possibly health visiting, CAMHS, housing or early help). No single authoritative average is published — this is the composition of a MASH and the standard agency list, used as a modelling assumption.',
    confidence: 'assumption' as const,
  },
  // Cohort order-of-magnitude figures for the "joins funnel" — dated, contested estimates.
  cohort: {
    // Children's Commissioner estimates (2018-19). Pre-2020, methodology-dependent.
    invisible: 829_000,        // children "invisible" to services
    familyRisk: 2_300_000,     // children living with a family-background risk factor
    teensGaps: 123_000,        // teens (13-17) "falling through gaps", 2017/18 (~1 in 25)
    note: 'The Children’s Commissioner estimated ~829,000 children “invisible” to services (of ~2.3m living with a family-background risk factor), and ~123,000 teenagers (13–17) “falling through the gaps” in 2017/18 (~1 in 25). These are dated (pre-2020) estimates and methodology-dependent — flagged as best-available but contested.',
    confidence: 'contested' as const,
  },
  // Coordination-failure share (the CSPRP figure) — high confidence, but a review population.
  coordFailureShare: {
    pct: 81, reviews: 330,
    note: 'In 81% of the 330 serious-incident rapid reviews in 2023–24 (≈267), the Panel found a lack of co-ordination or handover between services. High confidence in the figure — but it describes a review population (the most serious cases), not all children.',
    confidence: 'high' as const,
  },
  // ContactPoint as a privacy-cost anchor — historic facts.
  contactPoint: {
    buildCostM: 224, runCostM: 41, recordsM: 11, usersLow: 330_000, usersHigh: 390_000, las: 150,
    note: 'ContactPoint (2009–2010): ~£224m to build, ~£41m/yr to run, ~11m children’s records, ~330k–390k authorised users across 150 local authorities. Used as a privacy-cost / exposure-surface anchor for the coordination-cost simulator. The ICO’s ~£1bn lifetime figure was contested by the government.',
    confidence: 'medium' as const,
  },
  // Per-referral duplication / "repeat your story" burden — NO clean national rate.
  duplication: {
    note: 'The Independent Review of Children’s Social Care (MacAlister, 2022) described families repeating their story across agencies and duplicated assessments as a systemic failure, but no clean national duplication rate is published. The duplication slider below is therefore an explicit assumption, not a measured rate. (Family Context, by Social Finance, reportedly saved ~2.5 hours per new referral by surfacing which services already know a family — an order-of-magnitude anchor for what a duplicate touch costs.)',
    perReferralHoursSaved: 2.5,
    confidence: 'assumption' as const,
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
    dfeCan: 'Little directly — which illustrates the wider point: DfE is one holder among many, not the controller of this record.',
    dfeCant: 'Touch primary-care records. The lever sits with NHS England, via the safeguarding-partner duty and record standards (PRSB).',
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
    dfeCant: 'Procure or run the case systems — sector-owned tooling is the part of this market with the widest take-up (ChAT, ~150 LAs).',
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
    holds: 'AssetPlus — one assessment record that follows the child through the system (an uncommon design in this landscape), feeding YJB national statistics.',
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
    challenge: 'The flows are PULL (parents must apply) rather than PUSH (auto-enrolment): ~11% of FSM-eligible children — roughly 215,000 — are unregistered, not receiving the meals, and not counted in the disadvantage funding weighting. Child Benefit’s register-of-children role is declining as take-up falls.',
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
    challenge: 'The power is episodic — each audit is a one-off inquiry into gaps that are not currently covered by standing statistics.',
    dfeCan: 'Her audits function, in effect, as a requirements list: each one identifies a join that a standing system could make routine.',
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

// The eighteenth holder — the one the map can't show: the family itself.
export const FAMILY_NOTE = {
  title: 'The eighteenth holder — the centre of the map holds none of the pieces',
  research: 'On the map, the child sits at the centre, and neither the child nor their family holds a single piece of the distributed record. A parent has no consolidated way to see it — subject-access requests to each of seventeen organisations are the only mechanism, and the safeguarding file is partially exempt even from those. The components for a person-held alternative already exist: health’s About Me standard (PRSB) defines person-held “what matters to me” information; the eRedbook shows parents can hold a clinical record; and every register on this page would be measurably more accurate if the family could see and correct it. A reciprocity criterion — whether the people a record is about can see and use it — is therefore one test any stewardship model can be assessed against: where is the family’s copy?',
  eli5: 'Strangest of all: the child in the middle of the map — and their parents — can’t see any of it. Seventeen organisations hold pieces of their story, and the family’s only option is writing to each one separately. The NHS already has a standard for letting people hold their own record. Nobody has built the children’s version.',
  refs: [
    { label: 'PRSB — the About Me standard', url: 'https://theprsb.org/standards/aboutme/' },
    { label: 'ICO — subject access and children', url: 'https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/children-and-the-uk-gdpr/' },
  ] as Ref[],
};

// ---------------------------------------------------------------------------
// 3 · The RACI — information jobs × the system
// ---------------------------------------------------------------------------
export type RaciVal = 'R' | 'A' | 'C' | 'I' | '';

export interface RaciRow {
  job: string;
  eli5: string;
  cells: Record<string, RaciVal>;   // keyed by RACI_COLS ids
  gap?: string;                     // the analytical annotation (esp. where A is missing)
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
    gap: 'The LA duty is new (CWS Act registers) and only covers not-in-school; kinship care (~132,800 children, visible only in the census), unregistered settings and the under-5s coverage gap remain unobserved by any standing collection. The Commissioner’s episodic audits are, in practice, the main mechanism for locating these children.',
  },
  {
    job: 'Identify and reach children in an emergency', eli5: 'Find every child fast when disaster strikes',
    cells: { school: 'R', la: 'R', police: 'R', health: 'R', partnership: 'C', dfe: 'I', standards: 'C', cco: '' },
    gap: 'NO STANDING CAPABILITY. The Manchester Arena Inquiry recorded that the casualty bureau was not operational for around 4.5 hours while families sought information about children in hospitals. During COVID-19, vulnerable-children lists were assembled ad hoc — the kind of reactive assembly SAVVI’s standards are designed to prevent, currently funded on a ~£190k grant.',
  },
  {
    job: 'Set the standards for all of the above', eli5: 'Write the common rules so systems can talk',
    cells: { school: '', la: 'C', police: '', health: 'R', partnership: '', dfe: 'R', standards: 'R', cco: '' },
    gap: 'NO ACCOUNTABLE OWNER. Health has the PRSB; education/social-care records have no equivalent body. iStandUK is a programme accountable to one metropolitan borough council; SAVVI and Open Referral UK are funded grant round to grant round. The standards layer of the children’s information system is funded at a fraction of the scale of the systems it underpins.',
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
    what: 'The What Works Centre for Children & Families (the 2023 EIF + WWCSC merger): practice guides for the Families First reforms, RCTs and evaluations in children’s social care — the “does sharing actually help” evidence layer that bears on every wire on the switchboard.',
    fragility: 'Evidence synthesis and trials, not infrastructure; its findings bind nobody.',
    url: 'https://foundations.org.uk/about-us/',
  },
];

export const GRAVEYARD = {
  title: 'The graveyard — capability built and discontinued, documented',
  research: 'ContactPoint — the post-Climbié national index of all 11 million children, £224m to build and £41m a year to run — was switched off on 6 August 2010 on cost and civil-liberties grounds (the privacy precedent above sets out why). The Centre of Excellence for Information Sharing — ~17 staff in Leicester, funded by four Whitehall departments to work on the practice-culture barriers the Panel still identifies — closed in June 2018 when its funding ended, leaving a legacy website. The pattern is that information-sharing capability has been built and discontinued more than once, followed by reviews into why information was not shared — a sequence worth noting when weighing the durability of any new build.',
  eli5: 'Britain has built versions of this twice before: a national index of every child (cost £224 million, switched off in 2010 over cost and privacy) and a team dedicated to helping services share information (closed in 2018 when its funding ended). The capability keeps being built and then discontinued — and then reviews ask why information was not shared.',
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
    detail: 'School moves (safeguarding files outside the CTF, no cross-vendor standard), housing moves (no TA→school notification), service moves (children’s→adults’ at 18, care leavers untracked). Mobility is where the system loses sight of a child most often — and the most at-risk children move most.',
    eli5: 'Every time a child moves — school, house, or into adulthood — their story gets left behind. The children in most danger move the most.',
    refs: [
      { label: 'KCSIE — transferring the CP file', url: 'https://www.gov.uk/government/publications/keeping-children-safe-in-education--2' },
      { label: 'HCLG Committee — TA notification recommendation', url: 'https://publications.parliament.uk/pa/cm5901/cmselect/cmcomloc/338/report.html' },
    ],
  },
  {
    gap: 'The gap between the legal position and practice persists',
    detail: 'The legal position is settled: the ICO states that consent is not needed to share a child’s data for safeguarding; DfE’s 2024 practitioner advice says consent “should not be seen as the default lawful basis” in a child-safeguarding context; and the CWS Act 2026 places a duty to share in statute. Yet the Panel’s 2024 review still found practitioners uncertain about it. The remaining gap is therefore one of practice and confidence rather than of law — three successive legal clarifications have not closed it.',
    eli5: 'The law is clear that workers do not need permission to share worries about a child for safeguarding. But reviews still find some workers unsure. So the remaining problem is one of training and confidence, not of what the law allows.',
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
    gap: 'The standards layer is funded far below the scale it underpins',
    detail: 'iStandUK is accountable to one borough council; SAVVI runs on a £190k grant; Open Referral UK is volunteer-maintained. Health funds the PRSB as a standing body; no equivalent funded body exists for education or children’s social-care records.',
    eli5: 'The common rules that would let all these systems talk are kept running by a small number of people on modest grants — while the NHS funds its version as a standing institution.',
    refs: [
      { label: 'iStandUK — accountable body', url: 'https://istanduk.org/about-us/' },
      { label: 'SAVVI phase 4 — the £190k', url: 'https://www.ukauthority.com/articles/savvi-vulnerability-data-project-enters-phase-four/' },
    ],
  },
];

// ---------------------------------------------------------------------------
// 6 · The value offer — if DfE changed its support posture
// ---------------------------------------------------------------------------
// Framed as evaluable options — what each repositioning move would involve and its
// cost order-of-magnitude — rather than as recommendations the author endorses.
export const VALUE_OFFER: { move: string; what: string; cost: string }[] = [
  { move: 'Setting the missing standards', what: 'A cross-vendor safeguarding-record transfer standard; a MASH data specification (with Home Office/NHSE); record standards for education and social care comparable to the PRSB. DfE already runs standards.education.gov.uk; this would extend that function outward.', cost: 'Low — specification work, and the CTF precedent shows DfE has done comparable work before.' },
  { move: 'Generalising the Encompass pattern', what: 'Push-based, deadline-bound, purpose-narrow flows for the named joins: temporary accommodation → school, A&E attendance → DSL (the Cardiff Model shows a low-data form), court milestones → social care. Each is a single flow, not a database.', cost: 'Per-flow specification, plus the identifier the CWS Act already provides.' },
  { move: 'Funding the standards layer at scale', what: 'iStandUK, SAVVI, Open Referral UK and the D2I pattern collectively cost less than one national IT procurement. Placing the standards layer on standing funding comparable to the way health funds the PRSB.', cost: 'Single-digit £m/yr — a small budget line relative to its system-wide reach.' },
  { move: 'Closing the research/operational gap', what: 'Allowing ECHILD-grade matching to inform frontline systems: the Wigan pilot’s match-rate lessons becoming a national matching service the MASH can call — identity resolution as shared infrastructure rather than per-case manual effort.', cost: 'The most demanding of the five — though the linkage capability already exists in-house.' },
  { move: 'Reversing the welfare data flow', what: 'FSM auto-enrolment through the DWP/HMRC eligibility pipe that already runs weekly — affecting both the children registered and the accuracy of DfE’s own disadvantage data.', cost: 'A policy decision rather than a technical one.' },
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
  getsBack: string;        // what flows back out — the reciprocity criterion
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
    getsBack: 'A teacher who can respond appropriately that day — the function the flow is designed to serve.',
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
    getsBack: 'Triage minutes back per referral, and fewer wrong-child errors — a recognised risk at the front door.',
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
    getsBack: 'The school sees the event its attendance data would otherwise only register as absence, weeks later.',
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
    blockedBy: 'No operational identifier join; judicial-independence considerations cap what can flow (the design scope is milestone events, not court documents).',
    precedent: 'The MoJ–DfE research linkage already joins these records — years later, for analysts.',
    cost: '££', move: 2,
  },
  {
    id: 'review-reception', title: '2½-year review → reception planning', titleEli5: 'Nursery knows what the health visitor saw',
    from: ['hv'], to: ['ey'], via: 'spine', status: 'now',
    what: 'The 2–2.5-year development review flowing to the early-years setting and into reception planning — the last universal sighting before school, currently lost to education.',
    whatEli5: 'What the health visitor learned about a toddler reaches the nursery and the reception teacher, instead of sitting in a health file.',
    mechanism: 'The PRSB Healthy Child Record standard already defines the record; what is missing is a consume-side flow into DfE’s early-years estate.',
    gives: 'A structured review summary that already exists digitally (where the review happens at all).',
    getsBack: 'Reception teachers stop starting from zero; the review itself gains a reason to be completed — though coverage is the binding constraint (81.5% median LA coverage of the 2–2.5-year review).',
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
    what: 'Reversing the existing DWP/HMRC eligibility pipe from parent-must-apply to enrolled-by-default — which would both register eligible children and correct the disadvantage data every funding formula runs on.',
    whatEli5: 'Instead of parents filling in forms, eligible children just get free meals — the computer check already exists.',
    mechanism: 'The Eligibility Checking Service already verifies entitlement in real time; auto-enrolment reverses its direction.',
    gives: 'The same benefits match DWP already serves, run proactively.',
    getsBack: 'Schools: meals + pupil-premium funding for the ~215,000 eligible-but-unregistered (11%). DfE: the disadvantage measure underneath half its own statistics stops undercounting.',
    blockedBy: 'A policy decision: a Private Member’s Bill on automatic registration is before Parliament, and from September 2026 every Universal Credit household becomes eligible — making the entitlement trivially inferable from data DWP already holds.',
    precedent: 'Dozens of LAs already auto-enrol via local data matching (Policy in Practice found ~1,500 missed children across three boroughs; LOTI ran the cross-borough pilot); the pipe is national.',
    cost: '£', move: 5,
  },
];

// Stated as constraints the history makes evaluable, not as instructions.
export const VALUE_DONTS = {
  research: 'Three constraints the history makes testable. First, a central child database carries a documented record of reversal: ContactPoint was dismantled on cost and proportionality grounds, the Named Person information-sharing provisions were struck down under ECHR Article 8 (Christian Institute v Lord Advocate), and the Panel notes the identifier alone will not change practice culture — so any such design must clear the proportionality test the courts have already applied. Second, adding collections without retiring others increases burden (the rapid post-RAAC questionnaire is one example of new collections being stood up reactively). Third, nationalising the sector’s tooling removes the ownership that makes it work (D2I and ChAT are sector-owned). A repositioning from collector toward steward — standards body, identity infrastructure, and convenor of joins it does not itself hold — can be evaluated against these three constraints rather than asserted.',
  eli5: 'Three things the history warns against. Rebuilding a giant national database of every child has twice been stopped — once on cost and privacy, once by the courts. Piling on new data demands without removing old ones adds work. And taking over the tools councils built for themselves removes what makes them work. The test of a “collector-to-steward” shift is whether it respects all three.',
};
