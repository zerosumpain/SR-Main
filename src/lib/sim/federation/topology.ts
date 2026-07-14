// topology.ts — the synthetic federated education network: the real English MIS
// market (named suppliers, real WhichMIS Oct-2025 counts), ~22,600 provider points clustered
// by supplier, an exchange ring (the X-Road-style protocol layer), the consumer
// estate (DfE + its existing satellite stores — NPD, LEO, ILR, LDS — local
// authorities, social care, TRE, Ofsted, the DfE-brokered learner-held Education
// Record), a toggleable outer ring of edtech tendrils, and the citizen-readable
// audit ledger. Supplier names are real; market shares are indicative (the real
// figures move quarterly); every behaviour simulated on them is illustrative.
// Everything is deterministic (seeded RNG) and DOM/Three-free so it can be tested.

export type NodeKind = 'supplier' | 'consumer' | 'relay' | 'ledger' | 'central' | 'store' | 'edtech' | 'aggregator' | 'la' | 'resolver' | 'registry';
export type SupplierTier = 'major' | 'mid' | 'small';

export interface NetNode {
  id: string;
  kind: NodeKind;
  label: string;
  sub?: string;
  desc: string;
  pos: [number, number, number];
  size: number;
  tier?: SupplierTier;
  sharePct?: number;
  schools?: number;
  /** supplier flag: not in the tracked state MIS census (its count is illustrative) */
  indicative?: boolean;
  /** for holder nodes (kind 'la'): which second world this belongs to */
  sector?: 'la' | 'cross';
  /** edtech / aggregator nodes: indicative schools-reached figure, surfaced by the
   *  "approx reach" toggle as a second label line and in the inspector */
  reach?: number;
}

export interface Edge {
  from: string;
  to: string;
  kind: 'member' | 'ring' | 'central' | 'satellite' | 'tendril' | 'broker';
}

export interface SchoolField {
  count: number;
  /** xyz triplets, length = count * 3 */
  positions: Float32Array;
  /** supplier index (into suppliers()) per school */
  supplier: Uint16Array;
  /** first school index per supplier (suppliers are contiguous) */
  offsets: Uint32Array;
}

/** The local-authority estate: one dot per LA, drawn as a second context space. */
export interface LaField {
  count: number;
  /** xyz triplets, length = count * 3 */
  positions: Float32Array;
}

export interface Topology {
  nodes: NetNode[];
  edges: Edge[];
  schools: SchoolField;
  /** the LA context space (153 authorities) — the second half of a cross-context join */
  las: LaField;
  supplierIds: string[];
  relayIds: string[];
  edtechIds: string[];
  /** the MIS access brokers (Wonde et al.) — a second toggleable ring layer */
  aggregatorIds: string[];
  storeIds: string[];
  /** the second-world data-holder domains a join can terminate at (LA + cross-sector) */
  holderIds: string[];
  byId: Map<string, NetNode>;
}

// ---------------------------------------------------------------------------
// Deterministic RNG
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  // Box–Muller; clamp the tail so clusters stay visually tight
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(-2.6, Math.min(2.6, g));
}

// ---------------------------------------------------------------------------
// The MIS market — real supplier names, indicative shares (spring 2026 shape:
// three companies carrying ~80% of state schools, a mid pack, a long tail).
// Shares are rounded approximations of publicly tracked figures, not claims.
// ---------------------------------------------------------------------------

export interface SupplierSpec {
  id: string;
  label: string;
  sub: string;
  tier: SupplierTier;
  /** the source of truth for dots: real per-vendor English school count. State-market
   * vendors carry WhichMIS Oct-2025 census figures (1 dot = 1 real school); long-tail /
   * independent / early-years / bespoke estates carry an indicative figure (see below). */
  schools: number;
  /** derived display value (schools ÷ total modelled estate × 100). NOT the source of
   * truth — kept precomputed so the inspector/legend can show a share without recomputing. */
  sharePct: number;
  /** true = independent-sector / early-years / special / bespoke estate that is NOT in
   * the tracked state-school MIS census; its `schools` figure is illustrative, not sourced. */
  indicative?: boolean;
  desc: string;
}

