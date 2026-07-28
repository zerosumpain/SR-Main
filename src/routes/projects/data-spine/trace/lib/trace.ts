// trace.ts — every constant behind "Trace a request": the 2-D, layered, animated
// companion to the 3-D federation simulator. Where the simulator shows the SHAPE of
// the network, this shows the ORDER of events and what is true at each layer of the
// stack while they happen.
//
// Structure:
//   LAYERS   × STAGES = MATRIX  — 36 cells, the core of the thing
//   SCENARIOS                    — five journeys through the same six stages
//   METHODS + OPENSAFELY         — the methodologies in play, honestly bounded
//   TIERS + LOOP + GIVE_GET      — the MIS → edtech network-effect argument
//
// Honesty rules (inherited from the rest of this field study): every timing is
// illustrative and marked `hypothesis`; documented anchors are cited; nothing claims
// the spine has a published architecture, because it does not.

import type { Confidence } from '../../lib/types';
import { SUPPLIERS } from '$lib/sim/federation/topology';

// ---------------------------------------------------------------------------
// LAYERS — presented top-down: the audience starts at meaning, not matter.
// ---------------------------------------------------------------------------

export type LayerId = 'practical' | 'analytical' | 'compute' | 'storage' | 'network' | 'physical';

export interface Layer {
  id: LayerId;
  no: number;
  name: string;
  /** the question this layer answers */
  question: string;
  blurb: string;
  eli5: string;
  /** short mono tag used on the lens rail */
  tag: string;
}

export const LAYERS: Layer[] = [
  {
    id: 'practical', no: 1, name: 'Practical', tag: 'PEOPLE',
    question: 'Who actually does something, and what changes for them?',
    blurb: 'The human and organisational layer — the named person who asks, the headteacher who can refuse, the family who can object, the minister who reads the number. Almost every failure in national data programmes lives here, not in the technology.',
    eli5: 'The people. Who asks, who says yes or no, and who ends up better off.',
  },
  {
    id: 'analytical', no: 2, name: 'Analytical', tag: 'MEANING',
    question: 'What does the number actually mean, and can you trust it?',
    blurb: 'Definitions, populations, coverage, suppression and provenance. A federated answer with 71% coverage is a materially different claim from one with 99% — this layer is where that distinction is kept, or lost.',
    eli5: 'What the answer means — and how sure we are it is right.',
  },
  {
    id: 'compute', no: 3, name: 'Compute', tag: 'EXECUTION',
    question: 'What code runs, where, and who signed it?',
    blurb: 'Execution: policy decision points, the certified connector, the reducer, the signatures. This is the layer the "open-source connector" argument lives on — one certification instead of ~24,000 bespoke integrations.',
    eli5: 'The programs doing the work, and where they run.',
  },
  {
    id: 'storage', no: 4, name: 'Storage', tag: 'AT REST',
    question: 'What is written down, where, and for how long?',
    blurb: 'The layer that decides whether "no central database" is a promise or a property. Watch what each stage persists: if intermediate results start being retained at the centre, the pool has been rebuilt by accretion.',
    eli5: 'What gets saved, and where it sits afterwards.',
  },
  {
    id: 'network', no: 5, name: 'Network', tag: 'IN FLIGHT',
    question: 'What crosses a boundary, in which direction, and how big is it?',
    blurb: 'The wire. Direction matters as much as encryption: the useful property is not that pupil rows are encrypted in flight, but that there is no route by which they can arrive at the centre at all.',
    eli5: 'What travels down the wire between buildings.',
  },
  {
    id: 'physical', no: 6, name: 'Physical', tag: 'MATTER',
    question: 'Which buildings, which machines, whose jurisdiction?',
    blurb: 'Racks, residency and custody. The federated posture barely changes this layer, and that is the argument: the data stays in the datacentres it is already in, under the contracts schools already signed.',
    eli5: 'The actual computers, in actual buildings.',
  },
];

export const layerById = (id: LayerId) => LAYERS.find((l) => l.id === id)!;

// ---------------------------------------------------------------------------
// STAGES — the six beats the brief names, in order.
// ---------------------------------------------------------------------------

export type StageId = 'commission' | 'ledger' | 'consent' | 'mis' | 'aggregate' | 'answer';

export interface Stage {
  id: StageId;
  no: number;
  name: string;
  /** one-line, at three depths */
  eli5: string;
  official: string;
  technical: string;
  /** who owns this stage */
  actor: string;
  /** where it happens, for the little map above the rail */
  place: 'requester' | 'spine' | 'edge' | 'dfe';
}

export const STAGES: Stage[] = [
  {
    id: 'commission', no: 1, name: 'Commission', actor: 'The person asking', place: 'requester',
    eli5: 'Someone asks a question — and has to say why they want to know.',
    official: 'A named requester submits a purpose-bound question against the published catalogue, under a stated legal basis.',
    technical: 'A query contract is compiled — population, variables, aggregation, minimum cell size, retention — then signed with the requester’s organisational key and submitted to the brokerage. Nothing executes yet.',
  },
  {
    id: 'ledger', no: 2, name: 'Ledger update', actor: 'The trust layer', place: 'spine',
    eli5: 'Before anything happens, the ask is written down permanently — like a receipt.',
    official: 'The commission is written to an append-only transparency log before execution, so the record cannot be a reconstruction after the fact.',
    technical: 'A hash-chained, time-stamped, signed entry, replicated to independent witnesses. Deliberately not a blockchain: X-Road demonstrates that signed, time-stamped logs deliver integrity and non-repudiation without consensus overhead.',
  },
  {
    id: 'consent', no: 3, name: 'School consent', actor: 'Schools, trusts, families', place: 'spine',
    eli5: 'The rules get checked: is this allowed, here, right now — and has anyone said no?',
    official: 'The policy engine evaluates legal basis, purpose, sensitivity, aggregation and recipient class against standing agreements and the objection register, returning permit, deny, or permit-with-obligations.',
    technical: 'Attribute-based access control, default-deny. Obligations (e.g. suppress cells < 10) are attached to the query and enforced at the edge, not remembered at the centre. Opt-outs bind voluntary purposes; statutory safeguarding overrides them and the objection is logged rather than honoured.',
  },
  {
    id: 'mis', no: 4, name: 'MIS calculation', actor: 'Every school’s own system', place: 'edge',
    eli5: 'The question is sent to each school’s computer, which works out its own small answer.',
    official: 'The analysis executes in situ against records that never leave the estate. Each participant applies disclosure control locally and returns a signed partial.',
    technical: 'The certified open-source connector maps the local schema to the canonical model, executes, applies suppression, signs, and returns. Egress is default-deny — the connector has no code path that emits pupil-level rows on this flow.',
  },
  {
    id: 'aggregate', no: 5, name: 'DfE aggregation', actor: 'The department', place: 'dfe',
    eli5: 'All the little answers get added up into one national number.',
    official: 'Signed partials are combined, national disclosure control is applied a second time, and coverage and non-response are reported alongside the figure.',
    technical: 'A deterministic reducer over signed partials; signatures verified, late or unsigned partials excluded and counted rather than silently dropped; complementary suppression applied to prevent back-calculation of suppressed cells.',
  },
  {
    id: 'answer', no: 6, name: 'The answer', actor: 'The requester — and the public', place: 'requester',
    eli5: 'The answer comes back, with a note saying how it was worked out.',
    official: 'A number with its provenance: which contract, which coverage, which suppression profile, which schema version — plus a link to the ledger entry that authorised it.',
    technical: 'A signed result object carrying contract id, coverage ratio, suppression profile and schema version. Re-running the contract later returns a comparable answer or an explicit reason why it cannot.',
  },
];

export const stageById = (id: StageId) => STAGES.find((s) => s.id === id)!;

