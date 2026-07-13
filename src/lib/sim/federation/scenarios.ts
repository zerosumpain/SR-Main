// scenarios.ts — the scenario catalogue: fourteen scripted simulations of what a
// federated education data exchange would actually do, grouped into collections,
// frontline operations, the vendor economy, and trust & failure modes. Supplier
// names are real; every scenario is synthetic and every behaviour illustrative —
// the numbers are market-shaped, not measured, and no incident depicted here
// (outage, breach, queue) describes a real event. Colour language (shared with
// the scene): petrol = query/contract, orange = record content moving, green =
// verified/aggregate answer, red = refusal or breach.

import type { PulseColor, Scenario, SimAction } from './engine';
import { SUPPLIERS, supplierCounts, DEFAULT_SCHOOL_COUNT } from './topology';

// Derived from the topology's single source of truth so a new/renamed supplier
// can never be silently skipped by the scenario fan-outs.
const MAJORS = SUPPLIERS.filter((s) => s.tier === 'major').map((s) => s.id);
const SMALLS = SUPPLIERS.filter((s) => s.tier !== 'major').map((s) => s.id);
const ALL_SUPPLIERS = [...MAJORS, ...SMALLS];

// Narration numbers are TEMPLATED from the topology so the accurate per-MIS dots and
// the scenario prose can never drift apart (they did once: "15 gateways", "10,560
// schools" survived the switch to real WhichMIS counts). Never hardcode an estate
// count or a per-vendor school figure in a string below — derive it here.
const N_SUP = SUPPLIERS.length;
const SCH = supplierCounts(DEFAULT_SCHOOL_COUNT);
const gb = (n: number) => n.toLocaleString('en-GB');
const schoolsOf = (id: string) => SCH[SUPPLIERS.findIndex((s) => s.id === id)] ?? 0;
const shareOf = (id: string) => {
  const s = SUPPLIERS.find((x) => x.id === id);
  return s ? Math.round((s.schools / DEFAULT_SCHOOL_COUNT) * 1000) / 10 : 0;
};
/** the total modelled estate, e.g. "22,573" */
const TOTAL_SCHOOLS = gb(DEFAULT_SCHOOL_COUNT);
const sArbor = gb(schoolsOf('sup-arbor'));
const sSims = gb(schoolsOf('sup-sims'));
const sScholar = gb(schoolsOf('sup-scholarpack'));
const sIntegris = gb(schoolsOf('sup-integris'));
const sHub = gb(schoolsOf('sup-hubmis'));

/** Every completed exchange stamps the citizen-readable ledger. (Shared with queries.ts.) */
export function ledgerStamp(text: string, delayMs = 0): SimAction[] {
  return [
    { kind: 'flash', node: 'ledger', color: 'ok', delayMs },
    { kind: 'log', log: 'audit', text, delayMs },
    { kind: 'counter', key: 'auditEntries', delta: 1, delayMs },
  ];
}

/** Staggered pulses from one node to many (or many to one). (Shared with queries.ts.) */
export function spray(from: string | string[], to: string | string[], color: PulseColor, baseDelay = 0, stepMs = 110): SimAction[] {
  const froms = Array.isArray(from) ? from : [from];
  const tos = Array.isArray(to) ? to : [to];
  const out: SimAction[] = [];
  let i = 0;
  for (const f of froms) for (const t of tos) {
    if (f === t) continue; // a supplier never "transfers a record to itself via the ring"
    out.push({ kind: 'pulse', from: f, to: t, color, delayMs: baseDelay + i * stepMs });
    i++;
  }
  return out;
}

export const SCENARIO_GROUPS = [
  'Collections & statistics',
  'Frontline operations',
  'The vendor economy',
  'Trust & failure modes',
] as const;

