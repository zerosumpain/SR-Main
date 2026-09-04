import { describe, it, expect, vi } from 'vitest';
import { BIOME_DEFAULTS } from '$lib/biome/state';

// Note: Testing .svelte.ts files with $state runes requires Svelte compiler.
// If runes don't work in test context, test the pure logic only.

describe('biome store', () => {
  it('module exports createBiomeStore', async () => {
    // This test verifies the module can be imported
    // Full reactive testing requires a Svelte component context
    const mod = await import('$lib/biome/store.svelte');
    expect(mod.createBiomeStore).toBeDefined();
    expect(typeof mod.createBiomeStore).toBe('function');
  });

  it('polls shared state without polling optional renderer settings', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ...BIOME_DEFAULTS,
        weather: { ...BIOME_DEFAULTS.weather },
        sources: { ...BIOME_DEFAULTS.sources },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { createBiomeStore } = await import('$lib/biome/store.svelte');
    const store = createBiomeStore();
    store.startPolling();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledWith('/api/biome/state');

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    store.stopPolling();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('ignores a state response that arrives after polling stops', async () => {
    vi.useFakeTimers();
    let resolveFetch!: (response: {
      ok: boolean;
      json: () => Promise<typeof BIOME_DEFAULTS>;
    }) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => {
      resolveFetch = resolve;
    })));

    const { createBiomeStore } = await import('$lib/biome/store.svelte');
    const store = createBiomeStore();
    store.startPolling();
    store.stopPolling();
    resolveFetch({
      ok: true,
      json: async () => ({
        ...BIOME_DEFAULTS,
        pulse: 144,
        weather: { ...BIOME_DEFAULTS.weather },
        sources: { ...BIOME_DEFAULTS.sources, heartRate: true },
      }),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(store.targetState.pulse).toBe(BIOME_DEFAULTS.pulse);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
