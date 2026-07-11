import { describe, it, expect } from 'vitest';
import {
  buildTopology, routePath, schoolInfo, sampleSchools, supplierCounts,
  SUPPLIERS, CONSUMERS, STORES, EDTECH, RELAY_COUNT, DEFAULT_SCHOOL_COUNT,
  DFE_ID, RECORD_ID,
} from './topology';

describe('the MIS market', () => {
  it('shares sum to 100% with three majors', () => {
    const total = SUPPLIERS.reduce((a, s) => a + s.sharePct, 0);
    expect(total).toBeCloseTo(100, 6);
    expect(SUPPLIERS.filter((s) => s.tier === 'major')).toHaveLength(3);
    expect(SUPPLIERS.length).toBeGreaterThanOrEqual(13); // 3 majors + 10-15 smaller
  });

  it('uses the real supplier names', () => {
    const labels = SUPPLIERS.map((s) => s.label);
    for (const expected of ['Arbor', 'ESS SIMS', 'Bromcom', 'ScholarPack']) {
      expect(labels).toContain(expected);
    }
  });

  it('supplierCounts allocates exactly and deterministically', () => {
    const counts = supplierCounts(DEFAULT_SCHOOL_COUNT);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(DEFAULT_SCHOOL_COUNT);
    expect(counts).toEqual(supplierCounts(DEFAULT_SCHOOL_COUNT));
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

  it('brokers the Education Record through DfE', () => {
    const memberEdge = topo.edges.find((e) => e.kind === 'member' && e.from === RECORD_ID);
    expect(memberEdge?.to).toBe(DFE_ID);
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

  it('routes Education Record traffic through the DfE gateway', () => {
    const p = routePath(topo, RECORD_ID, 'sup-arbor', 'federated');
    expect(p[0]).toEqual(topo.byId.get(RECORD_ID)!.pos);
    expect(p[1]).toEqual(topo.byId.get(DFE_ID)!.pos); // brokered hop
    expect(p[p.length - 1]).toEqual(topo.byId.get('sup-arbor')!.pos);
    // and the broker hop never transits the ring, in either direction
    expect(routePath(topo, RECORD_ID, DFE_ID, 'federated')).toHaveLength(2);
    expect(routePath(topo, DFE_ID, RECORD_ID, 'federated')).toHaveLength(2);
  });

  it('routes DfE ↔ satellite-store traffic directly, both directions', () => {
    expect(routePath(topo, 'store-npd', DFE_ID, 'federated')).toHaveLength(2);
    expect(routePath(topo, DFE_ID, 'store-npd', 'federated')).toHaveLength(2);
  });

  it('routes edtech tendrils via their relay', () => {
    const p = routePath(topo, 'edt-wonde', 'sup-arbor', 'federated');
    expect(p.length).toBeGreaterThanOrEqual(3);
    expect(p[0]).toEqual(topo.byId.get('edt-wonde')!.pos);
    expect(p[p.length - 1]).toEqual(topo.byId.get('sup-arbor')!.pos);
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
