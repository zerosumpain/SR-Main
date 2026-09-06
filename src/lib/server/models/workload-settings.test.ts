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
  resolveVisionModel,
} from './workload-settings';
import { getWorkload } from '$lib/models/workloads';
import { withChatContext } from '$lib/context/chat';

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

/**
 * The chat model picker is a claim about the whole session, not just the reply.
 *
 * Before this, an override reached the chat loop and its sub-agents and stopped:
 * the same turn would summarise a research report, compact its own history and
 * read an attached PDF on whatever the site default happened to be, while the
 * UI and the price snapshot both named the model the owner chose.
 *
 * Two properties are load-bearing and pull in opposite directions, which is why
 * they are tested together:
 *  - a pin the owner set REACHES every role that can run on it, and
 *  - it is WITHDRAWN from a role the model cannot serve, because the failure
 *    there is not a worse answer but a broken one.
 */
describe('the session pin', () => {
  const PINNED = { provider: 'openrouter' as const, modelId: 'openai/gpt-4o' };
  const inSession = <T>(fn: () => Promise<T>) => withChatContext({ sessionModel: PINNED }, fn);

  it('wins over the role fallback for an ordinary text role', async () => {
    // `doctor` pins DEFAULT_DOCTOR_MODEL_ID in code. A session pin outranks it:
    // the owner choosing a model in the composer is a later and more specific
    // instruction than a constant in the source.
    expect(await inSession(() => resolveWorkloadModel(wl('doctor')))).toEqual(PINNED);
  });

  it('wins over an explicitly pinned setting too', async () => {
    // The admin pin is site-scope and standing; the session pin is thread-scope
    // and deliberate. If the standing one won, the picker would be inert on
    // exactly the roles someone had bothered to configure.
    getSetting.mockResolvedValue({ modelId: 'z-ai/glm-5.2' });
    expect(await inSession(() => resolveWorkloadModel(wl('doctor')))).toEqual(PINNED);
  });

  it('does NOTHING outside a session', async () => {
    // The whole safety argument rests on this. Every nightly pass, scheduled
    // job and unpinned thread runs with no store, and must resolve exactly as it
    // did before the pin existed.
    getSetting.mockResolvedValue({ modelId: 'z-ai/glm-5.2' });
    expect(await resolveWorkloadModel(wl('doctor'))).toEqual({
      provider: 'openrouter',
      modelId: 'z-ai/glm-5.2',
    });
  });

  it('is withdrawn from vision when the pinned model cannot see', async () => {
    // gpt-oss-120b is text-only. Letting it serve OCR does not blur the answer,
    // it fails the extract — and a failed extract stamps the file's hash, so a
    // later code fix re-indexes nothing. The role keeps its own model instead.
    const textOnly = { provider: 'openrouter' as const, modelId: 'openai/gpt-oss-120b' };
    const got = await withChatContext({ sessionModel: textOnly }, () => resolveVisionModel());
    expect(got.modelId).not.toBe('openai/gpt-oss-120b');
  });

  it('reaches vision when the pinned model CAN see', async () => {
    // The gate is a capability check, not a blanket exemption for the role.
    expect(await inSession(() => resolveVisionModel())).toEqual(PINNED);
  });

  it('is withdrawn from image generation for a model that only reads images', async () => {
    // gpt-4o takes image input and emits none — the model a naive check waves
    // through, and the one that returns prose where a picture was wanted.
    const got = await inSession(() => resolveWorkloadModel(wl('image')));
    expect(got.modelId).not.toBe('openai/gpt-4o');
  });

  it('reaches image generation for a model that emits images', async () => {
    const generator = { provider: 'openrouter' as const, modelId: 'google/gemini-3.1-flash-image' };
    expect(await withChatContext({ sessionModel: generator }, () => resolveWorkloadModel(wl('image')))).toEqual(
      generator,
    );
  });

  it('never reaches embeddings, whatever is pinned', async () => {
    // Not a gate that happens to fail — a role the session model is the wrong
    // KIND of thing for. No chat model in the catalogue is an embedding model,
    // and a mismatched vector lands in a fixed-dimension column that cannot
    // hold it. Asserted so a later "why is embeddings excluded?" cleanup has to
    // delete a stated reason rather than an unexplained branch.
    const got = await inSession(() => resolveWorkloadModel(wl('embeddings')));
    expect(got.modelId).not.toBe(PINNED.modelId);
  });
});


describe('daydream reviewer inheritance', () => {
  it('follows JKAI chat default rather than the site default', async () => {
    getSetting.mockImplementation(async (key: string) => key === 'jkai.chat.turn_model' ? { modelId: 'codex/gpt-5.6-luna' } : null);
    expect((await resolveWorkloadModel(wl('daydream-review'))).modelId).toBe('codex/gpt-5.6-luna');
    const { describeSiteWorkloads } = await import('./workload-settings');
    expect((await describeSiteWorkloads()).find((w) => w.id === 'daydream-review')?.effectiveModelId).toBe('codex/gpt-5.6-luna');
  });
  it('honours an explicit reviewer override', async () => {
    getSetting.mockImplementation(async (key: string) => key === 'jkai.daydream.review_model' ? { modelId: 'codex/gpt-5.6-luna' } : null);
    expect((await resolveWorkloadModel(wl('daydream-review'))).modelId).toBe('codex/gpt-5.6-luna');
  });
});
