import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getHeroCopy,
  clearHeroCopyCache,
  _awaitInflight,
  type HeroCopyInput,
  type HeroCopy,
} from '$lib/health/hero-copy-service';

const fallback = {
  pickHeadline: (_rec: number) => ({ primary: 'FALLBACK.', ghost: 'FB.' }),
  buildStrap: () => 'Fallback strap mentioning numbers.',
};

const baseInput: HeroCopyInput = {
  date: '2026-05-01',
  rec: 67,
  hrv: 78,
  rhr: 56,
  slept: 7.4,
  rhrBaseline: 58,
  hrvDeltaPct: 4,
};

beforeEach(() => {
  clearHeroCopyCache();
});

describe('getHeroCopy', () => {
  it('first call returns fallback immediately, then LLM populates cache', async () => {
    const fake: HeroCopy = {
      headline: { primary: 'READY.', ghost: 'GO MOVE.' },
      strap: 'Recovery 67%, HRV up 4% overnight, RHR at baseline. Acceptable.',
    };
    const llm = vi.fn().mockResolvedValue(fake);

    const first = await getHeroCopy(baseInput, fallback, llm);
    expect(first.headline.primary).toBe('FALLBACK.');

    await _awaitInflight(baseInput);

    const second = await getHeroCopy(baseInput, fallback, llm);
    expect(second).toEqual(fake);
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent calls for the same key into one LLM call', async () => {
    const llm = vi.fn().mockResolvedValue({
      headline: { primary: 'A.', ghost: 'B.' },
      strap: 'Recovery 67%, slept 7.4h.',
    });
    // Three "page loads" arrive at the same time.
    await Promise.all([
      getHeroCopy(baseInput, fallback, llm),
      getHeroCopy(baseInput, fallback, llm),
      getHeroCopy(baseInput, fallback, llm),
    ]);
    await _awaitInflight(baseInput);
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it('regenerates when recovery score changes (key is date|rec)', async () => {
    const llm = vi.fn().mockResolvedValue({
      headline: { primary: 'A.', ghost: 'B.' },
      strap: 'Recovery 67%, slept 7.4h.',
    });
    await getHeroCopy(baseInput, fallback, llm);
    await _awaitInflight(baseInput);
    await getHeroCopy({ ...baseInput, rec: 72 }, fallback, llm);
    await _awaitInflight({ ...baseInput, rec: 72 });
    expect(llm).toHaveBeenCalledTimes(2);
  });

  it('does not regenerate when only HRV/RHR/sleep tick (Apple webhook churn)', async () => {
    const llm = vi.fn().mockResolvedValue({
      headline: { primary: 'A.', ghost: 'B.' },
      strap: 'Recovery 67%, slept 7.4h.',
    });
    await getHeroCopy(baseInput, fallback, llm);
    await _awaitInflight(baseInput);
    // Same date + recovery, but RHR/HRV/sleep updated mid-day.
    await getHeroCopy({ ...baseInput, hrv: 80, rhr: 55, slept: 7.6 }, fallback, llm);
    await _awaitInflight({ ...baseInput, hrv: 80, rhr: 55, slept: 7.6 });
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it('returns fallback when LLM throws — and keeps fallback cached briefly', async () => {
    const llm = vi.fn().mockRejectedValue(new Error('boom'));
    const out = await getHeroCopy(baseInput, fallback, llm);
    expect(out.headline.primary).toBe('FALLBACK.');
    await _awaitInflight(baseInput);
    // Fallback remains cached so we don't hammer a broken provider.
    const second = await getHeroCopy(baseInput, fallback, llm);
    expect(second.headline.primary).toBe('FALLBACK.');
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it('returns fallback when LLM returns null (validation failure)', async () => {
    const llm = vi.fn().mockResolvedValue(null);
    const out = await getHeroCopy(baseInput, fallback, llm);
    expect(out.headline.primary).toBe('FALLBACK.');
    await _awaitInflight(baseInput);
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it('does not block on a slow LLM call', async () => {
    let resolveLater: (v: HeroCopy | null) => void = () => {};
    const llm = vi.fn().mockReturnValue(new Promise<HeroCopy | null>((r) => { resolveLater = r; }));
    const start = Date.now();
    const out = await getHeroCopy(baseInput, fallback, llm);
    expect(Date.now() - start).toBeLessThan(50);
    expect(out.headline.primary).toBe('FALLBACK.');
    resolveLater(null); // let the background call settle so the test exits
    await _awaitInflight(baseInput);
  });
});