// ---------------------------------------------------------------------------
// THE MATRIX — 36 cells. What is true at each layer, at each stage.
// This is the "complexity of information transfer" the visualisation reads out.
// ---------------------------------------------------------------------------

export interface Cell {
  /** what happens here */
  what: string;
  /** what actually crosses the boundary at this layer — the payload chip */
  moves: string;
  /** who or what is acting */
  who: string;
  /** how this cell fails in practice */
  fails: string;
}

export type Matrix = Record<StageId, Record<LayerId, Cell>>;

export const MATRIX: Matrix = {
  commission: {
    practical: {
      what: 'A named person with a named purpose asks. On the fast path this is a standing question that fires on a schedule and nobody touches it. On the slow path it is a new kind of question — and this is the moment months begin.',
      moves: 'a question, a purpose, and a person accountable for both',
      who: 'A DfE analyst, a MASH practitioner, an accredited researcher, or an accredited application',
      fails: 'The purpose is vague, so no rule can authorise it. The request dies in a mailbox — which is how most requests die today, invisibly and without a decision anyone can point at.',
    },
    analytical: {
      what: 'The question is compiled into a query contract: population, variables, aggregation level, minimum cell size, time window. If it cannot be expressed against the published schema, it is not yet a question — it is a standards change.',
      moves: 'a machine-readable query contract, not a data request',
      who: 'The requester, against the catalogue',
      fails: 'The variable does not exist in the canonical model. The "two-week analysis" becomes an eighteen-month schema negotiation, and everyone blames the technology.',
    },
    compute: {
      what: 'The contract is validated against the schema registry, checked for a live credential, and signed. No pupil data is touched; no estate has been contacted.',
      moves: 'a signed contract object, a few kilobytes',
      who: 'The requester’s client and the brokerage’s contract endpoint',
      fails: 'An unsigned, expired or over-scoped credential is rejected here — before it costs anything anywhere else. Cheap rejection is a feature.',
    },
    storage: {
      what: 'Nothing pupil-level is read or written. The contract itself is persisted at the centre — one of the very few things the centre ever stores.',
      moves: 'one row: contract, requester, purpose, basis, expiry',
      who: 'The brokerage’s contract store',
      fails: 'Persisting the results alongside the contracts is how a trust layer quietly becomes a national database. The discipline has to be architectural, not cultural.',
    },
    network: {
      what: 'One authenticated call from the requester to the brokerage. Mutual TLS for the organisation, OIDC for the human, verifiable credentials for the role.',
      moves: '1 request · kilobytes · no pupil data',
      who: 'Requester → brokerage',
      fails: 'Identity assurance is the weakest link in every exchange of this kind. GOV.UK Verify failed on exactly this problem; the design leans on organisational identity precisely because personal identity assurance is harder.',
    },
    physical: {
      what: 'A laptop or a scheduler in a government building, talking to a UK-domiciled service. Not one pupil record has yet moved anywhere.',
      moves: 'nothing that identifies a child has moved',
      who: 'A requester’s workstation; the trust layer’s datacentre',
      fails: 'Nothing meaningful fails here yet — which is the point of doing all the argument before any data is involved.',
    },
  },

  ledger: {
    practical: {
      what: 'Before anything runs, the ask is recorded permanently. In the strong version of this design a parent can see that a question was asked, by whom and under what authority — the Estonian property that turns surveillance anxiety into accountability.',
      moves: 'a receipt',
      who: 'The trust layer, on behalf of the public',
      fails: 'A ledger written after the fact is a log, not a control. Every system claims logging; almost none write the authorisation before the act.',
    },
    analytical: {
      what: 'The ledger entry is the unit of accountability: who asked what, under which basis, at which aggregation, and what came back. It is what makes the estate auditable at all, and what makes "2,385 distributions" a countable claim rather than an allegation.',
      moves: 'the shape of the ask, permanently',
      who: 'Auditors, the ICO, researchers, the public',
      fails: 'A ledger that records requests but not refusals hides the most interesting half of the record.',
    },
    compute: {
      what: 'An append-only, hash-chained entry is written, time-stamped and signed. Not a blockchain: signed logs with trusted time-stamping give integrity and non-repudiation without consensus.',
      moves: 'one signed, hash-chained entry',
      who: 'The ledger service',
      fails: 'Choosing a blockchain here is the classic failure — it buys nothing over a signed transparency log and it buys an operating cost and a procurement argument forever.',
    },
    storage: {
      what: 'Append-only: no deletes, no updates. Retention is deliberately longer than the data it describes, because the question "who looked at my child’s record in 2029" has to be answerable in 2039.',
      moves: 'nothing leaves; one entry lands',
      who: 'Write-once storage under independent custody',
      fails: 'Ledger retention shorter than the underlying data makes the whole accountability story unravel at exactly the moment someone needs it.',
    },
    network: {
      what: 'The entry is replicated to independent witnesses, so a single operator cannot rewrite history unnoticed.',
      moves: 'a few hundred bytes, to more than one custodian',
      who: 'Ledger → witnesses',
      fails: 'Single-custodian ledgers protect against accident, not against the operator. The witnesses are the whole difference.',
    },
    physical: {
      what: 'Independent custody, ideally write-once media. This is the cheapest component in the design and the most politically load-bearing: it is the part that lets an operator be held to account.',
      moves: 'nothing that identifies a child',
      who: 'More than one organisation, by design',
      fails: 'Housing the ledger with the party it holds to account is a governance failure disguised as an infrastructure saving.',
    },
  },

  consent: {
    practical: {
      what: 'Two entirely different questions get conflated here. (1) "Is there already a standing agreement for this class of request?" — a cached yes or no, in milliseconds. (2) "Should there be one?" — a DPIA, a data-sharing agreement, school and trust notification, and an objection window: weeks to months. A spine makes the first instant. It cannot make the second instant, and pretending otherwise is how these programmes fail.',
      moves: 'a decision — or, on a new class, a governance process',
      who: 'Schools and trusts as controllers; families exercising objection; DfE information governance',
      fails: 'Treating every request as new (paralysis) or every request as covered (the ICO audit). The register exists to make the difference explicit and countable.',
    },
    analytical: {
      what: 'Consent is evaluated as policy, not sentiment: legal basis × purpose × field sensitivity × aggregation level × recipient class. Objections bind voluntary purposes; statutory safeguarding overrides them, and the override is recorded.',
      moves: 'permit · deny · permit-with-obligations',
      who: 'The policy engine, against the basis registry',
      fails: 'Coverage silently drops when objections bite and nobody carries that number through to the published figure — so a 91%-coverage answer gets read as a national one.',
    },
    compute: {
      what: 'An attribute-based policy decision point returns a decision plus obligations — suppression thresholds, field masks, retention limits. Default deny: the absence of a rule is a refusal, not a permission.',
      moves: 'a signed decision with attached obligations',
      who: 'The rules engine',
      fails: 'Policy expressed in prose and implemented in code drifts apart within one release cycle. The basis registry has to be the executable artefact, not a document about one.',
    },
    storage: {
      what: 'A data-blind objection register: identifiers and scopes, and nothing else. The register knows only that a child has objected to a purpose; it holds nothing about the child.',
      moves: 'no pupil records; a scope lookup',
      who: 'The consent and objection register',
      fails: 'Health spent years retrofitting the national data opt-out onto systems that never expected it. Retrofitting is the expensive path; building the register first is the cheap one.',
    },
    network: {
      what: 'The decision travels to every edge connector attached to the query, so enforcement happens at source. The centre does not remember the rule on the estates’ behalf — it hands it to them.',
      moves: 'obligations, riding with the query',
      who: 'Brokerage → every participating connector',
      fails: 'Enforcing obligations only at the centre means an estate that is compromised, or simply misconfigured, can return more than it should and nothing catches it.',
    },
    physical: {
      what: 'The school remains the controller. A headteacher can physically disconnect their connector, and the design has to survive that by degrading into a coverage figure rather than an outage.',
      moves: 'nothing — this is a refusal, and refusals must be cheap',
      who: 'The school, in its own building',
      fails: 'A design that treats a school’s refusal as a fault, rather than a coverage number, has misunderstood who the controller is.',
    },
  },

  mis: {
    practical: {
      what: 'Nothing is copied out. The question runs inside the system the school already pays for, and the school can see what was asked of it. Whether any of this works at all depends on the MIS supplier having shipped the connector — which makes supplier buy-in the programme, not a procurement detail.',
      moves: 'a question in; a small total out',
      who: 'The school’s MIS supplier, on the school’s behalf',
      fails: 'A supplier that will not ship the connector removes its schools from every national answer. Coverage becomes a commercial negotiation — the single largest delivery risk in the whole model.',
    },
    analytical: {
      what: 'Execution in situ against the local records; the estate applies its own suppression before anything leaves. What comes back is a partial, not an extract — and the difference is the entire privacy argument.',
      moves: 'a suppressed partial: counts, not people',
      who: 'The connector, against local records',
      fails: 'Local schema drift. Two schools recording "persistent absence" differently produce a number that means nothing, and no amount of cryptography detects it.',
    },
    compute: {
      what: 'The same certified open-source connector everywhere: map the local schema to the canonical model, execute, apply disclosure control, sign, return. One certification against one component replaces roughly 24,000 bespoke integrations.',
      moves: 'a signed partial, typically a few hundred bytes',
      who: 'The certified connector inside the supplier’s estate',
      fails: 'Certification without a public conformance suite is a badge, not an assurance. The test fixtures have to be open or the certificate means nothing.',
    },
    storage: {
      what: 'Pupil records stay in the MIS’s own database, under the contract the school already signed. The connector holds no copy; intermediate results are ephemeral and are never persisted.',
      moves: 'nothing at rest changes hands',
      who: 'The supplier’s database — unchanged',
      fails: 'A connector that caches results "for performance" has created a second copy of the national dataset in fourteen places at once.',
    },
    network: {
      what: 'Only the signed partial leaves. Egress is default-deny: on this flow the connector has no code path that emits pupil-level rows, which is a stronger claim than "we encrypt everything".',
      moves: 'hundreds of bytes out; zero pupil rows',
      who: 'Connector → brokerage',
      fails: 'Any "debug" or "export" path that bypasses the connector reintroduces the whole risk. The bulk-export button is the vulnerability, not the network.',
    },
    physical: {
      what: 'The supplier’s own datacentre — or a server cupboard, for the schools still self-hosting. Data residency is unchanged, because the data did not move.',
      moves: 'nothing physically relocates',
      who: 'Existing datacentres and existing contracts',
      fails: 'The smallest self-hosting schools are where a funded on-ramp matters most — and they are exactly the ones a cost-recovery model would exclude.',
    },
  },

  aggregate: {
    practical: {
      what: 'The department adds up what came back. It never sees a child. What reaches a minister is a number with a coverage figure attached, not a spreadsheet of pupils.',
      moves: 'partial totals in; one national figure out',
      who: 'DfE analysts and statisticians',
      fails: 'The coverage caveat gets dropped somewhere between the analyst and the submission, and a partial answer is briefed as a national one.',
    },
    analytical: {
      what: 'Partials are combined; disclosure control is applied a second time at national level, with complementary suppression so suppressed cells cannot be recovered by subtraction. Coverage and non-response are reported next to the number, because a 71%-coverage answer is a different claim from a 99% one.',
      moves: 'aggregates only, suppressed twice',
      who: 'The reducer, then a statistician',
      fails: 'Differencing attacks: publish the same table twice with slightly different populations and the suppressed cells fall out. This is a known, solved problem — and only if someone is made responsible for it.',
    },
    compute: {
      what: 'A deterministic reducer over signed partials. Every signature is checked; late or unsigned partials are excluded and counted, never silently dropped.',
      moves: 'verified partials → one aggregate',
      who: 'The aggregation service',
      fails: 'Silent exclusion. A reducer that drops a supplier’s partial without surfacing it produces a plausible, wrong, unfalsifiable number.',
    },
    storage: {
      what: 'The aggregate is stored; the partials are not retained beyond the audit window. This is the discipline that stops the trust layer becoming the pool by accretion.',
      moves: 'one aggregate persisted; partials expire',
      who: 'DfE statistical systems',
      fails: 'Retaining partials "just in case" rebuilds a fine-grained national dataset one query at a time, without anyone ever deciding to build one.',
    },
    network: {
      what: 'Inbound partials only. There is no route by which pupil-level rows can arrive here — which is what makes "there is no central database" checkable rather than promised.',
      moves: 'inbound aggregates; no pupil-level path exists',
      who: 'Connectors → aggregation service',
      fails: 'The moment an exception route is added "temporarily", the property is gone and the audit story with it.',
    },
    physical: {
      what: 'One modest service in one datacentre. The absence of a national pupil datastore is the point: there is no honeypot to breach, and no ContactPoint to switch off later.',
      moves: 'nothing that identifies a child',
      who: 'DfE infrastructure',
      fails: 'Nothing here is technically demanding. The difficulty is entirely in not building the bigger thing.',
    },
  },

  answer: {
    practical: {
      what: 'A number, a caveat and a receipt reach the person who asked. In the strong version, a family can see that a question was asked of their child’s school, and what came back — which is what converts a data programme from something done to people into something done in front of them.',
      moves: 'an answer, and the evidence of how it was obtained',
      who: 'The requester; and, in the strong version, the public',
      fails: 'Publishing the answer without the receipt keeps all the cost of the design and throws away its main benefit.',
    },
    analytical: {
      what: 'The answer carries its own provenance: which contract, which coverage, which suppression profile, which schema version. Reproducible by construction rather than by convention.',
      moves: 'answer + provenance',
      who: 'The requester’s analytical environment',
      fails: 'Two answers to the same question a year apart, with no way to tell whether the world changed or the definition did.',
    },
    compute: {
      what: 'A signed result object linked to its ledger entry. Re-running the same contract later returns a comparable answer, or an explicit machine-readable reason why it cannot.',
      moves: 'a signed result',
      who: 'The brokerage',
      fails: 'Results that cannot be re-run are anecdotes with decimal places.',
    },
    storage: {
      what: 'The requester holds the answer under their own retention rules. Nothing new was created at the centre except the receipt.',
      moves: 'one aggregate, held by the asker',
      who: 'The requester',
      fails: 'Answers accumulating in spreadsheets on laptops — the failure mode the current extract-based world produces at industrial scale.',
    },
    network: {
      what: 'One response. Total pupil-level bytes crossing any boundary in this entire transaction: zero — except on the deliberate, rule-triggered, individually logged safeguarding path.',
      moves: '1 response · zero pupil rows',
      who: 'Brokerage → requester',
      fails: 'Nothing, if the previous five stages held. Every risk in this design is upstream of here.',
    },
    physical: {
      what: 'A dashboard, a case system, or a line in a submission. The point of the whole apparatus, reached without moving a single child’s record.',
      moves: 'a number, on a screen',
      who: 'Whoever has to decide something',
      fails: 'The answer arrives and no decision changes — the most common failure of all, and the only one no architecture can fix.',
    },
  },
};

