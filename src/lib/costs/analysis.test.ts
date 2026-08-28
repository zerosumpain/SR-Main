import { describe, it, expect } from 'vitest';
import {
  pricePerMTokens,
  projectedCost,
  findSwaps,
  findWaste,
  describeMix,
  reconcile,
  type CatalogueModel,
  type SpendGroup,
} from './analysis';

const model = (over: Partial<CatalogueModel> & { id: string }): CatalogueModel => ({
  name: over.id,
  promptPrice: 0.000001,
  completionPrice: 0.000002,
  toolsSupported: true,
  agenticIndex: 50,
  contextLength: 128_000,
  modality: 'text->text',
  ...over,
});

const group = (over: Partial<SpendGroup> = {}): SpendGroup => ({
  activity: 'extraction',
  source: 'gateway',
  provider: 'openrouter',
  model: 'a/current',
  calls: 10,
  tokensIn: 900_000,
  tokensOut: 100_000,
  costUsd: 1.1,
  unpricedCalls: 0,
  ...over,
});

const labels = new Map([['extraction', 'Entity extraction']]);
/** An activity with no declared capability requirement. */
const noReq = () => null;

describe('pricePerMTokens', () => {
  it('weights the two price columns by the ACTUAL mix, not a nominal 3:1', () => {
    const m = model({ id: 'x', promptPrice: 0.000001, completionPrice: 0.00001 });
    // 90% input → dominated by the cheap column.
    expect(pricePerMTokens(m, 900_000, 100_000)).toBeCloseTo(1 * 0.9 + 10 * 0.1, 6);
    // 10% input → dominated by the dear one.
    expect(pricePerMTokens(m, 100_000, 900_000)).toBeCloseTo(1 * 0.1 + 10 * 0.9, 6);
  });

  it('is null rather than half-priced when a price column is missing', () => {
    expect(pricePerMTokens(model({ id: 'x', completionPrice: null }), 10, 10)).toBeNull();
  });

  it("treats OpenRouter's -1 variable-pricing sentinel as unpriced", () => {
    expect(pricePerMTokens(model({ id: 'x', promptPrice: -1 }), 10, 10)).toBeNull();
    expect(projectedCost(model({ id: 'x', completionPrice: -1 }), 10, 10)).toBeNull();
  });
});

