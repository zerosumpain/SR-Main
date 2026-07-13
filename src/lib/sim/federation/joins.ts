// joins.ts — the cross-context JOIN engine. The 14 scripted scenarios and the 8
// "ask the federation" queries all live inside ONE context space: the schools/MIS
// estate. The genuinely hard research questions DfE needs to answer join TWO worlds
// that share no analytic key — the school MIS estate and the local-authority case
// systems (and, at the frontier, health and cross-government earnings). Each join
// fans a signed contract into BOTH estates, computes a partial on each side, then
// meets at the identity RESOLVER, which matches a school-side UPN to a second-side
// case ID, scores the confidence, and DROPS what it cannot link. The honesty is the
// whole point: there is no clean join, so every answer comes back with a match
// confidence and an unmatched count — never a false certainty.
//
// Plain TS, DOM/Three-free, seeded RNG. Deterministic per query id.

import type { Scenario, SimAction } from './engine';
import { spray, ledgerStamp } from './scenarios';
import { basisLabel, type QueryBasis } from './queries';
import {
  SUPPLIERS, ALL_HOLDERS, holderById, DFE_ID, RESOLVER_ID,
  supplierCounts, mulberry32, DEFAULT_SCHOOL_COUNT,
} from './topology';

export type MatchDifficulty = 'clean' | 'fuzzy' | 'hard';
export type PolicyHorizon = 'current' | 'emerging' | 'future';
export type JoinDifficulty = 'easy' | 'medium' | 'hard';

const ALL_SUP = SUPPLIERS.map((s) => s.id);
const MAJORS = SUPPLIERS.filter((s) => s.tier === 'major').map((s) => s.id);

export interface JoinQuery {
  id: string;
  question: string;
  requester: string;
  requesterId: string;
  basis: QueryBasis;
  instrument: string;
  purpose: string;
  /** the school-side context and predicate */
  schoolContext: string;
  schoolFields: string[];
  /** per-1000 of the school population that meets the school-side predicate */
  schoolRate: [number, number];
  /** the second-world holders this joins to (ids into ALL_HOLDERS); empty = single-context baseline */
  counterparts: string[];
  counterpartContext: string;
  /** how cleanly the two sides' identifiers resolve */
  matchDifficulty: MatchDifficulty;
  /** the identifiers on each side of the join */
  joinKey: { school: string; other: string };
  /** per-1000 of the overlap universe that genuinely satisfies BOTH sides */
  cooccurrence: [number, number];
  /** what the headline number counts */
  unit: string;
  queryBody: string;
  /** why this join is hard — the load-bearing narrative */
  hardBecause: string[];
  returnNotes: string[];
  horizon: PolicyHorizon;
  difficulty: JoinDifficulty;
  /** true = a deliberately EASY contrast: both attributes live in one record, no join needed */
  singleContext?: boolean;
}

export interface JoinSidePartial {
  side: 'school' | 'other';
  holderId: string;
  holderLabel: string;
  records: number;
  key: string;
  sector?: 'la' | 'cross';
}

export interface Resolution {
  matchRate: number;
  matchedPct: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  candidatePairs: number;
  matched: number;
  unmatched: number;
}

export interface JoinAssembled {
  answerValue: number;
  schoolRecords: number;
  otherRecords: number;
  coveragePct: number;
  caveats: string[];
}

export interface JoinRun {
  query: JoinQuery;
  schoolPartials: JoinSidePartial[];
  otherPartials: JoinSidePartial[];
  resolution: Resolution;
  assembled: JoinAssembled;
}

function hashId(s: string): number {
  let h = 0x9e3779b9;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 2654435761);
  return h >>> 0;
}

const MATCH_BASE: Record<MatchDifficulty, number> = { clean: 0.95, fuzzy: 0.8, hard: 0.64 };

