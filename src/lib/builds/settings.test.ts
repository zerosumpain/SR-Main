import { describe, it, expect } from 'vitest';
import { sanitiseBuildPatch, BUDGET_FIELDS, THINKING_LEVELS, RESEARCH_MODE_OPTIONS } from './settings';

describe('sanitiseBuildPatch', () => {
  it('drops keys that are not on the allow-list', () => {
    const out = sanitiseBuildPatch({ status: 'completed', tokensUsed: 0, prompt: 'x' });
    expect(out).toEqual({});
  });

  it('accepts the fields BuildSidebar has always sent', () => {
    expect(
      sanitiseBuildPatch({
        thinkingLevel: 'high',
        enforceDesignSystem: false,
        requireIterationApproval: true,
      }),
    ).toEqual({
      thinkingLevel: 'high',
      enforceDesignSystem: false,
      requireIterationApproval: true,
    });
  });

  it('rejects a thinking level outside the known set', () => {
    // Was 'ultra', which became a real rung when Astra landed. Pick something
    // that cannot plausibly be added later.
    expect(sanitiseBuildPatch({ thinkingLevel: 'ludicrous' })).toEqual({});
  });

  it('coerces the two booleans rather than requiring real booleans', () => {
    // The checkboxes send real booleans, but the chat tool bridge stringifies
    // tool arguments at any depth — coerce, never reject.
    expect(sanitiseBuildPatch({ enforceDesignSystem: 'false' })).toEqual({
      enforceDesignSystem: true,
    });
    expect(sanitiseBuildPatch({ enforceDesignSystem: 0 })).toEqual({
      enforceDesignSystem: false,
    });
  });

  describe('budgetConfig', () => {
    it('keeps only known numeric keys and drops the rest', () => {
      const out = sanitiseBuildPatch({
        budgetConfig: { maxIterations: 30, nonsense: 5, maxCostUsd: 12.5 },
      });
      expect(out.budgetConfig).toEqual({ maxIterations: 30, maxCostUsd: 12.5 });
    });

    it('accepts numeric strings — the tool bridge stringifies arguments', () => {
      const out = sanitiseBuildPatch({ budgetConfig: { maxIterations: '30' } });
      expect(out.budgetConfig).toEqual({ maxIterations: 30 });
    });

    it('clamps a value above its ceiling instead of rejecting the whole patch', () => {
      const cap = BUDGET_FIELDS.find((f) => f.key === 'maxIterations')!.max;
      const out = sanitiseBuildPatch({ budgetConfig: { maxIterations: cap + 1000 } });
      expect(out.budgetConfig).toEqual({ maxIterations: cap });
    });

    it('clamps a negative value to the floor', () => {
      const out = sanitiseBuildPatch({ budgetConfig: { maxCostUsd: -5 } });
      const floor = BUDGET_FIELDS.find((f) => f.key === 'maxCostUsd')!.min;
      expect(out.budgetConfig).toEqual({ maxCostUsd: floor });
    });

    it('never stores a cost cap of 0 — checkBudget reads 0 as "no cap"', () => {
      // `if (config.maxCostUsd)` in budget.ts is falsy at 0, so a stored 0 lifts
      // the only cash guardrail while the UI displays a cap of £0.
      const out = sanitiseBuildPatch({ budgetConfig: { maxCostUsd: 0 } });
      expect(out.budgetConfig!.maxCostUsd).toBeGreaterThan(0);
    });

    it('the idle breaker is the one cap that legitimately accepts 0 (= off)', () => {
      expect(sanitiseBuildPatch({ budgetConfig: { maxIdleIterations: 0 } }).budgetConfig).toEqual({
        maxIdleIterations: 0,
      });
    });

    it('refuses to null the idle breaker, which is not nullable', () => {
      expect(sanitiseBuildPatch({ budgetConfig: { maxIdleIterations: null } })).toEqual({});
    });

    it('drops NaN and non-finite values entirely', () => {
      const out = sanitiseBuildPatch({
        budgetConfig: { maxIterations: 'abc', maxCostUsd: Infinity, maxTotalMinutes: 60 },
      });
      expect(out.budgetConfig).toEqual({ maxTotalMinutes: 60 });
    });

    it('treats null as "remove the cap" and preserves it', () => {
      const out = sanitiseBuildPatch({ budgetConfig: { maxTokensPerHour: null } });
      expect(out.budgetConfig).toEqual({ maxTokensPerHour: null });
    });

    it('ignores a budgetConfig that is not an object', () => {
      expect(sanitiseBuildPatch({ budgetConfig: 'lots' })).toEqual({});
      expect(sanitiseBuildPatch({ budgetConfig: [1, 2] })).toEqual({});
    });

    it('drops an empty budget object rather than writing {} over the config', () => {
      expect(sanitiseBuildPatch({ budgetConfig: { bogus: 1 } })).toEqual({});
    });
  });

  describe('enabledToolsets', () => {
    it('keeps string entries only', () => {
      expect(sanitiseBuildPatch({ enabledToolsets: ['builds', 7, 'web'] }).enabledToolsets).toEqual([
        'builds',
        'web',
      ]);
    });

    it('accepts an empty list — that is a meaningful choice, not a no-op', () => {
      expect(sanitiseBuildPatch({ enabledToolsets: [] }).enabledToolsets).toEqual([]);
    });

    it('de-duplicates', () => {
      expect(
        sanitiseBuildPatch({ enabledToolsets: ['web', 'web', 'builds'] }).enabledToolsets,
      ).toEqual(['web', 'builds']);
    });
  });

  describe('researchMode', () => {
    it('accepts the three known modes', () => {
      for (const m of RESEARCH_MODE_OPTIONS) {
        expect(sanitiseBuildPatch({ researchMode: m.value }).researchMode).toBe(m.value);
      }
    });
    it('rejects anything else', () => {
      expect(sanitiseBuildPatch({ researchMode: 'deep' })).toEqual({});
    });
  });

  describe('chapterPlan', () => {
    it('normalises a well-formed spine', () => {
      const out = sanitiseBuildPatch({
        chapterPlan: [{ n: 1, title: 'Why funding differs', leverId: 'lv-a', outcomeId: 'oc-a' }],
      });
      expect(out.chapterPlan).toEqual([
        { n: 1, title: 'Why funding differs', leverId: 'lv-a', outcomeId: 'oc-a' },
      ]);
    });

    it('renumbers sequentially from 1 so the gate cannot be handed a gap', () => {
      const out = sanitiseBuildPatch({
        chapterPlan: [
          { n: 5, title: 'a', leverId: 'l1', outcomeId: 'o1' },
          { n: 9, title: 'b', leverId: 'l2', outcomeId: 'o2' },
        ],
      });
      expect(out.chapterPlan?.map((c) => c.n)).toEqual([1, 2]);
    });

    it('drops a chapter with no title — it cannot be built or checked', () => {
      const out = sanitiseBuildPatch({
        chapterPlan: [
          { n: 1, title: '  ', leverId: 'l1', outcomeId: 'o1' },
          { n: 2, title: 'real', leverId: 'l2', outcomeId: 'o2' },
        ],
      });
      expect(out.chapterPlan).toHaveLength(1);
      expect(out.chapterPlan?.[0].title).toBe('real');
    });

    it('keeps a chapter with empty lever/outcome ids but blanks them consistently', () => {
      // An undeclared pair is legal (the gate reports it as uncheckable) —
      // silently inventing ids would be worse.
      const out = sanitiseBuildPatch({
        chapterPlan: [{ n: 1, title: 'draft', leverId: '', outcomeId: undefined }],
      });
      expect(out.chapterPlan).toEqual([{ n: 1, title: 'draft', leverId: '', outcomeId: '' }]);
    });

    it('accepts an empty spine — clearing it is how you disable chapter checks', () => {
      expect(sanitiseBuildPatch({ chapterPlan: [] }).chapterPlan).toEqual([]);
    });

    it('ignores a chapterPlan that is not an array', () => {
      expect(sanitiseBuildPatch({ chapterPlan: { n: 1 } })).toEqual({});
    });

    it('caps the spine so a bad payload cannot write thousands of rows', () => {
      const many = Array.from({ length: 200 }, (_, i) => ({
        n: i + 1,
        title: `c${i}`,
        leverId: 'l',
        outcomeId: 'o',
      }));
      expect(sanitiseBuildPatch({ chapterPlan: many }).chapterPlan).toHaveLength(50);
    });
  });

  describe('model', () => {
    it('accepts a non-empty provider and id', () => {
      expect(sanitiseBuildPatch({ modelProvider: 'openrouter', modelId: 'x/y' })).toEqual({
        modelProvider: 'openrouter',
        modelId: 'x/y',
      });
    });
    it('rejects an empty model id', () => {
      expect(sanitiseBuildPatch({ modelId: '   ' })).toEqual({});
    });
  });

  describe('title', () => {
    it('trims and accepts', () => {
      expect(sanitiseBuildPatch({ title: '  Pay explainer  ' }).title).toBe('Pay explainer');
    });
    it('truncates rather than rejecting an over-long title', () => {
      const out = sanitiseBuildPatch({ title: 'x'.repeat(500) });
      expect(out.title).toHaveLength(200);
    });
    it('rejects an empty title — a build with no title falls back to its prompt', () => {
      expect(sanitiseBuildPatch({ title: '   ' })).toEqual({});
    });
  });
});

describe('catalogue metadata', () => {
  it('every budget field has a label, help text and a sane range', () => {
    for (const f of BUDGET_FIELDS) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.help.length).toBeGreaterThan(0);
      expect(f.min).toBeLessThan(f.max);
    }
  });

  it('thinking levels match the set the PATCH route accepts', () => {
    for (const lv of THINKING_LEVELS) {
      expect(sanitiseBuildPatch({ thinkingLevel: lv }).thinkingLevel).toBe(lv);
    }
  });
});