export const cell = (stage: StageId, layer: LayerId): Cell => MATRIX[stage][layer];

// ---------------------------------------------------------------------------
// SCENARIOS — five journeys through the same six stages.
// Durations are in SECONDS and are illustrative (see TIMING_NOTE).
// ---------------------------------------------------------------------------

export type StageMode = 'machine' | 'human' | 'override' | 'blocked';

export interface ScenarioStage {
  stage: StageId;
  /** machine time, seconds */
  machine: number;
  /** human / governance time, seconds (0 on a pre-agreed path) */
  human: number;
  mode: StageMode;
  /** what happens in THIS scenario at THIS stage, overriding the generic stage copy */
  note: string;
  /** the human work, named — only when human > 0 */
  humanWork?: string;
}

export interface Scenario {
  id: string;
  name: string;
  kicker: string;
  question: string;
  requester: string;
  eli5: string;
  official: string;
  technical: string;
  stages: ScenarioStage[];
  methods: MethodId[];
  /** what comes back */
  result: { value: string; label: string; kind: 'aggregate' | 'pii' | 'dataset' | 'signal' };
  /** the second time this exact class of question is asked */
  repeat: { machine: number; human: number; note: string };
  confidence: Confidence;
  /** the sentence this scenario exists to make unavoidable */
  point: string;
}

