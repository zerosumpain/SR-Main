import { describe, it, expect } from 'vitest';
import {
  MAX_SHARPENED_CHARS,
  applyAdversary,
  renderForAdversary,
  validateAdversary,
} from './adversary';
import type { FactPack } from './pack';

function packOf(ids: string[]): FactPack {
  const cards = ids.map((id) => ({ id, ref: { kind: 'test', id }, tense: 'past', text: `card ${id}` }));
  return { cards, byId: new Map(cards.map((c) => [c.id, c])) };
}

const PACK = packOf(['F1', 'F2', 'F3']);
const SLUGS = new Set(['a-musing', 'b-musing']);

describe('validateAdversary', () => {
  it('accepts a plain stands', () => {
    const r = validateAdversary({ verdicts: [{ slug: 'a-musing', verdict: 'stands', reason: 'fine' }] }, PACK, SLUGS);
    expect(r.rulings).toEqual([{ slug: 'a-musing', verdict: 'stands', reason: 'fine' }]);
    expect(r.rejected).toEqual([]);
  });

  it('accepts a drop that names its evidence', () => {
    const r = validateAdversary(
      { verdicts: [{ slug: 'a-musing', verdict: 'drop', reason: 'F2 already says this is handled' }] },
      PACK,
      SLUGS,
    );
    expect(r.rulings[0].verdict).toBe('drop');
  });

  it('refuses a drop with no reason and keeps the original', () => {
    // Overturning a musing that already passed the citation audit has to cost
    // a sentence, or the second pass is just an opinion with a veto.
    const r = validateAdversary({ verdicts: [{ slug: 'a-musing', verdict: 'drop', reason: '' }] }, PACK, SLUGS);
    expect(r.rulings[0].verdict).toBe('stands');
    expect(r.rejected[0]).toContain('drop with no reason');
  });

  it('accepts a sharpen that cites the pack', () => {
    const r = validateAdversary(
      { verdicts: [{ slug: 'a-musing', verdict: 'sharpen', reason: 'tighter', text: 'A sharper reading of it.', cites: ['F1'] }] },
      PACK,
      SLUGS,
    );
    expect(r.rulings[0]).toMatchObject({ verdict: 'sharpen', text: 'A sharper reading of it.', cites: ['F1'] });
  });

  it('tolerates bracketed citations in a sharpen, like every other audit here', () => {
    const r = validateAdversary(
      { verdicts: [{ slug: 'a-musing', verdict: 'sharpen', reason: 'x', text: 'A sharper reading of it.', cites: ['[F1]'] }] },
      PACK,
      SLUGS,
    );
    expect(r.rulings[0].cites).toEqual(['F1']);
  });

  it('keeps the original when a sharpen cites a card that does not exist', () => {
    const r = validateAdversary(
      { verdicts: [{ slug: 'a-musing', verdict: 'sharpen', reason: 'x', text: 'A sharper reading of it.', cites: ['F9'] }] },
      PACK,
      SLUGS,
    );
    expect(r.rulings[0].verdict).toBe('stands');
    expect(r.rejected[0]).toContain('unknown cards F9');
  });

  it('keeps the original when a sharpen cites nothing', () => {
    const r = validateAdversary(
      { verdicts: [{ slug: 'a-musing', verdict: 'sharpen', reason: 'x', text: 'A sharper reading of it.', cites: [] }] },
      PACK,
      SLUGS,
    );
    expect(r.rulings[0].verdict).toBe('stands');
  });

  it('keeps the original when a sharpen runs long', () => {
    const r = validateAdversary(
      { verdicts: [{ slug: 'a-musing', verdict: 'sharpen', reason: 'x', text: 'y'.repeat(MAX_SHARPENED_CHARS + 1), cites: ['F1'] }] },
      PACK,
      SLUGS,
    );
    expect(r.rulings[0].verdict).toBe('stands');
  });

  it('will not rule on a musing it was not given', () => {
    const r = validateAdversary({ verdicts: [{ slug: 'invented', verdict: 'drop', reason: 'no' }] }, PACK, SLUGS);
    expect(r.rulings).toEqual([]);
    expect(r.rejected[0]).toContain('unknown musing');
  });

  it('ignores a second ruling on the same musing', () => {
    const r = validateAdversary(
      {
        verdicts: [
          { slug: 'a-musing', verdict: 'stands', reason: '' },
          { slug: 'a-musing', verdict: 'drop', reason: 'changed my mind' },
        ],
      },
      PACK,
      SLUGS,
    );
    expect(r.rulings).toHaveLength(1);
    expect(r.rulings[0].verdict).toBe('stands');
  });

  it('rejects an unknown verdict rather than guessing', () => {
    const r = validateAdversary({ verdicts: [{ slug: 'a-musing', verdict: 'maybe', reason: '' }] }, PACK, SLUGS);
    expect(r.rulings).toEqual([]);
    expect(r.rejected[0]).toContain('unknown verdict');
  });

  it('survives junk', () => {
    expect(validateAdversary(null, PACK, SLUGS).rejected).toHaveLength(1);
    expect(validateAdversary({}, PACK, SLUGS).rulings).toEqual([]);
  });
});

describe('applyAdversary', () => {
  const musings = [{ slug: 'a-musing' }, { slug: 'b-musing' }];

  it('keeps everything when the adversary says nothing', () => {
    // Silence must never delete something the first audit admitted.
    const r = applyAdversary(musings, []);
    expect(r.kept).toHaveLength(2);
    expect(r.dropped).toEqual([]);
  });

  it('removes a dropped musing and records why', () => {
    const r = applyAdversary(musings, [{ slug: 'a-musing', verdict: 'drop', reason: 'restates F1' }]);
    expect(r.kept.map((m) => m.slug)).toEqual(['b-musing']);
    expect(r.dropped[0]).toContain('restates F1');
  });

  it('carries a sharpened text through on the kept musing', () => {
    const r = applyAdversary(musings, [
      { slug: 'b-musing', verdict: 'sharpen', reason: '', text: 'better', cites: ['F1'] },
    ]);
    expect(r.sharpened).toEqual(['b-musing']);
    expect(r.kept.find((m) => m.slug === 'b-musing')?.sharpenedText).toBe('better');
  });
});

describe('renderForAdversary', () => {
  it('names each musing by its slug so a ruling can address it', () => {
    const s = renderForAdversary([{ slug: 'a-musing', title: 'T', text: 'x', cites: ['F1', 'F2'] }]);
    expect(s).toContain('SLUG a-musing');
    expect(s).toContain('F1, F2');
  });
});