// State-tracked market: WhichMIS October 2025 census, 22,067 English state schools.
// Arbor 9,677 (44.0%) · ESS SIMS 6,897 (31.7%) · Bromcom 3,493 (15.9%) — a top-3
// concentration of ~92%. ScholarPack + RM Integris (The Key Group residual, 1,450
// combined) are being retired into Arbor by Feb 2026; the split shown is an estimate.
// The long-tail band below is independent-sector / early-years / special / bespoke —
// NOT in the state census, so its figures are illustrative and flagged `indicative`.
export const SUPPLIERS: SupplierSpec[] = [
  { id: 'sup-arbor', label: 'Arbor', sub: 'cloud-native · The Key Group', tier: 'major', schools: 9677, sharePct: 42.9,
    desc: 'The market leader by school count (WhichMIS Oct-2025: 9,677 state schools, ~44%): a cloud-native MIS that overtook the old incumbent by winning primaries and multi-academy trusts. API-first, so gateway integration lands in weeks not years.' },
  { id: 'sup-sims', label: 'ESS SIMS', sub: 'legacy incumbent · on-prem heritage', tier: 'major', schools: 6897, sharePct: 30.6,
    desc: 'The long-standing incumbent, still a vast estate in secondaries (6,897 schools, ~32%): an on-premises heritage product mid-way through its cloud migration. Deep feature set, slow release cadence, and the heaviest estate to bring onto any spine.' },
  { id: 'sup-bromcom', label: 'Bromcom', sub: 'cloud · trust dashboards & finance', tier: 'major', schools: 3493, sharePct: 15.5,
    desc: 'The third force (3,493 schools, ~16%): a cloud MIS focused on trust-level dashboards and finance integration, strong in secondaries and growing fast in open procurements.' },
  { id: 'sup-scholarpack', label: 'ScholarPack', sub: 'primary specialist · Key Group', tier: 'mid', schools: 800, sharePct: 3.5,
    desc: 'The primary-phase specialist with a loyal base of small schools — exactly the kind of supplier a federation must not price out. Being retired into Arbor by Feb 2026: consolidation is itself a federation risk.' },
  { id: 'sup-integris', label: 'RM Integris', sub: 'long-serving · Key Group', tier: 'mid', schools: 650, sharePct: 2.9,
    desc: 'A long-serving MIS with regional strongholds and decades of statutory-returns muscle memory. Also being folded into Arbor by Feb 2026 — proof the market has history, and that estates merge under any standard you write.' },
  { id: 'sup-horizons', label: 'Juniper Horizons', sub: 'primary-phase · was Pupil Asset', tier: 'mid', schools: 284, sharePct: 1.3,
    desc: 'The former Pupil Asset, folded into the Juniper group — one consolidation among many. Federation standards have to survive suppliers merging under them.' },
  { id: 'sup-edgen', label: 'IRIS Ed:gen', sub: 'IRIS group MIS', tier: 'small', schools: 115, sharePct: 0.5,
    desc: 'The IRIS software group’s MIS play — a payroll-and-payments giant arriving in the classroom market. A small estate (~115 schools) but cross-sells make its data footprint broader than a school register.' },
  { id: 'sup-compass', label: 'Compass', sub: 'Australian entrant', tier: 'small', schools: 102, sharePct: 0.5,
    desc: 'An established Australian MIS entering England (~102 schools, up from ~72) — a reminder that open standards decide whether international entrants can compete here at all.' },
  { id: 'sup-isams', label: 'iSAMS', sub: 'independent-sector roots', tier: 'small', schools: 95, sharePct: 0.4, indicative: true,
    desc: 'Grew up in the independent sector; strong pastoral and admissions modules; a small state-sector footprint not separately tracked in the census. Two statutory worlds, one product.' },
  { id: 'sup-famly', label: 'Famly', sub: 'nursery & early years', tier: 'small', schools: 140, sharePct: 0.6, indicative: true,
    desc: 'Early-years management: the spine’s hardest edge case, where children first appear in the data — and where record structures least resemble a school register. Not in the state-school census.' },
  { id: 'sup-engage', label: 'Engage', sub: 'Double First · independents', tier: 'small', schools: 65, sharePct: 0.3, indicative: true,
    desc: 'An independent-schools specialist. The independent sector holds records for ~600,000 children the state system will meet mid-flight — transfers cross this boundary daily.' },
  { id: 'sup-databridge', label: 'Databridge', sub: 'special schools & AP', tier: 'small', schools: 120, sharePct: 0.5, indicative: true,
    desc: 'Specialises in special schools and alternative provision, where record structures are richest and most sensitive. No published per-vendor count, so the figure here is illustrative — but the estates a federation must serve best, not last.' },
  { id: 'sup-hubmis', label: 'WCBS HUBmis', sub: 'independents · heritage', tier: 'small', schools: 45, sharePct: 0.2, indicative: true,
    desc: 'A heritage independent-sector supplier — small, stable, and unlikely to fund heavy integration work unaided. The on-ramp cost question, personified.' },
  { id: 'sup-selfhosted', label: 'Self-hosted', sub: 'long tail · bespoke systems', tier: 'small', schools: 90, sharePct: 0.4, indicative: true,
    desc: 'The long tail: schools running bespoke or self-hosted systems. Any federated design has to give them an on-ramp — or admit it excludes them.' },
];

/** Provenance for the per-vendor school counts, surfaced in the sim UI. */
export const MIS_SOURCE =
  'Per-vendor counts: WhichMIS October 2025 MIS census (22,067 tracked English state schools). ' +
  'Long-tail / independent / early-years / bespoke estates are indicative, not census-tracked. Shares drift each census.';
/** The tracked state-school MIS census total the accurate clusters are normalised against. */
export const STATE_CENSUS_TOTAL = 22067;

/** Total dots the model draws = Σ real/indicative per-vendor school counts. */
function totalSchools(): number {
  return SUPPLIERS.reduce((a, s) => a + s.schools, 0);
}

/**
 * Deterministic largest-remainder allocation of `schoolCount` dots to suppliers in
 * proportion to their REAL per-vendor `schools` — shared by buildTopology and the query
 * engine so both always agree on estate sizes. When `schoolCount === DEFAULT_SCHOOL_COUNT`
 * (= Σ schools) each supplier gets exactly its real count: 1 dot = 1 school.
 */
export function supplierCounts(schoolCount: number): number[] {
  const total = totalSchools();
  const raw = SUPPLIERS.map((s) => (s.schools / total) * schoolCount);
  const counts = raw.map(Math.floor);
  const rem = schoolCount - counts.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < rem; k++) counts[order[k % order.length].i]++;
  return counts;
}

export interface ConsumerSpec {
  id: string;
  label: string;
  sub: string;
  desc: string;
  size: number;
  /** this consumer reaches the ring via another member's gateway, not its own relay */
  brokeredBy?: string;
}

// Well-known node ids shared across the engine/scene/component layer. Renaming
// a node in buildTopology without updating these is a compile error at the use
// sites instead of a silent no-op pulse.
export const DFE_ID = 'con-dfe';
export const LEDGER_ID = 'ledger';
export const CENTRAL_ID = 'central-store';
export const RECORD_ID = 'con-record';

