// queries.ts — the query-anatomy model behind "Ask the federation". A catalogue
// of questions central government could put to the exchange, each carried down
// to the query text itself; a deterministic runner that produces per-supplier
// partial responses (the component parts) and the assembled return that lands
// at the DfE; and a scenario builder so a run plays out on the 3-D network.
// Guardrail: a statutory basis compels an answer (an attempted opt-out is noted
// and overridden); a voluntary basis is honoured at the gateway and the answer
// comes back smaller, labelled partial. Plain TS, DOM/Three-free, seeded RNG.

import type { Scenario, SimAction } from './engine';
import { spray, ledgerStamp } from './scenarios';
import { SUPPLIERS, EDTECH, DFE_ID, supplierCounts, mulberry32, DEFAULT_SCHOOL_COUNT, type SupplierTier } from './topology';

export type QueryBasis = 'statutory' | 'voluntary';

export interface FedQuery {
  id: string;
  question: string;
  requester: string;
  requesterId: string;
  basis: QueryBasis;
  instrument: string;
  purpose: string;
  fields: string[];
  population: string;
  aggregation: string;
  retention: string;
  queryBody: string;
  /** what the headline number counts, e.g. "pupils absent this morning" */
  unit: string;
  /** deterministic per-1000 rate band the MIS estates draw from — omitted for
   * edtech-sourced questions, whose rates are derived per platform */
  ratePer1000?: [number, number];
  /** the signal lives in the edtech tendrils, not the MIS estates */
  needsEdtech?: boolean;
  /** what actually lands at the DfE — shown in THE RETURN stage */
  returnNotes: string[];
}

export type PartialStatus = 'answered' | 'opted-out' | 'must-answer';

export interface PartialResult {
  supplierId: string;
  supplierLabel: string;
  providerKind: 'mis' | 'edtech';
  tier?: SupplierTier;
  schools: number;
  pupils: number;
  status: PartialStatus;
  /** metric count contributed by this estate (0 when opted out) */
  value: number;
  ratePer1000: number;
  suppressedCells: number;
  payloadKB: number;
}

export interface AssembledReturn {
  totalValue: number;
  totalPupils: number;
  schoolsCovered: number;
  schoolsTotal: number;
  coveragePct: number;
  partial: boolean;
  optedOut: string[];
  overridden: string[];
  suppressedCells: number;
}

export interface QueryRun {
  query: FedQuery;
  partials: PartialResult[];
  assembled: AssembledReturn;
}

// ---------------------------------------------------------------------------
// The catalogue — statutory asks (mandated: gateways must answer) and voluntary
// asks (pilots, research, consent-based: gateways may decline).
// ---------------------------------------------------------------------------

