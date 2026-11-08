import { describe, expect, it } from 'vitest';
import { fromBase64, rleDecode, rleEncode, toBase64 } from './codec';
import { h32 } from './rand';
import {
  CENTRAL_PARCELS,
  TILES,
  decodePlanes,
  emptyPlanes,
  encodePlanes,
  lvlLevel,
  lvlStyle,
  lvlTier,
  makeLvl,
  openableParcels,
  pairGet,
  pairSet,
  useCat,
  usePayload,
  zoneUse,
  buildingUse,
  roadUse,
  CAT_ZONE,
  CAT_BUILDING,
  CAT_ROAD,
} from './tiles';

const bytes = (n: number, seed: number, runs = false) => {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = runs ? (h32(seed, 1, i >> 5) & 3) : h32(seed, 1, i) & 255;
  return out;
};

describe('codecs', () => {
  it('base64 round-trips every length', () => {
    for (let n = 0; n < 40; n++) {
      const b = bytes(n, n);
      expect(fromBase64(toBase64(b))).toEqual(b);
    }
  });

  it('RLE round-trips random bytes, long runs and the edge cases', () => {
    for (const b of [bytes(5000, 1), bytes(5000, 2, true), new Uint8Array(4096), Uint8Array.from([1, 1]), Uint8Array.from([7]), new Uint8Array(0), Uint8Array.from([1, 2, 2, 2, 3, 3, 4, 4, 4, 4])]) {
      expect(rleDecode(rleEncode(b), b.length)).toEqual(b);
    }
    // An empty map compresses to almost nothing.
    expect(rleEncode(new Uint8Array(16384)).length).toBeLessThan(260);
  });

  it('the tile codec round-trips random planes', () => {
    for (let s = 0; s < 5; s++) {
      const p = emptyPlanes();
      for (let i = 0; i < TILES; i++) {
        const r = h32(s, 2, i);
        if (r % 3 === 0) p.use[i] = r & 0xffff;
        p.lvl[i] = (r >>> 8) & 255;
        p.age[i] = (r >>> 16) % 7 === 0 ? (r >>> 24) & 255 : 0;
      }
      const q = decodePlanes(encodePlanes(p));
      expect(q.use).toEqual(p.use);
      expect(q.lvl).toEqual(p.lvl);
      expect(q.age).toEqual(p.age);
    }
  });
});

describe('tile encodings', () => {
  it('use and lvl pack and unpack', () => {
    expect(useCat(zoneUse(3))).toBe(CAT_ZONE);
    expect(usePayload(zoneUse(3))).toBe(3);
    expect(useCat(buildingUse(4000))).toBe(CAT_BUILDING);
    expect(usePayload(buildingUse(4000))).toBe(4000);
    expect(useCat(roadUse(2))).toBe(CAT_ROAD);
    const l = makeLvl(5, 2, 7);
    expect([lvlLevel(l), lvlTier(l), lvlStyle(l)]).toEqual([5, 2, 7]);
  });

  it('sparse pair lists stay sorted and drop zeros', () => {
    const l: number[] = [];
    pairSet(l, 50, 3);
    pairSet(l, 10, 2);
    pairSet(l, 30, 1);
    expect(l).toEqual([10, 2, 30, 1, 50, 3]);
    pairSet(l, 30, 0);
    expect(l).toEqual([10, 2, 50, 3]);
    expect(pairGet(l, 50)).toBe(3);
    expect(pairGet(l, 99)).toBe(0);
  });

  it('only parcels next to open land can be surveyed', () => {
    const next = openableParcels(CENTRAL_PARCELS);
    expect(next.sort((a, b) => a - b)).toEqual([1, 2, 4, 7, 8, 11, 13, 14]);
  });
});