export const DAY = 86_400;
export const WEEK = 7 * DAY;

export const SCENARIOS: Scenario[] = [
  {
    id: 'standing',
    name: 'A standing question',
    kicker: 'THE FAST PATH · PRE-AGREED · NON-PII',
    question: 'How many Year-11 pupils with an EHCP were persistently absent last term?',
    requester: 'DfE analyst · scheduled, standing authorisation',
    eli5: 'This question has been asked and agreed before, so the computers just get on with it. It takes about as long as loading a web page.',
    official: 'A pre-agreed, non-PII aggregate against a standing data-sharing agreement. No human is in the loop: the policy engine finds a live authorisation, the query fans out, partials return, the total is published.',
    technical: 'Contract already in the catalogue with a live basis; policy decision is a cached permit-with-obligations (suppress < 10); fan-out is parallel across 14 supplier estates so wall-clock is bounded by the slowest partial, not the sum.',
    stages: [
      { stage: 'commission', machine: 0.4, human: 0, mode: 'machine', note: 'The scheduler fires an existing contract. Nobody types anything.' },
      { stage: 'ledger', machine: 0.15, human: 0, mode: 'machine', note: 'The commission is written before execution — same as every other path, no shortcut for routine work.' },
      { stage: 'consent', machine: 0.3, human: 0, mode: 'machine', note: 'A cached permit. The objection register is checked live, so a family’s "no" registered this morning already binds this afternoon’s run.' },
      { stage: 'mis', machine: 1.6, human: 0, mode: 'machine', note: 'Fourteen estates execute in parallel against their own records. Wall-clock is the slowest, not the sum.' },
      { stage: 'aggregate', machine: 0.5, human: 0, mode: 'machine', note: 'Partials verified and summed; national suppression applied; coverage computed at 99.2%.' },
      { stage: 'answer', machine: 0.2, human: 0, mode: 'machine', note: 'The number and its receipt land in the analyst’s dashboard.' },
    ],
    methods: ['federated-analytics', 'query-contract', 'sdc', 'consent-registry'],
    result: { value: '4,120', label: 'pupils · aggregate, no PII', kind: 'aggregate' },
    repeat: { machine: 3.15, human: 0, note: 'Identical. A standing question costs the same every time it is asked.' },
    confidence: 'hypothesis',
    point: 'Once the argument has been had, the machinery is boring — and boring is the goal.',
  },

  {
    id: 'novel',
    name: 'A question nobody has asked before',
    kicker: 'THE SLOW PATH · A NEW CLASS OF REQUEST',
    question: 'Do Year-11 pupils with an EHCP who are persistently absent go on to be NEET at 18?',
    requester: 'DfE analyst · no existing basis for this linkage',
    eli5: 'This is a new kind of question, so grown-ups have to agree it is allowed before any computer does anything. Agreeing takes months. The computers still take seconds.',
    official: 'A new purpose, a new variable and a cross-domain linkage: no standing agreement covers it. The governance work is real and largely irreducible — a DPIA, a varied data-sharing agreement, school and trust notification, an objection window, and an MIS release that carries the new field.',
    technical: 'The blocking dependencies are a schema-registry addition (a new canonical variable plus conformance fixtures), a basis-registry entry mapping statute to fields and aggregation, and each supplier shipping the mapping in a scheduled release. None of it is cryptography; all of it is agreement.',
    stages: [
      { stage: 'commission', machine: 0.6, human: 12 * DAY, mode: 'human', note: 'Framing the question so it can be authorised at all: purpose, minimisation, the smallest version that still answers the policy question.', humanWork: 'Analyst + information governance draft the purpose and minimise the ask' },
      { stage: 'ledger', machine: 0.2, human: 0, mode: 'machine', note: 'The ledger is the one part that is instant on both paths — including logging the refusals along the way.' },
      { stage: 'consent', machine: 0.4, human: 62 * DAY, mode: 'human', note: 'The bulk of the elapsed time, and none of it is technical: a DPIA, a varied data-sharing agreement, notification to schools and trusts, and an objection window that has to actually be open long enough to mean something.', humanWork: 'DPIA · DSA variation · school & trust notification · objection window' },
      { stage: 'mis', machine: 4.5, human: 21 * DAY, mode: 'human', note: 'A new canonical variable has to reach the estates. That means a schema-registry version, conformance fixtures, and every supplier shipping the mapping in a release — the critical path runs straight through the MIS market.', humanWork: 'Schema version + conformance fixtures + supplier release cycles' },
      { stage: 'aggregate', machine: 1.2, human: 3 * DAY, mode: 'human', note: 'A statistician agrees the disclosure-control profile for a variable nobody has published before.', humanWork: 'New suppression profile agreed' },
      { stage: 'answer', machine: 0.4, human: 2 * DAY, mode: 'human', note: 'First publication sign-off, because the first answer of a new class is also a precedent.', humanWork: 'Publication sign-off' },
    ],
    methods: ['query-contract', 'consent-registry', 'pprl', 'sdc', 'federated-analytics'],
    result: { value: '31%', label: 'of the cohort · aggregate, no PII', kind: 'aggregate' },
    repeat: { machine: 7.3, human: 0, note: 'The second time this class is asked it is a standing question: seconds, no humans. The 100 days buy a permanent capability, not one answer — which is the argument for asking the governance question once, properly, at the level of a class of request rather than a request.' },
    confidence: 'hypothesis',
    point: 'The spine cannot make consent instant. What it can do is make consent reusable — so the cost is paid once per class of question, not once per question.',
  },

  {
    id: 'safeguard',
    name: 'A child at risk',
    kicker: 'THE DELIBERATE EXCEPTION · MINIMUM-NECESSARY PII',
    question: 'This child has not been seen for eleven days. What do other services already know?',
    requester: 'A named MASH practitioner · verified identity, statutory role',
    eli5: 'When a child might be in danger, a named professional can be told the few facts they need — and every single time that happens, it is written down and can be checked.',
    official: 'The one path on which pupil-level data is deliberately released. A statutory basis and a satisfied threshold authorise a minimum-necessary disclosure to a named professional in a named role. Objections are recorded and overridden, not honoured — and that override is the most heavily audited event in the system.',
    technical: 'Policy engine returns permit-with-obligations under the statutory safeguarding class; the field mask restricts the release to the named fields; the ledger entry is individually attributable and retained beyond the record it describes. This is the amber path in the fabric diagram — narrow, logged, and never bulk.',
    stages: [
      { stage: 'commission', machine: 0.6, human: 0, mode: 'machine', note: 'The professional judgement is itself the commission. Their credential carries the role, and the role carries the authority — the governance was done in statute, in advance.' },
      { stage: 'ledger', machine: 0.1, human: 0, mode: 'machine', note: 'Written first, as always — and on this path the entry is individually attributable to a named person, because it has to be.' },
      { stage: 'consent', machine: 0.4, human: 0, mode: 'override', note: 'The override. A registered objection does not block a statutory safeguarding request; it is recorded alongside the disclosure. This is the sharpest edge in the whole design and it should be visible, not buried.' },
      { stage: 'mis', machine: 0.9, human: 0, mode: 'machine', note: 'Not an aggregate: a lookup, returning only the named fields for one child, from the estates that hold them.' },
      { stage: 'aggregate', machine: 0.2, human: 0, mode: 'machine', note: 'Nothing is aggregated. Instead the release is minimised to the fields the rule authorised — the inverse operation, in the same slot.' },
      { stage: 'answer', machine: 0.3, human: 0, mode: 'machine', note: 'Delivered to a named professional in a case system, not to a dataset. Retention is bounded by the case, not by the department.' },
    ],
    methods: ['query-contract', 'consent-registry', 'pprl'],
    result: { value: '3 facts', label: 'minimum-necessary · PII, to one named person', kind: 'pii' },
    repeat: { machine: 2.5, human: 0, note: 'Every invocation is the same cost — and every invocation is separately logged. Speed here is not an efficiency; it is the reason a child is found.' },
    confidence: 'hypothesis',
    point: 'The fast safeguarding path exists precisely because the argument was had in advance, in statute. Speed at the moment of crisis is bought with governance done years earlier.',
  },

  {
    id: 'research',
    name: 'An accredited researcher',
    kicker: 'COMPUTE TO DATA · THE OPENSAFELY PATTERN',
    question: 'Which attendance interventions actually move outcomes, controlling for prior attainment?',
    requester: 'An accredited researcher · project-approved, code published',
    eli5: 'A researcher never gets the records. They write the sums, the sums are published for anyone to check, the sums run where the records live, and only the checked results come out.',
    official: 'Accredited access on the DEA 2017 / Secure Research Service pattern, executed as compute-to-data. The analysis code is public before it runs; outputs are checked by a human statistician before release. The researcher never holds a pupil record at any point.',
    technical: 'Code is developed against dummy data, version-controlled in the open, then executed inside each estate’s secure environment. Outputs pass statistical disclosure control by an independent checker; only cleared outputs leave. Reproducibility is a property of the pipeline, not a claim in a paper.',
    stages: [
      { stage: 'commission', machine: 0.5, human: 26 * DAY, mode: 'human', note: 'Researcher accreditation and project approval by a data-access committee. Slow, and correctly so — this is the Five Safes "safe people" and "safe projects" test.', humanWork: 'Accreditation + project approval (Five Safes)' },
      { stage: 'ledger', machine: 0.2, human: 0, mode: 'machine', note: 'The protocol, the approval and the code hash all land in the ledger before execution — so what ran can be checked against what was approved.' },
      { stage: 'consent', machine: 0.4, human: 9 * DAY, mode: 'human', note: 'Objection handling for a research purpose, and the project-level consent posture. Research is a voluntary purpose: objections bind, and coverage drops accordingly.', humanWork: 'Research-purpose objection handling' },
      { stage: 'mis', machine: 340, human: 0, mode: 'machine', note: 'A real analysis, not a counter — minutes of compute inside each estate, against records that never move. The code is already public; anyone can read what was run.' },
      { stage: 'aggregate', machine: 12, human: 4 * DAY, mode: 'human', note: 'Output checking: a human statistician clears every table and figure before release. This is the step people forget when they say "automated" — and it is the step that makes the rest safe.', humanWork: 'Independent output checking (SDC)' },
      { stage: 'answer', machine: 0.6, human: 1 * DAY, mode: 'human', note: 'Cleared outputs released, alongside the code that produced them.', humanWork: 'Release sign-off' },
    ],
    methods: ['compute-to-data', 'code-open', 'sdc', 'synthetic', 'federated-analytics', 'pprl'],
    result: { value: '14 tables', label: 'cleared outputs · no record ever held', kind: 'dataset' },
    repeat: { machine: 353.7, human: 4 * DAY, note: 'Re-running the same approved protocol is machine time plus output checking — the accreditation and the approval are already spent. Output checking never fully disappears, and should not.' },
    confidence: 'fact',
    point: 'OpenSAFELY already proved this works at national scale in England. The open question is not whether compute-to-data is possible — it is whether education’s 14-supplier estate can be brought to the same standard as health’s two.',
  },

  {
    id: 'edtech',
    name: 'An accredited app asks — and gives back',
    kicker: 'THE NETWORK EFFECT · SCHOOL-AUTHORISED, RECIPROCAL',
    question: 'For this school, which pupils are flagged for an attendance intervention this week?',
    requester: 'An accredited edtech product · the school is the controller',
    eli5: 'An app the school already uses can ask a question about that school — but only because the school said it could, and only if the app puts something useful back into the network.',
    official: 'A school-scoped request from a product holding a DfE accreditation, executed under the school’s own standing authorisation, which the school can revoke instantly. In return the product contributes non-PII signals back to the network under the same rules it consumes them.',
    technical: 'Same certified gateway, same contract, same ledger — the only differences are scope (one school, not the nation) and the reciprocal contribution written back as a signed partial. Accreditation is a conformance status, not a commercial relationship, and it is published.',
    stages: [
      { stage: 'commission', machine: 0.3, human: 0, mode: 'machine', note: 'The product asks under its accreditation. Its scope is one school, because that is what the school authorised.' },
      { stage: 'ledger', machine: 0.1, human: 0, mode: 'machine', note: 'Logged like everything else — and visible to the school, which is what makes revocation an informed act rather than a panic.' },
      { stage: 'consent', machine: 0.5, human: 0, mode: 'machine', note: 'The school’s standing authorisation is checked live. A headteacher can withdraw it in the afternoon and the next request fails that afternoon.' },
      { stage: 'mis', machine: 0.8, human: 0, mode: 'machine', note: 'One estate, one school’s records, in situ. No CSV, no overnight sync, no third copy of the pupil roll.' },
      { stage: 'aggregate', machine: 0.3, human: 0, mode: 'machine', note: 'Cohort-level, suppressed below threshold — the product gets a working signal, not a roster it did not need.' },
      { stage: 'answer', machine: 0.2, human: 0, mode: 'machine', note: 'The signal returns — and the product’s reciprocal contribution is written back as a signed partial, under the same rules.' },
    ],
    methods: ['query-contract', 'consent-registry', 'sdc', 'federated-analytics'],
    result: { value: '2-way', label: 'a signal out, a contribution back', kind: 'signal' },
    repeat: { machine: 2.2, human: 0, note: 'Accreditation is a one-off cost of roughly 34 days. After that every request is seconds — which is precisely why suppliers would choose to pay it.' },
    confidence: 'hypothesis',
    point: 'The market will not join out of civic duty. It joins because one certified integration is cheaper than N bespoke ones, and because an accreditation a school asks for in procurement is worth money.',
  },
];