export const QUERIES: FedQuery[] = [
  {
    id: 'absence-today',
    question: 'How many children were absent from school this morning?',
    requester: 'Department for Education · daily statistics',
    requesterId: DFE_ID,
    basis: 'statutory',
    instrument: 'School Attendance (Pupil Registers) Regulations 2024',
    purpose: 'Same-day national and regional absence picture',
    fields: ['AM session marks (aggregate counts)', 'Absence category totals'],
    population: 'All state-funded providers',
    aggregation: 'School-level counts → LA and national totals; no pupil rows',
    retention: 'Aggregates kept; query text logged permanently',
    unit: 'pupils absent this morning',
    ratePer1000: [56, 84],
    queryBody: `-- attendance/daily/2026-07-11 · Attendance Regs 2024
SELECT school_urn,
       la_code,
       COUNT(*) FILTER (WHERE am_mark IN ('N','U','O'))  AS absent_am,
       COUNT(*) FILTER (WHERE am_mark = 'I')             AS absent_illness,
       COUNT(*)                                          AS on_roll_today
FROM   session_register
WHERE  session_date = CURRENT_DATE
GROUP  BY school_urn, la_code
-- gateway policy: aggregate-only · suppress cells < 10 at source`,
    returnNotes: [
      '152 LA-level absence totals and one national figure — assembled from 15 estate parcels',
      'No pupil identifier, no school-by-school register, no row-level marks leave any MIS',
      'Coverage statement attached: which estates answered, which were unreachable',
      'Ledger entry: query text + basis + result schema, citizen-inspectable',
    ],
  },
  {
    id: 'fsm-eligibility',
    question: 'How many pupils are eligible for free school meals right now?',
    requester: 'Department for Education · funding allocation',
    requesterId: DFE_ID,
    basis: 'statutory',
    instrument: 'Education Act 1996 s.537A — prescribed information regulations',
    purpose: 'In-year FSM eligibility for funding and pupil-premium allocation',
    fields: ['FSM-eligible totals by school', 'Year-group breakdown (counts)'],
    population: 'All state-funded providers',
    aggregation: 'School-level totals; cells under 10 suppressed at source',
    retention: 'Aggregates kept for allocation audit trail',
    unit: 'FSM-eligible pupils',
    ratePer1000: [228, 262],
    queryBody: `-- census/fsm/2026-summer · s.537A
SELECT school_urn,
       year_group,
       COUNT(*) FILTER (WHERE fsm_eligible)  AS fsm_pupils,
       COUNT(*)                              AS pupils_on_roll
FROM   pupil_register
WHERE  enrolment_status = 'on_roll'
GROUP  BY school_urn, year_group
HAVING COUNT(*) >= 10   -- small-cell suppression at source`,
    returnNotes: [
      'School-level FSM totals — the funding input, without a pupil-level census extract',
      'The eligibility check itself stays where it always ran: inside each MIS estate',
      'Suppressed small cells are counted and declared, not silently dropped',
      'Pupil-level records moved: 0',
    ],
  },
  {
    id: 'send-ehcp',
    question: 'How many pupils have an active EHC plan, by phase?',
    requester: 'Department for Education · SEND policy',
    requesterId: DFE_ID,
    basis: 'statutory',
    instrument: 'Children and Families Act 2014 · SEND Code of Practice returns',
    purpose: 'Monitor EHCP volumes against SEND reform trajectory',
    fields: ['Active EHCP counts by phase', 'Assessment-stage counts'],
    population: 'All state-funded providers incl. special and AP',
    aggregation: 'Phase-level counts; special-school cells watched for smallness',
    retention: 'Time series kept for policy monitoring',
    unit: 'pupils with an active EHCP',
    ratePer1000: [43, 58],
    queryBody: `-- send/ehcp/2026-Q3 · CFA 2014
SELECT school_phase,
       COUNT(*) FILTER (WHERE sen_status = 'EHCP')        AS ehcp_active,
       COUNT(*) FILTER (WHERE sen_status = 'assessment')  AS ehcp_assessment,
       COUNT(*) FILTER (WHERE sen_status = 'SEN_support') AS sen_support
FROM   pupil_register
WHERE  enrolment_status = 'on_roll'
GROUP  BY school_phase`,
    returnNotes: [
      'A phase-level EHCP census in minutes — special and AP estates answer alongside the mainstream',
      'Databridge’s special-school estate returns the richest cells, suppressed hardest',
      'No child’s plan, diagnosis or provision detail crosses the exchange',
    ],
  },
  {
    id: 'cme-count',
    question: 'How many children are missing education, by local authority?',
    requester: 'Department for Education · safeguarding statistics',
    requesterId: DFE_ID,
    basis: 'statutory',
    instrument: 'Education Act 1996 s.436A · CME statutory guidance',
    purpose: 'National children-missing-education volumes for the attendance strategy',
    fields: ['CME open-case counts by LA', 'Days-unaccounted distribution (banded)'],
    population: 'All providers + LA admissions records',
    aggregation: 'LA-level counts, banded durations — never a list of children',
    retention: 'Counts kept; the underlying case data never moves',
    unit: 'children flagged missing education',
    ratePer1000: [3, 8],
    queryBody: `-- cme/quarterly/2026-Q3 · s.436A
SELECT la_code,
       COUNT(*)                                   AS cme_open,
       COUNT(*) FILTER (WHERE days_gap > 20)      AS cme_over_20_days,
       WIDTH_BUCKET(days_gap, 0, 120, 6)          AS duration_band,
       COUNT(*)                                   AS in_band
FROM   leaver_tracking
WHERE  destination_confirmed = FALSE
GROUP  BY la_code, duration_band`,
    returnNotes: [
      '152 LA counts of children currently unaccounted for — the gap the child-who-moves scenario closes',
      'Banded durations show how long gaps persist, without naming a single child',
      'The record-level follow-up (which children) belongs to each LA’s own statutory duty, under its own basis',
    ],
  },
  {
    id: 'wellbeing-pilot',
    question: 'What does pupil wellbeing look like this term?',
    requester: 'Department for Education · wellbeing pilot',
    requesterId: DFE_ID,
    basis: 'voluntary',
    instrument: '2026 wellbeing pilot — school-level consent, no statutory power',
    purpose: 'Pilot a national wellbeing indicator without a new statutory collection',
    fields: ['Wellbeing index (school aggregate)', 'Participation rate'],
    population: 'Participating estates only — suppliers may decline',
    aggregation: 'School-level index; suppressed under 10 respondents',
    retention: 'Pilot aggregates for 24 months, then destroyed',
    unit: 'pupils reporting positive wellbeing',
    ratePer1000: [598, 704],
    queryBody: `-- pilot/wellbeing/1.0 · voluntary · consent-gated
SELECT school_urn,
       AVG(wellbeing_index)                       AS wb_index,
       COUNT(*)                                   AS respondents,
       COUNT(*) FILTER (WHERE wellbeing_index >= 3.0) AS positive
FROM   wellbeing_survey
WHERE  term = '2026-summer' AND consent_flag = TRUE
GROUP  BY school_urn
HAVING COUNT(*) >= 10`,
    returnNotes: [
      'A national wellbeing readout from whoever chose to take part — coverage honestly labelled',
      'Every estate that declined appears in the coverage statement, not in the data',
      'This is the guardrail demonstration: no statute, so "no" holds at the gateway',
    ],
  },
  {
    id: 'tutoring-uplift',
    question: 'Is small-group tutoring actually shifting outcomes?',
    requester: 'Accredited evaluation · commissioned by DfE',
    requesterId: DFE_ID,
    basis: 'voluntary',
    instrument: 'DEA 2017 research accreditation · school-level opt-in',
    purpose: 'Evaluate the tutoring programme against matched comparators',
    fields: ['Tutored-cohort attainment bands', 'Comparator bands', 'Dosage (hours, banded)'],
    population: 'Estates opting into the evaluation',
    aggregation: 'Banded cohort cells, suppressed under 10, noise added at source',
    retention: 'Evaluation results only; query auto-expires in 90 days',
    unit: 'tutored pupils in the evaluation cohort',
    ratePer1000: [78, 122],
    queryBody: `-- research/tutoring-eval/R-2691 · DEA 2017 · voluntary
SELECT attainment_band,
       dosage_band,
       COUNT(*) FILTER (WHERE tutored)      AS tutored,
       COUNT(*) FILTER (WHERE NOT tutored)  AS comparator
FROM   ks2_cohort_2026
GROUP  BY attainment_band, dosage_band
HAVING COUNT(*) >= 10
-- gateway adds calibrated noise before return (ε-DP profile v2)`,
    returnNotes: [
      'A tutoring-effect table built from partial tables computed inside each participating estate',
      'Small cells suppressed and noise added before anything leaves — the researcher never sees raw counts',
      'Estates that opted out simply shrink the cohort; the answer says so on its face',
    ],
  },
  {
    id: 'ai-classroom',
    question: 'Where are AI tools actually being used in classrooms?',
    requester: 'Department for Education · edtech evidence unit',
    requesterId: DFE_ID,
    basis: 'voluntary',
    instrument: '2026 AI-in-education evidence call — voluntary, no power exists',
    purpose: 'Map real classroom AI adoption before regulating it',
    fields: ['Classes using AI tools weekly (counts)', 'Tool category mix'],
    population: 'Estates willing to share adoption telemetry',
    aggregation: 'School-level counts by tool category',
    retention: 'Snapshot for the evidence call, 12 months',
    unit: 'pupils in classes using AI tools weekly',
    ratePer1000: [138, 264],
    queryBody: `-- evidence/ai-adoption/2026 · voluntary
SELECT school_urn,
       tool_category,
       COUNT(DISTINCT class_id)   AS classes_active,
       COUNT(DISTINCT pupil_id)   AS pupils_reached
FROM   integration_telemetry
WHERE  tool_category IN ('generative','adaptive','assessment')
  AND  last_active >= CURRENT_DATE - INTERVAL '7 days'
GROUP  BY school_urn, tool_category`,
    returnNotes: [
      'An adoption map no survey could produce — from the systems that already see it',
      'Voluntary end to end: suppliers and schools both consent to telemetry sharing',
      'The question the DfE cannot currently answer at all, answered without a new collection',
    ],
  },
  {
    id: 'digital-homework',
    question: 'How much homework happens digitally — and when?',
    requester: 'Department for Education · workload review',
    requesterId: DFE_ID,
    basis: 'voluntary',
    instrument: 'Edtech federation pilot — certified tendrils, aggregate-only',
    purpose: 'Evidence the homework-workload debate with usage curves, not anecdotes',
    fields: ['Active pupils (7-day)', 'Tasks set/completed (counts)', 'Hour-of-day histogram'],
    population: 'Schools covered by participating edtech platforms',
    aggregation: 'Platform-level aggregates; no account-level data',
    retention: 'Trend series, 24 months',
    unit: 'pupils active on digital homework this week',
    needsEdtech: true,
    queryBody: `-- edtech/homework-pulse/2026-28 · federation pilot
SELECT platform_id,
       date_trunc('hour', completed_at)  AS hour_bucket,
       COUNT(DISTINCT pupil_ref)         AS active_pupils,
       COUNT(*)                          AS tasks_completed
FROM   homework_events
WHERE  completed_at >= CURRENT_DATE - INTERVAL '7 days'
GROUP  BY platform_id, hour_bucket
-- pupil_ref is a per-platform pseudonym: never joinable across tendrils`,
    returnNotes: [
      'The 9pm homework spike, nationally, by platform — intelligence only the tendrils hold',
      'Each platform aggregates in its own estate; pseudonyms are not joinable across tendrils',
      'This is the edtech-ring argument: certified spurs contributing signals, never account data',
    ],
  },
];

