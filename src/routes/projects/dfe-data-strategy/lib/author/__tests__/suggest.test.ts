// suggest.test.ts — the suggested-lines engine must produce clean, grounded prose for
// every section template, under any posture, with no leaked placeholders or NaNs.

import { describe, it, expect } from 'vitest';
import { suggestLines, type SuggestContext } from '../suggest';
import { SECTION_TEMPLATES } from '../templates';
import { defaultState, runAlignment } from '../../engine';
import { POSTURE_IDS } from '../../postures';
import type { StrategyState } from '../../types';

function ctxFor(state: StrategyState): SuggestContext {
  return { state, align: runAlignment(state), scenarioName: 'Test stance' };
}

const balanced = ctxFor(defaultState());

function leaned(v: number): SuggestContext {
  const s = defaultState();
  for (const id of POSTURE_IDS) s.postures[id] = v;
  return ctxFor(s);
}

const CONTEXTS: [string, SuggestContext][] = [
  ['balanced', balanced],
  ['left-leaning', leaned(-0.6)],
  ['right-leaning', leaned(0.6)],
];

describe('suggestLines', () => {
  for (const t of SECTION_TEMPLATES) {
    it(`produces at least one clean line for "${t.id}" under every posture`, () => {
      for (const [name, ctx] of CONTEXTS) {
        const lines = suggestLines(t.id, ctx);
        expect(lines.length, `${t.id} @ ${name}`).toBeGreaterThan(0);
        for (const l of lines) {
          expect(l.text.length, `${t.id}/${l.id} @ ${name}`).toBeGreaterThan(40);
          expect(l.text).not.toMatch(/undefined|NaN|\[object/);
          expect(l.text).not.toMatch(/<|>/); // plain prose; HTML wrapping happens at insert time
          expect(['diagnostic', 'framework']).toContain(l.source);
          expect(l.label.length).toBeGreaterThan(3);
        }
        // no duplicate ids within a section
        expect(new Set(lines.map((l) => l.id)).size).toBe(lines.length);
      }
    });
  }

  it('returns nothing for custom sections', () => {
    expect(suggestLines(null, balanced)).toEqual([]);
    expect(suggestLines('not-a-template', balanced)).toEqual([]);
  });

  it('quotes live diagnostic numbers', () => {
    const lines = suggestLines('vision', balanced);
    const diag = lines.find((l) => l.source === 'diagnostic');
    expect(diag?.text).toMatch(/\d+%/);
    expect(diag?.text).toContain('Test stance');
  });

  it('reacts to posture changes', () => {
    const a = suggestLines('architecture-platforms', leaned(-0.6)).map((l) => l.text).join(' ');
    const b = suggestLines('architecture-platforms', leaned(0.6)).map((l) => l.text).join(' ');
    expect(a).not.toEqual(b);
    expect(a).toMatch(/centralised/i);
    expect(b).toMatch(/federated/i);
  });
});
