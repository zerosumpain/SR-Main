import { describe, it, expect, vi } from 'vitest';

// The meter writes through Drizzle; the credit arithmetic and the ambient-id
// plumbing are what these tests are about, so the database is a stub.
const update = vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) }));
vi.mock('$lib/db', () => ({ db: { update } }));

const {
  runWithResearchMeter,
  currentResearchSessionId,
  searchCredits,
  extractCredits,
  countTavilySearch,
  EXTRACT_URLS_PER_CREDIT,
} = await import('./meter');

describe('Tavily credit arithmetic', () => {
  it('prices a basic search at one credit and an advanced search at two', () => {
    expect(searchCredits('basic')).toBe(1);
    expect(searchCredits('advanced')).toBe(2);
    expect(searchCredits()).toBe(1);
  });

  it('bills extract per batch of five URLs, rounding up', () => {
    expect(EXTRACT_URLS_PER_CREDIT).toBe(5);
    expect(extractCredits(1)).toBe(1);
    expect(extractCredits(5)).toBe(1);
    expect(extractCredits(6)).toBe(2);
    expect(extractCredits(11)).toBe(3);
  });

  it('charges an advanced extract at double', () => {
    expect(extractCredits(6, 'advanced')).toBe(4);
  });

  it('treats an empty URL list as one batch — a request was still made', () => {
    expect(extractCredits(0)).toBe(1);
  });
});

describe('the ambient run id', () => {
  it('is null outside a run, so shared callers are unaffected', () => {
    expect(currentResearchSessionId()).toBeNull();
  });

  it('is readable from anywhere inside the run, across awaits', async () => {
    await runWithResearchMeter('sess-1', async () => {
      expect(currentResearchSessionId()).toBe('sess-1');
      await new Promise((r) => setTimeout(r, 1));
      expect(currentResearchSessionId()).toBe('sess-1');
    });
    expect(currentResearchSessionId()).toBeNull();
  });

  it('keeps two concurrent runs apart', async () => {
    const seen: string[] = [];
    await Promise.all([
      runWithResearchMeter('a', async () => {
        await new Promise((r) => setTimeout(r, 5));
        seen.push(currentResearchSessionId()!);
      }),
      runWithResearchMeter('b', async () => {
        seen.push(currentResearchSessionId()!);
      }),
    ]);
    expect(seen.sort()).toEqual(['a', 'b']);
  });
});

describe('counting', () => {
  it('does nothing at all outside a run', () => {
    update.mockClear();
    countTavilySearch('basic');
    expect(update).not.toHaveBeenCalled();
  });

  it('writes once per call inside a run', async () => {
    update.mockClear();
    await runWithResearchMeter('sess-2', async () => {
      countTavilySearch('advanced');
    });
    expect(update).toHaveBeenCalledTimes(1);
  });
});