export function queryById(id: string): FedQuery | undefined {
  return QUERIES.find((q) => q.id === id);
}

/** The one chip label for a basis — shared by the HUD phase chips and the explorer. */
export function basisLabel(basis: QueryBasis): string {
  return basis === 'statutory' ? 'MANDATED' : 'VOLUNTARY';
}

// ---------------------------------------------------------------------------
// The runner — deterministic partials + the assembled return
// ---------------------------------------------------------------------------

// The digital-homework panel is the topology's edtech roster: any platform with
// a schoolsReached figure participates, so a rename there can't strand a stale
// id here.
const EDTECH_PANEL = EDTECH.filter((e) => e.schoolsReached != null);

function hashId(s: string): number {
  let h = 0x9e3779b9;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 2654435761);
  return h >>> 0;
}

export function runQuery(
  query: FedQuery,
  optOuts: Iterable<string> = [],
  schoolCount = DEFAULT_SCHOOL_COUNT,
): QueryRun {
  const opted = new Set(optOuts);
  const partials: PartialResult[] = [];

  if (query.needsEdtech) {
    // the signal holders are the tendrils; participation is voluntary by construction
    for (const spec of EDTECH_PANEL) {
      const schools = spec.schoolsReached!;
      const rng = mulberry32(hashId(query.id) ^ hashId(spec.id));
      const pupils = Math.round(schools * (170 + rng() * 240));
      const rate = 420 + rng() * 340;
      partials.push({
        supplierId: spec.id,
        supplierLabel: spec.label,
        providerKind: 'edtech',
        schools,
        pupils,
        status: 'answered',
        value: Math.round((pupils * rate) / 1000),
        ratePer1000: Math.round(rate),
        suppressedCells: Math.round(schools * (0.012 + rng() * 0.02)),
        payloadKB: Math.round(4 + schools * 0.006),
      });
    }
  } else {
    const counts = supplierCounts(schoolCount);
    SUPPLIERS.forEach((spec, si) => {
      const rng = mulberry32(hashId(query.id) ^ hashId(spec.id));
      const schools = counts[si];
      const pupils = Math.round(schools * (235 + rng() * 175));
      const [lo, hi] = query.ratePer1000 ?? [0, 0];
      const rate = lo + rng() * (hi - lo);
      const wantsOut = opted.has(spec.id);
      const status: PartialStatus = wantsOut
        ? (query.basis === 'statutory' ? 'must-answer' : 'opted-out')
        : 'answered';
      const answers = status !== 'opted-out';
      partials.push({
        supplierId: spec.id,
        supplierLabel: spec.label,
        providerKind: 'mis',
        tier: spec.tier,
        schools,
        pupils,
        status,
        value: answers ? Math.round((pupils * rate) / 1000) : 0,
        ratePer1000: answers ? Math.round(rate * 10) / 10 : 0,
        suppressedCells: answers ? Math.round(schools * (0.05 + rng() * 0.06)) : 0,
        payloadKB: answers ? Math.round(2 + schools * 0.004) : 0,
      });
    });
  }

  const answering = partials.filter((p) => p.status !== 'opted-out');
  const schoolsTotal = query.needsEdtech
    ? schoolCount
    : partials.reduce((a, p) => a + p.schools, 0);
  // tendril coverage overlaps heavily; discount rather than sum naively
  const schoolsCovered = query.needsEdtech
    ? Math.min(Math.round(answering.reduce((a, p) => a + p.schools, 0) * 0.55), Math.round(schoolCount * 0.92))
    : answering.reduce((a, p) => a + p.schools, 0);
  const coveragePct = Math.round((schoolsCovered / schoolsTotal) * 1000) / 10;

  const assembled: AssembledReturn = {
    totalValue: answering.reduce((a, p) => a + p.value, 0),
    totalPupils: answering.reduce((a, p) => a + p.pupils, 0),
    schoolsCovered,
    schoolsTotal,
    coveragePct,
    partial: !query.needsEdtech && coveragePct < 100,
    optedOut: partials.filter((p) => p.status === 'opted-out').map((p) => p.supplierLabel),
    overridden: partials.filter((p) => p.status === 'must-answer').map((p) => p.supplierLabel),
    suppressedCells: answering.reduce((a, p) => a + p.suppressedCells, 0),
  };

  return { query, partials, assembled };
}