export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id)!;

export const totalMachine = (s: Scenario) => s.stages.reduce((a, x) => a + x.machine, 0);
export const totalHuman = (s: Scenario) => s.stages.reduce((a, x) => a + x.human, 0);

export const TIMING_NOTE =
  'Every duration on this page is illustrative. Machine timings assume parallel fan-out across the supplier estates and are the author’s estimates, not measurements — no spine exists to measure. Human timings are anchored on published processes (DPIA and data-sharing-agreement practice, ONS/DEA accreditation, statistical output checking, and typical MIS release cadences) but the totals are constructed, not observed. They are here to make the shape of the problem arguable, not to be quoted.';

/** Human-readable duration from seconds. */
export function fmtDuration(sec: number): string {
  if (sec <= 0) return '—';
  if (sec < 1) return `${Math.round(sec * 1000)} ms`;
  if (sec < 90) return `${sec < 10 ? sec.toFixed(1) : Math.round(sec)} s`;
  if (sec < 3600) return `${(sec / 60).toFixed(sec < 600 ? 1 : 0)} min`;
  if (sec < DAY) return `${(sec / 3600).toFixed(1)} hrs`;
  if (sec < 14 * DAY) return `${Math.round(sec / DAY)} days`;
  return `${(sec / WEEK).toFixed(1)} weeks`;
}