export function runJoinQuery(query: JoinQuery, schoolCount = DEFAULT_SCHOOL_COUNT): JoinRun {
  const counts = supplierCounts(schoolCount);
  const seed = hashId(query.id);

  // --- school side: per-estate count of pupils meeting the school predicate ---
  const schoolPartials: JoinSidePartial[] = SUPPLIERS.map((spec, si) => {
    const rng = mulberry32(seed ^ hashId(spec.id));
    const schools = counts[si];
    const pupils = Math.round(schools * (235 + rng() * 175));
    const [lo, hi] = query.schoolRate;
    const rate = lo + rng() * (hi - lo);
    return {
      side: 'school', holderId: spec.id, holderLabel: spec.label,
      records: Math.round((pupils * rate) / 1000), key: query.joinKey.school,
    };
  });
  const schoolRecords = schoolPartials.reduce((a, p) => a + p.records, 0);

  // --- second-world side: a relevant slice of each named holder's caseload ---
  const otherPartials: JoinSidePartial[] = query.counterparts.map((hid) => {
    const h = holderById(hid)!;
    const rng = mulberry32(seed ^ hashId(hid));
    const records = Math.round(h.cases * (0.06 + rng() * 0.1));
    return { side: 'other', holderId: hid, holderLabel: h.label, records, key: h.key, sector: h.sector };
  });
  const otherRecords = otherPartials.reduce((a, p) => a + p.records, 0);

  const rng = mulberry32(seed ^ 0x9e37);
  const [clo, chi] = query.cooccurrence;
  const coocc = (clo + rng() * (chi - clo)) / 1000;

  if (query.singleContext) {
    // baseline: both attributes are in one record — no resolver, nothing to match
    const answerValue = Math.round(schoolRecords * coocc);
    return {
      query, schoolPartials, otherPartials: [],
      resolution: { matchRate: 1, matchedPct: 100, confidence: 'HIGH', candidatePairs: answerValue, matched: answerValue, unmatched: 0 },
      assembled: {
        answerValue, schoolRecords, otherRecords: 0, coveragePct: 100,
        caveats: ['Single context: both attributes live in one pupil record, so no identity resolution is needed. This is the easy case — shown for contrast.'],
      },
    };
  }

  // the overlap universe is bounded by the smaller side; the true joined population is
  // a co-occurrence share of it; the resolver can only confidently link some of those
  const overlapUniverse = Math.min(schoolRecords, otherRecords);
  const candidatePairs = Math.round(overlapUniverse * coocc);
  const matchRate = Math.max(0.4, Math.min(0.98, MATCH_BASE[query.matchDifficulty] + (rng() - 0.5) * 0.05));
  const matched = Math.round(candidatePairs * matchRate);
  const unmatched = candidatePairs - matched;
  const confidence: Resolution['confidence'] = matchRate >= 0.9 ? 'HIGH' : matchRate >= 0.74 ? 'MEDIUM' : 'LOW';
  const coveragePct = Math.round(matchRate * 1000) / 10;

  const caveats = [
    `Match confidence ${confidence} (${coveragePct}%) — ${unmatched.toLocaleString('en-GB')} candidate links could not be resolved and are excluded from the count.`,
    query.hardBecause[0],
    'Record-level follow-up (which children) stays with each controller under its own basis — the join returns counts, not a roster.',
  ];

  return {
    query, schoolPartials, otherPartials,
    resolution: { matchRate, matchedPct: coveragePct, confidence, candidatePairs, matched, unmatched },
    assembled: { answerValue: matched, schoolRecords, otherRecords, coveragePct, caveats },
  };
}

export function joinQueryById(id: string): JoinQuery | undefined {
  return JOIN_QUERIES.find((q) => q.id === id);
}

// ---------------------------------------------------------------------------
// Scenario builder — a join run staged for the 3-D network
// ---------------------------------------------------------------------------

