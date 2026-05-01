import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getHeroCopy,
  clearHeroCopyCache,
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
  it('returns LLM output when valid', async () => {
    const fake: HeroCopy = {
      headline: { primary: 'READY.', ghost: 'GO MOVE.' },
      strap: 'Recovery 67%, HRV up 4% overnight, RHR at baseline. Acceptable.',
    };
    const llm = vi.fn().mockResolvedValue(fake);
    const out = await getHeroCopy(baseInput, fallback, llm);
    expect(out).toEqual(fake);
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it('caches identical input — only one LLM call', async () => {
    const llm = vi.fn().mockResolvedValue({
      headline: { primary: 'A.', ghost: 'B.' },
      strap: 'Recovery 67%, slept 7.4h.',
    });
    await getHeroCopy(baseInput, fallback, llm);
    await getHeroCopy(baseInput, fallback, llm);
    await getHeroCopy(baseInput, fallback, llm);
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it('regenerates when any underlying number changes', async () => {
    const llm = vi.fn().mockResolvedValue({
      headline: { primary: 'A.', ghost: 'B.' },
      strap: 'Recovery 67%, slept 7.4h.',
    });
    await getHeroCopy(baseInput, fallback, llm);
    await getHeroCopy({ ...baseInput, hrv: 80 }, fallback, llm);
    expect(llm).toHaveBeenCalledTimes(2);
  });

  it('falls back when LLM throws', async () => {
    const llm = vi.fn().mockRejectedValue(new Error('boom'));
    const out = await getHeroCopy(baseInput, fallback, llm);
    expect(out.headline.primary).toBe('FALLBACK.');
    expect(out.strap).toBe('Fallback strap mentioning numbers.');
  });

  it('falls back when LLM returns null (validation failure)', async () => {
    const llm = vi.fn().mockResolvedValue(null);
    const out = await getHeroCopy(baseInput, fallback, llm);
    expect(out.headline.primary).toBe('FALLBACK.');
  });

  it('caches the fallback too — failed LLM calls do not retry storm', async () => {
    const llm = vi.fn().mockRejectedValue(new Error('still down'));
    await getHeroCopy(baseInput, fallback, llm);
    await getHeroCopy(baseInput, fallback, llm);
    expect(llm).toHaveBeenCalledTimes(1);
  });
});