export const SCENARIOS: Scenario[] = [
  // =========================================================================
  // COLLECTIONS & STATISTICS
  // =========================================================================
  {
    id: 'census',
    group: 'Collections & statistics',
    title: 'Retire the census',
    tagline: 'A statutory collection becomes a question, not a form.',
    description: `The termly school census — ~400 items per child, three times a year — replayed as one signed query contract answered by ${N_SUP} suppliers computing locally.`,
    lesson: 'Today the DfE moves whole-child records to the centre to answer questions about totals. A federated collection moves the question instead — and the pupil-level records counter stays at zero.',
    contract: {
      requester: 'Department for Education',
      purpose: 'Termly pupil counts, FSM eligibility and SEN provision for funding allocation',
      legalBasis: 'Education Act 1996 s.537A — prescribed information regulations',
      fields: ['Pupil counts by year group', 'FSM-eligible totals', 'SEN support / EHCP totals'],
      population: `All ${TOTAL_SCHOOLS} state-funded providers`,
      aggregation: 'School-level totals — no pupil-level rows leave any MIS',
      retention: 'Aggregates kept; the query itself logged permanently',
    },
    queryId: 'fsm-eligibility',
    central: {
      records: '~8m pupil-level records copied to the centre, three times a year',
      exposure: 'The National Pupil Database grows by another term, forever',
      note: 'The census exists because moving the data was once the only way to ask the question. It no longer is.',
    },
    steps: [
      {
        narration: 'Census day, reimagined. The DfE publishes one signed query contract to the exchange: what it needs, under which statutory power, at what level of aggregation. Nobody emails a spreadsheet.',
        phase: 'CONTRACT', holdMs: 4600,
        actions: [
          { kind: 'highlight', nodes: ['con-dfe'], on: true },
          { kind: 'log', log: 'contract', text: 'DfE → exchange: census/2026-autumn · s.537A · school-level aggregates only' },
          { kind: 'counter', key: 'exchanges', delta: 1 },
          ...spray('con-dfe', ALL_SUPPLIERS, 'query', 300, 120),
        ],
      },
      {
        narration: `All ${N_SUP} gateways independently verify the signature and the statutory basis. Any of them can refuse. None does — this ask is lawful, minimal, and aggregate-only.`,
        phase: 'VERIFY', holdMs: 4200,
        actions: [
          ...ALL_SUPPLIERS.map((s, i): SimAction => ({ kind: 'flash', node: s, color: 'ok', delayMs: i * 90 })),
          { kind: 'log', log: 'verify', text: `${N_SUP}/${N_SUP} gateways: signature valid · basis s.537A confirmed · aggregation level accepted`, delayMs: 700 },
          ...ledgerStamp('Contract census/2026-autumn accepted by all members', 1400),
        ],
      },
      {
        narration: `Local compute. Each supplier runs the count inside its own estate — Arbor across ${sArbor} schools, WCBS HUBmis across ${sHub}. The records do the thing records almost never get to do: they stay put.`,
        phase: 'LOCAL COMPUTE', holdMs: 5200,
        actions: [
          ...MAJORS.map((s, i): SimAction => ({ kind: 'fanout', supplier: s, count: 260, color: 'query', delayMs: i * 500 })),
          ...SMALLS.map((s, i): SimAction => ({ kind: 'fanout', supplier: s, count: 60, color: 'query', delayMs: 1300 + i * 220 })),
          { kind: 'log', log: 'compute', text: `Counts computed inside all ${N_SUP} estates — 0 pupil-level rows extracted`, delayMs: 1800 },
        ],
      },
      {
        narration: `The answers come home: ${N_SUP} small parcels of school-level totals. The entire national census, and the pupil-records-moved counter still reads zero.`,
        phase: 'RETURN', holdMs: 4800,
        actions: [
          ...spray(ALL_SUPPLIERS, 'con-dfe', 'ok', 0, 140),
          { kind: 'counter', key: 'aggregatesReturned', delta: N_SUP, delayMs: 1200 },
          { kind: 'log', log: 'return', text: `${N_SUP} aggregate returns · largest payload ~40KB · pupil rows moved: 0`, delayMs: 1400 },
          ...ledgerStamp('census/2026-autumn complete — results and query text publicly inspectable', 2200),
          { kind: 'highlight', nodes: ['con-dfe'], on: false, delayMs: 2600 },
        ],
      },
    ],
  },
  {
    id: 'new-collection',
    group: 'Collections & statistics',
    title: 'A new question, without a new form',
    tagline: `Once-only: publish a schema, not ${TOTAL_SCHOOLS} admin tasks.`,
    description: `The DfE needs a new data collection — a wellbeing indicator. In the old world that is a new form for every school office. Here it is a schema published once and implemented ${N_SUP} times.`,
    lesson: `The burden of a new collection lands on whoever must implement it. A federation moves that burden from ${TOTAL_SCHOOLS} school offices to ${N_SUP} supplier dev teams — which is also where the CMA says the market power sits.`,
    contract: {
      requester: 'Department for Education',
      purpose: 'Pilot collection: school-level wellbeing indicator',
      legalBasis: 'New regulations following the summer 2026 consultation (hypothetical)',
      fields: ['Wellbeing index (school aggregate)', 'Participation rate'],
      population: 'Volunteer pilot: ~2,000 schools',
      aggregation: 'School-level; suppressed under 10 respondents',
      retention: 'Pilot aggregates for 24 months',
    },
    queryId: 'wellbeing-pilot',
    central: {
      records: 'A new column in the central store — collected from every school by hand',
      exposure: 'Another permanent field in the honeypot',
      note: 'Every new question historically became a new burden: a form, a portal, a deadline, a chase-up email.',
    },
    steps: [
      {
        narration: 'The DfE publishes wellbeing/1.0 to the exchange’s schema registry: field definitions, aggregation rules, suppression thresholds. This is the whole "collection instrument".',
        phase: 'SCHEMA', holdMs: 4200,
        actions: [
          { kind: 'pulse', from: 'con-dfe', to: 'ledger', color: 'query' },
          { kind: 'log', log: 'contract', text: 'Schema wellbeing/1.0 published to registry — open spec, versioned, consultable' },
          { kind: 'counter', key: 'exchanges', delta: 1 },
          ...ledgerStamp('New schema registered: wellbeing/1.0 (pilot)', 1200),
        ],
      },
      {
        narration: `${N_SUP} implementations, not ${TOTAL_SCHOOLS}. Each supplier maps the schema onto its own data model once, ships it in a release, and every school on that MIS is ready.`,
        phase: 'IMPLEMENT', holdMs: 4600,
        actions: [
          ...ALL_SUPPLIERS.map((s, i): SimAction => ({ kind: 'flash', node: s, color: 'query', delayMs: i * 180 })),
          { kind: 'log', log: 'compute', text: `${N_SUP} supplier implementations of wellbeing/1.0 · school effort required: 0 forms`, delayMs: 1500 },
        ],
      },
      {
        narration: 'First collection run, pilot cohort only. Two thousand volunteer schools answer through their MIS; the aggregates flow back under the same contract discipline as the census.',
        phase: 'FIRST RUN', holdMs: 5000,
        actions: [
          ...spray('con-dfe', MAJORS, 'query', 0, 150),
          ...MAJORS.map((s, i): SimAction => ({ kind: 'fanout', supplier: s, count: 90, color: 'query', delayMs: 700 + i * 400 })),
          ...spray(MAJORS, 'con-dfe', 'ok', 2400, 200),
          { kind: 'counter', key: 'aggregatesReturned', delta: 3, delayMs: 3000 },
          ...ledgerStamp('wellbeing/1.0 pilot run complete — 2,000 schools, aggregate-only', 3400),
        ],
      },
    ],
  },
  {
    id: 'research',
    group: 'Collections & statistics',
    title: 'The researcher and the disclosure control',
    tagline: 'Query-not-copy research, with the noise built in.',
    description: 'An accredited researcher asks whether Year 7 attendance predicts GCSE outcomes for FSM-eligible pupils — and gets an answer without any pupil-level extract existing.',
    lesson: 'The precedents’ research gold standard (Nordic registers) runs on copies. A federated TRE pattern gets most of the value with none of the extract: the question travels, small cells are suppressed at source, and the answer arrives pre-noised.',
    contract: {
      requester: 'Accredited researcher · Trusted Research Environment',
      purpose: 'Does Y7 attendance predict KS4 outcomes for FSM-eligible pupils?',
      legalBasis: 'DEA 2017 research provisions · accreditation #R-2417 · ethics approval attached',
      fields: ['Attendance band × attainment band × FSM flag', 'cohort counts only'],
      population: 'KS4 cohort 2025-26 (n ≈ 600,000)',
      aggregation: 'Cells under 10 suppressed at source; calibrated noise added before return',
      retention: 'Results only; underlying query auto-expires in 90 days',
    },
    queryId: 'tutoring-uplift',
    central: {
      records: 'A bespoke NPD extract, months of approvals, a copy on a TRE disk',
      exposure: 'Every extract is one more place the data lives',
      note: 'The current route works — slowly. The question here is not whether research happens, but whether it needs copies.',
    },
    steps: [
      {
        narration: 'A researcher in a trusted research environment writes a statistical query. Accreditation, ethics approval and the aggregation plan travel with it — the contract is the paperwork.',
        phase: 'CONTRACT', holdMs: 4400,
        actions: [
          { kind: 'highlight', nodes: ['con-tre'], on: true },
          { kind: 'log', log: 'contract', text: 'TRE → exchange: attendance×attainment×FSM, cohort counts · accreditation #R-2417' },
          { kind: 'counter', key: 'exchanges', delta: 1 },
          ...spray('con-tre', ALL_SUPPLIERS, 'query', 300, 110),
        ],
      },
      {
        narration: 'Gateways verify more than a signature here: the accreditation register, the ethics attachment, and that the query’s aggregation plan matches its stated purpose.',
        phase: 'VERIFY', holdMs: 4000,
        actions: [
          { kind: 'log', log: 'verify', text: 'Accreditation valid to 2027-03 · aggregation plan conforms to disclosure-control policy' },
          ...ALL_SUPPLIERS.map((s, i): SimAction => ({ kind: 'flash', node: s, color: 'ok', delayMs: 400 + i * 80 })),
          ...ledgerStamp('Research query R-2417/14 admitted', 1600),
        ],
      },
      {
        narration: 'Local compute with local discipline: each estate builds its cells, suppresses anything under ten pupils, and adds calibrated noise before anything leaves. Famly’s early-years estate returns mostly suppressed cells — correctly.',
        phase: 'DISCLOSURE CONTROL', holdMs: 5200,
        actions: [
          ...ALL_SUPPLIERS.map((s, i): SimAction => ({ kind: 'fanout', supplier: s, count: 90, color: 'query', delayMs: i * 160 })),
          { kind: 'log', log: 'compute', text: `${N_SUP} estates: cells built · 1,904 small cells suppressed at source · noise ε applied`, delayMs: 2000 },
        ],
      },
      {
        narration: `The answer assembles itself from ${N_SUP} partial tables — cohort n = 118,205, every cell already safe to publish. No pupil-level extract was created anywhere in the process.`,
        phase: 'RETURN', holdMs: 4600,
        actions: [
          ...spray(ALL_SUPPLIERS, 'con-tre', 'ok', 0, 130),
          { kind: 'counter', key: 'aggregatesReturned', delta: N_SUP, delayMs: 1400 },
          { kind: 'log', log: 'return', text: 'Combined table returned to TRE · n=118,205 · extract created: none', delayMs: 1600 },
          ...ledgerStamp('R-2417/14 answered — query text and result schema inspectable', 2200),
          { kind: 'highlight', nodes: ['con-tre'], on: false, delayMs: 2600 },
        ],
      },
    ],
  },

  // =========================================================================
  // FRONTLINE OPERATIONS
  // =========================================================================
  {
    id: 'move',
    group: 'Frontline operations',
    title: 'The child who moves',
    tagline: 'One record follows one child — and that’s the point.',
    description: 'A family moves from Bradford to Kent mid-year, across two schools on two different MIS suppliers — one on Arbor, one on SIMS. The record follows the child school-to-school; the LA sees no gap.',
    lesson: 'Federation doesn’t mean nothing moves — it means only what must move, moves; point-to-point, under a basis, on the record. The one pupil-level transfer in this scenario is the one the child needed.',
    contract: {
      requester: 'Fern Hill Primary (ESS SIMS) — receiving school',
      purpose: 'Enrolment of an in-year admission: fetch the education record',
      legalBasis: 'Education (Pupil Information) Regulations — common transfer duty',
      fields: ['Full education record: attainment, attendance, SEND, safeguarding flags'],
      population: 'One pupil',
      aggregation: 'None — this is the legitimate record-level case',
      retention: 'Record transfers custody to the receiving school',
    },
    central: {
      records: 'Today: a CTF file, emails, and re-keying — with a gap while it happens',
      exposure: 'A three-week window where the child is nobody’s pupil',
      note: 'Mid-year movers — the children most likely to be vulnerable — are exactly where today’s plumbing fragments.',
    },
    steps: [
      {
        narration: 'October half-term: a family leaves Bradford. Oakfield Primary records a leaver in Arbor, destination not yet known. Historically, this is the moment a child’s record starts to fragment.',
        phase: 'EVENT', holdMs: 4200,
        actions: [
          { kind: 'flash', node: 'sup-arbor', color: 'data' },
          { kind: 'highlight', nodes: ['sup-arbor'], on: true },
          { kind: 'log', log: 'info', text: 'Leaver recorded: Oakfield Primary (Arbor) · destination unknown' },
        ],
      },
      {
        narration: 'Two weeks later the child appears at Fern Hill Primary in Kent — a SIMS school. The SIMS gateway asks the exchange the only question that matters: who holds this child’s record?',
        phase: 'LOCATE', holdMs: 4400,
        actions: [
          { kind: 'flash', node: 'sup-sims', color: 'query' },
          { kind: 'highlight', nodes: ['sup-sims'], on: true },
          { kind: 'pulse', from: 'sup-sims', to: 'sup-arbor', color: 'query', delayMs: 500 },
          { kind: 'log', log: 'contract', text: 'SIMS → exchange: locate + fetch-a-record · UPN K93…41 · basis: enrolment', delayMs: 600 },
          { kind: 'counter', key: 'exchanges', delta: 1 },
        ],
      },
      {
        narration: 'Arbor’s gateway verifies the receiving school’s claim — the child really is enrolling there — and stamps the ledger before a single field moves.',
        phase: 'VERIFY', holdMs: 3800,
        actions: [
          { kind: 'flash', node: 'sup-arbor', color: 'ok', delayMs: 300 },
          { kind: 'log', log: 'verify', text: 'Enrolment claim verified against admissions round · transfer authorised' },
          ...ledgerStamp('Record transfer authorised: Oakfield → Fern Hill', 1200),
        ],
      },
      {
        narration: 'The record moves — once, whole, school-to-school. Attainment, attendance history, SEND plan, safeguarding flags. No re-keying, no CD in the post, no centre in the middle.',
        phase: 'TRANSFER', holdMs: 4400,
        actions: [
          { kind: 'pulse', from: 'sup-arbor', to: 'sup-sims', color: 'data', durMs: 2000 },
          { kind: 'counter', key: 'pupilRecordsMoved', delta: 1, delayMs: 1800 },
          { kind: 'log', log: 'return', text: 'Full record transferred point-to-point · CTF file rendered obsolete', delayMs: 1900 },
        ],
      },
      {
        narration: 'Both local authorities are notified automatically: Bradford closes its children-missing-education window, Kent opens a school place. The gap where a child can vanish never opens.',
        phase: 'NOTIFY', holdMs: 4600,
        actions: [
          { kind: 'pulse', from: 'sup-sims', to: 'con-la', color: 'ok', delayMs: 200 },
          { kind: 'log', log: 'info', text: 'CME check: 0 days unaccounted · both LAs notified', delayMs: 900 },
          ...ledgerStamp('Transfer complete — visible to the family in the Education Record', 1600),
          { kind: 'highlight', nodes: ['sup-arbor', 'sup-sims'], on: false, delayMs: 2400 },
        ],
      },
    ],
  },
  {
    id: 'attendance',
    group: 'Frontline operations',
    title: 'Tuesday morning, 09:04',
    tagline: 'Two sensitivities, one architecture — and you can see the difference.',
    description: 'Morning registers close across the country. Aggregate signals flow to the centre; one pupil-level early-warning flag flows to one local authority — and the model makes the difference visible.',
    lesson: 'A spine carries traffic at very different sensitivities. The counts are barely personal data; the early-warning flag is intensely so. Federation makes the two travel differently — and the ledger records which was which.',
    contract: {
      requester: 'Standing contract: DfE (aggregates) · LA (risk flags)',
      purpose: 'Daily attendance statistics + persistent-absence early warning',
      legalBasis: 'Attendance regulations 2024 · LA statutory duties',
      fields: ['AM/PM counts by school (aggregate)', 'PA-risk flag (pupil-level, LA only)'],
      population: 'All providers · flags: only pupils crossing the threshold',
      aggregation: 'Counts aggregate; flags record-level by exception',
      retention: 'Counts kept; flags reviewed at LA case level',
    },
    queryId: 'absence-today',
    central: {
      records: '~8m pupils’ marks piped daily to the centre via a commercial broker',
      exposure: 'The most current national dataset about children, in one place, twice a day',
      note: 'This one already exists — the daily attendance feed is the spine’s first vertebra, built on Wonde.',
    },
    steps: [
      {
        narration: '09:04. Registers close. Marks flow from classrooms into each school’s own MIS — note that none of this touches the exchange. This is a supplier doing its ordinary job inside its own estate.',
        phase: 'REGISTERS', holdMs: 4600,
        actions: [
          ...ALL_SUPPLIERS.map((s, i): SimAction => ({ kind: 'fanout', supplier: s, count: 120, color: 'ambient', delayMs: i * 140 })),
          { kind: 'log', log: 'info', text: 'Registers closing nationally — in-estate traffic, not exchange traffic' },
        ],
      },
      {
        narration: `By 09:30 the aggregate signals cross the exchange: counts by school, nothing more. The DfE’s daily attendance picture assembles from ${N_SUP} small green parcels.`,
        phase: 'AGGREGATE', holdMs: 4400,
        actions: [
          ...spray(ALL_SUPPLIERS, 'con-dfe', 'ok', 0, 120),
          { kind: 'counter', key: 'aggregatesReturned', delta: N_SUP, delayMs: 1200 },
          { kind: 'log', log: 'return', text: 'Daily counts → DfE · school-level · same-day national picture', delayMs: 1400 },
          { kind: 'counter', key: 'exchanges', delta: N_SUP, delayMs: 1400 },
        ],
      },
      {
        narration: 'One flag travels differently. A pupil at a Bromcom school crosses the persistent-absence threshold; the standing contract lets exactly that flag — one pupil, one field — reach the local authority team that can act.',
        phase: 'EARLY WARNING', holdMs: 5000,
        actions: [
          { kind: 'flash', node: 'sup-bromcom', color: 'data', delayMs: 300 },
          { kind: 'pulse', from: 'sup-bromcom', to: 'con-la', color: 'data', durMs: 2000, delayMs: 800 },
          { kind: 'counter', key: 'pupilRecordsMoved', delta: 1, delayMs: 2600 },
          { kind: 'log', log: 'return', text: 'PA-risk flag → LA attendance team · 1 pupil · threshold 15% crossed', delayMs: 2700 },
          ...ledgerStamp('Record-level disclosure logged: attendance flag, basis attendance regs', 3300),
        ],
      },
      {
        narration: 'Same morning, two kinds of traffic: statistics that are barely personal, and a flag that is intensely so. The architecture — and the audit ledger — keeps them distinguishable. That distinction is most of what "privacy-respecting" has to mean.',
        phase: 'LESSON', holdMs: 4800,
        actions: [],
      },
    ],
  },
  {
    id: 'social-care',
    group: 'Frontline operations',
    title: 'The social worker’s four questions',
    tagline: 'Minimum data, maximum accountability.',
    description: 'A referral lands with children’s social care. The practitioner needs four facts — enrolment, attendance, SEND plan, previous schools — not a browseable national database.',
    lesson: 'Frontline safeguarding needs answers, not access. Four fields returned under a statutory basis, stamped on a ledger the family can later read, is the exact inverse of ContactPoint — which gave 330,000 users a directory and failed its shielding audit.',
    contract: {
      requester: 'Children’s social care · allocated practitioner',
      purpose: 'Initial assessment following referral',
      legalBasis: 'Children Act 1989 · Working Together 2023',
      fields: ['Current enrolment', 'Attendance last 6 weeks', 'EHCP status', 'Schools attended (2yr)'],
      population: 'One child',
      aggregation: 'Four fields — not the record',
      retention: 'Into the case file; access logged and family-visible on closure',
    },
    central: {
      records: 'A standing directory of all children, browseable by hundreds of thousands of users',
      exposure: 'ContactPoint redux — the design England already rejected',
      note: 'The tempting answer to “social workers need information” is a big database. It has been tried.',
    },
    steps: [
      {
        narration: 'Monday, a referral. The allocated social worker needs four facts before a home visit: where is this child enrolled, are they attending, is there an EHCP, which schools have known them?',
        phase: 'REFERRAL', holdMs: 4400,
        actions: [
          { kind: 'flash', node: 'con-csc', color: 'query' },
          { kind: 'highlight', nodes: ['con-csc'], on: true },
          { kind: 'log', log: 'info', text: 'Referral received · initial assessment opened · 4 facts required' },
        ],
      },
      {
        narration: 'The query names its statutory basis and asks for four fields — not the record, not the file, not a browse session. The exchange resolves where the child is known: a Bromcom school now, an Arbor school before.',
        phase: 'CONTRACT', holdMs: 4600,
        actions: [
          { kind: 'log', log: 'contract', text: 'CSC → exchange: 4 fields, 1 child · basis Children Act 1989 / Working Together' },
          { kind: 'counter', key: 'exchanges', delta: 1 },
          { kind: 'pulse', from: 'con-csc', to: 'sup-bromcom', color: 'query', delayMs: 400 },
          { kind: 'pulse', from: 'con-csc', to: 'sup-arbor', color: 'query', delayMs: 700 },
          { kind: 'flash', node: 'sup-bromcom', color: 'ok', delayMs: 1600 },
          { kind: 'flash', node: 'sup-arbor', color: 'ok', delayMs: 1800 },
          { kind: 'log', log: 'verify', text: 'Practitioner role + case reference verified at both gateways', delayMs: 2000 },
        ],
      },
      {
        narration: 'Two answers come back — current enrolment and attendance from Bromcom, history from Arbor. Four fields cross the network. The rest of two rich school records stays exactly where it was.',
        phase: 'RETURN', holdMs: 4600,
        actions: [
          { kind: 'pulse', from: 'sup-bromcom', to: 'con-csc', color: 'data', delayMs: 200 },
          { kind: 'pulse', from: 'sup-arbor', to: 'con-csc', color: 'data', delayMs: 600 },
          { kind: 'counter', key: 'pupilRecordsMoved', delta: 1, delayMs: 1800 },
          { kind: 'log', log: 'return', text: '4 fields returned · enrolled: yes · attendance 71% ↓ · EHCP: assessment stage', delayMs: 2000 },
        ],
      },
      {
        narration: 'And the part ContactPoint never had: the ledger. When this case closes, the family can see that a named service asked four questions about their child, when, and under what law. Accountability is a feature, not a report.',
        phase: 'LEDGER', holdMs: 5000,
        actions: [
          ...ledgerStamp('Record-level access logged: CSC initial assessment · 4 fields · Children Act basis'),
          { kind: 'highlight', nodes: ['con-csc'], on: false, delayMs: 2200 },
        ],
      },
    ],
  },
  {
    id: 'safeguarding',
    group: 'Frontline operations',
    title: 'Section 47, in minutes',
    tagline: 'A multi-agency enquiry without a standing pool of everyone’s data.',
    description: 'A child-protection enquiry needs a chronology from every service that has known a child — two schools, an AP placement, the LA. The fan-out happens in minutes, under the strongest basis there is.',
    lesson: 'The crisis case is the argument people reach for to justify collecting everything in advance. The federated answer: urgent, narrow, lawful queries served in minutes — without a honeypot existing during the other 99.99% of the time.',
    contract: {
      requester: 'LA children’s services · s.47 strategy discussion',
      purpose: 'Child protection enquiry — assemble education chronology',
      legalBasis: 'Children Act 1989 s.47 — duty to investigate',
      fields: ['Enrolment history', 'Attendance patterns', 'Exclusions', 'Safeguarding logs held by schools'],
      population: 'One child · every service that has known them',
      aggregation: 'Record-level — justified by the strongest basis in the statute book',
      retention: 'Into the s.47 record; fully logged',
    },
    central: {
      records: 'A pre-built pool of every child’s everything, waiting for the 0.01% case',
      exposure: 'The 99.99% of children whose data sits in the pool unused',
      note: 'Emergencies are real. The question is whether they justify a standing copy of every child’s life.',
    },
    steps: [
      {
        narration: 'A strategy discussion convenes under section 47 — the strongest information-sharing basis in children’s law. The chronology must come from everywhere this child has been known: two schools, an AP placement, the LA’s own records.',
        phase: 'STRATEGY', holdMs: 4600,
        actions: [
          { kind: 'highlight', nodes: ['con-csc', 'con-la'], on: true },
          { kind: 'flash', node: 'con-csc', color: 'refuse' },
          { kind: 'log', log: 'info', text: 's.47 enquiry opened · strategy discussion 14:20 · chronology required today' },
        ],
      },
      {
        narration: 'The fan-out: one contract, three custodians — the current SIMS school, the previous ScholarPack school, and the Databridge alternative-provision placement. Section 47 unlocks record-level answers; it does not unlock browsing.',
        phase: 'FAN-OUT', holdMs: 4800,
        actions: [
          { kind: 'log', log: 'contract', text: 'CSC → exchange: s.47 chronology · 1 child · 3 custodians resolved' },
          { kind: 'counter', key: 'exchanges', delta: 1 },
          { kind: 'pulse', from: 'con-csc', to: 'sup-sims', color: 'query', delayMs: 300 },
          { kind: 'pulse', from: 'con-csc', to: 'sup-scholarpack', color: 'query', delayMs: 550 },
          { kind: 'pulse', from: 'con-csc', to: 'sup-databridge', color: 'query', delayMs: 800 },
          { kind: 'log', log: 'verify', text: '3/3 gateways: s.47 reference verified with the requesting LA', delayMs: 1900 },
          ...ledgerStamp('s.47 fan-out authorised — highest-sensitivity access class', 2400),
        ],
      },
      {
        narration: 'Three chronology extracts return inside four minutes — attendance collapsing since spring, an exclusion, a safeguarding log entry from the AP placement that changes the picture. The practitioners walk into the visit knowing what the system knows.',
        phase: 'CHRONOLOGY', holdMs: 5200,
        actions: [
          { kind: 'pulse', from: 'sup-sims', to: 'con-csc', color: 'data', delayMs: 200 },
          { kind: 'pulse', from: 'sup-scholarpack', to: 'con-csc', color: 'data', delayMs: 600 },
          { kind: 'pulse', from: 'sup-databridge', to: 'con-csc', color: 'data', delayMs: 1000 },
          { kind: 'counter', key: 'pupilRecordsMoved', delta: 3, delayMs: 2200 },
          { kind: 'log', log: 'return', text: 'Chronology assembled: 3 sources · 4 min · shared with strategy discussion', delayMs: 2400 },
        ],
      },
      {
        narration: 'Note what did not need to exist for this to work: a standing national pool of every child’s records. The emergency was served by the network being queryable — not by the data having been collected in advance, just in case.',
        phase: 'LESSON', holdMs: 5000,
        actions: [
          ...ledgerStamp('s.47 chronology complete — access reviewable by case audit'),
          { kind: 'highlight', nodes: ['con-csc', 'con-la'], on: false, delayMs: 2000 },
        ],
      },
    ],
  },

  // =========================================================================
  // THE VENDOR ECONOMY
  // =========================================================================
  {
    id: 'benchmark',
    group: 'The vendor economy',
    title: 'What the supplier gets back',
    tagline: 'Adoption economics: the day-one reason to plug in.',
    description: `A primary-specialist MIS pulls national benchmark distributions from the exchange and lights up dashboards in ${sScholar} schools — value flowing back down the network.`,
    lesson: 'GOV.UK Verify died of non-adoption, not bad architecture. A spine survives only if plugging in pays on day one — for suppliers and schools, not just the department. Benchmarks-back is the attendance-dashboard lesson, generalised.',
    contract: {
      requester: `ScholarPack (on behalf of ${sScholar} schools)`,
      purpose: 'National benchmark distributions for school dashboards',
      legalBasis: 'Published-statistics reuse — open aggregate data',
      fields: ['Attendance distributions by phase/region', 'Attainment quartiles', 'Cohort comparators'],
      population: 'National aggregates only',
      aggregation: 'Already-safe published aggregates',
      retention: 'Cached 24h in supplier estate',
    },
    central: {
      records: 'The centre holds everything and publishes what it chooses, when it chooses',
      exposure: '—',
      note: 'In a hub-and-spoke world value flows one way. Ask a school office what the census ever gave back.',
    },
    steps: [
      {
        narration: `ScholarPack — ${shareOf('sup-scholarpack')}% of the market, primary schools, no data-science team in most of them — pulls the national benchmark set the exchange publishes as open aggregates. The same infrastructure that collects can serve.`,
        phase: 'PULL', holdMs: 4400,
        actions: [
          { kind: 'highlight', nodes: ['sup-scholarpack'], on: true },
          { kind: 'pulse', from: 'sup-scholarpack', to: 'con-dfe', color: 'query' },
          { kind: 'log', log: 'contract', text: 'ScholarPack → exchange: pull national benchmarks v2026.3 (open aggregates)' },
          { kind: 'counter', key: 'exchanges', delta: 1 },
          { kind: 'pulse', from: 'con-dfe', to: 'sup-scholarpack', color: 'ok', delayMs: 1400 },
          { kind: 'counter', key: 'aggregatesReturned', delta: 1, delayMs: 2400 },
        ],
      },
      {
        narration: `Overnight, ${sScholar} small primaries get what only big trusts could previously afford: where do we actually sit — against phase, against region, against schools like us?`,
        phase: 'VALUE BACK', holdMs: 5000,
        actions: [
          { kind: 'fanout', supplier: 'sup-scholarpack', count: 200, color: 'ok', delayMs: 300 },
          { kind: 'log', log: 'info', text: `Benchmark dashboards live in ${sScholar} schools · cost to each school: nothing`, delayMs: 1500 },
        ],
      },
      {
        narration: 'This is the adoption argument in one frame. The daily attendance feed succeeded because schools got dashboards back on day one. Verify failed because nobody got anything. Every supplier in this picture needs its own version of this scenario — or the spine is Verify again.',
        phase: 'LESSON', holdMs: 5200,
        actions: [
          { kind: 'highlight', nodes: ['sup-scholarpack'], on: false, delayMs: 2600 },
        ],
      },
    ],
  },
  {
    id: 'edtech-signal',
    group: 'The vendor economy',
    title: 'The pattern only the tendrils see',
    tagline: 'Edtech platforms as certified spurs — intelligence in, never account data out.',
    description: 'Toggle the edtech ring on and imagine the platforms schools already use — Satchel One, Sparx, Class Charts, Tapestry — certified onto the federation as tendrils, contributing aggregate signals under the same contract discipline as the MIS estates.',
    lesson: 'The MIS estates hold the record; the edtech layer sees the behaviour. Homework engagement collapses weeks before attendance does — but today that signal dies inside each platform. Certified tendrils would let the federation see leading indicators without any platform surrendering account-level data.',
    contract: {
      requester: 'LA early-help team · standing pilot contract',
      purpose: 'District-level early-warning composite from certified edtech signals',
      legalBasis: 'Edtech federation pilot — school-level consent, aggregate-only',
      fields: ['Engagement-drop index (district)', 'Behaviour-climate index', 'Attendance context'],
      population: 'One district · platform aggregates only',
      aggregation: 'District-level composites; per-platform pseudonyms, never joinable',
      retention: 'Rolling 12-week window, then discarded',
    },
    queryId: 'digital-homework',
    usesEdtech: true,
    central: {
      records: 'The central alternative: pipe every platform’s clickstream into the national store and mine it',
      exposure: 'Every child’s homework, behaviour and reading history in one queryable pile',
      note: 'The tendril pattern is the argument that intelligence-sharing and surveillance are different designs, not different intentions.',
    },
    steps: [
      {
        narration: 'Look at the outer ring: the platforms schools already run — homework, behaviour, reading, early-years journals. Today each one sees its own sliver of every child’s week, and the slivers never meet. Imagine them certified onto the federation as tendrils.',
        phase: 'THE TENDRILS', holdMs: 5200,
        actions: [
          { kind: 'highlight', nodes: ['edt-satchel', 'edt-sparx', 'edt-classcharts', 'edt-tapestry'], on: true },
          { kind: 'log', log: 'info', text: 'Edtech ring active: 12 certified tendrils · aggregate-only contracts' },
        ],
      },
      {
        narration: 'In one district, Satchel One and Sparx both watch homework engagement sag for the same cohort — weeks before a single attendance mark changes. Class Charts sees the behaviour climate shift. Three platforms, one pattern, and none of them knows the others are seeing it.',
        phase: 'THE SIGNAL', holdMs: 5400,
        actions: [
          { kind: 'flash', node: 'edt-satchel', color: 'data', delayMs: 200 },
          { kind: 'flash', node: 'edt-sparx', color: 'data', delayMs: 600 },
          { kind: 'flash', node: 'edt-classcharts', color: 'data', delayMs: 1000 },
          { kind: 'log', log: 'info', text: 'Engagement-drop index: district 4 · 3 platforms independently past threshold' },
        ],
      },
      {
        narration: 'Under the standing pilot contract, each platform contributes its district-level index — an aggregate, computed inside its own estate, under a per-platform pseudonym scheme that cannot be joined into a profile of any child.',
        phase: 'CONTRIBUTE', holdMs: 5000,
        actions: [
          { kind: 'log', log: 'contract', text: 'Standing contract early-help/pilot: district composites · aggregate-only' },
          { kind: 'counter', key: 'exchanges', delta: 3 },
          { kind: 'pulse', from: 'edt-satchel', to: 'con-la', color: 'ok', delayMs: 300 },
          { kind: 'pulse', from: 'edt-sparx', to: 'con-la', color: 'ok', delayMs: 700 },
          { kind: 'pulse', from: 'edt-classcharts', to: 'con-la', color: 'ok', delayMs: 1100 },
          { kind: 'counter', key: 'aggregatesReturned', delta: 3, delayMs: 2000 },
          ...ledgerStamp('Edtech composite delivered: district 4 early-warning · no account data', 2400),
        ],
      },
      {
        narration: 'The LA early-help team gets a district signal it has never had before: something is happening here, weeks early. The record-level follow-up — which schools, which children — needs its own statutory basis and its own ledger entries. The tendrils gave intelligence, not identities.',
        phase: 'EARLY HELP', holdMs: 5600,
        actions: [
          { kind: 'flash', node: 'con-la', color: 'ok', delayMs: 400 },
          { kind: 'log', log: 'return', text: 'Early-warning composite → LA · district-level · account rows shared: 0', delayMs: 800 },
          { kind: 'highlight', nodes: ['edt-satchel', 'edt-sparx', 'edt-classcharts', 'edt-tapestry'], on: false, delayMs: 3000 },
        ],
      },
    ],
  },
  {
    id: 'transfer-day',
    group: 'The vendor economy',
    title: 'The first of September',
    tagline: 'Peak load is school-shaped. Federation queues; it doesn’t drown.',
    description: 'Admissions day: hundreds of thousands of enrolments, transfers and record fetches in one morning — the network at its annual maximum, with one supplier’s batch window showing.',
    lesson: 'Education traffic is brutally seasonal. In a federation every node owns its own backlog and the system degrades locally; a central write path makes September 1st everyone’s outage risk. (Each pulse shown stands in for roughly ten thousand real transfers.)',
    central: {
      records: 'Every September enrolment written through one national front door',
      exposure: 'One write path, on the one day everything writes at once',
      note: `Ask any national system operator which day they fear. Now put all ${TOTAL_SCHOOLS} schools behind one endpoint on it.`,
    },
    steps: [
      {
        narration: 'September the first. Reception intakes, secondary transfers, in-year moves, sixth-form enrolments — the single biggest data day in English education, hitting every supplier at once. Each pulse here stands for ~10,000 transfers.',
        phase: 'SURGE', holdMs: 5400,
        actions: [
          { kind: 'log', log: 'info', text: 'Admissions day: ~600,000 enrolment events forecast before noon' },
          ...spray(MAJORS, MAJORS, 'data', 0, 90),
          ...spray(['sup-arbor', 'sup-sims'], SMALLS.slice(0, 6), 'data', 500, 90),
          ...spray(SMALLS.slice(6), ['sup-bromcom', 'sup-sims'], 'data', 1000, 90),
          { kind: 'counter', key: 'pupilRecordsMoved', delta: 600000, delayMs: 2000 },
          { kind: 'counter', key: 'exchanges', delta: 58, delayMs: 2000 },
          ...ALL_SUPPLIERS.map((s, i): SimAction => ({ kind: 'fanout', supplier: s, count: 160, color: 'data', delayMs: 1500 + i * 150 })),
        ],
      },
      {
        narration: 'The exchange layer is doing what X-Road actually does all day: verifying signatures and stamping the log at volume. The relays carry receipts, not records — the heavy payloads travel point-to-point between the estates involved.',
        phase: 'UNDER LOAD', holdMs: 4800,
        actions: [
          ...ledgerStamp('High-volume window: 412,000 transfers logged by 11:00'),
          ...spray(MAJORS, MAJORS, 'data', 600, 120),
          { kind: 'log', log: 'verify', text: 'Exchange holding: p95 verification 240ms · no payloads via the ring', delayMs: 1600 },
        ],
      },
      {
        narration: 'One wobble, honestly imagined: suppose the incumbent’s overnight-batch heritage shows, and the SIMS queue stretches to forty minutes. Its schools wait; nobody else’s do. The backlog belongs to the node, not the nation.',
        phase: 'LOCAL STRAIN', holdMs: 5000,
        actions: [
          { kind: 'flash', node: 'sup-sims', color: 'refuse', delayMs: 300 },
          { kind: 'log', log: 'info', text: 'ESS SIMS: transfer queue 40 min (batch architecture) · other estates unaffected', delayMs: 800 },
          { kind: 'flash', node: 'sup-sims', color: 'ok', delayMs: 3200 },
          { kind: 'log', log: 'info', text: 'SIMS queue drained 13:10 · zero transfers lost', delayMs: 3400 },
        ],
      },
    ],
  },

  // =========================================================================
  // TRUST & FAILURE MODES
  // =========================================================================
  {
    id: 'rogue',
    group: 'Trust & failure modes',
    title: 'The query that gets refused',
    tagline: 'In a federation, “no” is enforced at the edge — and everyone can see it.',
    description: `Another department arrives with a memorandum of understanding and a bulk request: names, addresses and nationality of pupils. All ${N_SUP} gateways check the basis. All ${N_SUP} say no.`,
    lesson: 'England has run this experiment: the 2015 Home Office MoU pulled school records into immigration enforcement, in private, until an FOI surfaced it. Federation changes the physics of that — refusal is enforceable at the edge, and the attempt itself becomes a public fact.',
    contract: {
      requester: 'Cross-government requester · MoU attached',
      purpose: 'Bulk identified extract: pupil names, addresses, nationality',
      legalBasis: 'Asserted: memorandum of understanding (no statutory gateway cited)',
      fields: ['Name', 'Address', 'Nationality'],
      population: 'All pupils',
      aggregation: 'None — identified bulk extract',
      retention: 'Unspecified',
    },
    central: {
      records: '2015–16: monthly batches from the National Pupil Database, negotiated in private',
      exposure: 'Whatever the centre agrees to share, is shared — policy is the only firewall',
      note: 'This scenario is the one that actually happened. The architecture just decided how easy it was.',
    },
    steps: [
      {
        narration: 'A request arrives wearing a memorandum of understanding: names, addresses and nationality — all pupils, identified, in bulk. In 2015 a request like this was a meeting and a signature away from the National Pupil Database.',
        phase: 'CONTRACT', holdMs: 5000,
        actions: [
          { kind: 'highlight', nodes: ['con-xgov'], on: true },
          { kind: 'flash', node: 'con-xgov', color: 'refuse' },
          { kind: 'log', log: 'contract', text: 'Cross-gov → exchange: bulk identified extract · basis asserted: MoU only' },
          { kind: 'counter', key: 'exchanges', delta: 1 },
          ...spray('con-xgov', ALL_SUPPLIERS, 'query', 600, 110),
        ],
      },
      {
        narration: `All ${N_SUP} gateways run the same check the census passed — and this one fails it everywhere. No statutory gateway, no aggregation, no proportionality. The contract is refused at the edge, by code enforcing law, ${N_SUP} times independently.`,
        phase: 'REFUSE', holdMs: 5200,
        actions: [
          ...ALL_SUPPLIERS.map((s, i): SimAction => ({ kind: 'flash', node: s, color: 'refuse', delayMs: i * 100 })),
          ...spray(ALL_SUPPLIERS, 'con-xgov', 'refuse', 900, 110),
          { kind: 'counter', key: 'refusals', delta: N_SUP, delayMs: 1800 },
          { kind: 'log', log: 'refuse', text: `${N_SUP}/${N_SUP} gateways: REFUSED — no lawful basis for bulk identified extract`, delayMs: 1400 },
        ],
      },
      {
        narration: 'And the part that changes behaviour: the attempt is now on the ledger, permanently and inspectably. The 2015 MoU took journalists and an FOI battle to surface. Here, asking the wrong question in the wrong way is self-documenting.',
        phase: 'ON THE RECORD', holdMs: 5400,
        actions: [
          ...ledgerStamp('REFUSAL logged: bulk identified request, no statutory basis — public record'),
          { kind: 'log', log: 'audit', text: 'Refusal visible to members, regulators and the public — deterrence by daylight', delayMs: 1500 },
          { kind: 'highlight', nodes: ['con-xgov'], on: false, delayMs: 2600 },
        ],
      },
    ],
  },
  {
    id: 'breach',
    group: 'Trust & failure modes',
    title: 'Blast radius',
    tagline: 'The honeypot argument, rendered literally.',
    description: 'An attacker phishes their way into one mid-sized supplier. Watch what they can reach — then flip the architecture toggle and imagine the same morning against a central store.',
    lesson: 'Security economics, not security perfection: breaches happen in every architecture. Federation buys you a bounded blast radius (one estate, revocable in minutes) instead of a national catastrophe. The centre is the one target worth a nation-state’s time.',
    central: {
      records: 'One credential set away from 8m children’s records',
      exposure: 'Everything, in one place, behind one perimeter',
      note: 'The ICO’s 2020 audit of the DfE found 400+ organisations with NPD access. A central spine multiplies that surface.',
    },
    steps: [
      {
        narration: `Assume the breach — good security design always does. Suppose a phishing campaign lands: an engineer’s credentials at a mid-sized supplier — say RM Integris, ${sIntegris} schools, ${shareOf('sup-integris')}% of the market. The attacker is inside a real estate with real children’s records.`,
        phase: 'COMPROMISE', holdMs: 4800,
        actions: [
          { kind: 'flash', node: 'sup-integris', color: 'refuse' },
          { kind: 'highlight', nodes: ['sup-integris'], on: true },
          { kind: 'log', log: 'info', text: `INCIDENT (simulated): credential compromise at one mid-size estate · ${sIntegris} schools` },
          { kind: 'fanout', supplier: 'sup-integris', count: 200, color: 'refuse', delayMs: 1200 },
        ],
      },
      {
        narration: `The exposure is grave — and bounded. ${sIntegris} schools’ records: serious, notifiable, life-affecting. But the attacker holds one estate’s keys, not the nation’s. The other ${N_SUP - 1} estates, and the exchange itself, are different locks on different doors.`,
        phase: 'BLAST RADIUS', holdMs: 5000,
        actions: [
          { kind: 'log', log: 'info', text: `Exposure assessment: ${sIntegris} schools (${shareOf('sup-integris')}%) · other estates unreachable with these keys` },
          { kind: 'counter', key: 'pupilRecordsMoved', delta: 0 },
        ],
      },
      {
        narration: 'The federation’s immune response: the other members revoke the compromised estate’s certificates and the exchange isolates it pending forensics. Its schools fall back to local-only operation — degraded, but contained. Time from detection to isolation: minutes.',
        phase: 'REVOKE', holdMs: 5200,
        actions: [
          ...spray(['con-dfe', 'sup-sims', 'sup-arbor'], 'sup-integris', 'refuse', 300, 250),
          { kind: 'counter', key: 'refusals', delta: 1, delayMs: 1200 },
          { kind: 'log', log: 'refuse', text: 'Certificate revoked: compromised estate isolated from exchange · 09:41', delayMs: 1400 },
          ...ledgerStamp('Isolation event logged — members + regulator notified simultaneously', 2200),
        ],
      },
      {
        narration: 'Now run the counterfactual in your head — or with the architecture toggle above. The same phishing email against a central store isn’t a 2.5% incident; it is the incident. One perimeter, 8 million children, and a target rich enough to justify any adversary’s patience.',
        phase: 'COUNTERFACTUAL', holdMs: 5600,
        actions: [
          { kind: 'highlight', nodes: ['sup-integris'], on: false, delayMs: 3000 },
        ],
      },
    ],
  },
  {
    id: 'outage',
    group: 'Trust & failure modes',
    title: 'When the big one goes down',
    tagline: 'Partial answers, honestly labelled, beat no answers.',
    description: 'The largest supplier has a national outage on a school morning. The federation keeps answering — at 66% coverage, and says so — until the backfill arrives.',
    lesson: 'Resilience isn’t “nothing ever fails”; it’s what the system says while something is failing. A federation returns partial answers labelled partial. A monolith returns a status page.',
    central: {
      records: '—',
      exposure: 'One system’s outage is everyone’s outage',
      note: 'The write path is the single point of failure a central design cannot design away.',
    },
    steps: [
      {
        narration: `08:40, a wet Wednesday: imagine the incumbent — ESS SIMS, ${shareOf('sup-sims')}% of the market — goes dark. Nearly a third of the country’s school estates are unreachable. In a hub-and-spoke world this would be the whole story.`,
        phase: 'OUTAGE', holdMs: 4600,
        actions: [
          { kind: 'flash', node: 'sup-sims', color: 'refuse' },
          { kind: 'highlight', nodes: ['sup-sims'], on: true },
          { kind: 'log', log: 'info', text: `Simulated outage: largest estate dark from 08:40 · ${sSims} schools unreachable` },
        ],
      },
      {
        narration: `The DfE’s morning attendance question goes out anyway. The other ${N_SUP - 1} suppliers answer; the incumbent times out. The result comes back labelled for what it is: ${(100 - shareOf('sup-sims')).toFixed(0)}% coverage, partial, not wrong.`,
        phase: 'DEGRADED', holdMs: 5200,
        actions: [
          ...spray('con-dfe', ALL_SUPPLIERS, 'query', 0, 100),
          { kind: 'counter', key: 'exchanges', delta: 1 },
          ...spray(ALL_SUPPLIERS.filter((s) => s !== 'sup-sims'), 'con-dfe', 'ok', 1600, 110),
          { kind: 'flash', node: 'sup-sims', color: 'refuse', delayMs: 2000 },
          { kind: 'counter', key: 'aggregatesReturned', delta: N_SUP - 1, delayMs: 2800 },
          { kind: 'log', log: 'return', text: `Daily counts: ${N_SUP - 1}/${N_SUP} sources · coverage ${(100 - shareOf('sup-sims')).toFixed(0)}% · flagged PARTIAL in every downstream use`, delayMs: 3000 },
        ],
      },
      {
        narration: 'Lunchtime: the estate restores service and backfills the morning’s answers; the national picture quietly completes itself. Schools on other suppliers never noticed. Failure stayed local; honesty stayed global.',
        phase: 'BACKFILL', holdMs: 4800,
        actions: [
          { kind: 'flash', node: 'sup-sims', color: 'ok', delayMs: 400 },
          { kind: 'pulse', from: 'sup-sims', to: 'con-dfe', color: 'ok', delayMs: 900 },
          { kind: 'counter', key: 'aggregatesReturned', delta: 1, delayMs: 1900 },
          { kind: 'log', log: 'return', text: 'Backfill complete 12:55 · coverage 100% · partial flags cleared', delayMs: 2100 },
          ...ledgerStamp('Outage + recovery fully on the record — availability is auditable too', 2800),
          { kind: 'highlight', nodes: ['sup-sims'], on: false, delayMs: 3400 },
        ],
      },
    ],
  },
  {
    id: 'optout',
    group: 'Trust & failure modes',
    title: 'The family that says no',
    tagline: 'Consent enforced where the data lives, not remembered where it’s copied.',
    description: 'A family objects to their child’s data being used for research. The objection registers once — through the learner-held record — and every subsequent query honours it at source.',
    lesson: 'In a central store an opt-out is a row the centre must remember to respect on every extract, forever. At the edge, the objection lives beside the record it protects — the next research query simply returns n−1, automatically.',
    contract: {
      requester: '(The data subject, for once)',
      purpose: 'Register objection: no research / secondary uses',
      legalBasis: 'UK GDPR Art. 21 — right to object',
      fields: ['Objection flag: research uses'],
      population: 'One pupil, by their family',
      aggregation: '—',
      retention: 'Standing until withdrawn',
    },
    central: {
      records: 'An opt-out register the centre must consult on every extract, forever',
      exposure: 'One missed join and the objection silently fails',
      note: 'The NPD has no general opt-out at all. Health’s national data opt-out shows both that it’s possible — and how hard retrofitting one is.',
    },
    steps: [
      {
        narration: 'A family reads the ledger — who has asked about our child? — and decides they don’t want the research uses. Through the learner-held Education Record they register an objection — watch it travel through the DfE gateway that operates the Record service. One tap; Article 21.',
        phase: 'OBJECTION', holdMs: 4800,
        actions: [
          { kind: 'highlight', nodes: ['con-record'], on: true },
          { kind: 'flash', node: 'con-record', color: 'ok' },
          { kind: 'pulse', from: 'con-record', to: 'sup-arbor', color: 'query', delayMs: 600 },
          { kind: 'log', log: 'contract', text: 'Education Record (via DfE gateway) → Arbor: objection registered · research uses · Art. 21' },
          { kind: 'counter', key: 'exchanges', delta: 1 },
        ],
      },
      {
        narration: 'The flag lives where the record lives — in the school’s MIS at Arbor — and the exchange’s policy registry notes that it exists. No copies to chase, no register to reconcile: the objection sits beside the data it protects.',
        phase: 'AT SOURCE', holdMs: 4400,
        actions: [
          { kind: 'flash', node: 'sup-arbor', color: 'ok', delayMs: 300 },
          { kind: 'log', log: 'verify', text: 'Objection flag stored at source · policy registry updated', delayMs: 600 },
          ...ledgerStamp('Objection registered — visible to the family, binding on queries', 1400),
        ],
      },
      {
        narration: 'Prove it works: the earlier research query runs again. Arbor’s local compute excludes the flagged pupil before anything aggregates — the cohort returns as n = 118,204 instead of 118,205. Nobody downstream had to remember anything.',
        phase: 'ENFORCED', holdMs: 5400,
        actions: [
          ...spray('con-tre', ALL_SUPPLIERS, 'query', 0, 90),
          { kind: 'counter', key: 'exchanges', delta: 1 },
          { kind: 'fanout', supplier: 'sup-arbor', count: 120, color: 'query', delayMs: 1200 },
          ...spray(ALL_SUPPLIERS, 'con-tre', 'ok', 2200, 100),
          { kind: 'counter', key: 'aggregatesReturned', delta: N_SUP, delayMs: 3400 },
          { kind: 'log', log: 'return', text: 'Cohort n=118,204 (−1) · objection honoured at source, invisibly to the researcher', delayMs: 3600 },
          { kind: 'highlight', nodes: ['con-record'], on: false, delayMs: 4200 },
        ],
      },
    ],
  },
];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