export const CONSUMERS: ConsumerSpec[] = [
  { id: 'con-dfe', label: 'DfE', sub: 'department · statistics & policy', size: 2.1,
    desc: 'The Department for Education: statistical collections, funding allocation, policy monitoring. In a federated model it asks questions and receives answers — it does not hold the working copy of every child’s record. Its existing stores (NPD, LEO, ILR, LDS) orbit it: the estate a federation would slowly relieve.' },
  { id: 'con-la', label: 'Local authorities', sub: '153 · admissions · CME · SEND', size: 1.7,
    desc: '153 local authorities with statutory duties: admissions, children missing education, SEND, safeguarding. The heaviest operational users of any spine.' },
  { id: 'con-csc', label: 'Children’s social care', sub: 'safeguarding practitioners', size: 1.5,
    desc: 'Social-care practitioners needing narrow, urgent answers — is this child enrolled, are they attending — under a statutory basis, with every access logged.' },
  { id: 'con-tre', label: 'Research (TRE)', sub: 'accredited · query-not-copy', size: 1.4,
    desc: 'Accredited researchers working in a trusted research environment: statistical queries with small-cell suppression and noise, never record-level extracts.' },
  { id: 'con-ofsted', label: 'Ofsted', sub: 'inspection · pre-visit packs', size: 1.2,
    desc: 'Inspection: a pre-visit evidence pack assembled by query on demand, instead of schools compiling spreadsheets the night before.' },
  { id: 'con-record', label: 'Education Record', sub: 'learner-held · brokered by DfE', size: 1.3, brokeredBy: DFE_ID,
    desc: 'The learner-held record: the young person carries and shares their own attainment history. The one consumer that is also the data subject — and note its wiring: DfE operates the Education Record service, so the citizen’s view reaches the federation through the DfE gateway, stamped on the ledger like anyone else’s.' },
  { id: 'con-xgov', label: 'Cross-government', sub: 'other departments · MoUs', size: 1.1,
    desc: 'Other departments arriving with memoranda of understanding — the DWP, the Home Office, the Cabinet Office. Historically the least visible users of children’s data, and the reason the refusal path matters as much as the query path.' },
];

// ---------------------------------------------------------------------------
// The department's existing satellite stores — the current central estate,
// drawn honestly so the federation is explicit about what it would replace.
// ---------------------------------------------------------------------------

export interface StoreSpec {
  id: string;
  label: string;
  sub: string;
  desc: string;
  size: number;
}

export const STORES: StoreSpec[] = [
  { id: 'store-npd', label: 'NPD', sub: 'National Pupil Database · 28m+ records', size: 1.0,
    desc: 'The National Pupil Database: pupil-level records accumulated since 2002, linked across census, attainment and exclusions. The biggest single reason the federation argument exists — every collection this model answers by query is one the NPD no longer has to grow for.' },
  { id: 'store-leo', label: 'LEO', sub: 'Longitudinal Education Outcomes', size: 0.85,
    desc: 'Longitudinal Education Outcomes: NPD + ILR + HESA linked to HMRC and DWP earnings — education to payslip, tens of millions of people. The research crown jewels, and the strongest case for query-not-copy done properly through a TRE.' },
  { id: 'store-ilr', label: 'ILR', sub: 'Individualised Learner Record · FE & skills', size: 0.8,
    desc: 'The Individualised Learner Record: further-education and skills returns, collected termly from every funded provider. A second, parallel collection regime the spine would fold into the same query discipline.' },
  { id: 'store-lds', label: 'LDS', sub: 'learner records · ULN / PLR family', size: 0.7,
    desc: 'The learner-data services family — unique learner numbers and personal learning records, the department’s identity plumbing for post-16 learners. In a federated design, identity resolution like this becomes the spine’s most critical shared service.' },
];

// ---------------------------------------------------------------------------
// The edtech ring — real products drawn as tendrils on the exchange. This layer
// is aspirational: imagine each certified onto the federation, contributing the
// intelligence it uniquely sees under the same contract-and-ledger discipline.
// ---------------------------------------------------------------------------

export interface EdtechSpec {
  id: string;
  label: string;
  sub: string;
  desc: string;
  /** indicative schools-reached figure — presence also enrols the platform in the
   * digital-homework query panel (see queries.ts) */
  schoolsReached?: number;
  /** indicative reach shown by the "approx reach" toggle (schools). Falls back to
   * schoolsReached for the platforms that gate the homework panel, so the display
   * figure and the query gate never drift apart. */
  reach?: number;
}

// The certified-app roster (the ring's "Apps" layer): platforms imagined contributing
// aggregate intelligence. Reach figures are indicative UK-schools estimates. The MIS
// access brokers (Wonde, Xporter, Assembly, Salamander) are a SEPARATE layer — see
// AGGREGATORS below — because they are plumbing, not signal sources.
export const EDTECH: EdtechSpec[] = [
  { id: 'edt-cpoms', label: 'CPOMS', sub: 'safeguarding logs', reach: 15000,
    desc: 'Safeguarding and pastoral incident logs, in a large share of English schools. Federated intelligence: concern-pattern signals (never case content) that could reach a strategy discussion hours after they cluster, under s.47-grade controls.' },
  { id: 'edt-classcharts', label: 'Class Charts', sub: 'behaviour & seating', reach: 7000,
    desc: 'Behaviour points and seating plans. Federated intelligence: behaviour-climate aggregates that give the attendance numbers their missing context.' },
  { id: 'edt-satchel', label: 'Satchel One', sub: 'homework & engagement', schoolsReached: 4100,
    desc: 'Homework setting and completion. Federated intelligence: engagement-drop signals — the leading indicator that shows up weeks before attendance falls.' },
  { id: 'edt-sparx', label: 'Sparx Maths', sub: 'adaptive maths practice', schoolsReached: 2300,
    desc: 'Adaptive maths homework. Federated intelligence: anonymous mastery distributions by topic — a national curriculum-health readout no census question could collect.' },
  { id: 'edt-ttrs', label: 'TT Rock Stars', sub: 'fluency practice', schoolsReached: 13800,
    desc: 'Times-tables fluency. Federated intelligence: number-fluency cohort curves for the primary phase, aggregated at source, no child named.' },
  { id: 'edt-tapestry', label: 'Tapestry', sub: 'EYFS evidence journals', reach: 12000,
    desc: 'Early-years evidence journals. Federated intelligence: development-milestone aggregates from the phase where the state currently sees least.' },
  { id: 'edt-parentpay', label: 'ParentPay', sub: 'payments & engagement', reach: 10000,
    desc: 'School payments. Federated intelligence: FSM take-up vs eligibility gaps — the difference between entitled and fed, visible only in transaction aggregates.' },
  { id: 'edt-ar', label: 'Accelerated Reader', sub: 'reading practice · Renaissance', schoolsReached: 6100,
    desc: 'Reading practice and quizzing. Federated intelligence: reading-age distributions against chronological age, by region and phase — literacy weather, not literacy anecdotes.' },
  { id: 'edt-gl', label: 'GL Assessment', sub: 'standardised assessment', reach: 5000,
    desc: 'CAT4 and standardised assessment. Federated intelligence: ability-vs-attainment gap aggregates — where potential is being missed, at population scale.' },
  { id: 'edt-unifrog', label: 'Unifrog', sub: 'destinations & careers', reach: 4000,
    desc: 'Careers platforms see intentions before outcomes. Federated intelligence: destination-intention flows feeding LEO-style analysis years earlier than tax records can.' },
  { id: 'edt-provisionmap', label: 'Provision Map', sub: 'SEND provision · Tes', reach: 3000,
    desc: 'SEND provision mapping. Federated intelligence: intervention-coverage aggregates — what support is actually in place against what EHCPs promise.' },
];