// ---------------------------------------------------------------------------
// METHODS — the methodologies in play, each honestly bounded by what it is NOT for.
// ---------------------------------------------------------------------------

export type MethodId =
  | 'compute-to-data' | 'federated-analytics' | 'sdc' | 'dp' | 'smpc'
  | 'pprl' | 'synthetic' | 'code-open' | 'consent-registry' | 'query-contract' | 'he';

export interface Method {
  id: MethodId;
  name: string;
  short: string;
  what: string;
  solves: string;
  /** the stages it governs */
  stages: StageId[];
  /** the layer it principally lives on */
  layer: LayerId;
  precedent: string;
  maturity: 'proven' | 'emerging' | 'research';
  cost: string;
  /** what it does NOT do — the credibility field */
  notFor: string;
  confidence: Confidence;
}

export const METHODS: Method[] = [
  {
    id: 'compute-to-data', name: 'Compute to data', short: 'C2D',
    what: 'The analysis travels to the records instead of the records travelling to the analyst. Code executes inside the environment that already holds the data; only results come out.',
    solves: 'Removes the extract. If no copy is ever made, there is no copy to lose, mis-share, or find on a laptop in 2031.',
    stages: ['mis', 'aggregate'], layer: 'compute',
    precedent: 'OpenSAFELY (NHS England, from 2020) · ONS Secure Research Service · ADR UK',
    maturity: 'proven',
    cost: 'High up front: every participating estate needs a trustworthy execution environment. Low per query thereafter.',
    notFor: 'It does not solve definitions. Running the same code in fourteen estates that record persistent absence differently gives you fourteen incompatible answers, quickly.',
    confidence: 'fact',
  },
  {
    id: 'federated-analytics', name: 'Federated analytics', short: 'FED',
    what: 'One question is fanned out to many independent holders; each returns an aggregate partial; the partials are combined centrally. No combined dataset is ever created.',
    solves: 'National answers without a national database — and coverage becomes a measurable quantity rather than an assumption.',
    stages: ['commission', 'mis', 'aggregate'], layer: 'analytical',
    precedent: 'X-Road (Estonia, Finland) · Datafordeler (Denmark) · the daily attendance feed, in a primitive form',
    maturity: 'proven',
    cost: 'Moderate. The engineering is well understood; the standards work is where the cost actually is.',
    notFor: 'It does not help with genuinely record-level operational tasks — matching one child across services still needs a linkage method, not an aggregate.',
    confidence: 'fact',
  },
  {
    id: 'sdc', name: 'Statistical disclosure control', short: 'SDC',
    what: 'Suppress small cells, apply complementary suppression so suppressed values cannot be recovered by subtraction, and have a human check outputs before release.',
    solves: 'Stops an "aggregate" quietly identifying a child — the failure mode that discredits aggregate-only claims when it happens.',
    stages: ['mis', 'aggregate', 'answer'], layer: 'analytical',
    precedent: 'ONS output-checking practice · the Five Safes framework · OpenSAFELY output review',
    maturity: 'proven',
    cost: 'Low technically; ongoing in people. Output checking is a permanent staffed function, not a one-off build.',
    notFor: 'It is not automatic and should not be. A fully automated release gate is a good filter and a bad final decision.',
    confidence: 'fact',
  },
  {
    id: 'dp', name: 'Differential privacy', short: 'DP',
    what: 'Add calibrated noise so that any individual’s presence or absence cannot be inferred from a published result, with a formal, budgetable guarantee.',
    solves: 'Repeated-query attacks — the case where each answer is safe and a thousand answers together are not.',
    stages: ['aggregate', 'answer'], layer: 'analytical',
    precedent: 'US Census 2020 · Apple and Google telemetry · emerging in UK official statistics',
    maturity: 'emerging',
    cost: 'Moderate technically; expensive politically. Someone must own the epsilon budget and defend deliberately inexact official figures.',
    notFor: 'Small-area education statistics, where the noise needed for a real guarantee can exceed the effect being measured. It is a strong tool aimed at the wrong scale for much of this estate.',
    confidence: 'hypothesis',
  },
  {
    id: 'smpc', name: 'Secure multi-party computation', short: 'MPC',
    what: 'Several parties jointly compute a function over their combined inputs while none of them learns the others’ inputs.',
    solves: 'Cross-organisation statistics where even the aggregate partials are too sensitive to reveal to the aggregator.',
    stages: ['mis', 'aggregate'], layer: 'compute',
    precedent: 'Boston Women’s Workforce Council pay-gap study · Estonian tax-and-education study (2015)',
    maturity: 'emerging',
    cost: 'High. Every participant must run coordinated protocol software and stay online for the computation.',
    notFor: 'The routine case. For most education questions, signed aggregate partials plus disclosure control get you the same protection at a fraction of the operational cost. Reserve MPC for the genuinely adversarial joins.',
    confidence: 'fact',
  },
  {
    id: 'pprl', name: 'Privacy-preserving record linkage', short: 'PPRL',
    what: 'Match the same person across datasets without either side revealing identifiers — split-file protocols, keyed hashing, or Bloom-filter encodings with a trusted third party.',
    solves: 'The cross-domain problem: education × health × benefits, without a shared identifier being handed around or a combined register being created.',
    stages: ['consent', 'mis'], layer: 'compute',
    precedent: 'ADR UK linkage practice · ONS Demographic Index · CP-IS keyed on NHS number',
    maturity: 'proven',
    cost: 'Moderate — and the governance around who acts as linkage broker costs more than the code.',
    notFor: 'It does not make matching correct. Match rates in real children’s data run well short of perfect, and a confident answer built on a silent 8% mismatch is worse than no answer.',
    confidence: 'fact',
  },
  {
    id: 'synthetic', name: 'Synthetic data', short: 'SYN',
    what: 'Statistically realistic fake records that carry the shape of the real data and none of the people, used for building and testing before anything touches production.',
    solves: 'The development bottleneck — the reason analysts wait months for access before they can write a line of code.',
    stages: ['commission', 'mis'], layer: 'storage',
    precedent: 'ONS synthetic datasets · MoJ Data First · OpenSAFELY’s dummy-data development model',
    maturity: 'proven',
    cost: 'Low to moderate. Generating it is easy; making it faithful enough to catch real bugs is not.',
    notFor: 'Producing findings. Synthetic data is for building the pipeline, never for the answer — and every programme that has blurred that line has regretted it.',
    confidence: 'fact',
  },
  {
    id: 'code-open', name: 'Code in the open', short: 'OPEN',
    what: 'The analysis code is public, version-controlled and reviewable before it ever runs against real records — so what was executed can be checked against what was approved.',
    solves: 'The reproducibility and trust gap. It converts "trust us, the query was safe" into "here is the query; read it."',
    stages: ['commission', 'ledger', 'mis'], layer: 'practical',
    precedent: 'OpenSAFELY — arguably its most important innovation, and the least technical one',
    maturity: 'proven',
    cost: 'Very low technically. Culturally, it is the hardest item on this list.',
    notFor: 'It does not protect the data by itself. Public code running against an unprotected extract is just a well-documented breach.',
    confidence: 'fact',
  },
  {
    id: 'consent-registry', name: 'Consent & objection registry', short: 'CONSENT',
    what: 'A data-blind register of who has objected to what, enforced before a query executes rather than remembered afterwards at the centre.',
    solves: 'Makes an objection real. Today a parent’s objection is a letter in a file; here it is an executable obligation that binds every subsequent query.',
    stages: ['consent'], layer: 'storage',
    precedent: 'NHS national data opt-out · India’s DEPA consent managers · UK GDPR Art. 21',
    maturity: 'proven',
    cost: 'Moderate to build, high to retrofit. Health’s experience is that retrofitting an opt-out onto live systems costs several times what building it first would have.',
    notFor: 'It cannot resolve the statutory override. When safeguarding law overrides an objection, the register records the override — it does not make the tension go away, and no design can.',
    confidence: 'fact',
  },
  {
    id: 'query-contract', name: 'Purpose-bound query contracts', short: 'CONTRACT',
    what: 'The request is a signed, machine-readable object carrying purpose, legal basis, aggregation level, minimum cell size and retention — not an email and a spreadsheet.',
    solves: 'Makes purpose limitation enforceable rather than aspirational, and makes every request countable and auditable by construction.',
    stages: ['commission', 'ledger', 'consent'], layer: 'analytical',
    precedent: 'Eclipse Dataspace Components usage control · ODRL policies · X-Road message protocol',
    maturity: 'emerging',
    cost: 'Low technically. The cost is writing down what today is left comfortably implicit.',
    notFor: 'A contract expresses intent, not honesty. It has to be enforced at the edge and evidenced in the ledger, or it is documentation.',
    confidence: 'hypothesis',
  },
  {
    id: 'he', name: 'Homomorphic encryption', short: 'HE',
    what: 'Compute directly on encrypted data without ever decrypting it.',
    solves: 'In principle, the strongest possible version of "the holder never sees the query and the querier never sees the data".',
    stages: ['mis'], layer: 'compute',
    precedent: 'Research deployments; narrow production use in finance',
    maturity: 'research',
    cost: 'Very high — orders of magnitude slower than plaintext computation for general workloads.',
    notFor: 'This estate, now. It is listed here because it is the thing people reach for when they want a cryptographic guarantee, and the honest answer is that the model does not need it: nothing on this page is blocked by cryptography. It is blocked by agreement.',
    confidence: 'fact',
  },
];

