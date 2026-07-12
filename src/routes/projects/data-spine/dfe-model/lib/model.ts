// model.ts — all content for "The DfE model" section, distilled from the uploaded
// analysis paper "Federated Working: National Implementations and Their Underlying
// Models" (Parts I–III, /drive). The three HLD figures are rebuilt as interactive
// components; this module is their single source of data.

// ---------------------------------------------------------------------------
// The blueprint (Figure 1) — nodes, layers and flows of the national fabric
// ---------------------------------------------------------------------------

export interface FabricNode {
  id: string;
  label: string;
  sub?: string;
  /** which build-up stage introduces it (index into FABRIC_STAGES) */
  stage: number;
  band: 'consumers' | 'brokerage' | 'edge-mis' | 'edge-la' | 'cross';
  /** amber = PII-capable element */
  hot?: boolean;
  /** edge-mis only: indicative market share %, drives the weighted fan-out */
  share?: number;
  desc: string;
  exemplar?: string;
  standards?: string;
}

export const FABRIC_NODES: FabricNode[] = [
  // Edge — MIS estates (stage 0)
  { id: 'mis-arbor', label: 'Arbor', sub: '~39–44% of schools', stage: 0, band: 'edge-mis', share: 42,
    desc: 'The current market leader across state schools. Under the model it keeps every pupil record it holds today — its estate simply gains a connector that answers signed queries in situ.', exemplar: 'Data stays with the controller — the X-Road commitment' },
  { id: 'mis-sims', label: 'ESS SIMS', sub: '~a third of schools', stage: 0, band: 'edge-mis', share: 33,
    desc: 'The long-time incumbent, now around a third of schools after recent market churn and litigation. A vendor-neutral overlay avoids betting the spine on any one supplier’s fortunes.' },
  { id: 'mis-bromcom', label: 'Bromcom', sub: '~16% of schools', stage: 0, band: 'edge-mis', share: 16,
    desc: 'The third major. Together the top three carry roughly four in five schools — the fan-out topology in the simulator mirrors this concentration.' },
  { id: 'mis-iris', label: 'IRIS Ed:gen', sub: 'mid-tail', stage: 0, band: 'edge-mis', share: 4,
    desc: 'One of the mid-tail suppliers making up most of the remainder. Certification, not bespoke integration, is what lets the tail join on equal terms.' },
  { id: 'mis-compass', label: 'Compass', sub: 'mid-tail', stage: 0, band: 'edge-mis', share: 3,
    desc: 'Mid-tail MIS supplier. Every estate, large or small, runs the same open-source connector against its own records.' },
  { id: 'mis-juniper', label: 'Juniper / others', sub: 'long tail', stage: 0, band: 'edge-mis', share: 2,
    desc: 'The long tail down to self-hosted schools. A funded on-ramp matters here: the smallest participant must be able to afford the connector, or the fabric has holes exactly where safeguarding needs it most.' },
  // Edge — local authorities (stage 0)
  { id: 'la-a', label: 'LA node', sub: 'children’s services', stage: 0, band: 'edge-la',
    desc: 'Local authorities join as first-class members — children’s services, admissions, attendance and SEND casework — not as an afterthought bolted to a schools-only spine.', exemplar: 'X-Road multilateral membership' },
  { id: 'la-b', label: 'LA node', sub: 'admissions', stage: 0, band: 'edge-la',
    desc: 'Each of the 153 local authorities runs a connector against its own case systems, under the same certification and the same default-deny boundary as an MIS estate.' },
  { id: 'la-c', label: 'LA node', sub: 'attendance · SEND', stage: 0, band: 'edge-la',
    desc: 'The white paper itself concedes LA systems may be less secure than NHS systems — an argument for moving as little pupil-level data as possible, which is exactly what the connector enforces.' },

  // Brokerage (stage 2)
  { id: 'brk-dir', label: 'Directory & Catalogue', sub: 'standards · schemas', stage: 2, band: 'brokerage',
    desc: 'Registers capability, not data: who holds what, against which schema version. Every mature national deployment includes one — it is consistently as much work as the pipes.',
    exemplar: 'X-Road registry · NL Stelselcatalogus · DE VZD-FHIR', standards: 'DCAT, catalogue APIs' },
  { id: 'brk-consent', label: 'Consent & Opt-out Register', sub: 'query & data opt-outs', stage: 2, band: 'brokerage',
    desc: 'A data-blind register of who has objected to what. Opt-outs are applied before a query executes — enforced at source, not remembered at the centre.',
    exemplar: 'India DEPA consent managers · NHS national data opt-out', standards: 'consent receipts, OAuth2 scopes' },
  { id: 'brk-policy', label: 'Policy & Rules Engine', sub: 'ABAC + thresholds', stage: 2, band: 'brokerage', hot: true,
    desc: 'Decides no-PII versus rule-triggered PII release. An attribute-based policy engine confirms legal basis, purpose and threshold before any pupil-level release — the amber path.',
    exemplar: 'Eclipse Dataspace Components usage control · NL Digilevering triggers', standards: 'ABAC / XACML, ODRL usage policies, DSP' },
  { id: 'brk-ledger', label: 'Immutable Transaction Ledger', sub: 'append-only · hash-chained', stage: 2, band: 'brokerage',
    desc: 'Every commission, query, transfer and release is signed and written to an append-only transparency log. Deliberately not a blockchain — X-Road proves signed, time-stamped logs deliver integrity and non-repudiation without consensus overhead.',
    exemplar: 'X-Road signed & time-stamped message logs', standards: 'hash-chained transparency log (Trillian-style)' },
  { id: 'brk-identity', label: 'Identity & Trust Framework', sub: 'OIDC + verifiable creds', stage: 2, band: 'brokerage',
    desc: 'Who may ask; who may receive. Organisation and professional identity, issued under one trust framework — the layer every national exchange co-deploys, because the exchange moves the data but identity decides who may ask.',
    exemplar: 'Singpass · NHS CIS2 · eIDAS 2.0 direction', standards: 'OIDC, W3C Verifiable Credentials' },

  // Consumers (stage 3)
  { id: 'con-dfe', label: 'DfE / ONS analysts', sub: 'national statistics', stage: 3, band: 'consumers',
    desc: 'Commission no-PII federated queries against the catalogue. The analysis travels to the data; only aggregates return — the OpenSAFELY lesson applied to education.' },
  { id: 'con-research', label: 'Researchers', sub: 'accredited · SRS-style', stage: 3, band: 'consumers',
    desc: 'Accredited research access on the DEA 2017 / Secure Research Service pattern — compute-to-data rather than bulk extracts.' },
  { id: 'con-la-mat', label: 'LA & MAT insight teams', sub: 'place / trust planning', stage: 3, band: 'consumers',
    desc: 'Place-based and trust-level planning queries — the same machinery, scoped to their own population, with value returned to the people who supply the data.' },
  { id: 'con-safeguard', label: 'Safeguarding / SEND leads', sub: 'authorised PII recipients', stage: 3, band: 'consumers', hot: true,
    desc: 'The only consumers who ever receive pupil-level data — named professionals, verified identity, minimum-necessary release, under a rule the policy engine has satisfied. In statute: MASH and Multi-Agency Child Protection Teams.' },

  // Cross-domain (stage 5)
  { id: 'x-nhs', label: 'NHS / health', sub: 'FHIR UK Core bridge', stage: 5, band: 'cross',
    desc: 'Federated one-to-one via a FHIR bridge — the NHS number SUI is the resolving key on the safeguarding path. No combined education–health store is ever created.' },
  { id: 'x-csc', label: 'Children’s social care', sub: 'CP-IS lineage', stage: 5, band: 'cross',
    desc: 'The MAIS statutory duty and DPA 2018 safeguarding condition are the lawful gateway; the ledger evidences each disclosure as Working Together requires.' },
  { id: 'x-justice', label: 'Youth justice', stage: 5, band: 'cross',
    desc: 'Cross-agency safeguarding requests traverse sector boundaries under an explicit trust-federation agreement — the Estonia–Finland precedent.' },
  { id: 'x-dwp', label: 'DWP / benefits', stage: 5, band: 'cross',
    desc: 'Milburn’s hidden-NEETs finding makes this essential: a no-PII federated query across education, benefits and health can find the ~314,000 invisible 18–24s without building a combined database.' },
  { id: 'x-police', label: 'Police', sub: 'safeguarding', stage: 5, band: 'cross',
    desc: 'Safeguarding-class access only, through the same rules engine and the same ledger — never bulk access to the estate.' },
];