export function buildJoinScenario(run: JoinRun): Scenario {
  const { query, otherPartials, resolution, assembled } = run;
  const requester = query.requesterId;
  const counterparts = otherPartials.map((p) => p.holderId);
  const basisChip = basisLabel(query.basis);
  const gb = (n: number) => n.toLocaleString('en-GB');
  const steps: Scenario['steps'] = [];

  // 1 — CONTRACT
  steps.push({
    narration: `The department puts a two-world question to the exchange: "${query.question}" It names both context spaces up front — ${query.schoolContext} and ${query.counterpartContext} — and the basis it claims for each.`,
    phase: `CONTRACT · ${basisChip}`,
    holdMs: 4800,
    actions: [
      { kind: 'highlight', nodes: [requester], on: true },
      { kind: 'log', log: 'contract', text: `DfE → exchange: join ${query.id} · ${query.schoolContext} × ${query.counterpartContext}` },
      { kind: 'counter', key: 'exchanges', delta: 1 },
      ...spray(requester, ALL_SUP, 'query', 300, 70),
      ...(query.singleContext ? [] : spray(requester, counterparts, 'query', 700, 160)),
    ],
  });

  if (query.singleContext) {
    // baseline: one estate, both attributes in the record, no resolver
    steps.push({
      narration: `This one is easy, and that is the point. Free-school-meal eligibility and attainment both live in the SAME pupil record, so every estate answers with a local count — no second world, no matching, no confidence to worry about.`,
      phase: 'LOCAL COMPUTE',
      holdMs: 4600,
      actions: [
        ...MAJORS.map((s, i): SimAction => ({ kind: 'fanout', supplier: s, count: 220, color: 'query', delayMs: i * 240 })),
        { kind: 'log', log: 'compute', text: `Single-context count inside every estate · no identity resolution needed`, delayMs: 1400 },
      ],
    });
    steps.push({
      narration: `The answer comes home clean: ${gb(assembled.answerValue)} ${query.unit}, 100% coverage, no unmatched records. Hold this next to a real cross-context join to feel the difference.`,
      phase: 'RETURN',
      holdMs: 5000,
      actions: [
        ...spray(ALL_SUP, requester, 'ok', 0, 90),
        { kind: 'counter', key: 'aggregatesReturned', delta: 1, delayMs: 1200 },
        { kind: 'log', log: 'return', text: `${gb(assembled.answerValue)} ${query.unit} · coverage 100% · single context`, delayMs: 1400 },
        ...ledgerStamp(`${query.id} complete — single-context baseline`, 2000),
        { kind: 'highlight', nodes: [requester], on: false, delayMs: 2400 },
      ],
    });
    return finishScenario(query, steps, assembled, resolution);
  }

  // 2 — TWO ESTATES COMPUTE
  steps.push({
    narration: `Two estates compute in parallel, each behind its own gateway. The school MIS estates count ${gb(assembled.schoolRecords)} pupils meeting the school-side test; the ${query.counterpartContext} holders return ${gb(assembled.otherRecords)} on theirs. Neither has moved a record.`,
    phase: 'TWO WORLDS COMPUTE',
    holdMs: 5000,
    actions: [
      ...MAJORS.map((s, i): SimAction => ({ kind: 'fanout', supplier: s, count: 200, color: 'query', delayMs: i * 220 })),
      ...counterparts.map((c, i): SimAction => ({ kind: 'flash', node: c, color: 'query', delayMs: 400 + i * 220 })),
      { kind: 'log', log: 'compute', text: `School side: ${gb(assembled.schoolRecords)} candidate records · ${query.counterpartContext} side: ${gb(assembled.otherRecords)}`, delayMs: 1600 },
    ],
  });

  // 3 — IDENTITY RESOLUTION (the honest, hard step)
  const resolved = resolution.confidence !== 'LOW';
  steps.push({
    narration: `Now the hard part, made visible. Both sides send candidate keys to the resolver — ${query.joinKey.school} from the schools, ${query.joinKey.other} from the other world. There is no shared analytic key, so the resolver matches probabilistically: ${gb(resolution.matched)} of ${gb(resolution.candidatePairs)} links land at ${resolution.confidence} confidence, and ${gb(resolution.unmatched)} are dropped rather than guessed.`,
    phase: `RESOLVE · ${resolution.confidence}`,
    holdMs: 5600,
    actions: [
      ...spray(MAJORS, RESOLVER_ID, 'data', 200, 120),
      ...spray(counterparts, RESOLVER_ID, 'data', 700, 160),
      { kind: 'flash', node: RESOLVER_ID, color: resolved ? 'ok' : 'refuse', delayMs: 1600 },
      { kind: 'log', log: 'verify', text: `Identity resolution: ${gb(resolution.matched)}/${gb(resolution.candidatePairs)} matched · confidence ${resolution.confidence} (${resolution.matchedPct}%) · ${gb(resolution.unmatched)} unmatched dropped`, delayMs: 1800 },
      ...ledgerStamp(`Join ${query.id}: cross-context match logged — ${resolution.matchedPct}% confidence, unmatched excluded`, 2400),
    ],
  });

  // 4 — RETURN
  steps.push({
    narration: `The joined answer comes home — and wears its uncertainty on its face: ${gb(assembled.answerValue)} ${query.unit}, at ${assembled.coveragePct}% match confidence. The record-level follow-up stays with whichever service owns the duty; the exchange returned a count, not a list of children.`,
    phase: 'RETURN',
    holdMs: 5400,
    actions: [
      { kind: 'pulse', from: RESOLVER_ID, to: requester, color: 'ok', durMs: 1800 },
      { kind: 'counter', key: 'aggregatesReturned', delta: 1, delayMs: 1200 },
      { kind: 'log', log: 'return', text: `Joined answer → DfE · ${gb(assembled.answerValue)} ${query.unit} · confidence ${assembled.coveragePct}%`, delayMs: 1400 },
      { kind: 'highlight', nodes: [requester], on: false, delayMs: 2200 },
    ],
  });

  // 5 — WHY IT'S HARD
  steps.push({
    narration: `Why this is not a database query: ${query.hardBecause.join(' ')} A federation does not make the join easy — it makes the join honest, logged, and free of a standing pool of everyone's everything.`,
    phase: 'WHY IT’S HARD',
    holdMs: 5200,
    actions: [
      { kind: 'flash', node: RESOLVER_ID, color: 'query', delayMs: 200 },
      { kind: 'log', log: 'info', text: `Frontier: ${query.horizon === 'future' ? 'a question DfE cannot answer at all today' : query.horizon === 'emerging' ? 'a question arriving with new law' : 'a question answered today only by hand, slowly'}` },
    ],
  });

  return finishScenario(query, steps, assembled, resolution);
}

