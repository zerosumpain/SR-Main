import { describe, it, expect } from 'vitest';
import {
  buildTopology, routePath, schoolInfo, sampleSchools, supplierCounts,
  SUPPLIERS, CONSUMERS, STORES, EDTECH, RELAY_COUNT, DEFAULT_SCHOOL_COUNT,
  STATE_CENSUS_TOTAL, DFE_ID,
} from './topology';

describe('the MIS market', () => {
  it('has three majors and a real long tail, shares ≈100%', () => {
    const total = SUPPLIERS.reduce((a, s) => a + s.sharePct, 0);
    expect(total).toBeCloseTo(100, 0);
    expect(SUPPLIERS.filter((s) => s.tier === 'major')).toHaveLength(3);
    expect(SUPPLIERS.length).toBeGreaterThanOrEqual(13); // 3 majors + long tail
  });

  it('uses the real supplier names', () => {
    const labels = SUPPLIERS.map((s) => s.label);
    for (const expected of ['Arbor', 'ESS SIMS', 'Bromcom', 'ScholarPack']) {
      expect(labels).toContain(expected);
    }
  });

  it('carries real per-vendor census counts, drops the dead product, flags the long tail', () => {
    const byId = new Map(SUPPLIERS.map((s) => [s.id, s]));
    expect(byId.get('sup-arbor')!.schools).toBe(9677);
    expect(byId.get('sup-sims')!.schools).toBe(6897);
    expect(byId.get('sup-bromcom')!.schools).toBe(3493);
    // the top three carry ~92% of the tracked state estate
    expect((9677 + 6897 + 3493) / STATE_CENSUS_TOTAL).toBeGreaterThan(0.9);
    // Advanced/Progresso (EOL Aug 2023) has been removed
    expect(byId.has('sup-cloudschool')).toBe(false);
    // independent/EY/bespoke estates are flagged indicative; census vendors are not
    expect(byId.get('sup-famly')!.indicative).toBe(true);
    expect(byId.get('sup-arbor')!.indicative).toBeFalsy();
  });

  it('supplierCounts: 1 dot = 1 school at the default, exact + deterministic', () => {
    const counts = supplierCounts(DEFAULT_SCHOOL_COUNT);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(DEFAULT_SCHOOL_COUNT);
    SUPPLIERS.forEach((s, i) => expect(counts[i]).toBe(s.schools)); // exact real counts
    expect(counts).toEqual(supplierCounts(DEFAULT_SCHOOL_COUNT));
  });

  it('supplierCounts: scales proportionally + exactly at a reduced budget', () => {
    const counts = supplierCounts(8000);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(8000);
    expect(counts).toEqual(supplierCounts(8000));
    const maxIdx = counts.indexOf(Math.max(...counts));
    expect(SUPPLIERS[maxIdx].id).toBe('sup-arbor'); // still the largest cluster
  });
});

describe('buildTopology', () => {
  const topo = buildTopology();

  it('allocates exactly the requested school count across suppliers', () => {
    expect(topo.schools.count).toBe(DEFAULT_SCHOOL_COUNT);
    expect(topo.schools.positions.length).toBe(DEFAULT_SCHOOL_COUNT * 3);
    // offsets are increasing and contiguous
    for (let i = 1; i < topo.supplierIds.length; i++) {
      expect(topo.schools.offsets[i]).toBeGreaterThan(topo.schools.offsets[i - 1]);
    }
  });

  it('is deterministic', () => {
    const again = buildTopology();
    expect(Array.from(again.schools.positions.slice(0, 90))).toEqual(
      Array.from(topo.schools.positions.slice(0, 90)),
    );
    expect(again.nodes.map((n) => n.id)).toEqual(topo.nodes.map((n) => n.id));
  });

  it('has all node families present', () => {
    const kinds = (k: string) => topo.nodes.filter((n) => n.kind === k);
    expect(kinds('supplier')).toHaveLength(SUPPLIERS.length);
    expect(kinds('consumer')).toHaveLength(CONSUMERS.length);
    expect(kinds('relay')).toHaveLength(RELAY_COUNT);
    expect(kinds('store')).toHaveLength(STORES.length);
    expect(kinds('edtech')).toHaveLength(EDTECH.length);
    expect(topo.byId.get('ledger')).toBeDefined();
    expect(topo.byId.get('central-store')).toBeDefined();
  });

  it('connects every member to the ring and to the central counterfactual', () => {
    for (const n of topo.nodes) {
      if (n.kind !== 'supplier' && n.kind !== 'consumer') continue;
      expect(topo.edges.some((e) => e.kind === 'member' && e.from === n.id)).toBe(true);
      expect(topo.edges.some((e) => e.kind === 'central' && e.from === n.id)).toBe(true);
    }
    // the ring is closed
    expect(topo.edges.filter((e) => e.kind === 'ring')).toHaveLength(RELAY_COUNT);
  });

  it('hangs the satellite stores (NPD/LEO/ILR/LDS) off DfE', () => {
    expect(topo.storeIds).toEqual(['store-npd', 'store-leo', 'store-ilr', 'store-lds']);
    for (const id of topo.storeIds) {
      expect(topo.edges.some((e) => e.kind === 'satellite' && e.from === id && e.to === DFE_ID)).toBe(true);
    }
  });

  it('gives every edtech tendril a relay attachment', () => {
    expect(topo.edtechIds).toHaveLength(EDTECH.length);
    for (const id of topo.edtechIds) {
      const e = topo.edges.find((e) => e.kind === 'tendril' && e.from === id);
      expect(e, `${id} has no tendril edge`).toBeDefined();
      expect(topo.relayIds).toContain(e!.to);
    }
  });

  it('honours a reduced school count', () => {
    const small = buildTopology({ schoolCount: 8000 });
    expect(small.schools.count).toBe(8000);
    const sum = SUPPLIERS.length; // offsets still cover all suppliers
    expect(small.schools.offsets.length).toBe(sum);
  });
});

