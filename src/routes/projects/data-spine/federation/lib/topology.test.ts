import { describe, it, expect } from 'vitest';
import {
  buildTopology, routePath, schoolInfo, sampleSchools,
  SUPPLIERS, CONSUMERS, RELAY_COUNT, DEFAULT_SCHOOL_COUNT,
} from './topology';

describe('the synthetic market', () => {
  it('shares sum to 100% with three majors', () => {
    const total = SUPPLIERS.reduce((a, s) => a + s.sharePct, 0);
    expect(total).toBeCloseTo(100, 6);
    expect(SUPPLIERS.filter((s) => s.tier === 'major')).toHaveLength(3);
    expect(SUPPLIERS.length).toBeGreaterThanOrEqual(13); // 3 majors + 10-15 smaller
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
    const p = routePath(topo, 'con-dfe', 'sup-cedar', 'federated');
    expect(p.length).toBeGreaterThanOrEqual(3);
    expect(p[0]).toEqual(topo.byId.get('con-dfe')!.pos);
    expect(p[p.length - 1]).toEqual(topo.byId.get('sup-cedar')!.pos);
  });

  it('central: routes via the central store only', () => {
    const p = routePath(topo, 'con-dfe', 'sup-cedar', 'central');
    expect(p).toHaveLength(3);
    expect(p[1]).toEqual(topo.byId.get('central-store')!.pos);
  });

  it('routes to the ledger without a member edge', () => {
    const p = routePath(topo, 'sup-meridian', 'ledger', 'federated');
    expect(p[p.length - 1]).toEqual(topo.byId.get('ledger')!.pos);
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
    const picks = sampleSchools(topo, 'sup-beacon', 20);
    expect(picks.length).toBe(20);
    const si = topo.supplierIds.indexOf('sup-beacon');
    for (const i of picks) expect(topo.schools.supplier[i]).toBe(si);
  });
});