function finishScenario(query: JoinQuery, steps: Scenario['steps'], assembled: JoinAssembled, resolution: Resolution): Scenario {
  return {
    id: `join-${query.id}`,
    group: 'Joining two worlds',
    title: query.question,
    tagline: query.singleContext
      ? 'The easy case: one record, no join, 100% certainty.'
      : `${query.matchDifficulty === 'hard' ? 'A hard join' : 'A fuzzy join'} across two context spaces — answered with a confidence, not a certainty.`,
    description: query.purpose,
    lesson: query.singleContext
      ? 'Attributes inside one record are trivial. The moment a question spans two data worlds with no shared key, the honest answer carries a match confidence — and that is what separates a real cross-context join from a database query.'
      : `${query.hardBecause[0]} The federated answer is a logged, confidence-scored count — never a standing pool linking every child across services just in case.`,
    contract: {
      requester: query.requester,
      purpose: query.purpose,
      legalBasis: query.instrument,
      fields: query.schoolFields,
      population: `${query.schoolContext} × ${query.counterpartContext}`,
      aggregation: query.singleContext ? 'Single-context count' : `Joined count at ${resolution.matchedPct}% match confidence; ${assembled.caveats.length} caveats attached`,
      retention: 'Counts kept with their confidence; the underlying records never move',
    },
    queryId: undefined,
    central: {
      records: query.singleContext
        ? 'A central store answers this from its copy — the same answer, at the cost of holding everything'
        : 'A central store answers this by pre-linking every child across every service, permanently — the ContactPoint bargain',
      exposure: query.singleContext
        ? '—'
        : 'One standing linkage table across schools, social care, SEND and health: the honeypot the join argument exists to avoid',
      note: query.singleContext
        ? 'The easy questions never needed a central store either.'
        : 'A federation links at query time, under a basis, with the match confidence on the record — and dismantles the link afterwards.',
    },
    steps,
  };
}

// ---------------------------------------------------------------------------
// The join catalogue — the cross-context research questions DfE actually needs,
// current and future. Every figure is illustrative; the difficulty is real.
// ---------------------------------------------------------------------------

export const JOIN_GROUPS = [
  { key: 'current', label: 'Answerable today — but only by hand' },
  { key: 'emerging', label: 'Arriving with new law' },
  { key: 'future', label: 'The frontier — no shared key at all' },
] as const;

