import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bearerMatches } from '../../scripts/lib/bearer.mjs';

describe('bearerMatches (workspace broker auth)', () => {
  it('accepts only the exact bearer token', () => {
    expect(bearerMatches('Bearer s3cret', 's3cret')).toBe(true);
    expect(bearerMatches('Bearer s3cre', 's3cret')).toBe(false);
    expect(bearerMatches('Bearer s3cretX', 's3cret')).toBe(false);
    expect(bearerMatches('s3cret', 's3cret')).toBe(false);
    expect(bearerMatches(undefined, 's3cret')).toBe(false);
  });

  it('never matches when no token is configured', () => {
    expect(bearerMatches('Bearer ', '')).toBe(false);
    expect(bearerMatches('Bearer undefined', undefined)).toBe(false);
  });

  it('is what the broker uses, not a string comparison', () => {
    const broker = readFileSync(resolve('scripts/development-workspace-broker.mjs'), 'utf8');
    expect(broker).toContain('bearerMatches(req.headers.authorization, token)');
    expect(broker).not.toMatch(/authorization\s*!==/);
  });
});
