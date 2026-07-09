// governance.ts — the project's largest section: information governance, the trust
// ledger the DfE brings to the consultation, the legal plumbing, the catalogue of
// privacy-preserving techniques mapped to spine layers, and the interactive
// privacy-design playbook (choices → consequences, grounded in precedent).
import type { Confidence } from './types';

// ---- The trust ledger: what actually happened to education data ----
export interface TrustEvent {
  id: string;
  year: string;
  title: string;
  what: string;
  why: string;    // why it matters to the spine
  eli5: string;
  confidence: Confidence;
  url?: string;
}

export const TRUST_EVENTS: TrustEvent[] = [
  {
    id: 'npd-distribution', year: '2012–2025', title: '2,385+ NPD distributions to third parties',
    what: 'A 2012 regulations change let the DfE share identifiable National Pupil Database extracts with third parties, including commercial actors. defenddigitalme counts at least 2,385 unique distributions since — 39% of legacy requests at the most sensitive tier. Recipients have included journalists and, in one notorious case, pupil-address heat-maps for property marketing.',
    why: 'The spine consultation happens in the shadow of this: "trust us with more" from an organisation that distributed what it had, widely, without most parents ever knowing the database existed.',
    eli5: 'For over a decade, children\'s records were handed out thousands of times — to researchers, but also companies and journalists — while parents had no idea.',
    confidence: 'fact', url: 'https://defenddigitalme.org/2026/04/15/national-pupil-data-distribution-a-2026-review-and-how-to-fix-it/',
  },
  {
    id: 'ho-mou', year: '2015–2018', title: 'The Home Office MoU',
    what: 'A memorandum of understanding gave the Home Office monthly matching against pupil records for immigration enforcement — 1,836 records supplied. Nationality and country-of-birth were added to the census in 2016 while ministers deflected on the sharing; the Against Borders for Children boycott followed; collection stopped in 2018 and the data was deleted in 2020. Separately, police forces obtained pupil data — Merseyside Police once acquired a school\'s entire four-year pupil record.',
    why: 'The canonical scope-creep case: safeguarding-adjacent data became enforcement data through a quiet administrative agreement, not legislation. Every "purpose limitation" argument about the spine cites it — because it happened.',
    eli5: 'School records collected to help children were secretly used to find families for immigration enforcement. Parents boycotted; the government backed down.',
    confidence: 'fact', url: 'https://defenddigitalme.org/2016/12/15/children-school-census-nationality/',
  },
  {
    id: 'ico-audit', year: '2020', title: 'The ICO audit',
    what: 'The regulator audited the DfE and found it in breach of data-protection law: no record of processing (Art 30), "no clear picture of what data is held", no information-governance oversight, over-reliance on the public-task basis, transparency failures. 139 recommendations, over 60% urgent or high priority. The full report was never published.',
    why: 'The department proposing to run the most sensitive child-data infrastructure in Europe was formally found unable to account for the data it already held. The audit actions are the spine\'s real prerequisite list.',
    eli5: 'The privacy watchdog inspected the department and found it didn\'t even know what data it had. It was given 139 things to fix.',
    confidence: 'fact', url: 'https://schoolsweek.co.uk/dfe-broke-pupil-data-protection-laws-damning-ico-audit-reveals/',
  },
  {
    id: 'trustopia', year: '2022', title: 'The LRS / Trustopia breach',
    what: 'The ICO reprimanded the DfE after Trustopia, a screening firm, used Learning Records Service access for age-verification checks for gambling companies — exposure measured against ~28m learner records. The access route was an inherited account nobody had revoked.',
    why: 'A live demonstration that access control, not collection, is where education data governance actually fails — and precisely the class of failure a spine multiplies if access is designed loosely.',
    eli5: 'A private company kept an old login to a government learner database and used it to help gambling firms check ages. Nobody had turned the access off.',
    confidence: 'fact', url: 'https://defenddigitalme.org/the-learner-records-service-data-breach-and-ico-audit-a-connected-chronology/',
  },
  {
    id: 'contactpoint', year: '2009–2010', title: 'ContactPoint built, then destroyed',
    what: 'The universal child index — every child in England, £224m — was switched off within a year of full operation by an incoming government, on privacy and proportionality grounds. Its targeted sibling CP-IS (child-protection flags keyed on NHS number, shared between councils and unscheduled NHS care) survived and still runs.',
    why: 'The empirical answer to the custody question: in England, universal child databases die and targeted, purpose-bound services live. Any spine design that reads as "ContactPoint 2" carries its fate risk.',
    eli5: 'Britain built the big children\'s database once. It lasted a year. The small, targeted version built at the same time still quietly works.',
    confidence: 'fact', url: 'https://researchbriefings.files.parliament.uk/documents/SN05171/SN05171.pdf',
  },
];

