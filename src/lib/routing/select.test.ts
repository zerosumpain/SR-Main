import { describe, it, expect } from 'vitest';
import { selectForProfile, percentile, NEUTRAL_PRIOR, type Candidate } from './scoring';
import { wilsonLower, buildSuccessIndex, successForProfile } from './success';
import { classifyQuery } from './classify';
import { DEFAULT_CONFIG, type RoutingEvent } from './types';

const noSuccess = () => ({ rate: null, samples: 0 });

function cand(over: Partial<Candidate> & { id: string }): Candidate {
  return {
    name: over.id,
    toolsSupported: true,
    blendedPerM: 5,
    agenticIndex: 50,
    throughput: 100,
    contextLength: 128_000,
    ...over,
  };
}

describe('percentile', () => {
  it('nearest-rank', () => {
    expect(percentile([10, 20, 30, 40, 50], 0)).toBe(10);
    expect(percentile([10, 20, 30, 40, 50], 100)).toBe(50);
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
  });
});

describe('selectForProfile — anti-cheap guards', () => {
  const opts = {
    weights: DEFAULT_CONFIG.weights.general,
    qualityFloorPct: DEFAULT_CONFIG.qualityFloorPct.general,
    priceCeilingPerM: DEFAULT_CONFIG.priceCeilingPerM,
    minContext: DEFAULT_CONFIG.minContext,
    successBiasK: DEFAULT_CONFIG.successBiasK,
    successFor: noSuccess,
  };

  it('quality floor: a dirt-cheap but weak model can never win', () => {
    const models = [
      cand({ id: 'cheap-weak', blendedPerM: 0.1, agenticIndex: 10 }),
      cand({ id: 'lowish', blendedPerM: 0.3, agenticIndex: 30 }),
      cand({ id: 'mid', blendedPerM: 5, agenticIndex: 55 }),
      cand({ id: 'good', blendedPerM: 7, agenticIndex: 65 }),
      cand({ id: 'strong', blendedPerM: 8, agenticIndex: 70 }),
    ];
    const { winner, ranked } = selectForProfile(models, opts);
    expect(winner).not.toBeNull();
    expect(winner!.id).not.toBe('cheap-weak');
    // The weakest is below the 45th-pct agentic floor → excluded entirely,
    // no matter how cheap it is.
    expect(ranked.find((r) => r.id === 'cheap-weak')).toBeUndefined();
    expect(['mid', 'good', 'strong']).toContain(winner!.id);
  });

  it('price ceiling excludes the most expensive models', () => {
    const models = [
      cand({ id: 'premium', blendedPerM: 80, agenticIndex: 90 }),
      cand({ id: 'reasonable', blendedPerM: 6, agenticIndex: 70 }),
    ];
    const { winner } = selectForProfile(models, opts);
    expect(winner!.id).toBe('reasonable');
  });

  it('requires tools + min context', () => {
    const models = [
      cand({ id: 'no-tools', toolsSupported: false, agenticIndex: 90 }),
      cand({ id: 'tiny-ctx', contextLength: 8000, agenticIndex: 90 }),
      cand({ id: 'ok', agenticIndex: 60 }),
    ];
    const { winner } = selectForProfile(models, opts);
    expect(winner!.id).toBe('ok');
  });

  it('price weight is capped: a tiny price edge does not flip a big quality gap', () => {
    // Two models both clear the floor; one is far higher quality but a bit
    // pricier. With price capped at 0.25, quality should still win for general.
    const models = [
      cand({ id: 'cheaper-lower', blendedPerM: 2, agenticIndex: 52, throughput: 100 }),
      cand({ id: 'pricier-higher', blendedPerM: 12, agenticIndex: 80, throughput: 100 }),
    ];
    const { winner } = selectForProfile(models, opts);
    expect(winner!.id).toBe('pricier-higher');
  });

  it('rag profile weights speed heavily', () => {
    const ragOpts = {
      ...opts,
      weights: DEFAULT_CONFIG.weights.rag,
      qualityFloorPct: DEFAULT_CONFIG.qualityFloorPct.rag,
    };
    const models = [
      cand({ id: 'slow-smart', throughput: 30, agenticIndex: 70, blendedPerM: 5 }),
      cand({ id: 'fast-ok', throughput: 400, agenticIndex: 55, blendedPerM: 5 }),
    ];
    const { winner } = selectForProfile(models, ragOpts);
    expect(winner!.id).toBe('fast-ok');
  });

  it('success bias promotes a proven model over an unrated equal', () => {
    const models = [
      cand({ id: 'proven', agenticIndex: 60 }),
      cand({ id: 'unrated', agenticIndex: 60 }),
    ];
    const events: RoutingEvent[] = Array.from({ length: 20 }, (_, i) => ({
      conversationId: `c${i}`,
      profile: 'general',
      modelId: 'proven',
      decidedAt: '',
      correctFirstTime: true,
    }));
    const idx = buildSuccessIndex(events);
    const { winner } = selectForProfile(models, {
      ...opts,
      successFor: successForProfile(idx, 'general'),
    });
    expect(winner!.id).toBe('proven');
  });
});

describe('wilsonLower', () => {
  it('few samples stay pessimistic; more samples approach the rate', () => {
    const oneOfOne = wilsonLower(1, 1);
    const fortyOfFifty = wilsonLower(40, 50);
    expect(oneOfOne).toBeLessThan(fortyOfFifty); // 1/1 must not beat a proven 40/50
    expect(wilsonLower(0, 0)).toBe(0);
  });
});

describe('successForProfile', () => {
  it('unrated models return neutral (null rate)', () => {
    const idx = buildSuccessIndex([]);
    expect(successForProfile(idx, 'tool')('anything').rate).toBeNull();
  });
});

describe('NEUTRAL_PRIOR keeps exploration alive', () => {
  it('is between 0.5 and 0.8', () => {
    expect(NEUTRAL_PRIOR).toBeGreaterThan(0.5);
    expect(NEUTRAL_PRIOR).toBeLessThan(0.8);
  });
});

describe('classifyQuery', () => {
  it('workflow context → agentic', () => {
    expect(classifyQuery({ message: 'hi', workflowId: 'w1' }).profile).toBe('agentic');
  });
  it('@files → rag', () => {
    expect(classifyQuery({ message: 'summarise @files the report' }).profile).toBe('rag');
  });
  it('delegate → agentic', () => {
    expect(classifyQuery({ message: 'delegate this to the researcher' }).profile).toBe('agentic');
  });
  it('home control → tool', () => {
    expect(classifyQuery({ message: 'turn on the living room lights' }).profile).toBe('tool');
  });
  it('plain chat → general', () => {
    expect(classifyQuery({ message: 'what do you think about stoicism?' }).profile).toBe('general');
  });
});