// ---------------------------------------------------------------------------
// The aggregator layer — the MIS access brokers that already sit between school
// MIS estates and the apps above. This is how school data moves TODAY: a broker
// holds a bulk-access agreement with each MIS and re-sells a normalised feed to
// downstream apps. Drawn as a distinct ring layer because a federation would
// INVERT their role — from bulk-access middleman to certified gateway operator,
// answering queries under contract instead of piping copies. Reach figures are
// indicative UK-schools estimates from vendors' own public claims.
// ---------------------------------------------------------------------------

export interface AggregatorSpec {
  id: string;
  label: string;
  sub: string;
  desc: string;
  /** indicative UK schools this broker reaches */
  reach: number;
}

export const AGGREGATORS: AggregatorSpec[] = [
  { id: 'agg-wonde', label: 'Wonde', sub: 'access broker · the plumbing today', reach: 13000,
    desc: 'The broker the daily attendance feed already rides on, plugged into every major MIS — proof the middleman pattern already works at national scale. In a federation its role inverts: from bulk-access reseller to a certified gateway that answers queries under contract, with each access on the ledger.' },
  { id: 'agg-xporter', label: 'Groupcall Xporter', sub: 'MIS extraction · The Access Group', reach: 10000,
    desc: 'The long-standing MIS extraction agent — an on-site connector pulling from SIMS and the rest and syncing it out to third parties. The federation question it poses: why run an extraction agent at all, when a gateway could answer the question in place?' },
  { id: 'agg-assembly', label: 'Assembly', sub: 'MIS data platform · analytics', reach: 5000,
    desc: 'A newer MIS data platform aggregating school data for analytics and MAT reporting. The kind of value-added layer a federation should make easy to build on top of a certified feed — instead of each rebuilding its own bulk pipe.' },
  { id: 'agg-salamander', label: 'Salamander', sub: 'MIS sync · account provisioning', reach: 2500,
    desc: 'MIS synchronisation for identity and account provisioning — the quiet plumbing that keeps logins and groups in step with the school roll. A reminder that "integration" already means dozens of standing copies, each its own risk surface.' },
];

// ---------------------------------------------------------------------------
// The local-authority context space — the SECOND data world a cross-context join
// must reach. Schools cluster by MIS vendor; local authorities run their OWN line-
// of-business case systems (a different market: Liquidlogic and OLM Mosaic in social
// care; Capita ONE, Servelec Synergy and Civica in education). A join across schools
// and LAs is hard precisely because these two worlds share no analytic key — the
// school-side UPN does not resolve cleanly to an LA case-management ID. Caseload
// figures are indicative, grounded in DfE/ONS national statistics.
// ---------------------------------------------------------------------------

export const LA_COUNT = 153;
export const RESOLVER_ID = 'resolver';

export interface LaHolderSpec {
  id: string;
  label: string;
  /** the case-management system(s) behind this domain */
  sub: string;
  desc: string;
  /** indicative national caseload this domain holds — sizes the second-side partials */
  cases: number;
  /** the second-side identifier a join must resolve against the school-side UPN */
  key: string;
  /** 'la' = a local-authority case system; 'cross' = a different sector entirely
   * (health, cross-government earnings) where the join is harder still */
  sector: 'la' | 'cross';
}

export const LA_HOLDERS: LaHolderSpec[] = [
  { id: 'la-csc', label: 'Children’s social care', sub: 'CIN / CP / CLA casework · Liquidlogic · OLM Mosaic', cases: 404000, key: 'LA social-care person ID', sector: 'la',
    desc: 'Children-in-need, child-protection-plan and looked-after casework — the most sensitive LA data, held under a safeguarding basis distinct from schools’ attendance duty. ~404,000 children in need at a point in time (DfE CIN census). Its person IDs were never designed to line up with a school UPN.' },
  { id: 'la-send', label: 'SEND & EHCP casework', sub: 'assessment + plans · Capita ONE · Servelec Synergy', cases: 600000, key: 'LA SEND case ID', sector: 'la',
    desc: 'Education, health and care needs-assessment and plan casework — ~600,000 EHCPs and rising, plus those awaiting assessment. Lives in the LA’s SEND case system, not the school MIS; the two are linked today only by hand.' },
  { id: 'la-admissions', label: 'Admissions & fair access', sub: 'in-year + fair-access panels · Capita ONE · Synergy · Civica', cases: 700000, key: 'LA admissions applicant ID', sector: 'la',
    desc: 'The LA’s admissions and in-year / fair-access-panel systems — who applied where, who was placed, who is still unplaced. A separate line-of-business system from both the MIS and the SEND case file.' },
  { id: 'la-ap', label: 'Alternative provision', sub: 'AP / PRU commissioning · mixed / bespoke', cases: 41000, key: 'LA AP placement ID', sector: 'la',
    desc: 'LA-commissioned alternative provision and pupil-referral-unit rolls — where excluded and out-of-school children land. ~41,000 pupils in state-place AP/PRU. Often a different MIS again (special/AP specialists), or a spreadsheet.' },
  { id: 'la-cme', label: 'CME & Children Not in School', sub: 'attendance registers · Capita ONE · spreadsheets', cases: 117000, key: 'LA CME / CNIS register ID', sector: 'la',
    desc: 'The children-missing-education and new Children-Not-in-School registers (Children’s Wellbeing and Schools Act 2026). The LA’s own view of who is NOT accounted for by any school — the mirror image of the MIS estates.' },
];

