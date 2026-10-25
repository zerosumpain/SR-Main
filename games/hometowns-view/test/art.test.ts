// The procedural art (WP8, spec §9.7, §9.15): every advisor in every
// expression, every mayor avatar and every flag draws a small, well-formed,
// self-contained SVG, the same on every call, with ids that match the copy
// file. Self-contained matters twice: the page makes no network calls, and
// an SVG that pointed at a URL would be an asset we had not licensed.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// The copy module is not re-exported through src/engine.ts yet, so the lists come from the engine file itself.
import { AVATARS, EXPRESSIONS, FLAG_COUNT, COPY } from '../../../src/lib/games/hometowns/engine/copy';
import { ADVISOR_IDS, AVATAR_IDS, EXPRESSION_IDS, FLAG_COLOURS, advisorPortrait, allArt, flagPennant, mayorAvatar } from '../src/art/portraits';

/** Tags balance and nest: a small check in place of an XML parser (the test runs in plain Node). */
function wellFormed(svg: string): boolean {
  const stack: string[] = [];
  for (const m of svg.matchAll(/<(\/?)([A-Za-z]+)([^>]*?)(\/?)>/g)) {
    const [, close, name, , self] = m;
    if (self) continue;
    if (close) {
      if (stack.pop() !== name) return false;
    } else stack.push(name);
  }
  return stack.length === 0 && svg.startsWith('<svg ') && svg.endsWith('</svg>');
}

describe('procedural art', () => {
  const art = allArt();

  it('draws every advisor, expression, avatar and flag the copy names', () => {
    expect([...EXPRESSION_IDS]).toEqual([...EXPRESSIONS]);
    expect([...AVATAR_IDS]).toEqual([...AVATARS]);
    expect(FLAG_COLOURS).toHaveLength(FLAG_COUNT);
    for (const a of ADVISOR_IDS) expect(COPY[`advisorName.${a}`]).toBeDefined();
    expect(Object.keys(art)).toHaveLength(ADVISOR_IDS.length * EXPRESSION_IDS.length + AVATAR_IDS.length + FLAG_COLOURS.length);
  });

  it('makes small, well-formed, self-contained SVGs', () => {
    let total = 0;
    for (const [name, svg] of Object.entries(art)) {
      expect(wellFormed(svg), name).toBe(true);
      expect(svg, name).toMatch(/viewBox="0 0 (128 128|64 64)"/);
      expect(svg, name).not.toMatch(/<script|<image|<foreignObject|href=|url\(|\son[a-z]+=|NaN|undefined/i);
      expect(svg.length, name).toBeLessThan(6000);
      total += svg.length;
    }
    // The whole set is a rounding error next to the 3 MB atlas budget (§9.15).
    expect(total).toBeLessThan(120_000);
  });

  it('draws the same thing every time, and each expression differently', () => {
    expect(allArt()).toEqual(art);
    for (const a of ADVISOR_IDS) expect(new Set(EXPRESSION_IDS.map((e) => advisorPortrait(a, e))).size).toBe(EXPRESSION_IDS.length);
  });

  it('dresses a mayor in the town’s flag colour', () => {
    expect(mayorAvatar('fox', 3)).toContain(FLAG_COLOURS[3]);
    expect(mayorAvatar('fox', 3 + FLAG_COLOURS.length)).toBe(mayorAvatar('fox', 3));
    expect(flagPennant(-1)).toContain(FLAG_COLOURS[FLAG_COLOURS.length - 1]);
  });

  it('records the art’s licence', () => {
    const text = readFileSync(new URL('../src/art/ATTRIBUTION.md', import.meta.url), 'utf8');
    expect(text).toContain('portraits.ts');
    expect(text).toMatch(/original/i);
  });
});
