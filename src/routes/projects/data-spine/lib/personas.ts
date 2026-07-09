// personas.ts — eight stakeholder lenses on the data spine. Each persona is a
// composite grounded in published positions (sector bodies, consultation responses,
// campaign literature) — attributed where a real organisation holds the view.
import type { PersonaId } from './types';

export interface Persona {
  id: PersonaId;
  label: string;
  who: string;
  stake: string;
  wants: string[];
  fears: string[];
  spineTheyWant: string;
  verdict: string;      // the persona's one-paragraph honest take
  eli5: string;
  grounding: string;    // whose published views this composite draws on
}

export const PERSONAS: Persona[] = [
  {
    id: 'mat',
    label: 'MAT data lead',
    who: 'Head of data at a 40-school multi-academy trust, running a central data team over three different MIS platforms inherited through growth.',
    stake: 'Trusts already build mini-spines internally — warehouses joining MIS extracts across their schools. A national spine either replaces that plumbing or adds another reporting surface on top of it.',
    wants: [
      'One canonical pupil record that survives school moves — CTF chase-ups gone',
      'Data that flows back down: trust-level dashboards as good as the DfE’s own attendance views',
      'Open standards so the trust isn’t hostage to one MIS vendor’s export formats',
      'Fewer, not more, statutory collections — the census duplicated through a spine is the nightmare',
    ],
    fears: [
      'A new compliance surface: feeds to maintain, data-quality league tables, blame for upstream errors',
      'DfE seeing trust-internal operational data (behaviour, interventions) before the trust has context around it',
      'Accountability by ambush — regulators reading live feeds and acting on them without dialogue',
    ],
    spineTheyWant: 'A standards-and-exchange layer that kills duplicate returns and gives as much data back as it takes.',
    verdict: 'We already run a data spine — ours. If the national one means the census dies and pupils arrive with their records attached, we are the loudest supporters in the sector. If it means daily feeds of everything plus the census stays, it is just the biggest data collection ever built, and we will fight the burden line by line.',
    eli5: 'Big school groups already join up their own data. They’ll cheer if the national version cuts their paperwork — and revolt if it adds more.',
    grounding: 'ASCL and CST white-paper responses (broadly supportive, burden-focused); trust data-team practice.',
  },
  {
    id: 'la',
    label: 'LA children’s services',
    who: 'Director of children’s services and their data/MASH teams — statutory safeguarding duties, children-missing-education tracking, SEND, admissions — over a patch where academisation removed most of their levers.',
    stake: 'LAs hold the duties (safeguarding, CME, SEND) but lost the data as schools academised. The CWSA hands them new registers to run; the identifier and spine determine whether those duties are performable.',
    wants: [
      'Identity resolution at the front door: the MASH resolving “which child is this?” in minutes, not days of ringing around',
      'Children-not-in-school registers (CWSA duty) fed automatically rather than compiled by hand',
      'Operation Encompass-style event notifications — the right signal to the right school by 9am',
      'FSM auto-enrolment: DWP/HMRC checks joined to their registers so entitled families stop missing out',
    ],
    fears: [
      'An unfunded mandate: statutory duties keyed to infrastructure the DfE ships late or half-built',
      'The spine centralising to Whitehall what is legally the LA’s safeguarding judgement',
      'Wildly uneven LA digital capacity — a spine designed for the best-resourced authority excludes half the country',
    ],
    spineTheyWant: 'A record-locator and identifier service their existing case systems can call — not another national system to re-key into.',
    verdict: 'Every serious case review since Climbié says the same thing: services each held a piece and nobody joined them. We will take the identifier and the locator gladly. But we have watched ContactPoint get built for us and taken away, and we run on the thinnest budgets in the public sector — build it as a service we call, fund the connection, and do not make the register duties commence before the plumbing exists.',
    eli5: 'Councils must keep children safe but can’t see the data. They want the joins desperately — as long as it’s not another expensive system they must staff.',
    grounding: 'LGA briefings (FSM auto-registration), ADCS positions on information sharing, MASH practice literature.',
  },
  {
    id: 'research',
    label: 'Research agency',
    who: 'Quantitative researchers at an education institute or ADR-accredited lab, living off NPD/LEO extracts through the ONS Secure Research Service.',
    stake: 'England’s pupil data is world-class for research and painfully slow to access — months of accreditation for years-old extracts. A spine sets both the freshness of data and the terms of access for a generation.',
    wants: [
      'Faster accredited access: months-old, not years-old, linked data in the SRS/IDS',
      'The consistent identifier fixing linkage where it currently dies — school-to-college transitions, education-to-earnings (LEO), education-to-social-care',
      'In-year data enabling rapid policy evaluation (the attendance feed already lets researchers watch policy work in near-real-time)',
      'Query-not-copy access (OpenSAFELY pattern) that could make MORE data usable at HIGHER safety',
    ],
    fears: [
      'A governance panic closing doors: one spine scandal and researcher access is the first casualty',
      'Operational design crowding out research design — feeds built for dashboards, unusable for longitudinal analysis',
      'Consent/objection models that bias the samples (differential opt-out makes disadvantage research worse)',
    ],
    spineTheyWant: 'Identifier-led linkage plus a modern TRE — Denmark’s register quality with OpenSAFELY’s audit discipline.',
    verdict: 'The NPD is the envy of education researchers worldwide, and it is a decade behind the questions ministers actually ask. An identifier that fixes the post-16 linkage cliff plus in-year feeds would transform evaluation. But the 2012–2020 era of loose distribution nearly cost us the whole estate once — the spine must be the moment access moves to query-not-copy, or the next scandal closes the archive for everyone.',
    eli5: 'Researchers love this data but wait years for stale copies. They want fresher data through safer pipes — because one more scandal and they lose access entirely.',
    grounding: 'ADR UK programme aims, EPI white-paper response, FFT Datalab practice, Bennett Institute/OpenSAFELY advocacy.',
  },
  {
    id: 'policy',
    label: 'DfE policy professional',
    who: 'A grade-6 policy lead in Sanctuary Buildings — owns a delivery commitment (attendance, SEND reform, FSM), answerable to ministers weekly, dependent on analysts for every number.',
    stake: 'Policy careers are made and broken on “is it working?”. Today that question takes a commissioned analysis and a term’s lag; the spine promises it as a dashboard.',
    wants: [
      'In-year feedback loops: did the attendance mentoring programme move the number this half-term?',
      'Cross-cutting joins for the big agendas — disadvantage, SEND, safeguarding all live across departmental datasets',
      'The White Paper delivered: the spine is now a ministerial commitment with their name near it',
      'Fewer data fires: no more discovering the department cannot answer a PQ because two systems disagree',
    ],
    fears: [
      'The custody question landing badly and poisoning the whole agenda (a “database of every child” front page)',
      'A decade-long infrastructure programme eating the delivery window — policy needs it in this Parliament',
      'Operational data being read as accountability data by mistake — daily noise driving weekly panic',
    ],
    spineTheyWant: 'Whatever ships fastest inside the trust envelope — attendance-feed pragmatism extended to the next three datasets, not a cathedral.',
    verdict: 'The attendance feed changed what it feels like to run policy: you watch the thing move. Every other brief still runs on last year’s data. The spine is the difference between governing by anecdote and governing by evidence — but I have read the ContactPoint file, and I know one bad headline about a child database costs us the Parliament. Ship it vertebra by vertebra, each one useful on its own.',
    eli5: 'The people writing policy want tomorrow’s data instead of last year’s, so they can tell if their ideas work — without triggering a privacy firestorm that kills the project.',
    grounding: 'White-paper framing, DfE daily-collection principles document, algorithmic transparency records.',
  },
  {
    id: 'digital',
    label: 'DfE Digital & Technology',
    who: 'The department’s digital, data and technology profession — service teams, architects, the incoming Director General for Digital, and the people who inherit the ICO audit actions.',
    stake: 'They must actually build and run it — against the departmental record: Verify-era delivery odds, 139 ICO recommendations, and a services estate only recently consolidated from 271 systems into 57 service lines.',
    wants: [
      'An incremental architecture: extend the attendance feed and Education Record patterns rather than a big-bang platform',
      'The locator pattern (pointers, not content) — smaller honeypot, smaller blast radius, smaller DPIA',
      'Standards first: open schemas the market implements, so the DfE isn’t writing adapters for every MIS forever',
      'A funded, named, accountable service owner — infrastructure without an owner becomes shelfware',
    ],
    fears: [
      'Policy overpromising: “seamless” in a white paper becomes an undeliverable everything-machine',
      'Being handed NHS-Spine ambitions on GOV.UK Verify budgets',
      'Inheriting the IG debt: building new pipes on top of unresolved audit findings',
      'Vendor dependency hardening: the spine accidentally making Wonde/one MIS the load-bearing wall of the state',
    ],
    spineTheyWant: 'A thin, boring platform: identity API, record locator, published standards, ruthless audit logging — everything else stays federated.',
    verdict: 'We have two live proofs (attendance, Education Record) and one corpse (ContactPoint) — the delivery strategy writes itself: thin spine, standards-led, value at every increment. What keeps us up at night is not the engineering, it is the gap between the white paper adjective “seamless” and the funded reality, on a department still working through an ICO audit. Say no to the cathedral early, or we are Verify with children’s data.',
    eli5: 'The department’s own techies want to build it small, boring and step-by-step — because they’ve seen big government IT projects die, and this one involves children’s data.',
    grounding: 'DfE digital strategy (271→57 service lines), SUI pilots’ federated architecture, DG Digital role scope, Verify PAC findings.',
  },
  {
    id: 'vendor',
    label: 'MIS vendor & broker',
    who: 'Product leadership at an MIS (Arbor, Bromcom, ESS SIMS) or a data broker (Wonde, Groupcall) — the commercial layer that already moves this data every day.',
    stake: 'Brokers ARE the current spine: the DfE’s own daily attendance collection rides on Wonde. A national spine either standardises them into a bigger market, disintermediates them, or nationalises their niche.',
    wants: [
      'The spine as an API standard vendors implement — not a state-run broker replacing them',
      'A level playing field: standards that stop any one vendor (or the incumbent) weaponising integration',
      'Clear, stable specs with realistic timelines — vendors carry the census schema changes every year already',
      'A commercial story: connectivity as a funded service, not an unfunded compliance duty',
    ],
    fears: [
      'Disintermediation: DfE building direct MIS-to-state pipes and deleting the broker business overnight',
      'Standards written around the biggest incumbent’s data model',
      'Liability drift: vendors blamed for data quality, privacy breaches and outages on infrastructure they don’t control',
    ],
    spineTheyWant: 'Published open standards + certification, with vendors competing on how well they implement the pipes.',
    verdict: 'Quietly: the spine already exists and we run it — 20,000 schools each, the DfE is our customer too. Standardise us and we can compete on quality; nationalise us and you rebuild in five years what already works, minus the support desks. The real question the consultation must answer is whether critical national child-data infrastructure should live in venture-backed private companies at all — we would rather that question were answered by design than by scandal.',
    eli5: 'Private companies already pipe school data around — including to the government. They want the new rules to make them the regulated plumbers, not make them redundant.',
    grounding: 'Wonde’s role in the attendance solution, Groupcall Xporter scale, CMA MIS market investigation, techUK white-paper response.',
  },
  {
    id: 'ogd',
    label: 'Other government department',
    who: 'Data-sharing and policy teams at DWP, HMRC, Home Office, MoJ, DHSC — departments that already exchange data with the DfE through ECS checks, LEO linkage and safeguarding gateways.',
    stake: 'Education data is upstream of half of social policy: benefits (FSM passporting), earnings (LEO), health (SUI/NHS number), justice. A spine is a new front door — and every department will knock.',
    wants: [
      'Transactional joins that already half-exist made reliable: FSM auto-enrolment (DWP/HMRC), CME cross-checks (DHSC), care-leaver transitions (MoJ/DWP)',
      'The NHS number decision (their systems mostly speak it already)',
      'DUAA 2025 gateways actually used — the legal plumbing now exists for public-body sharing',
    ],
    fears: [
      'Education-side governance so restrictive the front door stays shut (from their view)',
      'Being the villain of the story: the Home Office MoU is the case study every privacy campaigner cites, and new requests inherit that shadow',
    ],
    spineTheyWant: 'A well-governed API they can be lawfully authorised against, purpose by purpose — because informal MoUs keep blowing up.',
    verdict: 'Cross-government joins deliver real money to real families — auto-enrolled FSM alone finds thousands of entitled children councils were missing. But we are also the reason this is hard: one immigration-enforcement MoU a decade ago still poisons every conversation. The lesson we would offer the DfE: purpose-specific statutory gateways, published, with the chilling-effect risk assessed each time — never another quiet memorandum.',
    eli5: 'Other ministries want to plug in — sometimes to give families money automatically, sometimes for darker reasons. One old misuse still haunts every new request.',
    grounding: 'ECS/FSM auto-enrolment machinery, LEO dataset, Home Office MoU history, DUAA 2025 provisions.',
  },
  {
    id: 'parent',
    label: 'Parent & privacy advocate',
    who: 'Parents, and the campaigners who read the legislation for them — defenddigitalme above all, plus medical bodies (BMA, GMC, RCGP) on the NHS-number question.',
    stake: 'It is their children’s data — collected compulsorily from age 2, ~400 items a year, held for life, and (the record shows) shared in ways parents were never told about.',
    wants: [
      'Transparency with teeth: parents able to see what is held and who has accessed it (the Estonian log, not an annual PDF)',
      'Purpose limitation in statute — safeguarding data not becoming immigration data, ever again',
      'A statutory code of practice on children’s education data (the ICO/defenddigitalme ask)',
      'Rights that work: SARs a parent can actually use, objection routes captured at admission, records that expire',
    ],
    fears: [
      'The honeypot: a lifetime child record joined across services is the most sensitive database the state would hold',
      'Chilling effects: GMC and BMA warn families may avoid GP registration if the NHS number becomes a tracking key',
      'Scope creep by regulation: the CWSA leaves the user list to future ministers — “we can explore the provisions further” is already on the record',
      'Profiling: “flight paths” and risk scores attached to five-year-olds, fed to algorithms nobody audits',
    ],
    spineTheyWant: 'Mostly, they want the question inverted: prove each join is necessary, minimal and visible — infrastructure earns trust use-case by use-case, or not at all.',
    verdict: 'The department lost this argument once already — ContactPoint — and its record since (2,385 NPD distributions, the Home Office MoU, an ICO audit it never published) is why “secure and privacy-respecting” in a white paper convinces nobody. The spine could be built well: pointers not databases, access logs parents can read, purposes fixed in law. Nothing in the department’s history suggests it will be — unless the consultation is fought hard. So it will be.',
    eli5: 'Parents’ champions say: you already misused school data and got audited for it — so this time, show us every access, fix the purposes in law, and build the smallest thing that works.',
    grounding: 'defenddigitalme State of Data reports + white-paper response, GMC/BMA/RCGP SUI positions, ICO 2020 audit, Special Needs Jungle.',
  },
];

export const PERSONA_META: Record<PersonaId, { short: string }> = {
  mat: { short: 'MAT' },
  la: { short: 'LA' },
  research: { short: 'Research' },
  policy: { short: 'DfE policy' },
  digital: { short: 'DfE Digital' },
  vendor: { short: 'MIS/broker' },
  ogd: { short: 'OGD' },
  parent: { short: 'Parent/privacy' },
};