// Cross-SECTOR holders — a third and fourth world, where the join is harder still
// because the shared key is either purpose-limited (the NHS number, a safeguarding
// identifier that cannot be an analytic key) or crosses a department boundary. These
// exist so the sim can honestly show the frontier questions, not to claim they're easy.
export const CROSS_HOLDERS: LaHolderSpec[] = [
  { id: 'xh-health', label: 'Health & CAMHS', sub: 'NHS · CAMHS · A&E · FHIR bridge', cases: 500000, key: 'NHS number (SUI — purpose-limited)', sector: 'cross',
    desc: 'NHS mental-health (CAMHS) and urgent-care contact — a different sector with its own law. The NHS number can appear in schools as a Safeguarding Unique Identifier, but that is purpose-limited to safeguarding and cannot lawfully be used as an analytic join key. So a schools×health question has no clean key at all: the hardest join in the model.' },
  { id: 'xh-earnings', label: 'Destinations & earnings', sub: 'ILR · LEO · HMRC–DWP link', cases: 700000, key: 'ULN → NINO link', sector: 'cross',
    desc: 'Post-16 learning (ILR) and employment/earnings outcomes (LEO, via HMRC and DWP) — the crown-jewel longitudinal link. The identifier cliff is at 16: the school UPN gives way to the ULN, and the join into tax records is a cross-government matching exercise under memoranda of understanding, not a shared key.' },
];

/** Every second-world data holder — LA case systems + the cross-sector worlds. */
export const ALL_HOLDERS: LaHolderSpec[] = [...LA_HOLDERS, ...CROSS_HOLDERS];

export function holderById(id: string): LaHolderSpec | undefined {
  return ALL_HOLDERS.find((h) => h.id === id);
}
export function laHolderById(id: string): LaHolderSpec | undefined {
  return LA_HOLDERS.find((h) => h.id === id);
}

// ---------------------------------------------------------------------------
// THE SPINE — the shared trust registries at the centre. This is the whole thesis
// made spatial: "centralise the trust, not the data". The data stays out at the
// edges (schools, LAs, health); the small thing in the middle is a set of registries
// and a protocol — the identity resolver, a record locator, a consent register, a
// policy/rules engine, and the citizen-readable ledger (rendered separately as the
// obelisk). These are the only new national infrastructure a federation actually builds.
// ---------------------------------------------------------------------------

export interface SpineNode { id: string; label: string; sub: string; desc: string; }

// The RESOLVER (identity) and the LEDGER are their own node kinds; these three are the
// remaining registry primitives that complete the central spine.
export const SPINE_NODES: SpineNode[] = [
  { id: 'reg-locator', label: 'Record locator', sub: 'find-a-record · pointers, not content',
    desc: 'The directory the whole federation turns on: given a resolved identity, which estates hold a record for this child? It returns pointers, never case content — the NHS PDS / National Record Locator pattern. No locator, no federation; a central store instead.' },
  { id: 'reg-consent', label: 'Consent & opt-out register', sub: 'a family’s “no”, enforced at source',
    desc: 'Where a family’s objection lives — beside the record it protects, not in a central list the middle must remember to consult. Every query checks it; a voluntary ask it can decline honours it, a statutory ask overrides it and logs the objection.' },
  { id: 'reg-policy', label: 'Policy & rules engine', sub: 'which basis unlocks which fields',
    desc: 'Law as configuration: a machine-readable registry of which statutory basis unlocks which fields at which level of aggregation. It is the thing every gateway checks before answering — the difference between “privacy-respecting” as a slogan and as an enforced rule.' },
];

export function spineNodeById(id: string): SpineNode | undefined {
  return SPINE_NODES.find((n) => n.id === id);
}

// ---------------------------------------------------------------------------
// Layout — a layered composition echoing the study's five-layer anatomy:
// provider field (ground) → supplier gateways → exchange ring (+ ledger,
// + edtech tendrils) → consumers (+ DfE satellite stores). The LA context space
// sits as a second estate off to one side, meeting the schools only at the resolver.
// ---------------------------------------------------------------------------

export const LAYERS_Y = { schools: 0, suppliers: 9, ring: 19, consumers: 30 } as const;
export const RING_RADIUS = 19;
export const RELAY_COUNT = 24;
/** 1 dot = 1 school: the total modelled estate = Σ per-vendor school counts (≈22,573). */
export const DEFAULT_SCHOOL_COUNT = SUPPLIERS.reduce((a, s) => a + s.schools, 0);

/** Visual blob radius for a supplier cluster (∝ sqrt of estate size). */
function blobRadius(schools: number): number {
  return 1.8 + Math.sqrt(schools) * 0.16;
}

