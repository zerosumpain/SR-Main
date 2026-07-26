import { describe, it, expect } from 'vitest';
import {
  buildOpenWeightResolver,
  rawHuggingFaceId,
  OPEN_WEIGHT_OVERRIDES,
  UNRESOLVED,
} from './open-weights';

const row = (id: string, hf?: string | null, description?: string) => ({
  id,
  raw: {
    ...(hf === undefined ? {} : { hugging_face_id: hf }),
    ...(description === undefined ? {} : { description }),
  },
});

describe('rawHuggingFaceId', () => {
  it('reads a non-empty string', () => {
    expect(rawHuggingFaceId({ hugging_face_id: 'zai-org/GLM-5' })).toBe('zai-org/GLM-5');
  });

  it('treats missing, null, empty and blank as absent', () => {
    expect(rawHuggingFaceId({})).toBeNull();
    expect(rawHuggingFaceId(null)).toBeNull();
    expect(rawHuggingFaceId({ hugging_face_id: '' })).toBeNull();
    expect(rawHuggingFaceId({ hugging_face_id: '   ' })).toBeNull();
    expect(rawHuggingFaceId({ hugging_face_id: 42 })).toBeNull();
  });
});

describe('buildOpenWeightResolver — OpenRouter signal', () => {
  it('passes through a populated hugging_face_id', () => {
    const r = buildOpenWeightResolver([row('z-ai/glm-5', 'zai-org/GLM-5')]);
    expect(r.isOpen('z-ai/glm-5')).toBe(true);
    expect(r.huggingFaceId('z-ai/glm-5')).toBe('zai-org/GLM-5');
  });

  it('leaves genuinely closed models closed', () => {
    const r = buildOpenWeightResolver([row('openai/gpt-5'), row('qwen/qwen3-max')]);
    expect(r.isOpen('openai/gpt-5')).toBe(false);
    expect(r.isOpen('qwen/qwen3-max')).toBe(false);
  });
});

describe('buildOpenWeightResolver — sibling inheritance', () => {
  it('inherits across a hosted -turbo variant (the glm-5-turbo case)', () => {
    const r = buildOpenWeightResolver([
      row('z-ai/glm-5', 'zai-org/GLM-5'),
      row('z-ai/glm-5-turbo'),
    ]);
    expect(r.isOpen('z-ai/glm-5-turbo')).toBe(true);
    expect(r.huggingFaceId('z-ai/glm-5-turbo')).toBe('zai-org/GLM-5');
  });

  it('inherits across a :variant row', () => {
    const r = buildOpenWeightResolver([
      row('deepseek/deepseek-v4', 'deepseek-ai/DeepSeek-V4'),
      row('deepseek/deepseek-v4:free'),
    ]);
    expect(r.isOpen('deepseek/deepseek-v4:free')).toBe(true);
  });

  it('does NOT invent a parent that is closed-weight', () => {
    // qwen3-max is proprietary, so the -thinking variant must stay closed.
    const r = buildOpenWeightResolver([row('qwen/qwen3-max'), row('qwen/qwen3-max-thinking')]);
    expect(r.isOpen('qwen/qwen3-max-thinking')).toBe(false);
  });

  it('does NOT invent a parent that is absent from the catalogue', () => {
    // glm-5v is not an OpenRouter model, so glm-5v-turbo has nothing to inherit.
    const r = buildOpenWeightResolver([row('z-ai/glm-5', 'zai-org/GLM-5'), row('z-ai/glm-5v-turbo')]);
    expect(r.isOpen('z-ai/glm-5v-turbo')).toBe(false);
  });

  it('only strips the known hosted-variant suffixes', () => {
    const r = buildOpenWeightResolver([
      row('meta-llama/llama-4', 'meta-llama/Llama-4'),
      row('meta-llama/llama-4-maverick'),
    ]);
    expect(r.isOpen('meta-llama/llama-4-maverick')).toBe(false);
  });
});

describe('buildOpenWeightResolver — explicit overrides', () => {
  it('flags a model OpenRouter left blank', () => {
    const r = buildOpenWeightResolver([row('cohere/command-r-08-2024')]);
    expect(r.isOpen('cohere/command-r-08-2024')).toBe(true);
    expect(r.huggingFaceId('cohere/command-r-08-2024')).toBe('CohereLabs/c4ai-command-r-08-2024');
  });

  it('lets OpenRouter win when it later populates the field', () => {
    const r = buildOpenWeightResolver([row('minimax/minimax-m1', 'MiniMaxAI/MiniMax-M1-40k')]);
    expect(r.huggingFaceId('minimax/minimax-m1')).toBe('MiniMaxAI/MiniMax-M1-40k');
  });

  it('resolves an id absent from the catalogue rows', () => {
    const r = buildOpenWeightResolver([]);
    expect(r.isOpen('inclusionai/ring-2.6-1t')).toBe(true);
    expect(r.isOpen('openai/gpt-5')).toBe(false);
  });

  it('keeps the override and unresolved lists disjoint', () => {
    for (const id of UNRESOLVED) {
      expect(OPEN_WEIGHT_OVERRIDES[id]).toBeUndefined();
    }
  });
});

describe('buildOpenWeightResolver — OpenRouter prose', () => {
  const KIMI =
    'Kimi K3 is a 2.8T parameter open-weight multimodal reasoning model from Moonshot AI.';

  it('flags a model OpenRouter calls open-weight but gave no repo (kimi-k3)', () => {
    const r = buildOpenWeightResolver([row('moonshotai/kimi-k3', undefined, KIMI)]);
    expect(r.isOpen('moonshotai/kimi-k3')).toBe(true);
  });

  it('reports open with a NULL repo — open must not be inferred from the id', () => {
    const r = buildOpenWeightResolver([row('moonshotai/kimi-k3', undefined, KIMI)]);
    const v = r.verdict('moonshotai/kimi-k3');
    expect(v.open).toBe(true);
    expect(v.huggingFaceId).toBeNull();
    expect(v.source).toBe('description');
  });

  it('matches "open weights" and is case-insensitive', () => {
    const r = buildOpenWeightResolver([
      row('a/spaced', undefined, 'Ships with Open Weights on release day.'),
      row('a/hyphen', undefined, 'An OPEN-WEIGHT reasoning model.'),
    ]);
    expect(r.isOpen('a/spaced')).toBe(true);
    expect(r.isOpen('a/hyphen')).toBe(true);
  });

  it('does NOT match the looser marketing phrasings', () => {
    const r = buildOpenWeightResolver([
      row('a/oss', undefined, 'An open-source licensed API model.'),
      row('a/openmodel', undefined, 'An open model available via API.'),
      row('a/none', undefined, 'A frontier proprietary model.'),
    ]);
    expect(r.isOpen('a/oss')).toBe(false);
    expect(r.isOpen('a/openmodel')).toBe(false);
    expect(r.isOpen('a/none')).toBe(false);
  });

  it('ranks the structured field above prose for the repo id', () => {
    const r = buildOpenWeightResolver([
      row('z-ai/glm-5', 'zai-org/GLM-5', 'An open-weight model.'),
    ]);
    expect(r.verdict('z-ai/glm-5').source).toBe('openrouter');
    expect(r.verdict('z-ai/glm-5').huggingFaceId).toBe('zai-org/GLM-5');
  });

  it('lets a :free row read its base row description', () => {
    const r = buildOpenWeightResolver([
      row('a/model', undefined, 'An open-weight model.'),
      row('a/model:free', undefined),
    ]);
    expect(r.isOpen('a/model:free')).toBe(true);
  });
});
