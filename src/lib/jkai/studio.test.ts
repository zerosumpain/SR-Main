import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { STUDIO_BUDGET, MAX_CHALLENGE_LEN, MAX_TITLE_LEN, createStudioBuild } from './studio';

// studio.ts pulls the db client in at import time; nothing under test reaches
// it, because every case here is rejected by validation before the insert.
vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('./builder-client', () => ({ builderClient: { startBuild: async () => {} } }));

describe('studio budget', () => {
  it('allows a chapter-sized iteration without triggering the hourly cooldown', () => {
    // budget.ts counts every iteration in the window, failed ones included.
    // A chapter is a big unit; at the app default of 1M/hour a single 800k
    // chapter would sleep the build for the rest of the hour.
    expect(STUDIO_BUDGET.maxTokensPerHour).toBeGreaterThanOrEqual(3_000_000);
  });

  it('leaves headroom for the skeleton, repairs and a polish pass over 10 chapters', () => {
    expect(STUDIO_BUDGET.maxIterations).toBeGreaterThanOrEqual(20);
  });

  it('caps a single runaway iteration', () => {
    expect(STUDIO_BUDGET.maxTokensPerIteration).toBeGreaterThan(0);
  });

  it('caps total spend in the unit a human reasons about', () => {
    expect(STUDIO_BUDGET.maxCostUsd).toBeGreaterThan(0);
  });

  it('stops an agent that re-verifies forever', () => {
    expect(STUDIO_BUDGET.maxIdleIterations).toBeGreaterThan(0);
  });
});

/**
 * The caps have to live in the creator, not on the route.
 *
 * `studio_build` is registered in the `builds` toolset, so a running build's
 * own agent can start a Studio build over the tool bridge — a path that never
 * touches /api/jkai/studio's validation. At STUDIO_BUDGET's $15 and 480 minutes
 * apiece, an unvalidated second entry point is the expensive one.
 */
describe('createStudioBuild input caps', () => {
  const long = (n: number) => 'x'.repeat(n);

  it('rejects an over-long challenge rather than truncating it', async () => {
    // Truncation would silently halve the brief the whole build is grounded in,
    // and the caller could not tell.
    await expect(createStudioBuild({ challenge: long(MAX_CHALLENGE_LEN + 1) })).rejects.toThrow(
      /challenge too long/,
    );
  });

  it('rejects an over-long title', async () => {
    await expect(
      createStudioBuild({ challenge: 'explain school funding', title: long(MAX_TITLE_LEN + 1) }),
    ).rejects.toThrow(/title too long/);
  });

  it('still rejects an empty challenge', async () => {
    await expect(createStudioBuild({ challenge: '   ' })).rejects.toThrow(/challenge is required/);
  });

  it('measures the challenge after trimming, so whitespace is not a cap', async () => {
    const padded = `  ${long(MAX_CHALLENGE_LEN - 10)}  `;
    // Gets past validation and on to resolveDefaultModel (which the db mock
    // cannot serve) — the point is that it is NOT a length rejection.
    await expect(createStudioBuild({ challenge: padded })).rejects.not.toThrow(/too long/);
  });

  it('caps at the numbers the API route advertises', () => {
    expect(MAX_CHALLENGE_LEN).toBe(4_000);
    expect(MAX_TITLE_LEN).toBe(200);
  });

  it('is the single source of the caps the route enforces', () => {
    // The route imports them rather than re-declaring, so the two cannot drift.
    const route = readFileSync('src/routes/api/jkai/studio/+server.ts', 'utf-8');
    expect(route).toMatch(/import \{[^}]*MAX_CHALLENGE_LEN[^}]*\} from '\$lib\/jkai\/studio'/s);
    expect(route).not.toMatch(/const MAX_CHALLENGE_LEN\s*=/);
  });
});

/**
 * Both build-kickoff routes were unmatched by RATE_LIMITS, which only listed
 * /api/jkai/builds. A retry loop could queue Studio builds serially at up to
 * $15 and 480 minutes each.
 */
describe('studio + forge rate limit', () => {
  const hooks = readFileSync('src/hooks.server.ts', 'utf-8');

  it('matches the studio and forge kickoff routes', () => {
    const line = hooks
      .split('\n')
      .find((l) => l.includes('(studio|forge)') && l.includes('pattern:'));
    expect(line).toBeTruthy();
    const pattern = /^\/api\/jkai\/(studio|forge)(\/|$)/;
    expect(pattern.test('/api/jkai/studio')).toBe(true);
    expect(pattern.test('/api/jkai/forge')).toBe(true);
    expect(pattern.test('/api/jkai/forge/propose')).toBe(true);
    expect(pattern.test('/api/jkai/builds')).toBe(false);
  });

  it('allows about three an hour, not three a minute', () => {
    const line = hooks
      .split('\n')
      .find((l) => l.includes('(studio|forge)') && l.includes('pattern:'))!;
    expect(line).toContain('capacity: 3');
    expect(line).toContain('3 / 3600');
  });
});