export function buildTopology(opts: { schoolCount?: number; seed?: number } = {}): Topology {
  const schoolCount = opts.schoolCount ?? DEFAULT_SCHOOL_COUNT;
  const rng = mulberry32(opts.seed ?? 20260710);
  const nodes: NetNode[] = [];
  const edges: Edge[] = [];

  // --- supplier school counts (largest remainder so they sum exactly) ---
  const counts = supplierCounts(schoolCount);

  // --- supplier cluster centres on a ground ring, arc width ∝ blob radius ---
  const blobs = counts.map(blobRadius);
  const pad = 2.2;
  const arcTotal = blobs.reduce((a, b) => a + b + pad, 0);
  let acc = 0;
  const centres: [number, number][] = blobs.map((b) => {
    const mid = acc + (b + pad) / 2;
    acc += b + pad;
    const theta = (mid / arcTotal) * Math.PI * 2;
    // The school estate is pushed out into an OUTER ANNULUS, leaving the centre clear for
    // the spine + ring — so the composition reads "data at the edges, trust in the middle".
    // (Arc width already ∝ blob radius, so majors claim more of the circle.)
    const r = 37 + b * 0.7;
    return [Math.cos(theta) * r, Math.sin(theta) * r];
  });

  // --- school field (contiguous per supplier) ---
  const positions = new Float32Array(schoolCount * 3);
  const supplier = new Uint16Array(schoolCount);
  const offsets = new Uint32Array(SUPPLIERS.length);
  let idx = 0;
  SUPPLIERS.forEach((spec, si) => {
    offsets[si] = idx;
    const [cx, cz] = centres[si];
    const b = blobs[si];
    for (let k = 0; k < counts[si]; k++) {
      const px = cx + gaussian(rng) * b * 0.42;
      const pz = cz + gaussian(rng) * b * 0.42;
      const py = LAYERS_Y.schools + rng() * 0.5;
      positions[idx * 3] = px;
      positions[idx * 3 + 1] = py;
      positions[idx * 3 + 2] = pz;
      supplier[idx] = si;
      idx++;
    }
  });

  // --- supplier gateway nodes ---
  SUPPLIERS.forEach((spec, si) => {
    const [cx, cz] = centres[si];
    nodes.push({
      id: spec.id, kind: 'supplier', label: spec.label, sub: spec.sub, desc: spec.desc,
      pos: [cx, LAYERS_Y.suppliers, cz],
      size: spec.tier === 'major' ? 1.7 : spec.tier === 'mid' ? 1.0 : 0.75,
      tier: spec.tier, sharePct: spec.sharePct, schools: counts[si], indicative: spec.indicative,
    });
  });

  // --- exchange ring relays ---
  const relayIds: string[] = [];
  for (let i = 0; i < RELAY_COUNT; i++) {
    const theta = (i / RELAY_COUNT) * Math.PI * 2;
    const id = `relay-${i}`;
    relayIds.push(id);
    nodes.push({
      id, kind: 'relay', label: '', desc: 'Exchange-layer relay: verifies signatures, enforces access rules, stamps the audit ledger. No relay stores record content.',
      pos: [Math.cos(theta) * RING_RADIUS, LAYERS_Y.ring, Math.sin(theta) * RING_RADIUS],
      size: 0.28,
    });
    edges.push({ from: id, to: `relay-${(i + 1) % RELAY_COUNT}`, kind: 'ring' });
  }

  // --- audit ledger at the heart of the ring ---
  nodes.push({
    id: LEDGER_ID, kind: 'ledger', label: 'Audit ledger', sub: 'every access, readable by the citizen',
    desc: 'The citizen-visible access log — Estonia’s pattern worth stealing regardless of architecture. Every query that crosses the exchange writes an immutable entry: who asked, about whom, under what basis.',
    pos: [0, LAYERS_Y.ring, 0], size: 1.1,
  });

  // --- consumers on an upper arc ---
  CONSUMERS.forEach((c, i) => {
    const theta = ((i + 0.5) / CONSUMERS.length) * Math.PI * 2;
    const r = 21;
    nodes.push({
      id: c.id, kind: 'consumer', label: c.label, sub: c.sub, desc: c.desc,
      pos: [Math.cos(theta) * r, LAYERS_Y.consumers, Math.sin(theta) * r],
      size: c.size,
    });
  });

  // --- DfE satellite stores: the existing central estate, orbiting the DfE ---
  const dfe = nodes.find((n) => n.id === DFE_ID)!;
  const storeIds: string[] = [];
  STORES.forEach((s, i) => {
    const theta = ((i + 0.5) / STORES.length) * Math.PI * 2;
    const orbit = 4.6;
    storeIds.push(s.id);
    nodes.push({
      id: s.id, kind: 'store', label: s.label, sub: s.sub, desc: s.desc,
      pos: [dfe.pos[0] + Math.cos(theta) * orbit, dfe.pos[1] - 3.6 + (i % 2) * 1.1, dfe.pos[2] + Math.sin(theta) * orbit],
      size: s.size,
    });
    edges.push({ from: s.id, to: DFE_ID, kind: 'satellite' });
  });

  // --- edtech tendrils: real products drawn as small spurs off the ring ---
  const edtechIds: string[] = [];
  EDTECH.forEach((e, i) => {
    const theta = ((i + 0.5) / EDTECH.length) * Math.PI * 2;
    const r = RING_RADIUS + 5.6 + (i % 3) * 1.7;
    edtechIds.push(e.id);
    nodes.push({
      id: e.id, kind: 'edtech', label: e.label, sub: e.sub, desc: e.desc,
      pos: [Math.cos(theta) * r, LAYERS_Y.ring + (i % 2 === 0 ? 1.6 : -1.8) + (i % 4) * 0.5, Math.sin(theta) * r],
      size: 0.5, reach: e.reach ?? e.schoolsReached,
    });
  });

  // --- aggregators: the MIS access brokers, a tighter inner ring just off the
  //     exchange — the plumbing that carries school data today (toggle layer) ---
  const aggregatorIds: string[] = [];
  AGGREGATORS.forEach((a, i) => {
    const theta = ((i + 0.5) / AGGREGATORS.length) * Math.PI * 2 + Math.PI * 0.13;
    const r = RING_RADIUS + 3.4;
    aggregatorIds.push(a.id);
    nodes.push({
      id: a.id, kind: 'aggregator', label: a.label, sub: a.sub, desc: a.desc,
      pos: [Math.cos(theta) * r, LAYERS_Y.ring + 2.6 + (i % 2) * 1.1, Math.sin(theta) * r],
      size: 0.85, reach: a.reach,
    });
  });

  // --- the local-authority estate: LA-side data-holder gateways in their own sector,
  //     a ground field of 153 authorities, and the identity RESOLVER between the worlds ---
  // The LA world is a DISTINCT ISLAND off to one side, beyond the school cloud, so the
  // "two context spaces" reading is literal: schools fill the main disc, local
  // authorities sit apart, and the resolver bridges the gap between them.
  // Two distinct back-world ISLANDS so the entity types read separately: local
  // authorities to the back-LEFT, the cross-sector worlds (health, earnings) to the
  // back-RIGHT. Schools fill the front and sides; the spine registries own the centre.
  const LA_SECTOR = Math.PI * 1.0;     // back-left
  const CROSS_SECTOR = Math.PI * 1.62; // back-right
  const holderIds: string[] = [];
  const laH = ALL_HOLDERS.filter((h) => h.sector === 'la');
  const crossH = ALL_HOLDERS.filter((h) => h.sector === 'cross');
  ALL_HOLDERS.forEach((h) => {
    holderIds.push(h.id);
    let pos: [number, number, number];
    if (h.sector === 'la') {
      const i = laH.indexOf(h);
      const frac = laH.length > 1 ? i / (laH.length - 1) : 0.5;
      const theta = LA_SECTOR + (frac - 0.5) * Math.PI * 0.5;
      const r = 31;
      pos = [Math.cos(theta) * r, LAYERS_Y.suppliers + 5, Math.sin(theta) * r];
    } else {
      const i = crossH.indexOf(h);
      const frac = crossH.length > 1 ? i / (crossH.length - 1) : 0.5;
      const theta = CROSS_SECTOR + (frac - 0.5) * Math.PI * 0.34;
      const r = 31;
      pos = [Math.cos(theta) * r, LAYERS_Y.suppliers + 8, Math.sin(theta) * r];
    }
    nodes.push({
      id: h.id, kind: 'la', label: h.label, sub: h.sub, desc: h.desc,
      pos, size: h.sector === 'cross' ? 1.05 : 1.2, sector: h.sector,
    });
  });

  // the 153 local authorities as a raised, floating shelf beneath the LA island (back-left)
  const laPositions = new Float32Array(LA_COUNT * 3);
  for (let i = 0; i < LA_COUNT; i++) {
    const theta = LA_SECTOR + gaussian(rng) * 0.3;
    const rr = 30 + gaussian(rng) * 4;
    laPositions[i * 3] = Math.cos(theta) * rr;
    laPositions[i * 3 + 1] = LAYERS_Y.suppliers - 1 + rng() * 0.8;
    laPositions[i * 3 + 2] = Math.sin(theta) * rr;
  }

  // --- THE SPINE: the shared registries at dead centre. The identity resolver and the
  //     three registry primitives ring the ledger obelisk (pushed below) — a small,
  //     elevated trust core that every world reaches. "Centralise the trust, not the data." ---
  const HUB_R = 6.6;
  const HUB_Y0 = LAYERS_Y.suppliers + 2; // ≈11, base of an ascending "spiral" spine core
  // the resolver (identity register) faces camera-front so cross-context joins visibly converge here
  nodes.push({
    id: RESOLVER_ID, kind: 'resolver', label: 'Identity resolver', sub: 'UPN ↔ LA case ID · match confidence',
    desc: 'The hardest, least-built registry: matching a child’s school-side identifier (UPN) to their LA-side case-management ID, with no shared analytic key. It resolves what it can, scores the confidence, and drops what it cannot match — honestly. There is no published standard for this today; the study names it as the missing piece.',
    pos: [Math.cos(Math.PI * 0.25) * HUB_R, HUB_Y0, Math.sin(Math.PI * 0.25) * HUB_R],
    size: 1.3,
  });
  // registries spiral UP around the ledger, so their labels stagger in height instead of stacking
  SPINE_NODES.forEach((s, i) => {
    const theta = Math.PI * (0.75 + i * 0.5); // 0.75π, 1.25π, 1.75π around the ledger
    const y = HUB_Y0 + 2.2 + i * 2.2;
    nodes.push({
      id: s.id, kind: 'registry', label: s.label, sub: s.sub, desc: s.desc,
      pos: [Math.cos(theta) * HUB_R, y, Math.sin(theta) * HUB_R], size: 1.05,
    });
  });

  // --- the central-store counterfactual node (hidden in federated mode) ---
  nodes.push({
    id: CENTRAL_ID, kind: 'central', label: 'Central store', sub: 'the counterfactual · one copy of everything',
    desc: 'The counterfactual: every record copied into one national database. Fast to query, catastrophic to breach, and the one design with a proven political failure mode in England (ContactPoint, 2010).',
    pos: [0, 15, 0], size: 3.2,
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));

  // --- membership edges: every member connects to its nearest relay ---
  const nearestRelay = (p: [number, number, number]): string => {
    let best = relayIds[0];
    let bd = Infinity;
    for (const rid of relayIds) {
      const r = byId.get(rid)!;
      const dx = r.pos[0] - p[0];
      const dz = r.pos[2] - p[2];
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = rid; }
    }
    return best;
  };
  const consumerBroker = new Map(CONSUMERS.map((c) => [c.id, c.brokeredBy]));
  for (const n of nodes) {
    if (n.kind === 'supplier' || n.kind === 'consumer') {
      // a brokered consumer's one door is its broker's gateway (Education Record → DfE)
      edges.push({ from: n.id, to: consumerBroker.get(n.id) ?? nearestRelay(n.pos), kind: 'member' });
      edges.push({ from: n.id, to: CENTRAL_ID, kind: 'central' });
    }
    if (n.kind === 'edtech') {
      edges.push({ from: n.id, to: nearestRelay(n.pos), kind: 'tendril' });
    }
    if (n.kind === 'aggregator') {
      edges.push({ from: n.id, to: nearestRelay(n.pos), kind: 'broker' });
    }
    // LA-side data holders answer through their own gateway onto the ring, like any member
    if (n.kind === 'la') {
      edges.push({ from: n.id, to: nearestRelay(n.pos), kind: 'member' });
    }
  }

  return {
    nodes, edges,
    schools: { count: schoolCount, positions, supplier, offsets },
    las: { count: LA_COUNT, positions: laPositions },
    supplierIds: SUPPLIERS.map((s) => s.id),
    relayIds,
    edtechIds,
    aggregatorIds,
    storeIds,
    holderIds,
    byId,
  };
}

