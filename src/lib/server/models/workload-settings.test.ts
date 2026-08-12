import { describe, it, expect, vi, beforeEach } from 'vitest';

/** One catalogue row per model id, for the image-output lookup. */
const CATALOGUE: Record<string, string | null> = {
  'google/gemini-3.1-flash-image': 'text+image->text+image',
  'openai/gpt-4o': 'text+image->text',
  'openai/gpt-oss-120b': 'text->text',
};

vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (cond: { modelId?: string }) => ({
          limit: () =>
            Promise.resolve(
              cond?.modelId && cond.modelId in CATALOGUE
                ? [{ modality: CATALOGUE[cond.modelId] }]
                : [],
            ),
        }),
      }),
    }),
  },
}));
vi.mock('$lib/db/schema', () => ({ openrouterModels: { id: 'id', modality: 'modality' } }));
// `eq(col, value)` is only used to reach the mocked `where` above; carry the id
// through so the fake can decide which row to return.
vi.mock('drizzle-orm', () => ({ eq: (_col: unknown, value: string) => ({ modelId: value }) }));

const getSetting = vi.fn();
const setSetting = vi.fn();
const deleteSetting = vi.fn();
vi.mock('./settings', () => ({
  getSetting: (...args: unknown[]) => getSetting(...args),
  setSetting: (...args: unknown[]) => setSetting(...args),
  deleteSetting: (...args: unknown[]) => deleteSetting(...args),
  clearSettingsCache: vi.fn(),
  resolveDefaultModel: vi
    .fn()
    .mockResolvedValue({ provider: 'codex', modelId: 'codex/gpt-5.6-terra' }),
}));

import {
  workloadBlockReason,
  resolveWorkloadModel,
  describeSiteWorkloads,
  setWorkloadModel,
} from './workload-settings';
import { getWorkload } from '$lib/models/workloads';

const wl = (id: string) => getWorkload(id)!;

beforeEach(() => {
  getSetting.mockReset();
  getSetting.mockResolvedValue(null);
});

describe('workloadBlockReason', () => {
  it('refuses a text-only model for a role that must SEE images', async () => {
    // The failure this prevents is not a crash: a text-only model answers the
    // prompt and ignores the picture, producing a confident caption of nothing.
    const reason = await workloadBlockReason(wl('vision'), 'openai/gpt-oss-120b');
    expect(reason).toMatch(/cannot accept images/i);
    expect(await workloadBlockReason(wl('vision'), 'openai/gpt-4o')).toBeNull();
  });

  it('refuses Codex for embeddings, which it has no endpoint for', async () => {
    const reason = await workloadBlockReason(wl('embeddings'), 'codex/gpt-5.6-terra');
    expect(reason).toMatch(/embeddings/i);
    expect(await workloadBlockReason(wl('embeddings'), 'openai/text-embedding-3-large')).toBeNull();
  });

  it('refuses a model that reads images but cannot emit them', async () => {
    // gpt-4o takes image INPUT — the exact model a naive modality check waves
    // through for a generator, and the one that returns prose instead of a picture.
    const reason = await workloadBlockReason(wl('image'), 'openai/gpt-4o');
    expect(reason).toMatch(/does not emit images/i);
    expect(await workloadBlockReason(wl('image'), 'google/gemini-3.1-flash-image')).toBeNull();
  });

  it('allows an image model the catalogue has never heard of', async () => {
    // Absent from the feed means UNKNOWN, not disproven: flux-1.1-pro is a real
    // generator OpenRouter's /models endpoint omits, and blocking it would
    // refuse a value the site already ships.
    expect(await workloadBlockReason(wl('image'), 'black-forest-labs/flux-1.1-pro')).toBeNull();
  });

  it('allows Codex where the role only needs tools', async () => {
    expect(await workloadBlockReason(wl('selfimprove'), 'codex/gpt-5.6-terra')).toBeNull();
  });
});

describe('resolveWorkloadModel', () => {
  it('prefers the setting over the code fallback', async () => {
    getSetting.mockResolvedValue({ modelId: 'z-ai/glm-5.2' });
    expect(await resolveWorkloadModel(wl('doctor'))).toEqual({
      provider: 'openrouter',
      modelId: 'z-ai/glm-5.2',
    });
  });

  it('falls back to the code default when unset', async () => {
    expect(await resolveWorkloadModel(wl('doctor'))).toEqual({
      provider: 'openrouter',
      modelId: 'deepseek/deepseek-v4-flash',
    });
  });

  it('follows the SITE DEFAULT for a role with no code fallback', async () => {
    // The thinking tier used to return the code constant here, which made it the
    // one role that quietly ignored the operator's choice.
    expect(await resolveWorkloadModel(wl('thinking'))).toEqual({
      provider: 'codex',
      modelId: 'codex/gpt-5.6-terra',
    });
  });

  it('recovers the provider from a stored Codex id', async () => {
    getSetting.mockResolvedValue({ modelId: 'codex/gpt-5.6-sol' });
    expect(await resolveWorkloadModel(wl('extraction'))).toEqual({
      provider: 'codex',
      modelId: 'codex/gpt-5.6-sol',
    });
  });
});

describe('describeSiteWorkloads', () => {
  it('marks each role pinned / code / default and flags divergence', async () => {
    getSetting.mockImplementation((key: string) =>
      Promise.resolve(key === 'jkai.vision.model' ? { modelId: 'openai/gpt-4o' } : null),
    );
    const rows = await describeSiteWorkloads();

    const vision = rows.find((r) => r.id === 'vision')!;
    expect(vision.source).toBe('pinned');
    expect(vision.effectiveModelId).toBe('openai/gpt-4o');

    const doctor = rows.find((r) => r.id === 'doctor')!;
    expect(doctor.source).toBe('code');
    expect(doctor.divergesFromDefault).toBe(true);

    // No setting and no code fallback → follows the site default, and therefore
    // does NOT diverge. That row is the "nothing to see here" case.
    const thinking = rows.find((r) => r.id === 'thinking')!;
    expect(thinking.source).toBe('default');
    expect(thinking.effectiveModelId).toBe('codex/gpt-5.6-terra');
    expect(thinking.divergesFromDefault).toBe(false);
  });
});

describe('setWorkloadModel', () => {
  beforeEach(() => {
    setSetting.mockReset();
    deleteSetting.mockReset();
  });

  it('DELETES the row to clear, never writing a null', async () => {
    // app_settings.value is jsonb NOT NULL, so `setSetting(key, null)` fails at
    // the driver and 500s the request. Caught by exercising the clear path
    // against a real database — the mocks alone would happily have accepted it.
    await setWorkloadModel(wl('doctor'), null);
    expect(deleteSetting).toHaveBeenCalledWith('jkai.workflowdoctor.model');
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('stores a Codex pick as a Codex context, not an OpenRouter one', async () => {
    await setWorkloadModel(wl('extraction'), 'codex/gpt-5.6-terra');
    expect(setSetting).toHaveBeenCalledWith('jkai.intel.extract_model', {
      provider: 'codex',
      modelId: 'codex/gpt-5.6-terra',
    });
  });
});
