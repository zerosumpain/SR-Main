// topology.ts — the synthetic federated education network: 15 fictional MIS
// suppliers (market-shaped: one legacy incumbent, cloud challengers, a long tail),
// 24,000 provider points clustered by supplier, an exchange ring (the X-Road-style
// protocol layer), and the consumer estate (DfE, LAs, social care, TRE, Ofsted,
// the learner-held Education Record) plus the citizen-readable audit ledger.
// Everything is deterministic (seeded RNG) and DOM/Three-free so it can be tested.

export type NodeKind = 'supplier' | 'consumer' | 'relay' | 'ledger' | 'central';
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
}

export interface Edge {
  from: string;
  to: string;
  kind: 'member' | 'ring' | 'central';
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

export interface Topology {
  nodes: NetNode[];
  edges: Edge[];
  schools: SchoolField;
  supplierIds: string[];
  relayIds: string[];
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
// The synthetic MIS market — fictional names, real market *shape*
// (~80% with three majors, a mid pack, and a long tail incl. self-hosted)
// ---------------------------------------------------------------------------

export interface SupplierSpec {
  id: string;
  label: string;
  sub: string;
  tier: SupplierTier;
  sharePct: number;
  desc: string;
}

export const SUPPLIERS: SupplierSpec[] = [
  { id: 'sup-cedar', label: 'Cedar MIS', sub: 'legacy incumbent · on-prem heritage', tier: 'major', sharePct: 34,
    desc: 'The long-standing incumbent: an on-premises heritage product mid-way through a cloud migration. Deep feature set, slow release cadence, and the largest single estate to bring onto any spine.' },
  { id: 'sup-meridian', label: 'Meridian', sub: 'cloud-native challenger', tier: 'major', sharePct: 29,
    desc: 'The cloud-native challenger that has grown fastest since 2020, strong with large multi-academy trusts. API-first, so gateway integration lands in weeks not years.' },
  { id: 'sup-beacon', label: 'BeaconEd', sub: 'cloud · trust-focused', tier: 'major', sharePct: 17,
    desc: 'The third force: a cloud MIS focused on trust-level dashboards and finance integration. Its customers are concentrated in secondaries.' },
  { id: 'sup-rowanfield', label: 'Rowanfield', sub: 'primary specialist', tier: 'mid', sharePct: 3.4,
    desc: 'A primary-phase specialist with a loyal base of small schools — the kind of supplier a federation must not price out.' },
  { id: 'sup-kestrel', label: 'Kestrel SIS', sub: 'independent-sector roots', tier: 'mid', sharePct: 2.8,
    desc: 'Grew up in the independent sector; strong pastoral and admissions modules; now selling into the state sector.' },
  { id: 'sup-harbourside', label: 'Harbourside', sub: 'regional, north-west', tier: 'mid', sharePct: 2.4,
    desc: 'A regional player with dense coverage in the north-west — proof that the market has geography, not just size.' },
  { id: 'sup-aldergrey', label: 'Alder & Grey', sub: 'special schools & AP', tier: 'mid', sharePct: 2.1,
    desc: 'Specialises in special schools and alternative provision, where record structures are richest and most sensitive.' },
  { id: 'sup-ternbridge', label: 'Ternbridge', sub: 'sixth-form & colleges', tier: 'mid', sharePct: 1.9,
    desc: 'Post-16 specialist straddling the school/college data divide — two statutory reporting regimes in one product.' },
  { id: 'sup-lodestone', label: 'Lodestone', sub: 'MAT-built, now sold on', tier: 'small', sharePct: 1.6,
    desc: 'Built inside a large trust and later spun out — a reminder that schools themselves create MIS suppliers.' },
  { id: 'sup-fenwick', label: 'Fenwick Data', sub: 'attendance-led', tier: 'small', sharePct: 1.4,
    desc: 'Entered via attendance and safeguarding tooling; holds thin records but very current ones.' },
  { id: 'sup-bracken', label: 'Bracken MIS', sub: 'rural & small schools', tier: 'small', sharePct: 1.2,
    desc: 'Serves federations of small rural schools that share a business manager between them.' },
  { id: 'sup-pelham', label: 'Pelham Systems', sub: 'faith-school niche', tier: 'small', sharePct: 1.1,
    desc: 'A niche supplier with a diocesan customer base — small, stable, and unlikely to fund heavy integration work unaided.' },
  { id: 'sup-whitloe', label: 'Whitloe', sub: 'nursery & early years', tier: 'small', sharePct: 0.9,
    desc: 'Early-years specialist: the spine’s hardest edge case, where children first appear in the data.' },
  { id: 'sup-osier', label: 'Osier', sub: 'new entrant, AI-led', tier: 'small', sharePct: 0.7,
    desc: 'A venture-backed new entrant. Open standards decide whether entrants like this can exist at all.' },
  { id: 'sup-longtail', label: 'Self-hosted', sub: 'long tail · bespoke systems', tier: 'small', sharePct: 0.5,
    desc: 'The long tail: schools running bespoke or self-hosted systems. Any federated design has to give them an on-ramp — or admit it excludes them.' },
];

export interface ConsumerSpec {
  id: string;
  label: string;
  sub: string;
  desc: string;
  size: number;
}

// Well-known node ids shared across the engine/scene/component layer. Renaming
// a node in buildTopology without updating these is a compile error at the use
// sites instead of a silent no-op pulse.
export const DFE_ID = 'con-dfe';
export const LEDGER_ID = 'ledger';
export const CENTRAL_ID = 'central-store';

export const CONSUMERS: ConsumerSpec[] = [
  { id: 'con-dfe', label: 'DfE', sub: 'department · statistics & policy', size: 2.1,
    desc: 'The Department for Education: statistical collections, funding allocation, policy monitoring. In a federated model it asks questions and receives answers — it does not hold the working copy of every child’s record.' },
  { id: 'con-la', label: 'Local authorities', sub: '153 · admissions · CME · SEND', size: 1.7,
    desc: '153 local authorities with statutory duties: admissions, children missing education, SEND, safeguarding. The heaviest operational users of any spine.' },
  { id: 'con-csc', label: 'Children’s social care', sub: 'safeguarding practitioners', size: 1.5,
    desc: 'Social-care practitioners needing narrow, urgent answers — is this child enrolled, are they attending — under a statutory basis, with every access logged.' },
  { id: 'con-tre', label: 'Research (TRE)', sub: 'accredited · query-not-copy', size: 1.4,
    desc: 'Accredited researchers working in a trusted research environment: statistical queries with small-cell suppression and noise, never record-level extracts.' },
  { id: 'con-ofsted', label: 'Ofsted', sub: 'inspection · pre-visit packs', size: 1.2,
    desc: 'Inspection: a pre-visit evidence pack assembled by query on demand, instead of schools compiling spreadsheets the night before.' },
  { id: 'con-record', label: 'Education Record', sub: 'learner-held · the citizen’s copy', size: 1.3,
    desc: 'The learner-held record: the young person carries and shares their own attainment history. The one consumer that is also the data subject.' },
  { id: 'con-xgov', label: 'Cross-government', sub: 'other departments · MoUs', size: 1.1,
    desc: 'Other departments arriving with memoranda of understanding — the DWP, the Home Office, the Cabinet Office. Historically the least visible users of children’s data, and the reason the refusal path matters as much as the query path.' },
];

// ---------------------------------------------------------------------------
// Layout — a layered composition echoing the study's five-layer anatomy:
// provider field (ground) → supplier gateways → exchange ring (+ ledger) → consumers
// ---------------------------------------------------------------------------

export const LAYERS_Y = { schools: 0, suppliers: 9, ring: 19, consumers: 30 } as const;
export const RING_RADIUS = 19;
export const RELAY_COUNT = 24;
export const DEFAULT_SCHOOL_COUNT = 24000;

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
  const raw = SUPPLIERS.map((s) => (s.sharePct / 100) * schoolCount);
  const counts = raw.map(Math.floor);
  let rem = schoolCount - counts.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < rem; k++) counts[order[k % order.length].i]++;

