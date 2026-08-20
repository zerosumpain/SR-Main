import { describe, it, expect } from 'vitest';
import { selectForProfile, enrichRow, NEUTRAL_PRIOR, type Candidate } from './scoring';
import { wilsonLower, buildSuccessIndex, successForProfile } from './success';
import { classifyQuery } from './classify';
import { DEFAULT_CONFIG, PRICE_WEIGHT_CAP, type RoutingEvent } from './types';

const noSuccess = () => ({ rate: null, samples: 0 });

function cand(over: Partial<Candidate> & { id: string }): Candidate {
  return {
    name: over.id,
    toolsSupported: true,
    blendedPerM: 5,
    agenticIndex: 50,
    throughput: 100,
    contextLength: 128_000,
    openWeights: false,
    imageInput: false,
    fileInput: false,
    ...over,
  };
}

describe('selectForProfile — capability band, then cost', () => {
  const opts = {
    weights: DEFAULT_CONFIG.weights.general,
    qualityFloorFrac: DEFAULT_CONFIG.qualityFloorFrac.general,
    priceCeilingPerM: DEFAULT_CONFIG.priceCeilingPerM,
    minContext: DEFAULT_CONFIG.minContext,
    successBiasK: DEFAULT_CONFIG.successBiasK,
    openWeightBonus: DEFAULT_CONFIG.openWeightBonus,
    openWeightsOnly: DEFAULT_CONFIG.openWeightsOnly,
    successFor: noSuccess,
  };

  it('band floor: a dirt-cheap but weak model can never win', () => {
    const models = [
      cand({ id: 'cheap-weak', blendedPerM: 0.1, agenticIndex: 10 }),
      cand({ id: 'lowish', blendedPerM: 0.3, agenticIndex: 30 }),
      cand({ id: 'mid', blendedPerM: 5, agenticIndex: 55 }),
      cand({ id: 'good', blendedPerM: 7, agenticIndex: 65 }),
      cand({ id: 'strong', blendedPerM: 8, agenticIndex: 70 }),
    ];
    const { winner, ranked } = selectForProfile(models, opts);
    expect(winner).not.toBeNull();
    // Floor = 0.6 × best (70) = 42, so both cheap-and-weak models are excluded
    // outright however cheap they are.
    expect(ranked.find((r) => r.id === 'cheap-weak')).toBeUndefined();
    expect(ranked.find((r) => r.id === 'lowish')).toBeUndefined();
    expect(['mid', 'good', 'strong']).toContain(winner!.id);
  });

  it('within the band, cost decides', () => {
    const models = [
      cand({ id: 'mid', blendedPerM: 5, agenticIndex: 55 }),
      cand({ id: 'good', blendedPerM: 7, agenticIndex: 65 }),
      cand({ id: 'strong', blendedPerM: 8, agenticIndex: 70 }),
    ];
    const { winner } = selectForProfile(models, opts);
    expect(winner!.id).toBe('mid');
  });

  it('the band is anchored to the catalogue ceiling, not the surviving pool', () => {
    const base = [
      cand({ id: 'ok', agenticIndex: 40, blendedPerM: 1 }),
      cand({ id: 'better', agenticIndex: 60, blendedPerM: 9 }),
    ];
    // 'ok' clears 0.6 × 60 = 36 and wins on price.
    expect(selectForProfile(base, opts).winner!.id).toBe('ok');
    // A new frontier model lands (index 100) → floor rises to 60 and 'ok' drops
    // out of the band entirely, even though nothing about it changed.
    const withFrontier = [...base, cand({ id: 'frontier', agenticIndex: 100, blendedPerM: 14 })];
    const { ranked } = selectForProfile(withFrontier, opts);
    expect(ranked.find((r) => r.id === 'ok')).toBeUndefined();
    expect(ranked.map((r) => r.id).sort()).toEqual(['better', 'frontier']);
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

  it('price weight is clamped to PRICE_WEIGHT_CAP', () => {
    const models = [
      cand({ id: 'cheap', blendedPerM: 1, agenticIndex: 50 }),
      cand({ id: 'dear', blendedPerM: 12, agenticIndex: 80 }),
    ];
    const atCap = selectForProfile(models, {
      ...opts,
      weights: { quality: 0.5, price: PRICE_WEIGHT_CAP, speed: 0 },
    });
    const overCap = selectForProfile(models, {
      ...opts,
      weights: { quality: 0.5, price: 0.9, speed: 0 },
    });
    // Asking for a price weight above the cap changes nothing — the clamp holds.
    expect(overCap.ranked.map((r) => [r.id, r.finalScore])).toEqual(
      atCap.ranked.map((r) => [r.id, r.finalScore]),
    );
  });

  it('open-weight bonus wins a near-tie', () => {
    // Scores are min-max normalised across the pool, so "near-tie" only means
    // anything relative to the pool's spread — hence the two dominated fillers
    // that set the quality and price ranges.
    const models = [
      cand({ id: 'closed', blendedPerM: 5, agenticIndex: 60, openWeights: false }),
      cand({ id: 'open', blendedPerM: 5.2, agenticIndex: 59, openWeights: true }),
      cand({ id: 'filler-a', blendedPerM: 14, agenticIndex: 40 }),
      cand({ id: 'filler-b', blendedPerM: 13, agenticIndex: 41 }),
    ];
    // The closed model is marginally cheaper AND marginally better, so it wins
    // with the bonus off...
    expect(selectForProfile(models, { ...opts, openWeightBonus: 0 }).winner!.id).toBe('closed');
    // ...and loses once open weights are worth 15%.
    expect(selectForProfile(models, opts).winner!.id).toBe('open');
  });

  it('a big quality gap still beats the open-weight bonus', () => {
    const models = [
      cand({ id: 'closed-strong', blendedPerM: 5, agenticIndex: 100, openWeights: false }),
      cand({ id: 'open-weak', blendedPerM: 5, agenticIndex: 61, openWeights: true }),
    ];
    // Both clear 0.6 × 100 = 60, prices identical → quality decides, and a 15%
    // bonus cannot bridge the gap. The bias is soft by design.
    expect(selectForProfile(models, opts).winner!.id).toBe('closed-strong');
  });

  it('openWeightsOnly excludes closed models entirely', () => {
    const models = [
      cand({ id: 'closed-cheap', blendedPerM: 1, agenticIndex: 90, openWeights: false }),
      cand({ id: 'open-dear', blendedPerM: 9, agenticIndex: 60, openWeights: true }),
    ];
    const { winner, ranked } = selectForProfile(models, { ...opts, openWeightsOnly: true });
    expect(winner!.id).toBe('open-dear');
    expect(ranked.find((r) => r.id === 'closed-cheap')).toBeUndefined();
    // Narrowing the field must not lower the bar: the band is still 0.6 × 90 = 54,
    // computed from the whole catalogue including the excluded closed model.
    expect(selectForProfile(
      [...models, cand({ id: 'open-tiny', blendedPerM: 0.1, agenticIndex: 20, openWeights: true })],
      { ...opts, openWeightsOnly: true },
    ).ranked.find((r) => r.id === 'open-tiny')).toBeUndefined();
  });

  it('rag profile weights speed heavily', () => {
    const ragOpts = {
      ...opts,
      weights: DEFAULT_CONFIG.weights.rag,
      qualityFloorFrac: DEFAULT_CONFIG.qualityFloorFrac.rag,
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

describe('enrichRow — open-weight detection', () => {
  const row = (raw: unknown) => ({
    id: 'v/m',
    name: 'M',
    contextLength: 128_000,
    promptPrice: '0.000001',
    completionPrice: '0.000002',
    throughput: null,
    raw,
  });

  it('reads OpenRouter hugging_face_id as the open-weight signal', () => {
    expect(enrichRow(row({ hugging_face_id: 'deepseek-ai/DeepSeek-V4-Flash' })).openWeights).toBe(true);
  });

  it('treats missing, empty and blank ids as closed weights', () => {
    expect(enrichRow(row({})).openWeights).toBe(false);
    expect(enrichRow(row({ hugging_face_id: '' })).openWeights).toBe(false);
    expect(enrichRow(row({ hugging_face_id: '   ' })).openWeights).toBe(false);
    expect(enrichRow(row(null)).openWeights).toBe(false);
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


describe('vision profile — must read pictures, need not call tools', () => {
  const visionOpts = {
    weights: DEFAULT_CONFIG.weights.vision,
    qualityFloorFrac: DEFAULT_CONFIG.qualityFloorFrac.vision,
    priceCeilingPerM: DEFAULT_CONFIG.priceCeilingPerM,
    minContext: DEFAULT_CONFIG.minContext,
    successBiasK: DEFAULT_CONFIG.successBiasK,
    openWeightBonus: DEFAULT_CONFIG.openWeightBonus,
    openWeightsOnly: DEFAULT_CONFIG.openWeightsOnly,
    successFor: noSuccess,
    requireImageInput: true,
    requireFileInput: true,
    requireTools: false,
  };

  it('never picks a text-only model, however cheap and strong', () => {
    // The whole point: a text-only model would accept the request and describe
    // the prompt while ignoring the picture — a confident caption of nothing.
    const models = [
      cand({ id: 'cheap-text-only', blendedPerM: 0.05, agenticIndex: 70, imageInput: false }),
      cand({ id: 'pricier-vision', blendedPerM: 4, agenticIndex: 60, imageInput: true, fileInput: true }),
    ];
    const { winner } = selectForProfile(models, visionOpts);
    expect(winner?.id).toBe('pricier-vision');
  });

  it('prefers the cheaper of two comparable vision models', () => {
    const models = [
      cand({ id: 'vision-dear', blendedPerM: 12, agenticIndex: 62, imageInput: true, fileInput: true }),
      cand({ id: 'vision-cheap', blendedPerM: 0.6, agenticIndex: 60, imageInput: true, fileInput: true }),
    ];
    const { winner } = selectForProfile(models, visionOpts);
    expect(winner?.id).toBe('vision-cheap');
  });

  it('keeps a vision model that cannot call tools', () => {
    const models = [cand({ id: 'vision-no-tools', toolsSupported: false, imageInput: true, fileInput: true })];
    const { winner, poolSize } = selectForProfile(models, visionOpts);
    expect(poolSize).toBe(1);
    expect(winner?.id).toBe('vision-no-tools');
  });

  it('still drops a tool-less model on a query profile', () => {
    const models = [cand({ id: 'no-tools', toolsSupported: false })];
    const { winner } = selectForProfile(models, {
      ...visionOpts,
      requireImageInput: false,
      requireTools: true,
    });
    expect(winner).toBeNull();
  });

  it('enrichRow reads image capability off architecture.input_modalities', () => {
    const seen = enrichRow({
      id: 'x/vision',
      name: 'vision',
      promptPrice: '0.000001',
      completionPrice: '0.000004',
      contextLength: 128_000,
      throughput: '80',
      raw: { architecture: { input_modalities: ['text', 'image', 'file'] } },
    } as never);
    expect(seen.imageInput).toBe(true);
    expect(seen.fileInput).toBe(true);

    const blind = enrichRow({
      id: 'x/text',
      name: 'text',
      promptPrice: '0.000001',
      completionPrice: '0.000004',
      contextLength: 128_000,
      throughput: '80',
      raw: { architecture: { input_modalities: ['text'] } },
    } as never);
    expect(blind.imageInput).toBe(false);
    expect(blind.fileInput).toBe(false);
  });
});

describe('uncallable catalogue variants', () => {
  const opts = {
    weights: DEFAULT_CONFIG.weights.general,
    qualityFloorFrac: DEFAULT_CONFIG.qualityFloorFrac.general,
    priceCeilingPerM: DEFAULT_CONFIG.priceCeilingPerM,
    minContext: DEFAULT_CONFIG.minContext,
    successBiasK: DEFAULT_CONFIG.successBiasK,
    openWeightBonus: DEFAULT_CONFIG.openWeightBonus,
    openWeightsOnly: DEFAULT_CONFIG.openWeightsOnly,
    successFor: noSuccess,
  };

  it('never picks a :batch variant, however cheap', () => {
    // Priced ~half the parent, so a cost-aware score loves them — and every
    // chat-completions call returns 404 "only available through the Batch API".
    const models = [
      cand({ id: 'openai/thing:batch', blendedPerM: 0.22, agenticIndex: 60 }),
      cand({ id: 'openai/thing', blendedPerM: 2.25, agenticIndex: 60 }),
    ];
    const { winner, poolSize } = selectForProfile(models, opts);
    expect(poolSize).toBe(1);
    expect(winner?.id).toBe('openai/thing');
  });

  it('leaves other variant suffixes alone', () => {
    // :free and :thinking are ordinary chat models; only :batch needs a
    // different endpoint.
    const models = [cand({ id: 'x/y:free', blendedPerM: 0.1, agenticIndex: 60 })];
    expect(selectForProfile(models, opts).winner?.id).toBe('x/y:free');
  });
});