export interface FabricStage {
  title: string;
  kicker: string;
  narration: string;
  eli5: string;
}

/** the layered build-up — each stage adds one idea to the diagram */
export const FABRIC_STAGES: FabricStage[] = [
  {
    title: 'Start with the estate England already has',
    kicker: 'STAGE 1 · THE EDGE',
    narration: 'No new database. ~24,000 schools and colleges keep their records where they are today — inside six-plus MIS estates and 153 local authorities. Pupil-level data lives here, owned and controlled by schools, trusts and LAs, and under this model it never moves except under an approved rule.',
    eli5: 'Every school already keeps its own records in its own system. Step one: leave them exactly where they are.',
  },
  {
    title: 'Give every participant the same front door',
    kicker: 'STAGE 2 · CONNECTORS',
    narration: 'Each estate and LA runs the same open-source connector — the trust boundary. It is default-deny: data crosses only as a no-PII aggregate, an approved point-to-point transfer, or a rule-triggered PII release. Certification against the connector spec is how you join — no bespoke integrations.',
    eli5: 'Every system gets an identical guarded door. The door starts locked, and only three kinds of thing are ever allowed through it.',
  },
  {
    title: 'Centralise trust, not data',
    kicker: 'STAGE 3 · THE NATIONAL BROKERAGE',
    narration: 'What the DfE actually runs is thin: a directory of who holds what, a consent and opt-out register, a policy and rules engine, an immutable transaction ledger, and the identity and trust framework. Brokers only — this layer holds no pupil-level data. This is the deliberate answer to what a "centralised" DfE model should centralise.',
    eli5: 'The middle is small on purpose. It keeps the phone book, the rulebook, the no-thank-you list and the receipts — but never the records themselves.',
  },
  {
    title: 'Let the questions in at the top',
    kicker: 'STAGE 4 · COMMISSIONING & CONSUMERS',
    narration: 'Analysts, accredited researchers and insight teams commission queries against the catalogue. Queries fan out through the brokerage to every relevant connector, run in situ, and return as aggregates. One consumer class is different: safeguarding and SEND leads, the only authorised recipients of pupil-level data.',
    eli5: 'People with questions ask at the top. The question travels down to every school system, gets answered there, and only the totals come back.',
  },
  {
    title: 'Watch what actually moves',
    kicker: 'STAGE 5 · THE TRAFFIC',
    narration: 'Three kinds of movement, three colours. Teal: no-PII aggregates returning from federated queries. Amber: a rules-based, minimum-necessary PII release to a named professional when a safeguarding or SEND threshold is met. Navy: signed point-to-point transfers between two members (a child moves school). Every arrow, of every colour, is written to the ledger.',
    eli5: 'Green-ish sparks are safe totals. Amber sparks are the rare, logged emergencies. Dark sparks are one school passing a file to the next when a child moves.',
  },
  {
    title: 'Federate beyond education',
    kicker: 'STAGE 6 · GREATER THAN EDUCATION',
    narration: 'Cross-domain reach by trust federation, not a shared pool: health over a FHIR bridge, children’s social care, youth justice, DWP. The join is virtual, governed and logged — a safeguarding query can lawfully cross sector boundaries without a central store of combined records ever existing. This is what answers Milburn’s million-NEET finding safely.',
    eli5: 'Other services — doctors, social workers, job centres — connect the same careful way. Nobody builds one giant folder about every child.',
  },
];