  // --- supplier cluster centres on a ground ring, arc width ∝ blob radius ---
  const blobs = counts.map(blobRadius);
  const pad = 2.2;
  const arcTotal = blobs.reduce((a, b) => a + b + pad, 0);
  let acc = 0;
  const centres: [number, number][] = blobs.map((b) => {
    const mid = acc + (b + pad) / 2;
    acc += b + pad;
    const theta = (mid / arcTotal) * Math.PI * 2;
    // majors sit slightly closer in so the composition reads hub-and-shore
    const r = 30 + b * 0.9;
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
      tier: spec.tier, sharePct: spec.sharePct, schools: counts[si],
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
  for (const n of nodes) {
    if (n.kind === 'supplier' || n.kind === 'consumer') {
      edges.push({ from: n.id, to: nearestRelay(n.pos), kind: 'member' });
      edges.push({ from: n.id, to: CENTRAL_ID, kind: 'central' });
    }
  }

  return {
    nodes, edges,
    schools: { count: schoolCount, positions, supplier, offsets },
    supplierIds: SUPPLIERS.map((s) => s.id),
    relayIds,
    byId,
  };
}

// ---------------------------------------------------------------------------
// Pulse routing — waypoints a message visits between two members
// ---------------------------------------------------------------------------

export type ArchMode = 'federated' | 'central';

function memberRelay(topo: Topology, id: string): string | null {
  const e = topo.edges.find((e) => e.kind === 'member' && e.from === id);
  return e ? e.to : null;
}

/**
 * Returns the positions a pulse passes through. Federated: member → its relay →
 * (short arc along the ring) → target's relay → member. Central: member → store → member.
 */
export function routePath(topo: Topology, fromId: string, toId: string, mode: ArchMode): [number, number, number][] {
  const a = topo.byId.get(fromId);
  const b = topo.byId.get(toId);
  if (!a || !b) return [];
  if (mode === 'central') {
    const store = topo.byId.get(CENTRAL_ID)!;
    return [a.pos, store.pos, b.pos];
  }
  const path: [number, number, number][] = [a.pos];
  const ra = a.kind === 'relay' || a.kind === 'ledger' ? a.id : memberRelay(topo, a.id);
  const rb = b.kind === 'relay' || b.kind === 'ledger' ? b.id : memberRelay(topo, b.id);
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
  } else if (ra) {
    path.push(topo.byId.get(ra)!.pos);
  }
  path.push(b.pos);
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