export const JOIN_QUERIES: JoinQuery[] = [
  {
    id: 'absence-cin',
    question: 'Do children with an open social-care plan have materially worse persistent absence, by local authority?',
    requester: 'Department for Education · attendance & safeguarding analysis',
    requesterId: DFE_ID,
    basis: 'statutory',
    instrument: 'Education Act 1996 (attendance) × Children Act 1989 (social care) — dual basis',
    purpose: 'Quantify the attendance penalty for children known to social care, to target attendance support',
    schoolContext: 'Attendance (school MIS)',
    schoolFields: ['Persistent-absence flag (pupil-level)', 'Sessions missed (banded)'],
    schoolRate: [90, 150],
    counterparts: ['la-csc'],
    counterpartContext: 'Children’s social care',
    matchDifficulty: 'hard',
    joinKey: { school: 'UPN', other: 'LA social-care person ID' },
    cooccurrence: [180, 320],
    unit: 'children with an open CIN/CP plan who are persistently absent',
    hardBecause: [
      'The school MIS keys on UPN; the LA social-care case system keys on its own person ID, and the two were never designed to reconcile.',
      'Social-care data is special-category, held under a safeguarding basis distinct from the attendance duty — the join needs both to hold at once.',
    ],
    queryBody: `-- join/absence×cin/2026-Q3 · dual basis, aggregate-only
WITH school AS (
  SELECT upn, la_code, persistent_absent
  FROM   mis.attendance WHERE term = '2026-autumn'),
la AS (
  SELECT person_id, la_code, plan_type          -- CIN | CP | CLA
  FROM   csc.casework WHERE plan_open)
SELECT la_code,
       COUNT(*) FILTER (WHERE persistent_absent) AS pa_in_social_care
FROM   resolve(school.upn, la.person_id, confidence => 0.8)  -- <-- no shared key
GROUP  BY la_code`,
    returnNotes: [
      'LA-level counts of children who are BOTH known to social care AND persistently absent',
      'A match-confidence figure travels with every count — unmatched children are excluded, not guessed',
      'No case content, no child named: the record-level work stays with each LA under its own basis',
    ],
    horizon: 'current',
    difficulty: 'hard',
  },
  {
    id: 'admissions-ehcp',
    question: 'Are children with an EHC plan over-represented in in-year admissions and fair-access referrals?',
    requester: 'Department for Education · SEND & admissions policy',
    requesterId: DFE_ID,
    basis: 'statutory',
    instrument: 'Children and Families Act 2014 (SEND) × School Admissions Code',
    purpose: 'Test whether the admissions system disadvantages children with SEND',
    schoolContext: 'Enrolment (school MIS)',
    schoolFields: ['In-year admission flag', 'Fair-access-panel referral flag'],
    schoolRate: [40, 90],
    counterparts: ['la-admissions', 'la-send'],
    counterpartContext: 'LA admissions & SEND casework',
    matchDifficulty: 'fuzzy',
    joinKey: { school: 'UPN', other: 'LA admissions & SEND case IDs' },
    cooccurrence: [120, 240],
    unit: 'EHCP children in in-year admissions / fair-access referrals',
    hardBecause: [
      'Admissions and SEND are two SEPARATE LA line-of-business systems that rarely share a key with each other, let alone with the school MIS.',
      'EHCP status is special-category and fair-access governance is contested — three-way matching under two bases.',
    ],
    queryBody: `-- join/admissions×ehcp/2026 · three-way, aggregate-only
SELECT region,
       COUNT(*) FILTER (WHERE fap_referral) AS ehcp_fap_referrals
FROM   resolve(mis.enrolment.upn,
               la_admissions.applicant_id,
               la_send.case_id, confidence => 0.8)
WHERE  send_status = 'EHCP'
GROUP  BY region`,
    returnNotes: [
      'Regional counts of EHCP children appearing in in-year admissions and fair-access panels',
      'A three-way match: school enrolment × LA admissions × LA SEND — each match scored',
      'Contested governance is surfaced, not hidden: the fair-access basis is stated on the contract',
    ],
    horizon: 'current',
    difficulty: 'hard',
  },
  {
    id: 'exclusions-ap',
    question: 'What share of permanently-excluded pupils enter LA-commissioned alternative provision within six weeks — and how long do placements last?',
    requester: 'Department for Education · exclusions & AP strategy',
    requesterId: DFE_ID,
    basis: 'statutory',
    instrument: 'Education Act 2002 (exclusions) × LA AP commissioning duties',
    purpose: 'Follow the child from exclusion into alternative provision to test the six-week duty',
    schoolContext: 'Exclusions (school MIS)',
    schoolFields: ['Permanent-exclusion event + date', 'Prior reduced-timetable flag'],
    schoolRate: [8, 20],
    counterparts: ['la-ap'],
    counterpartContext: 'LA alternative provision',
    matchDifficulty: 'hard',
    joinKey: { school: 'UPN', other: 'LA AP placement ID' },
    cooccurrence: [400, 620],
    unit: 'excluded pupils placed in AP within six weeks',
    hardBecause: [
      'The child changes controller mid-journey — from a mainstream MIS to an AP setting often on a different system entirely — with no follow-the-child key.',
      'Off-rolling is politically sensitive, and AP rolls are among the least standardised data the sector holds.',
    ],
    queryBody: `-- join/exclusions×ap/2026 · follow-the-child, aggregate-only
SELECT la_code,
       COUNT(*) FILTER (WHERE days_to_ap <= 42) AS placed_within_6wk,
       WIDTH_BUCKET(placement_length_days, 0, 365, 6) AS length_band
FROM   resolve(mis.exclusions.upn, la_ap.placement_id, confidence => 0.64)
GROUP  BY la_code, length_band`,
    returnNotes: [
      'LA-level counts of excluded children reaching AP within the statutory window, with placement-length bands',
      'The follow-the-child match is the hard part — and its confidence is reported, not assumed',
      'Where a child cannot be matched into AP, that gap is itself the finding: possible off-rolling',
    ],
    horizon: 'current',
    difficulty: 'hard',
  },
  {
    id: 'cme-enrol',
    question: 'How many children on an LA’s children-missing-education register are actually enrolled elsewhere under a different UPN?',
    requester: 'Department for Education · attendance strategy',
    requesterId: DFE_ID,
    basis: 'statutory',
    instrument: 'Education Act 1996 s.436A · CME statutory guidance',
    purpose: 'Distinguish genuinely missing children from UPN-duplication artefacts',
    schoolContext: 'Enrolment (all-provider MIS)',
    schoolFields: ['On-roll status', 'UPN issued this enrolment'],
    schoolRate: [900, 990],
    counterparts: ['la-cme'],
    counterpartContext: 'LA CME register',
    matchDifficulty: 'hard',
    joinKey: { school: 'UPN', other: 'LA CME register ID' },
    cooccurrence: [150, 300],
    unit: 'CME-register children found enrolled under another UPN',
    hardBecause: [
      'UPNs are duplicated and re-issued when children move, so the join has to match on more than the identifier — exactly where matching goes wrong.',
      'Children cross LA boundaries, so the enrolment could sit in any of 22,573 estates under any authority.',
    ],
    queryBody: `-- join/cme×enrol/2026-Q3 · de-duplication, aggregate-only
SELECT la_code,
       COUNT(*) FILTER (WHERE enrolled_elsewhere) AS false_cme,
       COUNT(*) FILTER (WHERE NOT enrolled_elsewhere) AS genuine_cme
FROM   resolve(la_cme.register_id, mis.enrolment.upn, confidence => 0.64)
GROUP  BY la_code`,
    returnNotes: [
      'Splits each LA’s CME register into genuinely-missing vs enrolled-under-another-UPN',
      'Turns a data-quality artefact into a measurable number — and shows the matching confidence behind it',
      'This is the child-who-moves scenario, run in reverse and at national scale',
    ],
    horizon: 'current',
    difficulty: 'medium',
  },
  {
    id: 'mobility-attainment',
    question: 'Do children who cross a local-authority boundary mid-key-stage lose attainment compared with stable peers?',
    requester: 'Department for Education · disadvantage & mobility research',
    requesterId: DFE_ID,
    basis: 'voluntary',
    instrument: 'DEA 2017 research accreditation · school-level opt-in',
    purpose: 'Isolate the attainment cost of mid-phase mobility across LA boundaries',
    schoolContext: 'Enrolment + attainment (school MIS, two estates)',
    schoolFields: ['Mid-key-stage move flag', 'Attainment band', 'Prior-attainment band'],
    schoolRate: [60, 120],
    counterparts: ['la-admissions'],
    counterpartContext: 'LA admissions (both authorities)',
    matchDifficulty: 'fuzzy',
    joinKey: { school: 'UPN (across two MIS)', other: 'LA admissions applicant IDs' },
    cooccurrence: [200, 360],
    unit: 'boundary-crossing movers with a measurable attainment change',
    hardBecause: [
      'This is a join across THREE keys: the UPN in the leaving school’s MIS, the UPN in the arriving school’s MIS, and the admissions IDs in two different LAs.',
      'A voluntary research basis means estates can decline, so coverage and match confidence compound.',
    ],
    queryBody: `-- join/mobility×attainment/R-3120 · voluntary · noise-added
SELECT prior_attainment_band,
       AVG(attainment_delta) AS mean_delta          -- movers vs stable
FROM   resolve(mis_from.upn, mis_to.upn, la_admissions.applicant_id, confidence => 0.8)
WHERE  crossed_la_boundary AND opted_in
GROUP  BY prior_attainment_band
-- calibrated noise applied before return (ε-DP v2)`,
    returnNotes: [
      'Attainment change for boundary-crossing movers, banded by prior attainment, movers vs stable peers',
      'Three-key resolution with a stated confidence — the hardest matching problem in the catalogue',
      'Voluntary basis: opted-out estates shrink coverage and the answer says so',
    ],
    horizon: 'emerging',
    difficulty: 'hard',
  },
  {
    id: 'cnis-offrolling',
    question: 'Of children newly on the Children-Not-in-School register, how many were excluded or on a reduced timetable in the prior twelve months?',
    requester: 'Department for Education · school-attendance & CNIS policy',
    requesterId: DFE_ID,
    basis: 'statutory',
    instrument: 'Children’s Wellbeing and Schools Act 2026 — CNIS register duty',
    purpose: 'Test whether the new CNIS population is fed by exclusion and off-rolling upstream',
    schoolContext: 'Exclusions + timetable history (school MIS)',
    schoolFields: ['Prior permanent/fixed exclusion', 'Reduced-timetable history'],
    schoolRate: [15, 35],
    counterparts: ['la-cme'],
    counterpartContext: 'LA Children-Not-in-School register',
    matchDifficulty: 'hard',
    joinKey: { school: 'UPN', other: 'LA CNIS register ID' },
    cooccurrence: [220, 380],
    unit: 'CNIS children with prior exclusion or reduced timetable',
    hardBecause: [
      'The CNIS register is brand new (2026 Act) with no established identifiers or matching history to lean on.',
      'Detecting off-rolling is adversarial: the signal is a child leaving a roll shortly before appearing on the register, which schools have reason not to make legible.',
    ],
    queryBody: `-- join/cnis×offrolling/2026-Q4 · new register, aggregate-only
SELECT la_code,
       COUNT(*) FILTER (WHERE prior_exclusion OR prior_reduced_timetable) AS upstream_signal
FROM   resolve(la_cnis.register_id, mis.history.upn, confidence => 0.64)
WHERE  register_entry_date >= '2026-09-01'
GROUP  BY la_code`,
    returnNotes: [
      'For each LA, how much of the new CNIS population carries an upstream exclusion or reduced-timetable signal',
      'A brand-new question the 2026 Act makes askable — and a stress test of matching onto a register with no history',
      'The unmatched tail is meaningful: children the register and the MIS estates cannot yet reconcile',
    ],
    horizon: 'emerging',
    difficulty: 'hard',
  },
  {
    id: 'absence-camhs',
    question: 'Is a spike in unexplained school absence associated with a CAMHS or A&E mental-health contact, by area?',
    requester: 'Department for Education × Department of Health & Social Care',
    requesterId: DFE_ID,
    basis: 'voluntary',
    instrument: 'Cross-government MoU · UK GDPR Art. 9 conditions · FHIR bridge (hypothetical)',
    purpose: 'Test attendance as an early signal of mental-health need',
    schoolContext: 'Attendance (school MIS)',
    schoolFields: ['Unexplained-absence spike flag', 'Sessions missed (banded)'],
    schoolRate: [70, 140],
    counterparts: ['xh-health'],
    counterpartContext: 'Health (CAMHS / A&E)',
    matchDifficulty: 'hard',
    joinKey: { school: 'UPN', other: 'NHS number (SUI — purpose-limited)' },
    cooccurrence: [90, 190],
    unit: 'children with an absence spike near a CAMHS/A&E contact',
    hardBecause: [
      'There is no lawful shared analytic key: the NHS number can appear in schools only as a safeguarding identifier, purpose-limited, so it CANNOT be used to join for analysis.',
      'Health data is special-category in another sector entirely, under its own law and its own regulator — the join crosses a departmental as well as a technical boundary.',
    ],
    queryBody: `-- join/absence×camhs/frontier · area-level only, heavy suppression
SELECT area_code,
       COUNT(*) AS absence_spike_near_mh_contact
FROM   resolve(mis.attendance.upn,
               health.nhs_number,        -- NOT lawful as an analytic key today
               confidence => 0.64, basis => 'MoU + Art.9')
WHERE  absence_spike AND mh_contact_within_28d
GROUP  BY area_code
HAVING COUNT(*) >= 10   -- area-level, never individual`,
    returnNotes: [
      'Area-level counts only — the most heavily suppressed answer in the catalogue',
      'The honest output is mostly a statement of what CANNOT be joined: the frontier, not a finished result',
      'Included to show where a federation runs out of lawful road — not to imply this join is available today',
    ],
    horizon: 'future',
    difficulty: 'hard',
  },
  {
    id: 'post16-destinations',
    question: 'Do free-school-meal KS4 leavers reach sustained employment, by prior attendance band?',
    requester: 'Department for Education · post-16 outcomes (LEO)',
    requesterId: DFE_ID,
    basis: 'voluntary',
    instrument: 'DEA 2017 · cross-government LEO linkage (HMRC / DWP) under MoU',
    purpose: 'Link school attendance to long-run employment outcomes through the earnings data',
    schoolContext: 'KS4 attendance + FSM (school MIS / NPD)',
    schoolFields: ['FSM-eligible flag', 'KS4 attendance band'],
    schoolRate: [200, 260],
    counterparts: ['xh-earnings'],
    counterpartContext: 'Destinations & earnings (ILR / LEO)',
    matchDifficulty: 'fuzzy',
    joinKey: { school: 'UPN', other: 'ULN → NINO link' },
    cooccurrence: [300, 460],
    unit: 'FSM leavers in sustained employment, by attendance band',
    hardBecause: [
      'The identifier cliff is at sixteen: the school UPN gives way to the learner ULN, and the link into earnings is a cross-government matching exercise, not a shared key.',
      'The join reaches into HMRC and DWP earnings data under memoranda of understanding — the crown-jewel LEO linkage, and the most governed.',
    ],
    queryBody: `-- join/post16×leo/R-2891 · cross-gov, noise-added
SELECT ks4_attendance_band,
       AVG(sustained_employment_rate) AS empl_rate  -- FSM leavers only
FROM   resolve(npd.upn, lrs.uln, leo.nino_link, confidence => 0.8, basis => 'DEA + MoU')
WHERE  fsm_eligible
GROUP  BY ks4_attendance_band`,
    returnNotes: [
      'Sustained-employment rates for FSM leavers, banded by their KS4 attendance',
      'A four-stage identity chain (UPN → ULN → NINO) — each hop loses some children, and the loss is reported',
      'The longitudinal crown jewels, done as a query-time join rather than a permanent linked warehouse',
    ],
    horizon: 'current',
    difficulty: 'hard',
  },
  {
    id: 'fsm-attainment',
    question: 'How large is the disadvantage gap — FSM-eligible pupils below the expected standard?',
    requester: 'Department for Education · disadvantage monitoring',
    requesterId: DFE_ID,
    basis: 'statutory',
    instrument: 'Education Act 1996 s.537A — prescribed information',
    purpose: 'The classic disadvantage gap — shown as the EASY, single-context contrast',
    schoolContext: 'Attainment + FSM (school MIS)',
    schoolFields: ['FSM-eligible flag', 'Below-expected-standard flag'],
    schoolRate: [228, 262],
    counterparts: [],
    counterpartContext: 'none — single context',
    matchDifficulty: 'clean',
    joinKey: { school: 'UPN', other: 'same record' },
    cooccurrence: [520, 640],
    unit: 'FSM-eligible pupils below the expected standard',
    hardBecause: [
      'This is the easy case: FSM eligibility and attainment are two columns of the SAME pupil record, so no cross-context matching is needed at all.',
    ],
    queryBody: `-- baseline/fsm×attainment · single context, no join
SELECT school_urn,
       COUNT(*) FILTER (WHERE fsm_eligible AND below_expected) AS disadvantage_gap
FROM   pupil_register
GROUP  BY school_urn`,
    returnNotes: [
      'A clean, 100%-coverage count — because both attributes live in one record',
      'Shown deliberately to contrast with the genuine two-world joins above',
      'No resolver, no match confidence, no unmatched tail: this is what "easy" looks like',
    ],
    horizon: 'current',
    difficulty: 'easy',
    singleContext: true,
  },
];
