import { describe, it, expect, vi } from 'vitest';
import { VITALS_DEFAULTS } from '$lib/vitals/state';

// Note: Testing .svelte.ts files with $state runes requires Svelte compiler.
// If runes don't work in test context, test the pure logic only.

describe('vitals store', () => {
  it('module exports createVitalsStore', async () => {
    // This test verifies the module can be imported
    // Full reactive testing requires a Svelte component context
    const mod = await import('$lib/vitals/store.svelte');
    expect(mod.createVitalsStore).toBeDefined();
    expect(typeof mod.createVitalsStore).toBe('function');
  });

  it('polls shared state without polling optional renderer settings', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ...VITALS_DEFAULTS,
        weather: { ...VITALS_DEFAULTS.weather },
        sources: { ...VITALS_DEFAULTS.sources },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { createVitalsStore } = await import('$lib/vitals/store.svelte');
    const store = createVitalsStore();
    store.startPolling();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledWith('/api/vitals/state');

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
      json: () => Promise<typeof VITALS_DEFAULTS>;
    }) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => {
      resolveFetch = resolve;
    })));

    const { createVitalsStore } = await import('$lib/vitals/store.svelte');
    const store = createVitalsStore();
    store.startPolling();
    store.stopPolling();
    resolveFetch({
      ok: true,
      json: async () => ({
        ...VITALS_DEFAULTS,
        pulse: 144,
        weather: { ...VITALS_DEFAULTS.weather },
        sources: { ...VITALS_DEFAULTS.sources, heartRate: true },
      }),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(store.targetState.pulse).toBe(VITALS_DEFAULTS.pulse);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
