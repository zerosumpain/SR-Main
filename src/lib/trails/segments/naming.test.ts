import { describe, it, expect } from 'vitest';
import { segmentSeed, segmentName, segmentDescriptor, WORDLISTS } from './naming';

const line = (n: number, offset = 0): Array<[number, number, number | null, number]> =>
  Array.from({ length: n }, (_, i) => [-1.5 + (i + offset) * 0.0002, 53 + offset * 0.0002, null, i * 10]);

describe('wordlists', () => {
  it('has no repeated word within a list', () => {
    for (const [name, list] of Object.entries(WORDLISTS)) {
      expect(new Set(list).size, name).toBe(list.length);
    }
  });

  it('is large enough that names do not routinely collide', () => {
    const combinations =
      WORDLISTS.LIVING.length * WORDLISTS.MATTER.length * WORDLISTS.GROUND.length;
    expect(combinations).toBeGreaterThan(1_000_000);
  });

  it('uses only lowercase letters, so a name is safe in a URL', () => {
    for (const list of Object.values(WORDLISTS)) {
      for (const word of list) expect(word).toMatch(/^[a-z-]+$/);
    }
  });
});

describe('segmentName', () => {
  it('gives the same stretch the same name every time', () => {
    const seed = segmentSeed(line(60));
    expect(segmentName(seed)).toBe(segmentName(seed));
  });

  it('reads as three words separated by dots', () => {
    const name = segmentName(segmentSeed(line(60)));
    expect(name.split('.')).toHaveLength(3);
    expect(name).toMatch(/^[a-z-]+\.[a-z-]+\.[a-z-]+$/);
  });

  it('gives different stretches different names', () => {
    const names = new Set(
      Array.from({ length: 200 }, (_, i) => segmentName(segmentSeed(line(60, i * 7)))),
    );
    // A handful of collisions across 200 would still be tolerable; a hash that
    // is not spreading at all would show up as a tiny set.
    expect(names.size).toBeGreaterThan(195);
  });

  it('never hands out a name already taken', () => {
    const seed = segmentSeed(line(60));
    const first = segmentName(seed);
    const second = segmentName(seed, new Set([first]));
    expect(second).not.toBe(first);
    expect(second.split('.')).toHaveLength(3);
  });

  it('survives a seed whose whole neighbourhood is taken', () => {
    const seed = segmentSeed(line(60));
    const taken = new Set<string>();
    for (let i = 0; i < 12; i++) taken.add(segmentName(seed, taken));
    expect(taken.size).toBe(12);
  });
});

describe('segmentSeed', () => {
  it('ignores a shift smaller than the match tolerance', () => {
    const a = line(60);
    const b = a.map(([lng, lat, ele, d]) => [lng + 0.00001, lat, ele, d]) as typeof a;
    expect(segmentSeed(b)).toBe(segmentSeed(a));
  });

  it('separates stretches that are genuinely elsewhere', () => {
    expect(segmentSeed(line(60, 50))).not.toBe(segmentSeed(line(60)));
  });
});

describe('segmentDescriptor', () => {
  it('calls a net climb a climb', () => {
    expect(
      segmentDescriptor({ distanceM: 1200, elevationGainM: 52, elevationLossM: 4, effortCount: 9 }),
    ).toBe('1.20 km · +48 m climb · 9 efforts');
  });

  it('calls a net drop a descent', () => {
    expect(
      segmentDescriptor({ distanceM: 680, elevationGainM: 3, elevationLossM: 61, effortCount: 24 }),
    ).toContain('−58 m descent');
  });

  it('calls level ground flat, whatever the jitter says', () => {
    expect(
      segmentDescriptor({ distanceM: 680, elevationGainM: 8, elevationLossM: 9, effortCount: 2 }),
    ).toBe('0.68 km · flat · 2 efforts');
  });

  it('calls a stretch that climbs and gives it all back rolling', () => {
    expect(
      segmentDescriptor({ distanceM: 900, elevationGainM: 70, elevationLossM: 66, effortCount: 3 }),
    ).toContain('rolling');
  });

  it('says one effort, not one efforts', () => {
    expect(
      segmentDescriptor({ distanceM: 500, elevationGainM: 0, elevationLossM: 0, effortCount: 1 }),
    ).toMatch(/1 effort$/);
  });
});