// ---- Legal plumbing ----
export interface LegalInstrument {
  id: string;
  name: string;
  what: string;
  spineRelevance: string;
  eli5: string;
  confidence: Confidence;
  url?: string;
}

export const LEGAL: LegalInstrument[] = [
  {
    id: 'gdpr', name: 'UK GDPR + DPA 2018',
    what: 'The baseline: education data is processed mostly under the public-task basis; special-category data (health, SEND) needs additional conditions; children\'s data attracts specific protection ("children merit specific protection" — Recital 38) though education has no dedicated statutory code.',
    spineRelevance: 'The 2020 audit showed the department struggling with these baseline duties. A spine multiplies every obligation: records of processing, DPIAs per flow, transparency to data subjects who are children.',
    eli5: 'The ordinary data-protection rules — which the department was already found breaching before adding anything new.',
    confidence: 'fact', url: 'https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/',
  },
  {
    id: 'cwsa', name: 'Children\'s Wellbeing and Schools Act 2026, ss.16LA–16LD',
    what: 'Inserts the consistent-identifier duty into the Children Act 2004: designated agencies must include the identifier when sharing for safeguarding/welfare purposes. The Act does not name the NHS number (regulations will) and leaves the designated-bodies list to future regulations. Critically, it provides that disclosure "does not breach any obligation of confidence" — which critics note strips the consent/objection protections that s.251A Health and Social Care Act 2012 attached to NHS-number use in health.',
    spineRelevance: 'The identifier\'s statutory foundation — and the open door: both the number and the user list are delegated to ministers via regulations, which is exactly where scope-creep concern concentrates.',
    eli5: 'The new law creates the shared child number but leaves the two biggest questions — which number, and who gets to use it — for ministers to decide later.',
    confidence: 'fact', url: 'https://defenddigitalme.org/2025/06/14/nhs-number-to-be-national-id-mandated-in-childrens-wellbeing-and-schools-bill/',
  },
  {
    id: 'duaa', name: 'Data (Use and Access) Act 2025',
    what: 'Creates "recognised legitimate interests" — a lawful basis with no balancing test — explicitly covering safeguarding of vulnerable individuals and responding to public-body requests; broadens "scientific research" (including commercial); relaxes notice duties for research reuse; removes the sender\'s duty to verify a requesting public body\'s need.',
    spineRelevance: 'The spine\'s enabling environment: data can lawfully move with less friction than at any point since 2018. Advocates read that as the plumbing finally matching the policy; critics read it as the guardrails coming off exactly as the volume increases.',
    eli5: 'A 2025 law made it legally easier for public bodies to share data — which makes the spine easier to run and easier to worry about, simultaneously.',
    confidence: 'fact', url: 'https://ico.org.uk/about-the-ico/what-we-do/legislation-we-cover/data-use-and-access-act-2025/the-data-use-and-access-act-2025-what-does-it-mean-for-organisations/',
  },
  {
    id: 'dea', name: 'Digital Economy Act 2017 research gateway',
    what: 'The accredited route for research access: DfE data flows into the ONS Secure Research Service (transitioning to the cross-government Integrated Data Service) under Five Safes governance — safe people, projects, settings, outputs, data.',
    spineRelevance: 'The already-working template for the spine\'s analytical face: accredited researchers, secure settings, disclosure control — the opposite pole from the 2012-era "post an extract" model.',
    eli5: 'There\'s already a well-guarded reading room for researchers. The question is whether the spine routes analysis through it — or around it.',
    confidence: 'fact', url: 'https://www.ons.gov.uk/aboutus/whatwedo/statistics/requestingstatistics/secureresearchservice',
  },
  {
    id: 'code', name: 'A statutory code of practice (the missing instrument)',
    what: 'Health data has Caldicott Guardians, a National Data Guardian, and statutory codes. Children\'s education data has none of these. defenddigitalme and others campaign for a statutory code of practice on children\'s data and education; the ICO has signalled support.',
    spineRelevance: 'The most-cited governance gap in every critical response to the white paper: the spine would industrialise flows that currently lack even the sector-specific rulebook health considers basic.',
    eli5: 'Hospitals have special guardians and rulebooks for patient data. Schools\' data has nothing equivalent — and campaigners say fix that before building the spine.',
    confidence: 'fact', url: 'https://defenddigitalme.org/2025/03/03/a-code-of-practice-on-childrens-data-and-education-whats-next/',
  },
];