export type FlowKind = 'query' | 'aggregate' | 'pii' | 'p2p' | 'cross';

export const FLOW_META: Record<FlowKind, { label: string; color: string; desc: string }> = {
  query: { label: 'query fan-out', color: 'var(--accent-ink)', desc: 'a signed, no-PII question travelling out to the connectors' },
  aggregate: { label: 'no-PII aggregate', color: '#2f7d4f', desc: 'disclosure-controlled aggregates returning — raw records never move' },
  pii: { label: 'rules-based PII release', color: '#c4570a', desc: 'minimum-necessary pupil data to a named professional, under a satisfied rule' },
  p2p: { label: 'point-to-point', color: '#1c2f4a', desc: 'a signed direct transfer between two members — CTF, casework' },
  cross: { label: 'cross-domain', color: '#7a5aa6', desc: 'trust-federated traffic to health, social care, justice, DWP' },
};

// ---------------------------------------------------------------------------
// The edge node (Figure 2)
// ---------------------------------------------------------------------------

export interface EdgePart {
  id: string;
  label: string;
  sub: string;
  panel: 'source' | 'connector' | 'fabric';
  tone?: 'ok' | 'hot' | 'ledger';
  desc: string;
}

export const EDGE_PARTS: EdgePart[] = [
  { id: 'src', label: 'Pupil-level records', sub: 'they remain here', panel: 'source',
    desc: 'The MIS or LA case system — Arbor, ESS SIMS, Bromcom, IRIS Ed:gen, an LA case system. Owned and controlled by the school, MAT or LA. The connector reads in situ; the records never leave home except under an approved rule.' },
  { id: 'adapter', label: 'Standards adapter', sub: 'native schema → common model', panel: 'connector',
    desc: 'Maps the native MIS schema to the common education data model once — Ed-Fi / OneRoster aligned to UK CBDS, UPN and URN — so one commissioned query can run everywhere without 24,000 bespoke translations.' },
  { id: 'runtime', label: 'Local query runtime', sub: 'compute-to-data', panel: 'connector', tone: 'ok',
    desc: 'Runs federated analytic queries in situ and applies statistical disclosure control (minimum cell sizes, suppression) before anything leaves. The OpenSAFELY pattern: analysis travels to the data.' },
  { id: 'pep', label: 'Policy Enforcement Point', sub: 'blocks by default', panel: 'connector',
    desc: 'Checks consent and rules before anything crosses the boundary. Default-deny is the posture: the burden of proof sits with the query, not with the school.' },
  { id: 'cache', label: 'Consent / opt-out cache', sub: 'this population’s opt-outs', panel: 'connector',
    desc: 'Holds the current query- and data-level opt-outs for this school’s population, synchronised from the national register — so objections are enforced at source even if the centre is unreachable.' },
  { id: 'rules', label: 'Rules evaluator', sub: 'threshold · break-glass', panel: 'connector', tone: 'hot',
    desc: 'Releases PII only when a defined safeguarding / SEND rule is met — legal basis, purpose and threshold confirmed, recipient identity verified. A break-glass path, fully logged, in a different policy class from analytics.' },
  { id: 'signer', label: 'Signing & ledger agent', sub: 'every transaction', panel: 'connector', tone: 'ledger',
    desc: 'Signs every transaction and writes an entry to the immutable log — the thing that makes any override accountable after the fact.' },
  { id: 'f-cat', label: 'Catalogue', sub: 'capability, not data', panel: 'fabric',
    desc: 'The connector registers what it can answer — schema versions, populations — never the data itself.' },
  { id: 'f-consent', label: 'Consent register', sub: 'authoritative opt-outs', panel: 'fabric',
    desc: 'The authoritative national record of objections, synchronised down to every connector’s cache.' },
  { id: 'f-policy', label: 'Policy & rules', sub: 'central policy, local enforcement', panel: 'fabric',
    desc: 'Policy is authored centrally, versioned in the open, and enforced locally by every PEP — law as configuration.' },
  { id: 'f-ledger', label: 'Immutable ledger', sub: 'append-only audit', panel: 'fabric',
    desc: 'The append-only, hash-chained national audit log every signing agent writes to.' },
  { id: 'f-id', label: 'Identity', sub: 'OIDC + verifiable creds', panel: 'fabric',
    desc: 'Organisation and professional identity under one trust framework — who may ask, who may receive.' },
];

// ---------------------------------------------------------------------------
// The two core flows (Figure 3)
// ---------------------------------------------------------------------------

