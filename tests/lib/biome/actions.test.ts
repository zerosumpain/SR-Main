// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeWindSkew, livingType } from '$lib/biome/actions';
import type { BiomeStore } from '$lib/biome/store.svelte';
import { BIOME_DEFAULTS } from '$lib/biome/state';

describe('computeWindSkew', () => {
  it('returns 0 for calm wind', () => {
    expect(computeWindSkew(0, 0)).toBe(0);
  });

  it('returns 0 for northerly wind (no east-west component)', () => {
    expect(computeWindSkew(0, 20)).toBeCloseTo(0, 5);
  });

  it('returns 0 for southerly wind (no east-west component)', () => {
    expect(computeWindSkew(180, 20)).toBeCloseTo(0, 3);
  });

  it('returns negative skew for easterly wind (90deg)', () => {
    const skew = computeWindSkew(90, 30);
    expect(skew).toBeLessThan(0);
    expect(Math.abs(skew)).toBeCloseTo(3, 0);
  });

  it('returns positive skew for westerly wind (270deg)', () => {
    const skew = computeWindSkew(270, 30);
    expect(skew).toBeGreaterThan(0);
    expect(Math.abs(skew)).toBeCloseTo(3, 0);
  });

  it('clamps speed at 30 km/h — higher speed does not increase skew', () => {
    const at30 = computeWindSkew(90, 30);
    const at50 = computeWindSkew(90, 50);
    expect(at30).toBeCloseTo(at50, 5);
  });

  it('scales linearly with speed below 30', () => {
    const at15 = computeWindSkew(90, 15);
    const at30 = computeWindSkew(90, 30);
    expect(at15).toBeCloseTo(at30 / 2, 1);
  });
});

describe('livingType action', () => {
  let node: HTMLElement;
  let rafCallbacks: FrameRequestCallback[];
  let rafId: number;

  function mockStore(overrides: Partial<typeof BIOME_DEFAULTS> = {}): BiomeStore {
    const state = { ...BIOME_DEFAULTS, ...overrides };
    return { state } as unknown as BiomeStore;
  }

  beforeEach(() => {
    node = document.createElement('p');
    node.style.letterSpacing = '-0.02em';
    rafCallbacks = [];
    rafId = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return ++rafId;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function flushRaf(time = 500) {
    const cbs = [...rafCallbacks];
    rafCallbacks = [];
    cbs.forEach(cb => cb(time));
  }

  it('modifies letter-spacing when enabled', () => {
    const store = mockStore({ pulse: 72, stale: false, sources: { heartRate: true, weather: true } });
    const action = livingType(node, () => ({ store, enabled: true }));
    flushRaf(500);
    // Should have set a letter-spacing value containing 'em'
    expect(node.style.letterSpacing).not.toBe('');
    expect(node.style.letterSpacing).toContain('em');
    action.destroy();
  });

  it('resets styles when disabled', () => {
    const store = mockStore({ pulse: 72, stale: false, sources: { heartRate: true, weather: true } });
    const action = livingType(node, () => ({ store, enabled: false }));
    flushRaf(500);
    expect(node.style.letterSpacing).toBe('');
    expect(node.style.transform).toBe('');
    action.destroy();
  });

  it('is a no-op when prefers-reduced-motion is set', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const store = mockStore({ pulse: 90 });
    const action = livingType(node, () => ({ store, enabled: true }));
    flushRaf(500);
    expect(node.style.letterSpacing).toBe('');
    action.destroy();
  });

  it('applies skewX for windy conditions', () => {
    const store = mockStore({
      weather: { condition: 'clear', temp: 15, windSpeed: 25, windDirection: 90 },
    });
    const action = livingType(node, () => ({ store, enabled: true }));
    for (let i = 0; i < 120; i++) flushRaf(i * 16.67);
    const transform = node.style.transform;
    expect(transform).toContain('skewX(');
    action.destroy();
  });

  it('uses reduced intensity when data is stale', () => {
    const freshStore = mockStore({ pulse: 72, stale: false, sources: { heartRate: true, weather: true } });
    const staleStore = mockStore({ pulse: 72, stale: true, sources: { heartRate: true, weather: true } });

    const freshNode = document.createElement('p');
    const staleNode = document.createElement('p');

    const freshAction = livingType(freshNode, () => ({ store: freshStore, enabled: true }));
    const staleAction = livingType(staleNode, () => ({ store: staleStore, enabled: true }));

    flushRaf(100);

    const freshSpacing = parseFloat(freshNode.style.letterSpacing);
    const staleSpacing = parseFloat(staleNode.style.letterSpacing);

    // Fresh data (intensity=40) should produce strictly larger modulation than stale (intensity=20)
    // at time=100ms which hits a beat peak for 72 BPM
    expect(freshSpacing).toBeGreaterThan(staleSpacing);

    freshAction.destroy();
    staleAction.destroy();
  });

  it('does not apply transform for near-zero wind', () => {
    const store = mockStore({
      weather: { condition: 'clear', temp: 15, windSpeed: 0.1, windDirection: 90 },
    });
    const action = livingType(node, () => ({ store, enabled: true }));
    for (let i = 0; i < 10; i++) flushRaf(i * 16.67);
    expect(node.style.transform).toBe('');
    action.destroy();
  });

  it('cancels rAF on destroy', () => {
    const store = mockStore();
    const action = livingType(node, () => ({ store, enabled: true }));
    action.destroy();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });
});