// ---- Privacy-enhancing techniques, mapped to spine layers ----
export interface Pet {
  id: string;
  name: string;
  layer: 'identifier' | 'index' | 'exchange' | 'standards' | 'governance';
  what: string;
  precedent: string;
  maturity: 'proven' | 'emerging';
  eli5: string;
  url?: string;
}

export const PETS: Pet[] = [
  {
    id: 'pseudonym', name: 'Pseudonymisation at source', layer: 'identifier', maturity: 'proven',
    what: 'The raw identifier (NHS number) never travels with analytical data: it is replaced at the point of extraction with sector-scoped pseudonyms via a keyed hash, so a breach of any analytical store cannot re-identify children, and datasets from different sectors cannot be joined without the key authority\'s involvement.',
    precedent: 'Standard in NHS analytics pipelines; the Welsh SUI pilot went further — the NHS number was deleted after matching for matched children.',
    eli5: 'Swap the real number for a code the moment data leaves the building; only a locked service can translate back.',
    url: 'https://gds.blog.gov.uk/2025/10/09/using-privacy-enhancing-technologies-to-enable-international-data-sharing/',
  },
  {
    id: 'locator', name: 'Locator, not warehouse', layer: 'index', maturity: 'proven',
    what: 'Data minimisation by architecture: the national layer stores pointers (which service holds a record) and never case content. A breach of the spine itself then reveals service-contact metadata, not case files. This is the NHS National Record Locator pattern — and the shape the SUI pilots have already published.',
    precedent: 'NHS NRL, CP-IS; the SUI pilots\' find-a-record/fetch-a-record APIs. ContactPoint\'s destruction is the counter-precedent for going further.',
    eli5: 'The centre keeps a phone book, never the files. Steal the phone book and you still don\'t have the files.',
    url: 'https://digital.nhs.uk/developer/api-catalogue/national-record-locator-fhir/v2.8.0',
  },
  {
    id: 'query', name: 'Query-not-copy analytics', layer: 'exchange', maturity: 'proven',
    what: 'Analysts never receive data; their code travels to the data. OpenSAFELY runs analyses in situ over pseudonymised NHS records, with every query logged and published. Applied to education, the 2012-era model (post an extract to an applicant) becomes impossible by construction — the fix defenddigitalme explicitly proposes for NPD distribution.',
    precedent: 'OpenSAFELY (58m NHS records through the pandemic, zero copies released); federated analytics in GDS\'s PET guidance.',
    eli5: 'Instead of mailing out copies of the data, researchers send in their questions and only answers come back — every question on the record.',
    url: 'https://www.bennett.ox.ac.uk/blog/2023/03/the-five-safes-framework-and-applying-it-to-opensafely/',
  },
  {
    id: 'tre', name: 'Trusted research environments + Five Safes', layer: 'governance', maturity: 'proven',
    what: 'Accredited researchers, approved projects, secure settings, checked outputs: the Five Safes framework operationalised in the ONS SRS/IDS, where NPD and LEO extracts already live. The spine\'s analytical access routes through TREs rather than creating new distribution channels.',
    precedent: 'ONS Secure Research Service; ADR UK\'s flagship LEO dataset; the DfE\'s own Data Access and Engagement Programme is already moving shares this way.',
    eli5: 'A guarded reading room: vetted people, vetted questions, nothing leaves without checking. It already exists — use it.',
    url: 'https://www.gov.uk/data-ethics-guidance/the-five-safes-framework',
  },
  {
    id: 'dp', name: 'Differential privacy on published outputs', layer: 'standards', maturity: 'emerging',
    what: 'Calibrated statistical noise on published aggregates (dashboards, school profiles, weekly statistics) with formal guarantees that no individual child is identifiable — replacing the blunter suppress-small-cells approach, which fails against repeated queries and side knowledge.',
    precedent: 'US Census Bureau 2020 (whole-population deployment); GDS PET guidance pairs it with cell suppression for cross-border stats.',
    eli5: 'Published numbers get a precisely measured amount of blur — enough that no one can spot a single child, small enough that the statistics stay useful.',
    url: 'https://gds.blog.gov.uk/2025/10/09/using-privacy-enhancing-technologies-to-enable-international-data-sharing/',
  },
  {
    id: 'audit', name: 'Immutable, citizen-visible access logs', layer: 'governance', maturity: 'proven',
    what: 'Every access to a child\'s record is logged immutably, and the log is visible — to the family, not just internal auditors. Estonia\'s X-Road made this ordinary twenty years ago: citizens inspect who queried their data and ask why. The single highest-leverage trust technology available, and the cheapest.',
    precedent: 'Estonia X-Road access logs; the DfE\'s external-data-shares register is a (quarterly, aggregate) gesture in this direction.',
    eli5: 'A receipt every time anyone looks at your child\'s record — and you can read the receipts.',
    url: 'https://e-estonia.com/solutions/interoperability-services/x-road/',
  },
  {
    id: 'consent', name: 'Rights capture at the front door', layer: 'standards', maturity: 'emerging',
    what: 'Objection and transparency built into the admission process: rights information and objection routes captured on the admission form, coded in the MIS, and propagated with the data through every broker and feed — so a family\'s objection travels with the record instead of evaporating at the first hop.',
    precedent: 'defenddigitalme\'s concrete proposal in its 2026 NPD review; no national implementation yet — which is rather the point.',
    eli5: 'When you enrol your child you\'d see what data goes where and could object — and that choice would stick to the record wherever it flows.',
    url: 'https://defenddigitalme.org/2026/04/15/national-pupil-data-distribution-a-2026-review-and-how-to-fix-it/',
  },
  {
    id: 'abac', name: 'Purpose-bound, attribute-based access', layer: 'exchange', maturity: 'proven',
    what: 'Access decisions computed per request from role + purpose + legal gateway + child-specific context (e.g. shielding flags), not from standing database accounts. The Trustopia breach was a standing account nobody revoked; ABAC makes that class of failure structurally harder. Legal gateways become machine-checkable policy.',
    precedent: 'NHS national services\' role-based access + legitimate-relationship checks; ContactPoint\'s inadequate shielding is the design warning.',
    eli5: 'No permanent keys to the building — every single request must state who, why, and under which rule, and the door checks all three.',
    url: 'https://digital.nhs.uk/services/spine',
  },
  {
    id: 'synthetic', name: 'Synthetic data for the ecosystem', layer: 'standards', maturity: 'emerging',
    what: 'High-fidelity synthetic pupil datasets for MIS vendors, edtech developers and researchers testing pipelines — so the ecosystem builds and tests against realistic data without any real child\'s record leaving governance. Cuts off the "we needed production data to test" excuse that drives quiet copies.',
    precedent: 'NHS England synthetic A&E data; ONS synthetic census pilots; GAO\'s PET survey covers the technique.',
    eli5: 'Give developers convincing fake children to build with, so no one needs real ones.',
    url: 'https://www.gao.gov/products/gao-26-109063',
  },
];

