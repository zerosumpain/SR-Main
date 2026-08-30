import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import SegmentsSection from './SegmentsSection.svelte';
import type { SegmentForms } from './types';

// `gapPct` on the gettable board is a FRACTION of the PB, straight off
// `segmentForm` — (recentBest − pb) / pb. Membership of the board requires it
// under GETTABLE_GAP_PCT (0.03), so a row can only ever hold 0.000…0.029, and
// rendering it as a percentage without the ×100 printed "gap 0.0%" on every
// row of the one positive panel on the page.
function forms(board: SegmentForms['board']): SegmentForms {
  return {
    gettable: board.length,
    improving: 11,
    withForm: 64,
    nearest: board.length ? { name: board[0].name, gapPct: board[0].gapPct } : null,
    taxonomy: { improving: 11, holding: 20, slipping: 33, noRead: 300, total: 364 },
    board,
  };
}

const row = (over: Partial<SegmentForms['board'][number]> = {}) => ({
  id: 1,
  name: 'living.matter.ground',
  activityType: 'Run',
  gapPct: 0.018,
  daysSincePb: 214,
  effortCount: 9,
  ...over,
});

const html = (segmentForms: SegmentForms | null) =>
  render(SegmentsSection, {
    props: { segmentForms, totals: { segments: 364, efforts: 6317 }, chains: [] },
  }).body;

describe('SegmentsSection — the gettable board', () => {
  it('prints the gap as a real percentage, not a rounded-to-nothing fraction', () => {
    const body = html(forms([row({ gapPct: 0.018 })]));
    expect(body).toContain('gap 1.8%');
    expect(body).not.toContain('gap 0.0%');
  });

  it('separates rows that the fraction rendering collapsed into one number', () => {
    // 0.4%, 1.8% and 2.9% all printed "gap 0.0%" before — three different
    // segments reading as identically far from their records.
    const body = html(
      forms([
        row({ id: 1, name: 'near.one', gapPct: 0.004 }),
        row({ id: 2, name: 'mid.one', gapPct: 0.018 }),
        row({ id: 3, name: 'far.one', gapPct: 0.029 }),
      ]),
    );
    expect(body).toContain('gap 0.4%');
    expect(body).toContain('gap 1.8%');
    expect(body).toContain('gap 2.9%');
  });

  it('never claims a gap wider than the 3% the board is defined by', () => {
    const body = html(
      forms([
        row({ id: 1, gapPct: 0.029 }),
        row({ id: 2, name: 'other.one', gapPct: 0.0005 }),
      ]),
    );
    for (const [, pct] of body.matchAll(/gap (\d+\.\d)%/g)) {
      expect(Number(pct)).toBeLessThan(3);
    }
  });

  it('keeps the rest of the row — the PB age and the effort count — intact', () => {
    const body = html(forms([row({ gapPct: 0.018, daysSincePb: 214, effortCount: 9 })]));
    expect(body).toContain('pb 214d');
    expect(body).toContain('9 efforts');
  });

  it('renders with nothing on the board and with no form read at all', () => {
    expect(() => html(forms([]))).not.toThrow();
    expect(() => html(null)).not.toThrow();
    expect(html(forms([]))).not.toContain('In range now');
  });
});
