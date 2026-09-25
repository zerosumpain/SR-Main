import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, unknown>();
vi.mock('./settings', () => ({
  getSetting: vi.fn(async (key: string) => store.get(key) ?? null),
  setSetting: vi.fn(async (key: string, value: unknown) => void store.set(key, value)),
}));

const notifyOwner = vi.fn(async (_input: { title: string; body: string }) => ({ raised: true }));
vi.mock('$lib/server/notify', () => ({ notifyOwner: (input: { title: string; body: string }) => notifyOwner(input) }));

import {
  listCodexModels,
  probeCodexModel,
  prettyCodexName,
  refreshCodexCatalogue,
  type CatalogueRow,
  type ProbeResult,
} from './codex-discovery';
import { CODEX_MODELS } from './codex-catalogue';
import { thinkingLevelsFor } from '$lib/models/thinking';

/** Every static model, as the list would name them, plus `extra`. */
function catalogue(...extra: CatalogueRow[]): CatalogueRow[] {
  return [...CODEX_MODELS.map((m) => ({ slug: m.slug, visibility: 'list' })), ...extra];
}

const ok = (effortCeiling: 'max' | 'xhigh'): ProbeResult => ({ ok: true, effortCeiling });

beforeEach(() => {
  store.clear();
  notifyOwner.mockClear();
});

describe('prettyCodexName', () => {
  it('spells names the way the static table does', () => {
    expect(prettyCodexName('GPT-6-Sol')).toBe('GPT-6 Sol');
    expect(prettyCodexName('GPT-5.3-Codex-Spark')).toBe('GPT-5.3 Codex Spark');
    expect(prettyCodexName('Codex-Auto-Review')).toBe('Codex Auto Review');
  });
});

describe('probeCodexModel', () => {
  it('takes max when the model answers at max', async () => {
    const send = vi.fn(async () => {});
    expect(await probeCodexModel('gpt-7-nova', send)).toEqual({ ok: true, effortCeiling: 'max' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('steps down to xhigh when the API refuses max by name', async () => {
    const send = vi.fn(async (_slug: string, effort: string) => {
      if (effort === 'max') {
        throw new Error("Unsupported value: 'max' is not supported with the 'gpt-5.5' model.");
      }
    });
    expect(await probeCodexModel('gpt-5.5', send)).toEqual({ ok: true, effortCeiling: 'xhigh' });
  });

  it('rejects a model the subscription cannot run, without trying lower', async () => {
    const send = vi.fn(async () => {
      throw new Error("The 'gpt-6-terra' model is not supported when using Codex with a ChatGPT account.");
    });
    const result = await probeCodexModel('gpt-6-terra', send);
    expect(result.ok).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('refreshCodexCatalogue', () => {
  const deps = (rows: CatalogueRow[], probe: (slug: string) => Promise<ProbeResult>) => ({
    clientVersion: async () => '0.160.0',
    fetchCatalogue: async () => rows,
    probe,
  });

  it('adds a new listed model that answers, and says so', async () => {
    const probe = vi.fn(async () => ok('max'));
    const report = await refreshCodexCatalogue(
      deps(catalogue({ slug: 'gpt-7-nova', display_name: 'GPT-7-Nova', description: 'New.', visibility: 'list' }), probe),
    );
    expect(report.added.map((m) => m.slug)).toEqual(['gpt-7-nova']);
    expect(probe).toHaveBeenCalledWith('gpt-7-nova');
    expect(notifyOwner).toHaveBeenCalledOnce();
    expect(notifyOwner.mock.calls[0][0].title).toBe('New Codex model: GPT-7 Nova');

    const listed = await listCodexModels();
    const nova = listed.find((m) => m.slug === 'gpt-7-nova');
    expect(nova).toMatchObject({ name: 'GPT-7 Nova', discovered: true, effortCeiling: 'max' });
    // The ceiling reaches the thinking menu, not just the list.
    expect(thinkingLevelsFor('codex', 'codex/gpt-7-nova').at(-1)).toBe('max');
  });

  it('never probes a model the static table already has, or a hidden one', async () => {
    const probe = vi.fn(async () => ok('max'));
    const report = await refreshCodexCatalogue(deps(catalogue({ slug: 'gpt-reserve', visibility: 'hide' }), probe));
    expect(probe).not.toHaveBeenCalled();
    expect(report.added).toEqual([]);
    expect(notifyOwner).not.toHaveBeenCalled();
  });

  it('does not offer a model that fails its probe', async () => {
    const report = await refreshCodexCatalogue(
      deps(catalogue({ slug: 'gpt-6-terra', visibility: 'list' }), async () => ({ ok: false, reason: 'not supported' })),
    );
    expect(report.rejected).toEqual([{ slug: 'gpt-6-terra', reason: 'not supported' }]);
    expect((await listCodexModels()).some((m) => m.slug === 'gpt-6-terra')).toBe(false);
  });

  it('probes a model once, then keeps it on later nights', async () => {
    const probe = vi.fn(async () => ok('xhigh'));
    const rows = catalogue({ slug: 'gpt-7-nova', visibility: 'list' });
    await refreshCodexCatalogue(deps(rows, probe));
    notifyOwner.mockClear();
    const second = await refreshCodexCatalogue(deps(rows, probe));
    expect(probe).toHaveBeenCalledOnce();
    expect(second.added).toEqual([]);
    expect(notifyOwner).not.toHaveBeenCalled();
    expect((await listCodexModels()).find((m) => m.slug === 'gpt-7-nova')?.effortCeiling).toBe('xhigh');
  });

  it('drops a discovered model once the list stops naming it', async () => {
    await refreshCodexCatalogue(deps(catalogue({ slug: 'gpt-7-nova', visibility: 'list' }), async () => ok('max')));
    const report = await refreshCodexCatalogue(deps(catalogue(), async () => ok('max')));
    expect(report.dropped).toEqual(['gpt-7-nova']);
    expect((await listCodexModels()).some((m) => m.slug === 'gpt-7-nova')).toBe(false);
  });

  it('reports a static model missing from the list once, not every night', async () => {
    const gone = CODEX_MODELS[CODEX_MODELS.length - 1].slug;
    const rows = catalogue().filter((r) => r.slug !== gone);
    const first = await refreshCodexCatalogue(deps(rows, async () => ok('max')));
    expect(first.newlyUnlisted).toEqual([gone]);
    expect(notifyOwner).toHaveBeenCalledOnce();
    const second = await refreshCodexCatalogue(deps(rows, async () => ok('max')));
    expect(second.newlyUnlisted).toEqual([]);
    expect(notifyOwner).toHaveBeenCalledOnce();
  });

  it('throws when the list cannot be read, leaving the stored result alone', async () => {
    await expect(
      refreshCodexCatalogue({ clientVersion: async () => '0.160.0', fetchCatalogue: async () => null }),
    ).rejects.toThrow(/unavailable/);
    expect(store.size).toBe(0);
  });
});