export const PET_LAYER_META: Record<Pet['layer'], { label: string; color: string }> = {
  identifier: { label: 'L1 · Identifier', color: '#7a5aa6' },
  index: { label: 'L2 · Index', color: 'var(--accent-ink)' },
  exchange: { label: 'L3 · Exchange', color: '#2f7d4f' },
  standards: { label: 'L4 · Standards', color: '#b4632e' },
  governance: { label: 'L5 · Governance', color: '#8a2d3a' },
};

// ---- The privacy-design playbook (interactive) ----
// Four design decisions; each option carries a trust score contribution (0–25) and a
// consequence grounded in precedent. HYPOTHESIS by construction: scores are a
// structured way to explore the argument, not a measurement.
export interface PlayOption {
  id: string;
  label: string;
  detail: string;
  consequence: string;
  precedent: string;
  score: number; // contribution to trust (0–25)
}
export interface PlayDecision {
  id: string;
  no: number;
  title: string;
  question: string;
  options: PlayOption[];
}

export const PLAYBOOK: PlayDecision[] = [
  {
    id: 'custody', no: 1, title: 'Custody', question: 'Where do the records live?',
    options: [
      {
        id: 'store', label: 'Central store', score: 3,
        detail: 'Collect records (or rich summaries) into one national system.',
        consequence: 'Maximum capability, maximum honeypot, maximum politics. Every breach, every misuse and every headline lands on one asset with every child in it.',
        precedent: 'ContactPoint: built for £224m, switched off within a year. No English universal child store has survived.',
      },
      {
        id: 'locator', label: 'Index + locator', score: 18,
        detail: 'National identity resolution + record pointers; case content stays in local systems, fetched under per-request rules.',
        consequence: 'Most operational value per unit of risk. The centre knows who and where, never what — a breach leaks contact metadata, not case files. Matches the SUI pilots\' published shape.',
        precedent: 'NHS PDS + National Record Locator, two decades at national scale; CP-IS outliving ContactPoint.',
      },
      {
        id: 'federated', label: 'Federated queries only', score: 22,
        detail: 'No national store at all — signed, logged queries between systems that keep their own data.',
        consequence: 'Smallest attack surface and strongest privacy story; hardest delivery (24,000+ endpoints, and interoperability is mostly institutional agreements). Rapid-response use-cases get slower and flakier.',
        precedent: 'Estonia\'s X-Road — proven for 20 years, in a country of 1.3m with one civil register.',
      },
    ],
  },
  {
    id: 'identifier', no: 2, title: 'Identifier', question: 'What keys the join?',
    options: [
      {
        id: 'nhs', label: 'NHS number everywhere', score: 8,
        detail: 'The government\'s piloted intent: one civic number across education, health, social care and police.',
        consequence: 'Cheapest and near-universal from birth — but imports the chilling-effect risk the GMC and BMA warn about: families avoiding GPs because the health number now tracks them everywhere. One number also means one skeleton key if governance slips.',
        precedent: 'Netherlands runs education on the civic BSN successfully — inside a strong statutory register regime England lacks.',
      },
      {
        id: 'mapped', label: 'Education ID, mapped', score: 15,
        detail: 'A lifetime education identifier (fix UPN/ULN), mapped to the NHS number only inside a controlled matching service when a cross-sector purpose is authorised.',
        consequence: 'Keeps sector data self-contained by default; cross-sector joins become deliberate, gated events rather than a standing property of the data. Costs a matching service and issuance discipline.',
        precedent: 'New Zealand\'s NSN: an education-scoped lifetime number that works without becoming a national ID.',
      },
      {
        id: 'wrapped', label: 'Matching-service wrap', score: 20,
        detail: 'No single number travels: sector systems keep their own IDs; a national matching service resolves identity per authorised request and issues per-purpose pseudonyms.',
        consequence: 'Strongest privacy architecture — datasets cannot be joined even if stolen together — and the hardest to explain to a minister. Matching quality becomes the safeguarding-critical component.',
        precedent: 'The Wigan pilot\'s PDS-adapter matching service is already halfway here; Wales deleted the NHS number post-match.',
      },
    ],
  },
  {
    id: 'access', no: 3, title: 'Access', question: 'Who gets in, and how?',
    options: [
      {
        id: 'standing', label: 'Standing accounts', score: 2,
        detail: 'Approved organisations get durable credentials and query as needed.',
        consequence: 'Operationally frictionless and historically catastrophic: standing access is how Trustopia happened, and how one police force acquired a school\'s entire pupil history. Access reviews always lag reality.',
        precedent: 'The LRS breach; the 2012–2020 NPD distribution era.',
      },
      {
        id: 'purpose', label: 'Purpose-bound requests', score: 18,
        detail: 'Every request states role + purpose + legal gateway, evaluated per transaction (attribute-based access control); bulk analysis goes through TREs.',
        consequence: 'Legal gateways become machine-checkable; misuse requires lying to the system rather than merely possessing a login. Costs real engineering and an authorisation authority someone must run.',
        precedent: 'NHS legitimate-relationship checks; Five Safes for the analytical route.',
      },
      {
        id: 'query-only', label: 'Query-not-copy everywhere', score: 22,
        detail: 'No raw record access outside source systems at all: operational users get answers ("is this child on a roll?"), analysts get code-to-data TREs, nobody gets extracts.',
        consequence: 'Distribution scandals become impossible by construction. Some legitimate front-line workflows (reading a case history in a crisis) need carefully designed exceptions — which is where the model gets tested.',
        precedent: 'OpenSAFELY: 58m records analysed through a pandemic, zero extracts released, every query public.',
      },
    ],
  },
  {
    id: 'transparency', no: 4, title: 'Transparency', question: 'Who watches — and can families see?',
    options: [
      {
        id: 'internal', label: 'Internal audit', score: 3,
        detail: 'Access logging reviewed by the department and the ICO on request.',
        consequence: 'The status quo that produced the 2020 audit findings. Internal-only logs are read after scandals, not before them.',
        precedent: 'The DfE\'s pre-2020 arrangements; the unpublished audit report itself.',
      },
      {
        id: 'register', label: 'Published shares register', score: 12,
        detail: 'Quarterly publication of who received what, plus DPIAs and an annual governance report.',
        consequence: 'Meaningful accountability for journalists and campaigners; invisible to individual families. Roughly where DfE better practice already sits (the external-data-shares register).',
        precedent: 'DfE\'s quarterly external-data-shares publication; algorithmic transparency records.',
      },
      {
        id: 'citizen', label: 'Family-visible access log', score: 22,
        detail: 'Every access to a child\'s record generates an entry the family can read — with shielding regimes for children whose location is protected.',
        consequence: 'The single strongest trust instrument available: surveillance concerns answer themselves when every look leaves a receipt the parent holds. Shielding design is genuinely hard and must be got right first.',
        precedent: 'Estonia, ordinarily, for 20 years. The Education Record app proves DfE can put records in family hands.',
      },
    ],
  },
];