export const methodById = (id: MethodId) => METHODS.find((m) => m.id === id)!;

// ---------------------------------------------------------------------------
// OPENSAFELY — the case study, and its honest limits.
// ---------------------------------------------------------------------------

export interface CaseStudyPoint { k: string; v: string }

export const OPENSAFELY = {
  title: 'OpenSAFELY',
  strap: 'England already built the thing this page is arguing for — in health, under pressure, at national scale.',
  eli5: 'During the pandemic, researchers needed to study millions of health records fast. Instead of copying the records out, they sent their sums in. The sums were published so anyone could check them, and only the checked results came back out. Nobody ever handed over the records.',
  official:
    'OpenSAFELY is a secure analytics platform for NHS electronic health records, built at the University of Oxford’s Bennett Institute from 2020. Analysts never receive the data. They write code against dummy data, publish it, and the code executes inside the secure environments run by the EHR suppliers that already hold the records. Outputs are disclosure-checked before release. It has supported a large body of peer-reviewed work covering the great majority of English general practice.',
  technical:
    'Analysis is expressed against a common data model, developed against dummy data, version-controlled in the open, and dispatched to run inside each supplier’s environment. Every job, its code hash and its outputs are logged. Output checking is a staffed human function, not an automated gate. The privacy property is structural: there is no route by which record-level data reaches the analyst, so it does not depend on the analyst’s good behaviour.',
  proves: [
    { k: 'Compute-to-data works at national scale', v: 'Not a pilot and not a lab result — a production platform that carried a very large body of national research under real pressure.' },
    { k: 'Code in the open is practical', v: 'Publishing the analysis before it runs turned out to be operationally workable, and it is the single cheapest trust mechanism on the list.' },
    { k: 'Output checking is the real gate', v: 'The human statistical review before release is what makes the rest safe. Every serious design keeps it.' },
    { k: 'The vendors can be the execution environment', v: 'The suppliers already holding the records ran the compute. That is exactly the role this model asks MIS suppliers to take.' },
  ] as CaseStudyPoint[],
  limits: [
    { k: 'Two vendors, not fourteen', v: 'OpenSAFELY federated across a small number of EHR suppliers covering most of English general practice. Education’s estate is roughly fourteen meaningful MIS suppliers plus a self-hosting tail — a materially harder coordination problem, and the main reason supplier onboarding is the programme rather than a workstream.' },
    { k: 'Primary care data is far more standardised', v: 'Health has decades of clinical terminologies and a mature common data model. Education has the Common Basic Data Set, the census specification and a great deal of local practice. The standards gap, not the privacy technology, is the binding constraint.' },
    { k: 'Its speed had a legal engine that has lapsed', v: 'Much of the pandemic-era pace came from emergency legal instruments. The steady-state governance timeline is closer to the slow path on this page than to the fast one — which is exactly why consent reusability matters so much.' },
    { k: 'Research users are not operational users', v: 'OpenSAFELY serves a small, accredited research population. A spine also has to serve safeguarding practitioners, school leaders and commercial products — populations with different assurance, different urgency and different failure modes.' },
  ] as CaseStudyPoint[],
  confidence: 'fact' as Confidence,
};

// ---------------------------------------------------------------------------
// THE NETWORK EFFECT — onboarding tiers, the loop, and the bargain.
// Coverage derives from the same supplier census the simulator uses, so the two
// visualisations cannot disagree about the market.
// ---------------------------------------------------------------------------

const REAL = SUPPLIERS.filter((s) => !s.indicative);
const STATE_TOTAL = REAL.reduce((a, s) => a + s.schools, 0);
const TOP3 = ['sup-arbor', 'sup-sims', 'sup-bromcom'];
const top3Schools = REAL.filter((s) => TOP3.includes(s.id)).reduce((a, s) => a + s.schools, 0);

export const TOP3_COVERAGE = Math.round((top3Schools / STATE_TOTAL) * 100);
export const ALL_MIS_COVERAGE = 99;
export const SUPPLIER_COUNT = SUPPLIERS.length;

export interface Tier {
  id: string;
  no: number;
  name: string;
  who: string;
  /** % of the state-funded school estate reachable once this tier is on */
  coverage: number;
  /** what joining costs them */
  gives: string;
  gets: string;
  /** the questions this tier makes answerable that were not before */
  unlocks: string[];
  hardPart: string;
  confidence: Confidence;
}