describe('routePath', () => {
  const topo = buildTopology({ schoolCount: 1000 });

  it('federated: routes member → ring → member with the endpoints intact', () => {
    const p = routePath(topo, 'con-dfe', 'sup-sims', 'federated');
    expect(p.length).toBeGreaterThanOrEqual(3);
    expect(p[0]).toEqual(topo.byId.get('con-dfe')!.pos);
    expect(p[p.length - 1]).toEqual(topo.byId.get('sup-sims')!.pos);
  });

  it('central: routes via the central store only', () => {
    const p = routePath(topo, 'con-dfe', 'sup-sims', 'central');
    expect(p).toHaveLength(3);
    expect(p[1]).toEqual(topo.byId.get('central-store')!.pos);
  });

  it('routes to the ledger without a member edge', () => {
    const p = routePath(topo, 'sup-arbor', 'ledger', 'federated');
    expect(p[p.length - 1]).toEqual(topo.byId.get('ledger')!.pos);
  });

  it('routes DfE ↔ satellite-store traffic directly, both directions', () => {
    expect(routePath(topo, 'store-npd', DFE_ID, 'federated')).toHaveLength(2);
    expect(routePath(topo, DFE_ID, 'store-npd', 'federated')).toHaveLength(2);
  });

  it('routes edtech tendrils via their relay', () => {
    const p = routePath(topo, 'edt-cpoms', 'sup-arbor', 'federated');
    expect(p.length).toBeGreaterThanOrEqual(3);
    expect(p[0]).toEqual(topo.byId.get('edt-cpoms')!.pos);
    expect(p[p.length - 1]).toEqual(topo.byId.get('sup-arbor')!.pos);
  });

  it('routes aggregator brokers via their relay', () => {
    expect(topo.aggregatorIds).toContain('agg-wonde');
    const p = routePath(topo, 'agg-wonde', 'sup-arbor', 'federated');
    expect(p.length).toBeGreaterThanOrEqual(3);
    expect(p[0]).toEqual(topo.byId.get('agg-wonde')!.pos);
    for (const id of topo.aggregatorIds) {
      const e = topo.edges.find((e) => e.kind === 'broker' && e.from === id);
      expect(e, `${id} has no broker edge`).toBeDefined();
      expect(topo.relayIds).toContain(e!.to);
    }
  });

  it('returns empty for unknown nodes', () => {
    expect(routePath(topo, 'nope', 'con-dfe', 'federated')).toEqual([]);
  });
});

describe('synthetic school records', () => {
  const topo = buildTopology({ schoolCount: 2000 });

  it('are deterministic and consistent with the field', () => {
    const a = schoolInfo(topo, 123);
    const b = schoolInfo(topo, 123);
    expect(a).toEqual(b);
    expect(a.supplierId).toBe(SUPPLIERS[topo.schools.supplier[123]].id);
    expect(a.pupils).toBeGreaterThan(0);
  });

  it('samples schools belonging to the right supplier', () => {
    const picks = sampleSchools(topo, 'sup-bromcom', 20);
    expect(picks.length).toBe(20);
    const si = topo.supplierIds.indexOf('sup-bromcom');
    for (const i of picks) expect(topo.schools.supplier[i]).toBe(si);
  });
});