describe('findSwaps', () => {
  const current = model({ id: 'a/current', promptPrice: 0.000001, completionPrice: 0.000002, agenticIndex: 50 });

  it('proposes the cheapest model that is at least as good', () => {
    const catalogue = [
      current,
      model({ id: 'b/cheap-good', promptPrice: 0.0000002, completionPrice: 0.0000004, agenticIndex: 52 }),
      model({ id: 'c/cheapest-worse', promptPrice: 0.00000001, completionPrice: 0.00000002, agenticIndex: 30 }),
    ];
    const [s, ...rest] = findSwaps([group()], catalogue, labels, noReq);
    expect(rest).toHaveLength(0);
    expect(s.candidateModelId).toBe('b/cheap-good');
    // 900k in @ 1e-6 + 100k out @ 2e-6 = 1.1 → candidate is a fifth of that.
    expect(s.currentCostUsd).toBeCloseTo(1.1, 6);
    expect(s.projectedCostUsd).toBeCloseTo(0.22, 6);
    expect(s.savingShare).toBeCloseTo(0.8, 6);
  });

  it('never proposes an unrated model, however cheap', () => {
    const catalogue = [
      current,
      model({ id: 'z/unrated', promptPrice: 0, completionPrice: 0, agenticIndex: null }),
    ];
    expect(findSwaps([group()], catalogue, labels, noReq)).toEqual([]);
  });

  it('will not drop a tool-capable role onto a model without tools', () => {
    const catalogue = [
      current,
      model({ id: 'b/no-tools', promptPrice: 1e-9, completionPrice: 1e-9, agenticIndex: 90, toolsSupported: false }),
    ];
    expect(findSwaps([group()], catalogue, labels, () => 'tools')).toEqual([]);
  });

  it('will not offer a text-only model to a role that must read images', () => {
    const visionNow = model({
      id: 'a/current',
      promptPrice: 0.000001,
      completionPrice: 0.000002,
      agenticIndex: 50,
      modality: 'text+image->text',
    });
    const catalogue = [
      visionNow,
      model({ id: 'b/text-only', promptPrice: 1e-9, completionPrice: 1e-9, agenticIndex: 80, modality: 'text->text' }),
    ];
    // The save guard would refuse this pick; recommending it would be advice
    // the page itself will not carry out.
    expect(findSwaps([group({ activity: 'vision' })], catalogue, labels, () => 'image-input')).toEqual([]);

    const withSight = [
      visionNow,
      model({ id: 'b/sighted', promptPrice: 1e-9, completionPrice: 1e-9, agenticIndex: 80, modality: 'text+image->text' }),
    ];
    expect(
      findSwaps([group({ activity: 'vision' })], withSight, labels, () => 'image-input')[0].candidateModelId,
    ).toBe('b/sighted');
  });

  it('will not offer a model whose modality the catalogue never recorded', () => {
    // Unknown is not "probably fine" when the question is whether to volunteer
    // a suggestion — the opposite call from workloadBlockReason, on purpose.
    const catalogue = [
      model({ id: 'a/current', promptPrice: 1e-6, completionPrice: 2e-6, agenticIndex: 50, modality: 'text+image->text' }),
      model({ id: 'b/unknown', promptPrice: 1e-9, completionPrice: 1e-9, agenticIndex: 80, modality: null }),
    ];
    expect(findSwaps([group({ activity: 'vision' })], catalogue, labels, () => 'image-input')).toEqual([]);
  });

  it('will not shrink the context window by default', () => {
    const catalogue = [
      current,
      model({ id: 'b/short', promptPrice: 1e-9, completionPrice: 1e-9, agenticIndex: 90, contextLength: 8_000 }),
    ];
    expect(findSwaps([group()], catalogue, labels, noReq)).toEqual([]);
    const relaxed = findSwaps([group()], catalogue, labels, noReq, { requireContextParity: false });
    expect(relaxed[0].candidateModelId).toBe('b/short');
  });

  it('lets a deliberate quality trade through when the floor is lowered', () => {
    const catalogue = [
      current,
      model({ id: 'c/worse-cheaper', promptPrice: 1e-9, completionPrice: 1e-9, agenticIndex: 45 }),
    ];
    expect(findSwaps([group()], catalogue, labels, noReq)).toEqual([]);
    const traded = findSwaps([group()], catalogue, labels, noReq, { qualityFloorRatio: 0.85 });
    expect(traded[0].candidateModelId).toBe('c/worse-cheaper');
    expect(traded[0].candidateQuality).toBe(45);
  });

  it('prices the baseline on the same arithmetic as the candidate, so a per-request fee does not inflate the saving', () => {
    // Observed cost is inflated by a $5 search fee that no per-token projection
    // can reproduce; the saving must not claim credit for removing it.
    const catalogue = [
      current,
      model({ id: 'b/half', promptPrice: 5e-7, completionPrice: 1e-6, agenticIndex: 55 }),
    ];
    const [s] = findSwaps([group({ costUsd: 6.1 })], catalogue, labels, noReq);
    expect(s.currentCostUsd).toBeCloseTo(1.1, 6);
    expect(s.savingUsd).toBeCloseTo(0.55, 6);
  });

  it('skips activities below the spend floor and savings below the share floor', () => {
    const catalogue = [current, model({ id: 'b/tiny-win', promptPrice: 9.5e-7, completionPrice: 1.9e-6, agenticIndex: 55 })];
    expect(findSwaps([group({ costUsd: 0.001, tokensIn: 900, tokensOut: 100 })], catalogue, labels, noReq)).toEqual([]);
    // A 5% saving on a big spender is still below the 10% default share floor.
    expect(findSwaps([group()], catalogue, labels, noReq)).toEqual([]);
  });

  it("never proposes an OpenRouter :free variant, however much it would save", () => {
    const catalogue = [
      current,
      model({ id: 'z/brilliant:free', promptPrice: 0, completionPrice: 0, agenticIndex: 99 }),
    ];
    // A free variant wins every price comparison and then rate-limits the site
    // to a standstill by mid-morning — a saving that cannot be taken.
    expect(findSwaps([group()], catalogue, labels, noReq)).toEqual([]);
    const opted = findSwaps([group()], catalogue, labels, noReq, { allowFreeTier: true });
    expect(opted[0].candidateModelId).toBe('z/brilliant:free');
  });

  it('keys the suggestion on the activity it was given, not on the model', () => {
    const catalogue = [current, model({ id: 'b/half', promptPrice: 5e-7, completionPrice: 1e-6, agenticIndex: 55 })];
    const [s] = findSwaps([group({ activity: 'source:gateway' })], catalogue, new Map([['source:gateway', 'Untagged site calls']]), noReq);
    expect(s.activity).toBe('source:gateway');
    expect(s.label).toBe('Untagged site calls');
  });

  it('ignores a model that is not in the catalogue at all (Codex, subscription-billed)', () => {
    const rows = findSwaps([group({ model: 'codex/gpt-5.6-terra' })], [current], labels, noReq);
    expect(rows).toEqual([]);
  });

  it('orders by absolute saving, not by percentage', () => {
    const other = model({ id: 'a/other', promptPrice: 0.000001, completionPrice: 0.000002, agenticIndex: 50 });
    const catalogue = [
      current,
      other,
      model({ id: 'b/half', promptPrice: 5e-7, completionPrice: 1e-6, agenticIndex: 55 }),
      model({ id: 'b/tenth', promptPrice: 1e-7, completionPrice: 2e-7, agenticIndex: 55 }),
    ];
    const rows = findSwaps(
      [
        group({ activity: 'small', model: 'a/other', tokensIn: 90_000, tokensOut: 10_000, costUsd: 0.11 }),
        group({ activity: 'big', tokensIn: 9_000_000, tokensOut: 1_000_000, costUsd: 11 }),
      ],
      catalogue,
      new Map(),
      noReq,
    );
    expect(rows.map((r) => r.activity)).toEqual(['big', 'small']);
  });
});