/** Verdict bands for the playbook's combined trust score (max 89 achievable → normalise to /100 in UI). */
export function playbookVerdict(pct: number): { label: string; tone: 'good' | 'mid' | 'bad'; text: string } {
  if (pct >= 75) return {
    label: 'Trustworthy by design', tone: 'good',
    text: 'This combination answers the trust deficit structurally: minimal custody, gated joins, no extracts, receipts for families. It is also the slowest and most expensive to deliver — the political risk shifts from privacy backlash to delivery fatigue. Ship a visible vertebra early.',
  };
  if (pct >= 45) return {
    label: 'Defensible, with pressure points', tone: 'mid',
    text: 'A workable middle: real safeguards, real capability. Its weakness is drift — every pressure point (a standing account here, a new user by regulation there) erodes it quietly. This design needs its guardrails in statute, not in policy documents, or it degrades into the ContactPoint-shaped thing it was trying not to be.',
  };
  return {
    label: 'ContactPoint 2', tone: 'bad',
    text: 'This is the design England has already built and destroyed once: central custody, broad standing access, internal-only oversight. It maximises capability on paper and has a documented failure mode in practice — one government, one headline, one switch-off. The record suggests it does not survive a Parliament.',
  };
}

// ---- Closing synthesis ----
export const SYNTHESIS = {
  title: 'How to build it without repeating ContactPoint',
  points: [
    'Fix the layer nobody has designed: governance. The white paper commits to plumbing; the trust ledger shows plumbing was never the failure point — access rules, purpose limits and oversight were.',
    'Choose the locator. Every English precedent rewards pointers-not-content (NHS NRL, CP-IS, the SUI pilots\' own architecture) and punishes the universal store (ContactPoint).',
    'Make every join earn its place. FSM auto-enrolment ships money to families and is loved; the Home Office MoU shipped enforcement and poisoned a decade. Purpose-by-purpose statutory gateways, each with its own chilling-effect assessment.',
    'Give families the receipts. A parent-visible access log is cheaper than any of the cryptography and worth more than all of it.',
    'Retire a collection with every vertebra. The spine buys sector goodwill exactly as fast as the census shrinks — burden reduction is the only benefit every persona agrees on.',
  ],
  eli5: 'Build the phone book not the filing cabinet, let parents see every access, make each new use of data justify itself in law, and delete an old form every time a new pipe opens.',
};