export interface FlowStep {
  title: string;
  desc: string;
  /** node ids (in the flow strip) lit at this step */
  lit: [number, number]; // [from,to] indices into the flow's nodes
}

export interface CoreFlow {
  key: 'a' | 'b';
  name: string;
  tag: string;
  color: string;
  nodes: string[];
  steps: FlowStep[];
  footer: string;
}

export const CORE_FLOWS: CoreFlow[] = [
  {
    key: 'a', name: 'No-PII federated analytic query', tag: 'FLOW A · TEAL', color: '#2f7d4f',
    nodes: ['Analyst', 'Brokerage', 'Connectors', 'Local compute', 'SDC', 'DfE'],
    steps: [
      { title: 'Commission query', desc: 'An analyst defines a no-PII question against the catalogue, using the agreed standards and schemas.', lit: [0, 1] },
      { title: 'Consent & opt-out filter', desc: 'Query- and data-level opt-outs are removed before execution — the register is checked first, not after.', lit: [1, 1] },
      { title: 'Fan-out to nodes', desc: 'The request is distributed to the relevant MIS and LA connectors. No data is centralised.', lit: [1, 2] },
      { title: 'Local compute in situ', desc: 'Each connector runs the analysis against its own records, behind its own trust boundary.', lit: [2, 3] },
      { title: 'Disclosure control', desc: 'Statistical disclosure control is applied locally — minimum cell sizes, suppression — before anything leaves.', lit: [3, 4] },
      { title: 'Aggregate & return', desc: 'Only no-PII aggregates are returned and combined. Raw records never move.', lit: [4, 5] },
    ],
    footer: 'every step is written to the immutable transaction ledger',
  },
  {
    key: 'b', name: 'Rules-based PII release', tag: 'FLOW B · AMBER', color: '#c4570a',
    nodes: ['Trigger', 'Rules engine', 'Identity', 'Release', 'Ledger'],
    steps: [
      { title: 'Condition detected', desc: 'A safeguarding / SEND trigger or lawful cross-agency request meets a defined rule threshold.', lit: [0, 1] },
      { title: 'Rules engine evaluates', desc: 'ABAC policy confirms the legal basis, purpose and threshold are satisfied — the MAIS duty and the DPA 2018 safeguarding condition are the lawful gateway.', lit: [1, 1] },
      { title: 'Identity & authorisation', desc: 'The recipient’s professional identity and role are verified with verifiable credentials — a named professional, not an organisation-wide door.', lit: [1, 2] },
      { title: 'Controlled PII release', desc: 'Minimum-necessary pupil data is shared point-to-point to the named professional. The NHS-number SUI is the resolving key on this path only.', lit: [2, 3] },
      { title: 'Notify & audit', desc: 'Subject / guardian notification per policy; the full entry is written to the immutable ledger — what was shared, with whom, when and why.', lit: [3, 4] },
    ],
    footer: 'every step is written to the immutable transaction ledger',
  },
];

// ---------------------------------------------------------------------------
// Cherry-picked requirements (Part II)
// ---------------------------------------------------------------------------

export interface Requirement { need: string; how: string; from: string }

export const REQUIREMENTS: Requirement[] = [
  { need: 'Federated analytic queries across ~24,000 schools', how: 'Compute-to-data: queries fan out, run in situ, return aggregates only — nothing is centralised.', from: 'UK SDEs / OpenSAFELY + X-Road fan-out' },
  { need: 'Commission & compile no-PII analysis, to standards', how: 'An analytic commissioning service defines queries against a common education data model; disclosure control applied locally.', from: 'Ed-Fi / OneRoster + NL Stelselcatalogus discipline' },
  { need: 'Immutable log of every transaction', how: 'An append-only, hash-chained, signed ledger records every commission, query, transfer and release.', from: 'X-Road signed & time-stamped logs (no blockchain)' },
  { need: 'Point-to-point sharing', how: 'Brokered, signed, mutually-authenticated direct transfers between two members (CTF, casework).', from: 'X-Road security-server model' },
  { need: 'Query opt-outs (consent-based)', how: 'A data-blind consent & opt-out register; opt-outs applied before execution.', from: 'India DEPA + NHS national data opt-out' },
  { need: 'Rules-based PII release on thresholds', how: 'An ABAC policy engine authorises minimum-necessary release when a threshold and legal basis are met — break-glass, fully logged.', from: 'EDC usage-control + base-register event triggers' },
  { need: 'Greater-than-education', how: 'Cross-domain trust federation with health, children’s social care, youth justice and DWP.', from: 'Estonia–Finland trust federation + NHS Spine' },
  { need: 'Local authority connectivity', how: 'LAs join as first-class nodes — children’s services, admissions, attendance, SEND.', from: 'X-Road multilateral membership' },
  { need: 'Open standards end to end', how: 'Education, web and data-space standards throughout the stack.', from: '1EdTech / Ed-Fi / IDS Dataspace Protocol' },
  { need: 'Highly distributed governance', how: 'DfE owns the trust framework and standards; controllership, consent and operation stay at the edge; onboarding by certification.', from: 'X-Road trust framework + TI-M certification + NL directing board' },
];

// ---------------------------------------------------------------------------
// Part I — archetypes and national implementations
// ---------------------------------------------------------------------------

export interface Implementation { where: string; system: string; tech: string; note: string }
// named to avoid collision with the 4-archetype taxonomy in the sibling ../lib/precedents.ts
export interface SurveyArchetype {
  no: number;
  name: string;
  short: string;
  what: string;
  impls: Implementation[];
}