// ---------------------------------------------------------------------------
// Scenario builder — a run, staged for the 3-D network
// ---------------------------------------------------------------------------

export function buildQueryScenario(run: QueryRun): Scenario {
  const { query, partials, assembled } = run;
  const requester = query.requesterId;
  const responders = partials.map((p) => p.supplierId);
  const answering = partials.filter((p) => p.status !== 'opted-out');
  const refusing = partials.filter((p) => p.status === 'opted-out');
  const overridden = partials.filter((p) => p.status === 'must-answer');
  const basisChip = basisLabel(query.basis);

  const steps: Scenario['steps'] = [];

  steps.push({
    narration: `The question leaves the department as a signed contract: "${query.question}" Basis: ${query.instrument} — ${query.basis === 'statutory' ? 'a mandated ask; gateways must answer' : 'a voluntary ask; every gateway may decline'}. The query text itself travels with it.`,
    phase: `CONTRACT · ${basisChip}`,
    holdMs: 4800,
    actions: [
      { kind: 'highlight', nodes: [requester], on: true },
      { kind: 'log', log: 'contract', text: `DfE → exchange: ${query.id} · ${query.basis} · aggregate-only` },
      { kind: 'counter', key: 'exchanges', delta: 1 },
      ...spray(requester, responders, 'query', 300, 110),
    ],
  });

  const verifyActions: SimAction[] = [
    ...answering.map((p, i): SimAction => ({ kind: 'flash', node: p.supplierId, color: 'ok', delayMs: i * 90 })),
    ...refusing.map((p, i): SimAction => ({ kind: 'flash', node: p.supplierId, color: 'refuse', delayMs: 300 + i * 140 })),
    ...spray(refusing.map((p) => p.supplierId), requester, 'refuse', 700, 160),
    ...(refusing.length ? [{ kind: 'counter', key: 'refusals', delta: refusing.length, delayMs: 1200 } as SimAction] : []),
    { kind: 'log', log: 'verify', text: `${answering.length}/${partials.length} gateways accept · signature + basis verified`, delayMs: 900 },
  ];
  if (refusing.length) {
    verifyActions.push({ kind: 'log', log: 'refuse', text: `Declined (voluntary basis honoured): ${refusing.map((p) => p.supplierLabel).join(', ')}`, delayMs: 1400 });
  }
  if (overridden.length) {
    verifyActions.push({ kind: 'log', log: 'verify', text: `Objection noted but overridden — statutory basis compels: ${overridden.map((p) => p.supplierLabel).join(', ')}`, delayMs: 1400 });
  }
  steps.push({
    narration: refusing.length
      ? `Every gateway runs the same check. ${refusing.length} decline${refusing.length === 1 ? 's' : ''} — this ask carries no statute, so "no" holds at the edge and the refusal goes on the record. The rest verify and proceed.`
      : overridden.length
        ? `Every gateway runs the same check. ${overridden.map((p) => p.supplierLabel).join(' and ')} lodge${overridden.length === 1 ? 's' : ''} an objection — but this ask is mandated, so the gateway answers anyway and the objection itself is logged. That is the guardrail working in both directions.`
        : 'Every gateway independently verifies the signature, the basis, and the aggregation plan. This ask is lawful, minimal and aggregate-only — all accept.',
    phase: refusing.length ? 'VERIFY · OPT-OUT' : overridden.length ? 'VERIFY · OVERRIDE' : 'VERIFY',
    holdMs: 4600,
    actions: verifyActions,
  });

  steps.push({
    narration: query.needsEdtech
      ? 'Local compute, tendril edition: each platform aggregates inside its own estate. Pseudonyms stay per-platform — nothing here can be joined into a profile of a child.'
      : 'Local compute. Each estate runs the count behind its own gateway; small cells are suppressed before anything is assembled. The records stay put.',
    phase: 'LOCAL COMPUTE',
    holdMs: 4600,
    actions: [
      ...answering
        .filter((p) => p.providerKind === 'mis')
        .map((p, i): SimAction => ({
          kind: 'fanout', supplier: p.supplierId,
          count: p.tier === 'major' ? 260 : p.tier === 'mid' ? 90 : 55,
          color: 'query', delayMs: i * 240,
        })),
      ...answering
        .filter((p) => p.providerKind === 'edtech')
        .map((p, i): SimAction => ({ kind: 'flash', node: p.supplierId, color: 'query', delayMs: i * 200 })),
      { kind: 'log', log: 'compute', text: `${answering.length} estates computing · ${assembled.suppressedCells.toLocaleString('en-GB')} small cells suppressed at source · pupil rows extracted: 0`, delayMs: 1600 },
    ],
  });

  steps.push({
    narration: assembled.partial
      ? `The answer comes home smaller and says so: ${assembled.totalValue.toLocaleString('en-GB')} ${query.unit}, from ${assembled.coveragePct}% of schools — labelled PARTIAL in every downstream use. A voluntary federation trades coverage for consent, in the open.`
      : `The answers come home: ${answering.length} parcels of aggregates assemble into ${assembled.totalValue.toLocaleString('en-GB')} ${query.unit}${query.needsEdtech ? ` across roughly ${assembled.coveragePct}% of schools` : ''} — and the pupil-records-moved counter still reads zero.`,
    phase: 'RETURN',
    holdMs: 5200,
    actions: [
      ...spray(answering.map((p) => p.supplierId), requester, 'ok', 0, 130),
      { kind: 'counter', key: 'aggregatesReturned', delta: answering.length, delayMs: 1300 },
      { kind: 'log', log: 'return', text: `${answering.length} aggregate returns → DfE · coverage ${assembled.coveragePct}%${assembled.partial ? ' · flagged PARTIAL' : ''}`, delayMs: 1500 },
      ...ledgerStamp(`${query.id} complete — query text, basis and coverage publicly inspectable`, 2100),
      { kind: 'highlight', nodes: [requester], on: false, delayMs: 2600 },
    ],
  });

  return {
    id: `ask-${query.id}`,
    group: 'Ask the federation',
    title: query.question,
    tagline: query.basis === 'statutory' ? 'A mandated ask — answered by all, objections logged.' : 'A voluntary ask — every gateway may say no.',
    description: query.purpose,
    lesson: query.basis === 'statutory'
      ? 'Mandated asks are compelled by statute, not by architecture — and the same ledger that records answers records objections.'
      : 'Voluntary asks live or die on trust: the federation returns what participants choose to give, honestly labelled.',
    contract: {
      requester: query.requester,
      purpose: query.purpose,
      legalBasis: query.instrument,
      fields: query.fields,
      population: query.population,
      aggregation: query.aggregation,
      retention: query.retention,
    },
    queryId: query.id,
    usesEdtech: !!query.needsEdtech,
    central: {
      records: 'The same question against a central store: answered from the copy of everything, whether or not anyone consented',
      exposure: 'Opt-outs become rows the centre must remember to respect on every extract, forever',
      note: 'In a federation, participation is enforced where the data lives — not remembered where it’s copied.',
    },
    steps,
  };
}