describe('describeMix', () => {
  it('reads as a ratio in whichever direction is dominant', () => {
    expect(describeMix(900, 100)).toBe('9.0:1 in:out');
    expect(describeMix(40_000, 1_000)).toBe('40:1 in:out');
    expect(describeMix(100, 900)).toBe('1:9.0 in:out');
    expect(describeMix(100, 0)).toBe('input-only');
    expect(describeMix(0, 100)).toBe('output-only');
  });
});

describe('findWaste', () => {
  it('flags unpriced calls and refuses to call them zero', () => {
    const [w] = findWaste([group({ unpricedCalls: 4, calls: 10 })], { windowDays: 30 });
    expect(w.id).toBe('unpriced');
    expect(w.severity).toBe('warn');
    expect(w.valueUsd).toBeNull();
  });

  it('reports concentration only when one model carries at least half', () => {
    const even = findWaste(
      [group({ model: 'a', costUsd: 1 }), group({ model: 'b', costUsd: 1.1 }), group({ model: 'c', costUsd: 1 })],
      { windowDays: 30 },
    );
    expect(even.find((w) => w.id === 'concentration')).toBeUndefined();
    const lopsided = findWaste(
      [group({ model: 'a', costUsd: 9 }), group({ model: 'b', costUsd: 1 })],
      { windowDays: 30 },
    );
    expect(lopsided.find((w) => w.id === 'concentration')?.title).toContain('90%');
  });

  it('turns a window into a monthly run rate', () => {
    const w = findWaste([group({ costUsd: 7 })], { windowDays: 7 });
    expect(w.find((x) => x.id === 'runrate')?.title).toBe('Run rate $30.00 / month');
  });

  it('flags a cold prompt cache', () => {
    const cold = findWaste([group()], {
      windowDays: 30,
      cacheReadTokens: 100,
      totalInputTokens: 1_000_000,
      measuredInputTokens: 1_000_000,
    });
    expect(cold.find((w) => w.id === 'cache')).toBeDefined();
    const warm = findWaste([group()], {
      windowDays: 30,
      cacheReadTokens: 600_000,
      totalInputTokens: 1_000_000,
      measuredInputTokens: 1_000_000,
    });
    expect(warm.find((w) => w.id === 'cache')).toBeUndefined();
  });

  it('says the cache is unmeasured rather than cold when no row carries a figure', () => {
    // The state the ledger was actually in the day the column was added: a
    // month of spend, none of it recording cache reads. "0.0% cached" would
    // send you hunting a prefix-churn bug that does not exist.
    const w = findWaste([group()], {
      windowDays: 30,
      cacheReadTokens: 0,
      totalInputTokens: 1_000_000,
      measuredInputTokens: 0,
    });
    expect(w.find((x) => x.id === 'cache')).toBeUndefined();
    expect(w.find((x) => x.id === 'cache-unmeasured')).toBeDefined();
  });

  it('judges the hit rate on the measured rows only', () => {
    // 9/10 of the window predates the column. The measured tenth is 60% cached,
    // which is healthy — dividing by the whole window would call it 6% and warn.
    const w = findWaste([group()], {
      windowDays: 30,
      cacheReadTokens: 60_000,
      totalInputTokens: 1_000_000,
      measuredInputTokens: 100_000,
    });
    expect(w.find((x) => x.id === 'cache')).toBeUndefined();
    expect(w.find((x) => x.id === 'cache-unmeasured')).toBeUndefined();
  });
});

describe('reconcile', () => {
  it('names the gap between what was billed and what was recorded', () => {
    const r = reconcile(20, 15);
    expect(r.gapUsd).toBe(5);
    expect(r.coverage).toBeCloseTo(0.75, 6);
  });

  it('does not clamp above 1 — Codex is recorded here and billed elsewhere', () => {
    expect(reconcile(10, 12).coverage).toBeCloseTo(1.2, 6);
  });

  it('stays null rather than guessing when the provider figure is unavailable', () => {
    const r = reconcile(null, 15);
    expect(r.gapUsd).toBeNull();
    expect(r.coverage).toBeNull();
  });

  it('reports no gap at all when the ledger recorded more than the bill', () => {
    // Production printed "$-0.1246" in a column headed "Unaccounted". The
    // overshoot is not lost — coverage says 105% and the Codex note explains it.
    const r = reconcile(2.5585, 2.6831);
    expect(r.gapUsd).toBeNull();
    expect(r.coverage).toBeGreaterThan(1);
  });

  it('does not print a negative zero when the two figures agree exactly', () => {
    // billed === recorded to the cent, off by float noise: "$-0.0000".
    expect(reconcile(0.6243, 0.62430000001).gapUsd).toBeNull();
  });
});