export const SURVEY_ARCHETYPES: SurveyArchetype[] = [
  {
    no: 1, name: 'Brokered data-exchange layer', short: 'X-Road family',
    what: 'A governed hub sits in the path of every transaction — routing, authentication, logging — but never stores the payload. Data is fetched on demand from the owning register.',
    impls: [
      { where: 'Estonia', system: 'X-tee', tech: 'X-Road (open source, MIT); per-member security servers, PKI, signed & time-stamped logs', note: 'The 2001 original. 450+ organisations, 3,000+ services; only the query is brokered.' },
      { where: 'Finland', system: 'Suomi.fi Palveluväylä', tech: 'X-Road core, shared with Estonia', note: 'Cross-border trust federation with Estonia since 2018.' },
      { where: 'Ukraine', system: 'Trembita', tech: 'X-Road-based; underpins the Diia app', note: 'Proved the model at ~44m population scale, through wartime disruption.' },
      { where: 'Cambodia', system: 'CamDX', tech: 'X-Road; per-transaction encryption, signing, time-stamping', note: 'Deployed 2020, extended to banks and the private sector.' },
      { where: 'Iceland · Faroes · Kyrgyzstan · 20+ more', system: 'Straumurinn · Heldin · Tunduk …', tech: 'X-Road core, locally adapted under MIT licence', note: 'The de facto open-source standard for government data exchange.' },
    ],
  },
  {
    no: 2, name: 'API-gateway exchange', short: 'central gateway, agency APIs',
    what: 'A variant of brokered exchange where a central gateway publishes and governs agency APIs.',
    impls: [
      { where: 'Singapore', system: 'APEX + Singpass / MyInfo', tech: 'GovTech API gateway; REST APIs from 45+ agencies; consent-based tell-us-once', note: '97% adult Singpass adoption, ~2,000 services. Agencies keep control of their own APIs.' },
      { where: 'United Kingdom', system: 'NHS Spine', tech: 'Spine Secure Proxy, PDS, MESH messaging; HL7 v3 → FHIR UK Core; CIS2 smartcards', note: '~44,000 systems across ~26,000 organisations; national broker, records held in provider systems.' },
    ],
  },
  {
    no: 3, name: 'Base-register federation', short: 'authentic sources + events',
    what: 'A system of authoritative base registers with standardised messaging, event distribution and a semantic catalogue.',
    impls: [
      { where: 'Netherlands', system: 'Stelsel van Basisregistraties', tech: 'Digikoppeling, Digilevering (events), Digimelding (error feedback), Stelselcatalogus (semantics)', note: 'Changes propagate as events; each consumer decides what is relevant.' },
      { where: 'Denmark', system: 'Grunddata', tech: 'Datafordeler shared distribution platform; standardised core registers', note: 'Funded in proportion to use — a strong take-up incentive.' },
      { where: 'Belgium', system: 'Crossroads Bank for Social Security', tech: 'Routing broker between institutions, no central store', note: 'One of the earliest large-scale "data stays at source" implementations.' },
      { where: 'Spain', system: 'Plataforma de Intermediación', tech: 'Central intermediation over the SARA network', note: 'Once-only lookups against authoritative registers.' },
    ],
  },
  {
    no: 4, name: 'Consent-mediated federation', short: 'the citizen holds the switch',
    what: 'The individual holds consent; a data-blind consent manager brokers flows between source and consumer.',
    impls: [
      { where: 'India', system: 'India Stack — DEPA / Account Aggregator', tech: 'Aadhaar, UPI, DigiLocker; Account Aggregators as data-blind consent managers over standard APIs', note: 'Consent, not the custodian, is the pivot — controller and consent-collector deliberately separated.' },
    ],
  },
  {
    no: 5, name: 'Peer-mesh messaging federation', short: 'servers speak protocol',
    what: 'Autonomous servers speak a common protocol directly to one another, bounded by a certification allow-list.',
    impls: [
      { where: 'Germany', system: 'TI-Messenger', tech: 'Matrix open standard; VZD-FHIR directory; smartcard identity; certified server builds', note: 'Targets 150,000+ healthcare organisations; gematik funds upstream Matrix as a sovereignty measure.' },
    ],
  },
  {
    no: 6, name: 'Compute-to-data', short: 'analysis travels, data stays',
    what: 'The analysis travels to the data and only aggregate results return.',
    impls: [
      { where: 'United Kingdom', system: 'Secure Data Environments / OpenSAFELY', tech: 'TREs; vetted code runs against NHS data in situ; outputs aggregate and reviewed', note: 'The strongest controllership posture of the set — raw records never leave the boundary.' },
    ],
  },
  {
    no: 7, name: 'Foundational identity federation', short: 'identity as the trust primitive',
    what: 'An open-source national identity platform provides the trust primitive the exchange layers depend on.',
    impls: [
      { where: 'Philippines · Ethiopia · Morocco · Sri Lanka · Togo …', system: 'MOSIP-based national ID (PhilSys, Fayda…)', tech: 'MOSIP; biometric de-duplication, token-based auth, eKYC', note: 'The trusted identity primitive exchange layers depend on, adopted across the global south.' },
    ],
  },
];

export interface Observation { title: string; body: string }