// ---------------------------------------------------------------------------
// Pulse routing — waypoints a message visits between two members
// ---------------------------------------------------------------------------

export type ArchMode = 'federated' | 'central';

function memberEdgeTarget(topo: Topology, id: string): string | null {
  const e = topo.edges.find((e) => (e.kind === 'member' || e.kind === 'tendril' || e.kind === 'satellite' || e.kind === 'broker') && e.from === id);
  return e ? e.to : null;
}

/**
 * The hop chain from a member out to its relay. Usually [member, relay]; for
 * brokered members (Education Record → DfE) the chain passes through the broker:
 * [record, dfe, dfe's relay].
 */
function accessChain(topo: Topology, id: string): { via: NetNode[]; relay: string | null } {
  const start = topo.byId.get(id);
  if (!start) return { via: [], relay: null };
  if (start.kind === 'relay' || start.kind === 'ledger') return { via: [start], relay: start.id };
  const via: NetNode[] = [start];
  let cur = start;
  for (let hop = 0; hop < 3; hop++) {
    const next = memberEdgeTarget(topo, cur.id);
    if (!next) return { via, relay: null };
    const node = topo.byId.get(next);
    if (!node) return { via, relay: null };
    if (node.kind === 'relay') return { via, relay: node.id };
    via.push(node);
    cur = node;
  }
  return { via, relay: null };
}