export const TIERS: Tier[] = [
  {
    id: 't1', no: 1, name: 'The three majors', who: 'Arbor · ESS SIMS · Bromcom',
    coverage: TOP3_COVERAGE,
    gives: 'A conformant gateway on their existing estate, and the release-cycle commitment to keep it current.',
    gets: 'One integration instead of a growing queue of bespoke DfE data requests — and a defensible answer when a trust asks how they support national reporting.',
    unlocks: [
      'National attendance and absence aggregates without a collection',
      'Cohort counts by any published characteristic, same day',
      'The end of the census as the only way to ask a question',
    ],
    hardPart: 'Three commercial suppliers gain a de-facto veto over national statistics. That concentration is a real strategic risk and it argues for the on-ramp being funded and the spec being genuinely open.',
    confidence: 'hypothesis',
  },
  {
    id: 't2', no: 2, name: 'The mid-tail and self-hosted', who: `${SUPPLIER_COUNT - 3}+ further suppliers, down to schools running their own servers`,
    coverage: ALL_MIS_COVERAGE,
    gives: 'The same conformant gateway, at a scale where the build cost is a much larger share of revenue.',
    gets: 'Parity. A small supplier that is certified competes on product rather than on integration reach.',
    unlocks: [
      'Place-based answers that survive suppression — small LAs stop disappearing from published tables',
      'Special and alternative provision counted properly, rather than estimated',
      'Coverage figures high enough that a federated answer can be published as a national statistic',
    ],
    hardPart: 'This is where a funded on-ramp decides whether the fabric has holes exactly where safeguarding needs it most. Cost recovery here would be a false economy with a body count.',
    confidence: 'hypothesis',
  },
  {
    id: 't3', no: 3, name: 'The 153 local authorities', who: 'Children’s services, admissions, attendance, SEND casework',
    coverage: ALL_MIS_COVERAGE,
    gives: 'Connectors on case-management systems that were never built to be queried.',
    gets: 'The join they have wanted for twenty years — their own children, across school and service, without a manual data-matching exercise per question.',
    unlocks: [
      'Absence × children in need — visible for the first time without a bespoke study',
      'Exclusions × alternative provision, nationally and in near real time',
      'Children missing education, reconciled against enrolment rather than estimated',
    ],
    hardPart: 'LA case systems are more varied and less well resourced than the MIS market, and the white paper itself concedes their security posture is weaker. This tier needs money and time, not exhortation.',
    confidence: 'hypothesis',
  },
  {
    id: 't4', no: 4, name: 'Accredited edtech', who: 'Assessment, safeguarding, wellbeing, attendance-intervention and parental-engagement products',
    coverage: ALL_MIS_COVERAGE,
    gives: 'Non-PII signals back to the network under school authorisation — usage, reach, and outcome flags — plus audit and a published accreditation status.',
    gets: 'Certified, school-authorised read access to school-scoped context. No more re-keying a pupil roll at every onboarding, and a DfE accreditation a school can point to in procurement.',
    unlocks: [
      'Intervention effectiveness at national scale — what actually works, without a single new form',
      'The evidence base moving from small trials to the whole population',
      'Schools able to see whether the product they bought is doing anything',
    ],
    hardPart: 'This is where the model stops being an infrastructure decision and becomes a market intervention. Accreditation that is valuable is accreditation that must be contestable, appealable and priced on conformance rather than on how much data a supplier contributes.',
    confidence: 'hypothesis',
  },
  {
    id: 't5', no: 5, name: 'Cross-sector', who: 'Health, DWP, youth justice, police — as federated peers, never as a pool',
    coverage: ALL_MIS_COVERAGE,
    gives: 'Their own connectors, under their own controllers, with objections and statutory overrides handled in their own domain.',
    gets: 'Answers to questions no single department can currently ask at all.',
    unlocks: [
      'The hidden NEETs — Milburn’s ~314,000 invisible young people, findable with no combined database',
      'Safeguarding context assembled at the moment of need rather than after a serious case review',
      'Whole-child outcomes measured without a whole-child dossier existing anywhere',
    ],
    hardPart: 'Every additional domain multiplies the legal surface. This tier is the prize and it is also the one that should move last, after the education federation has demonstrably worked.',
    confidence: 'hypothesis',
  },
];

export interface LoopStep { no: number; title: string; body: string; actor: string }

export const LOOP: LoopStep[] = [
  { no: 1, actor: 'DfE', title: 'Publish one spec, free', body: 'An open gateway specification, a public conformance suite, and a versioned schema registry. Certification is a test result, not a procurement.' },
  { no: 2, actor: 'Supplier', title: 'Implement once, get certified', body: 'A supplier builds the gateway a single time and passes the public conformance suite. That replaces an indefinite queue of bespoke integration requests.' },
  { no: 3, actor: 'Schools', title: 'Value comes back immediately', body: 'The estates that answer questions get their own benchmarks back the same day — the school sees itself against similar schools without filling anything in.' },
  { no: 4, actor: 'Market', title: 'Certification becomes a buying criterion', body: 'Once schools notice which systems answer instantly and which need a data request, "certified" starts appearing in procurement. The badge acquires commercial value.' },
  { no: 5, actor: 'Edtech', title: 'Products want in', body: 'Accredited products get school-authorised access to school-scoped context instead of re-keying rolls and chasing CSVs. Onboarding stops being the worst week of the customer relationship.' },
  { no: 6, actor: 'Network', title: 'They contribute back — and it compounds', body: 'In exchange, products return non-PII signals under the same rules. The network answers questions it could not answer before, which makes membership worth more, which brings the next supplier in.' },
];

export interface GiveGet { give: string; get: string }

export const GIVE_GET: GiveGet[] = [
  { give: 'A conformant gateway, plus public conformance test results', get: 'One integration instead of N bespoke ones — and a credible answer to every future data request' },
  { give: 'Non-PII signals returned to the network under school authorisation', get: 'Certified read access to school-scoped context; no CSV re-keying at onboarding' },
  { give: 'Audit, and an accreditation status that is published — including when it lapses', get: 'A DfE accreditation a school can cite in procurement: a genuine moat for suppliers who do this properly' },
  { give: 'Objections and revocations honoured in seconds, not release cycles', get: 'A school’s data-protection review becomes a checkbox rather than a six-week project — a materially shorter sales cycle' },
];

export interface Risk { title: string; body: string; confidence: Confidence }

export const NETWORK_RISKS: Risk[] = [
  {
    title: 'It makes the DfE a de-facto regulator of a market it does not fund',
    body: 'An accreditation schools ask for in procurement is a licence to trade in all but name. That power needs an appeal route, a published standard, and a statutory footing decided in advance — not discovered when the first supplier is refused.',
    confidence: 'contested',
  },
  {
    title: 'Data-for-access is a coercive bargain at small scale',
    body: 'A large incumbent can absorb a contribution obligation; a three-person supplier cannot. Access should be priced on conformance, never on how much data a supplier hands back, or the network quietly consolidates the market it depends on.',
    confidence: 'hypothesis',
  },
  {
    title: 'The three majors gain a veto',
    body: `Roughly ${TOP3_COVERAGE}% of state schools sit behind three suppliers. If national statistics depend on their cooperation, their commercial interests become a policy input. An open spec and a funded tail are the only real counterweights.`,
    confidence: 'hypothesis',
  },
  {
    title: 'Scope creep is the default failure',
    body: 'Every extra field a partner may read is a new consent class carrying the full governance cost on the slow path. A catalogue that grows fast is a catalogue nobody has assessed. Slow growth has to be a design goal, not a symptom of underfunding.',
    confidence: 'hypothesis',
  },
  {
    title: 'The school is the controller — not the department',
    body: 'An accreditation regime in which the DfE authorises app access to school data on schools’ behalf would be a legal and political error. The department certifies conformance; the school grants access; the family can object. Blurring those three roles is how this loses public consent.',
    confidence: 'fact',
  },
];

// New citations this route relies on beyond the existing SOURCES list are appended
// to lib/sources.ts rather than duplicated here.

// ---------------------------------------------------------------------------
// DEPTH — the ELI5 → technical gradient, page-local (see spec decision D6).
// ---------------------------------------------------------------------------

export type Depth = 'eli5' | 'official' | 'technical';

export interface DepthOption { id: Depth; label: string; hint: string }

export const DEPTHS: DepthOption[] = [
  { id: 'eli5', label: 'ELI5', hint: 'Plain English. No jargon, no acronyms, nothing assumed.' },
  { id: 'official', label: 'Official', hint: 'The briefing-note version — precise, but readable by a non-specialist.' },
  { id: 'technical', label: 'Technical', hint: 'The engineering detail: protocols, artefacts and failure modes.' },
];

/** Pick the right depth string off any object carrying all three. */
export const say = (o: { eli5: string; official: string; technical: string }, d: Depth) => o[d];