export const OBSERVATIONS: Observation[] = [
  { title: 'Data-stays-at-source is the global default', body: 'The single most common pattern is a governed broker routing signed, logged queries between registers that keep their own data. The recurring commitment: no central pool — no single point of failure, controllership stays with the source.' },
  { title: 'An identity layer is almost always co-deployed', body: 'Estonian eID, Singpass, Aadhaar, German health smartcards, MOSIP, NHS CIS2. The exchange moves the data; identity decides who may ask. Treat them as a matched pair, not sequential projects.' },
  { title: 'The real divergence is where consent sits', body: 'Brokered systems put policy in the broker; base-register systems in register rules; India hands it to the citizen; Germany gates membership by certification. Each is a different answer to the same controllership question.' },
  { title: 'A directory / catalogue is non-optional', body: '"Who holds what, and how do I find it" is consistently as much work as the transport — and the semantic layer, not the pipes, is where interoperability succeeds or fails.' },
  { title: 'Standards converge; governance doesn’t travel', body: 'FHIR, REST/OpenAPI, PKI, signed logs — the field is converging technically. The hard half is trust agreements, certification, funding models and legal basis. The software can be copied under an open licence; the governance cannot.' },
];

// ---------------------------------------------------------------------------
// Part III — DfE policy reality check
// ---------------------------------------------------------------------------

export interface Commitment { what: string; source: string; align: string }

export const COMMITMENTS: Commitment[] = [
  { what: 'DfE Data Spine', source: 'Schools white paper (Feb 2026); new DG Digital & Infrastructure remit', align: 'Supplies the spine’s architecture as a federated overlay rather than a central store — delivering the linking the white paper wants while minimising how much pupil data actually moves.' },
  { what: 'Single Unique Identifier (NHS number)', source: 'Children’s Wellbeing and Schools Act 2026, s.16LB; Wigan pilot', align: 'The SUI resolves identity on the PII-release path only; the analytic path stays pseudonymous — honouring the safeguarding-purpose limitation ministers have stated.' },
  { what: 'MAIS statutory information-sharing duty', source: 'DfE MAIS unit; Working Together 2026; DPA 2018 safeguarding condition', align: 'The lawful gateway the rules engine evaluates before any PII release; each disclosure written to the ledger.' },
  { what: 'MAIS Tier 1 Data Sharing Agreement', source: 'MAIS statutory-guidance consultation (2026)', align: 'Serves as the multilateral trust-framework agreement — replacing bilateral DSA spaghetti across ~24,000 schools and every LA.' },
  { what: 'MASH / Multi-Agency Child Protection Teams', source: 'Children’s Wellbeing and Schools Act 2026', align: 'The authorised recipients on the rules-based PII-release path (flow B).' },
  { what: 'NPD & “collection and linking”', source: 'DG role brief; existing NPD cross-linkage to DWP, HMRC, health, Home Office, justice', align: 'A data-minimising alternative to open-ended central linkage — the direct answer to ContactPoint’s precedent and the white paper’s own "LA systems may be less secure" caveat.' },
  { what: 'Milburn review — hidden NEETs', source: '“Young People and Work” interim report (28 May 2026)', align: 'Justifies cross-domain federation: find the hidden cohort across education, benefits and health with a no-PII query — never a combined database. Extends scope to 16–24, DWP and DHSC.' },
  { what: 'School Profiles', source: 'Schools white paper (Feb 2026)', align: 'A worked example of a downstream consumer of no-PII outputs.' },
  { what: 'Content Store / National Data Library', source: 'Schools white paper; national data infrastructure', align: 'Compatible: research and reuse via the compute-to-data pattern rather than bulk distribution.' },
  { what: 'Post-16 & Skills England', source: '2025–26 skills reforms', align: 'FE and skills providers join the same fabric — the place-based data alignment Skills England is seeking.' },
];

export interface Tension { title: string; body: string }

export const TENSIONS: Tension[] = [
  { title: 'Centralise-and-link vs federate', body: 'The department’s language tilts central; the federated posture reaches the same outcomes with a materially stronger privacy and security story.' },
  { title: 'Purpose limitation on the SUI', body: 'Safeguarding-only today. Analytics must not quietly become the reason to broaden it.' },
  { title: 'ContactPoint’s shadow', body: 'Any perception of a revived national children’s database is a live political risk — "no central pool" should be a stated design principle, not an implementation detail.' },
  { title: 'Coverage gaps', body: 'Children without an NHS number — migrant, home-educated, on the Children Not in School register — must not be made more invisible. The fabric needs an explicit fallback resolution path.' },
  { title: 'LA capacity and security', body: 'The white paper’s own caveat. The default-deny connector and local enforcement reduce reliance on uneven LA security.' },
  { title: 'Commercial MIS incentives', body: 'Vendors are given pupil data to build products; mandating the open connector through the DfE MIS framework is the lever against re-created lock-in.' },
];

export interface StackRow { layer: string; choice: string }

export const STACK: StackRow[] = [
  { layer: 'Data model', choice: 'Ed-Fi Data Standard, OneRoster 1.2 — aligned to UK CBDS, UPN and URN' },
  { layer: 'Transport & contracts', choice: 'IDS Dataspace Protocol over OpenAPI/REST; ODRL usage policies' },
  { layer: 'Connector', choice: 'Eclipse Dataspace Components — catalogue, negotiation, identity, usage control' },
  { layer: 'Identity', choice: 'OIDC + W3C Verifiable Credentials (eIDAS 2.0 direction); professional identity on the NHS CIS2 pattern' },
  { layer: 'Catalogue & health bridge', choice: 'DCAT for discovery; FHIR UK Core at the health interface' },
  { layer: 'Assurance', choice: 'Hash-chained transparency log; ONS-style statistical disclosure control' },
];