/**
 * Returns the positions a pulse passes through. Federated: member → (broker →)
 * its relay → (short arc along the ring) → target's relay → (broker →) member.
 * Central: member → store → member.
 */
export function routePath(topo: Topology, fromId: string, toId: string, mode: ArchMode): [number, number, number][] {
  const a = topo.byId.get(fromId);
  const b = topo.byId.get(toId);
  if (!a || !b) return [];
  if (mode === 'central') {
    const store = topo.byId.get(CENTRAL_ID)!;
    return [a.pos, store.pos, b.pos];
  }
  const chainA = accessChain(topo, a.id);
  const chainB = accessChain(topo, b.id);
  // broker-direct hops need no ring transit, in either direction:
  // destination is the source's own broker (record → DfE, NPD → DfE)…
  const brokerIdxA = chainA.via.findIndex((n) => n.id === b.id);
  if (brokerIdxA > 0) return chainA.via.slice(0, brokerIdxA + 1).map((n) => n.pos);
  // …or the source is the destination's broker (DfE → record, DfE → NPD)
  const brokerIdxB = chainB.via.findIndex((n) => n.id === a.id);
  if (brokerIdxB > 0) return chainB.via.slice(0, brokerIdxB + 1).reverse().map((n) => n.pos);
  const path: [number, number, number][] = chainA.via.map((n) => n.pos);
  const ra = chainA.relay;
  const rb = chainB.relay;
  if (ra && rb && ra !== rb) {
    const ia = topo.relayIds.indexOf(ra);
    const ib = topo.relayIds.indexOf(rb);
    path.push(topo.byId.get(ra)!.pos);
    if (ia >= 0 && ib >= 0) {
      // walk the ring the short way, sampling at most 3 intermediate relays
      const n = topo.relayIds.length;
      const fwd = (ib - ia + n) % n;
      const dir = fwd <= n / 2 ? 1 : -1;
      const steps = Math.min(dir === 1 ? fwd : n - fwd, 12);
      const sample = Math.max(1, Math.floor(steps / 3));
      for (let s = sample; s < steps; s += sample) {
        path.push(topo.byId.get(topo.relayIds[(ia + dir * s + n) % n])!.pos);
      }
    }
    path.push(topo.byId.get(rb)!.pos);
  } else if (ra && ra !== a.id) {
    path.push(topo.byId.get(ra)!.pos);
  }
  for (let i = chainB.via.length - 1; i >= 0; i--) {
    const n = chainB.via[i];
    if (n.id !== a.id) path.push(n.pos);
  }
  return path;
}

// ---------------------------------------------------------------------------
// Synthetic school records (deterministic per index)
// ---------------------------------------------------------------------------

const NAME_A = ['Oakfield', 'St Anselm’s', 'Riverside', 'Hollybrook', 'Marsh Lane', 'Whitegate', 'Ash Grove', 'St Cuthbert’s', 'Fern Hill', 'Longacre', 'Kingsmead', 'Brackenbury', 'Elm Park', 'Saltmarsh', 'Weaver Vale', 'Copperfield', 'Northolme', 'Lark Rise', 'St Winifred’s', 'Tanners End', 'Milldale', 'Harefield', 'Stonecross', 'Beckside', 'Ivy House', 'Redwharf', 'Gorsebank', 'Applegarth', 'Windmill Hill', 'Curlew Park'];
const NAME_B = ['Primary School', 'Academy', 'CofE Primary', 'Junior School', 'Infant School', 'High School', 'Community School', 'Catholic Primary', 'Church School', 'Primary Academy', 'School'];
const PHASES = ['Primary', 'Primary', 'Primary', 'Secondary', 'Secondary', 'Special', 'AP/PRU', 'All-through'];
const REGIONS = ['North West', 'North East', 'Yorkshire & Humber', 'West Midlands', 'East Midlands', 'East of England', 'London', 'South East', 'South West'];

export interface SchoolInfo {
  index: number;
  name: string;
  phase: string;
  region: string;
  pupils: number;
  supplierId: string;
  supplierLabel: string;
  urn: string;
}

export function schoolInfo(topo: Topology, index: number): SchoolInfo {
  const rng = mulberry32(0x5eed ^ (index * 2654435761));
  const si = topo.schools.supplier[index];
  const spec = SUPPLIERS[si];
  const phase = PHASES[Math.floor(rng() * PHASES.length)];
  const pupils = phase === 'Secondary' ? 600 + Math.floor(rng() * 1100)
    : phase === 'Special' || phase === 'AP/PRU' ? 40 + Math.floor(rng() * 180)
    : 90 + Math.floor(rng() * 420);
  return {
    index,
    name: `${NAME_A[Math.floor(rng() * NAME_A.length)]} ${NAME_B[Math.floor(rng() * NAME_B.length)]}`,
    phase,
    region: REGIONS[Math.floor(rng() * REGIONS.length)],
    pupils,
    supplierId: spec.id,
    supplierLabel: spec.label,
    urn: `9${String(100000 + Math.floor(rng() * 899999)).slice(0, 5)}`,
  };
}

/** Deterministically sample n school indices belonging to a supplier. */
export function sampleSchools(topo: Topology, supplierId: string, n: number, seed = 1): number[] {
  const si = topo.supplierIds.indexOf(supplierId);
  if (si < 0) return [];
  const start = topo.schools.offsets[si];
  const end = si + 1 < topo.supplierIds.length ? topo.schools.offsets[si + 1] : topo.schools.count;
  const size = end - start;
  const rng = mulberry32(seed * 7919 + si);
  const out: number[] = [];
  for (let i = 0; i < Math.min(n, size); i++) out.push(start + Math.floor(rng() * size));
  return out;
}