export const RISKS: Tension[] = [
  { title: 'Re-identification in aggregates', body: 'Needs strong, centrally-governed disclosure control and output checking — not just local suppression.' },
  { title: 'Opt-out vs statutory override', body: 'It must be legally and publicly unambiguous which duties override consent, or trust erodes.' },
  { title: 'Vendor incentives & market churn', body: 'The open connector must be mandated through the DfE framework, or lock-in is recreated in a new place.' },
  { title: 'LA capacity and funding', body: 'A Denmark-style use-proportional funding model could align incentives to connect.' },
  { title: 'Threshold scope-creep', body: 'The PII-release rule catalogue needs a tight definition and independent oversight to resist expansion.' },
  { title: 'Ledger governance', body: 'Who operates it, retention periods, and who may read it are first-order policy questions, not implementation details.' },
];

// ---------------------------------------------------------------------------
// VISUAL-FIRST layer — the "one question's journey" redesign. The page is a
// 7-beat journey; every section is a beat or an annotation on it. These are the
// data the new interactive visuals read; keyed lookups so the arrays above stay
// untouched.
// ---------------------------------------------------------------------------

export interface Beat { id: string; n: number; kicker: string; label: string }
/** the journey spine — every section maps to one of these */
export const BEATS: Beat[] = [
  { id: 'ask', n: 0, kicker: 'BEAT 0', label: 'Ask one question' },
  { id: 'terrain', n: 1, kicker: 'BEAT 1', label: 'The terrain' },
  { id: 'gates', n: 2, kicker: 'BEAT 2', label: 'The front door' },
  { id: 'connector', n: 3, kicker: 'BEAT 3', label: 'Inside a connector' },
  { id: 'endings', n: 4, kicker: 'BEAT 4', label: 'The two endings' },
  { id: 'beyond', n: 5, kicker: 'BEAT 5', label: 'Beyond education' },
  { id: 'borrowed', n: 6, kicker: 'BEAT 6', label: 'Borrowed from the world' },
];
export const BEAT_LABEL: Record<string, string> = Object.fromEntries(BEATS.map((b) => [b.id, `Beat ${b.n} · ${b.label}`]));

/** the protagonist question threaded through the whole page */
export const WORKED_QUESTION = 'How many Year-11 pupils with an EHCP were persistently absent last autumn term?';
export const WORKED_QUESTION_SHORT = 'Yr-11 · EHCP · persistently absent';
export const WORKED_ANSWER = 4120; // illustrative no-PII aggregate
export const WORKED_ANSWER_LABEL = 'pupils, England';

/** per-category cell counts at one connector (Oakfield Academy) — feeds the
 *  disclosure-control slider: small cells are suppressed before the total leaves.
 *  Sums to WORKED_ANSWER. */
export interface CellRow { group: string; count: number }
export const CONNECTOR_CELLS: CellRow[] = [
  { group: 'Community school', count: 1840 },
  { group: 'Academy', count: 1560 },
  { group: 'Free school', count: 420 },
  { group: 'Special school', count: 250 },
  { group: 'AP / PRU', count: 42 },
  { group: 'Independent, state-funded place', count: 8 },
];

/** the central-store counterfactual, for the hero "…what if we pooled it?" morph */
export const POOL_RECORDS = 8_400_000; // ~ every pupil record, copied into one store
export const POOL_LABEL = 'records in one national store';
export const BLAST_FEDERATED = 'one school';
export const BLAST_CENTRAL = '8.4M pupils';

/** where each model sits on the DATA↔TRUST spectrum. dataMoves 0 = nothing moves
 *  (compute-to-data) … 1 = bulk copies to a central pool. centralises = the one
 *  primitive that country puts in the middle. Keyed by SurveyArchetype.no. */
export interface ArchetypeAxis { centralises: string; dataMoves: number }
export const ARCHETYPE_AXIS: Record<number, ArchetypeAxis> = {
  1: { centralises: 'routing', dataMoves: 0.14 },              // X-Road brokered exchange
  2: { centralises: 'gateway', dataMoves: 0.24 },             // Singapore APEX / NHS Spine
  3: { centralises: 'events + catalogue', dataMoves: 0.34 },  // NL/DK base registers
  4: { centralises: 'consent', dataMoves: 0.18 },             // India DEPA
  5: { centralises: 'membership', dataMoves: 0.16 },          // German TI-Messenger
  6: { centralises: 'compute', dataMoves: 0.05 },             // UK OpenSAFELY
  7: { centralises: 'identity', dataMoves: 0.20 },            // MOSIP
};
/** England's proposed model, plotted as the star on the same spectrum */
export const ENGLAND_MODEL = { centralises: 'routing + trust', dataMoves: 0.10, label: 'England (proposed)' };

/** each requirement → the beat it powers + the archetype numbers it's lifted from.
 *  Keyed by Requirement.need. */
export const REQUIREMENT_LINK: Record<string, { beat: string; archetypeNos: number[] }> = {
  'Federated analytic queries across ~24,000 schools': { beat: 'terrain', archetypeNos: [6, 1] },
  'Commission & compile no-PII analysis, to standards': { beat: 'connector', archetypeNos: [3] },
  'Immutable log of every transaction': { beat: 'gates', archetypeNos: [1] },
  'Point-to-point sharing': { beat: 'endings', archetypeNos: [1] },
  'Query opt-outs (consent-based)': { beat: 'gates', archetypeNos: [4] },
  'Rules-based PII release on thresholds': { beat: 'endings', archetypeNos: [3] },
  'Greater-than-education': { beat: 'beyond', archetypeNos: [1, 2] },
  'Local authority connectivity': { beat: 'terrain', archetypeNos: [1] },
  'Open standards end to end': { beat: 'connector', archetypeNos: [3] },
  'Highly distributed governance': { beat: 'gates', archetypeNos: [1, 5] },
};

/** stack layer → the journey beats that depend on it. Keyed by StackRow.layer. */
export const STACK_BEATS: Record<string, string[]> = {
  'Data model': ['connector'],
  'Transport & contracts': ['connector', 'gates'],
  'Connector': ['terrain', 'connector'],
  'Identity': ['gates', 'endings'],
  'Catalogue & health bridge': ['beyond'],
  'Assurance': ['connector', 'endings'],
};

/** every risk/tension → the beat that absorbs it + the design's mitigation.
 *  Keyed by title (RISKS and TENSIONS share this map). */
export const RISK_LINK: Record<string, { beat: string; kind: 'risk' | 'tension'; mitigation: string }> = {
  'Re-identification in aggregates': { beat: 'connector', kind: 'risk', mitigation: 'Disclosure control fires at every connector before a total leaves — minimum cell sizes and suppression — plus centrally-governed output checking on the assembled result.' },
  'Opt-out vs statutory override': { beat: 'endings', kind: 'risk', mitigation: 'The two endings sit in different policy classes by design: opt-outs govern the analytic total; a statutory duty can override consent only under a logged rule.' },
  'Vendor incentives & market churn': { beat: 'terrain', kind: 'risk', mitigation: 'The open connector is mandated through the DfE MIS framework — conformance certification as a condition of listing — so lock-in cannot re-form around one supplier.' },
  'LA capacity and funding': { beat: 'terrain', kind: 'risk', mitigation: 'A Denmark-style use-proportional funding model + a funded on-ramp for the long tail keeps the smallest participant able to join.' },
  'Threshold scope-creep': { beat: 'endings', kind: 'risk', mitigation: 'The PII-release rule catalogue is tightly scoped with an independent directing board overseeing every threshold change.' },
  'Ledger governance': { beat: 'gates', kind: 'risk', mitigation: 'Who operates the ledger, retention and read-access are first-order policy set by the cross-sector directing board — the ledger is a named brokerage service, not an implementation detail.' },
  'Centralise-and-link vs federate': { beat: 'terrain', kind: 'tension', mitigation: 'The federated posture reaches the same linking outcomes the white paper wants, with a materially stronger privacy and security story — no central pool to breach.' },
  'Purpose limitation on the SUI': { beat: 'endings', kind: 'tension', mitigation: 'The NHS-number SUI resolves identity on the amber PII path only; the teal analytic path stays pseudonymous, honouring the stated safeguarding-purpose limitation.' },
  'ContactPoint’s shadow': { beat: 'terrain', kind: 'tension', mitigation: '"No central pool" is a stated design principle here, not an implementation detail — the direct architectural answer to the 2010 precedent.' },
  'Coverage gaps': { beat: 'connector', kind: 'tension', mitigation: 'An explicit fallback resolution path for children without an NHS number (migrant, home-educated, CNIS) so the fabric never makes them more invisible.' },
  'LA capacity and security': { beat: 'terrain', kind: 'tension', mitigation: 'The default-deny connector and local enforcement reduce reliance on uneven LA security — the least-secure estate still only ever emits an aggregate or a logged rule-based release.' },
  'Commercial MIS incentives': { beat: 'terrain', kind: 'tension', mitigation: 'Mandating the open connector through the DfE MIS framework is the procurement lever that realigns vendor incentives away from data lock-in.' },
};

/** each DfE commitment → its live status, source type (for filter chips), and the
 *  journey beat it validates. Keyed by Commitment.what. */
export const COMMITMENT_META: Record<string, { status: 'committed' | 'statute' | 'programme' | 'emerging'; sourceType: 'white-paper' | 'statute' | 'mais' | 'milburn'; beat: string }> = {
  'DfE Data Spine': { status: 'committed', sourceType: 'white-paper', beat: 'terrain' },
  'Single Unique Identifier (NHS number)': { status: 'statute', sourceType: 'statute', beat: 'endings' },
  'MAIS statutory information-sharing duty': { status: 'programme', sourceType: 'mais', beat: 'endings' },
  'MAIS Tier 1 Data Sharing Agreement': { status: 'programme', sourceType: 'mais', beat: 'gates' },
  'MASH / Multi-Agency Child Protection Teams': { status: 'statute', sourceType: 'statute', beat: 'endings' },
  'NPD & “collection and linking”': { status: 'committed', sourceType: 'white-paper', beat: 'terrain' },
  'Milburn review — hidden NEETs': { status: 'emerging', sourceType: 'milburn', beat: 'beyond' },
  'School Profiles': { status: 'committed', sourceType: 'white-paper', beat: 'connector' },
  'Content Store / National Data Library': { status: 'emerging', sourceType: 'white-paper', beat: 'connector' },
  'Post-16 & Skills England': { status: 'emerging', sourceType: 'white-paper', beat: 'terrain' },
};
export const SOURCE_TYPE_LABEL: Record<string, string> = {
  'white-paper': 'White paper', 'statute': 'Statute', 'mais': 'MAIS', 'milburn': 'Milburn',
};
