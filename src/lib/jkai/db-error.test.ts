import { describe, it, expect } from 'vitest';
import { describeDbError } from './db-error';

/** The shape drizzle-orm + postgres-js actually throws. */
function drizzleError(sqlState: string, driverMessage: string, extra: Record<string, unknown> = {}) {
  const cause = Object.assign(new Error(driverMessage), { code: sqlState, ...extra });
  return Object.assign(new Error(`Failed query: update "jkai_iterations" set ...`), { cause });
}

describe('describeDbError', () => {
  // The failure that cost build 85dac418 seven iterations' work, and took a
  // day to identify because this information was never logged.
  it('names the NUL-byte rejection in plain English', () => {
    const out = describeDbError(
      drizzleError('22P05', 'unsupported Unicode escape sequence'),
    );
    expect(out).toContain('22P05');
    expect(out).toContain('NUL byte');
    expect(out).toContain('unsupported Unicode escape sequence');
  });

  // The whole point: the parameter dump is what buried the cause. 400KB of it
  // per failure, seven times.
  it('never returns the query or its parameters', () => {
    const err = Object.assign(
      new Error(`Failed query: update "jkai_iterations" set "messages"=$1\nparams: ${'x'.repeat(50_000)}`),
      { cause: Object.assign(new Error('boom'), { code: '22P05' }) },
    );
    const out = describeDbError(err);
    expect(out).not.toContain('Failed query');
    expect(out).not.toContain('xxxxxxxxxx');
    expect(out.length).toBeLessThan(700);
  });

  it('includes detail and locates the column when the driver gives them', () => {
    const out = describeDbError(
      drizzleError('23502', 'null value in column violates not-null constraint', {
        detail: 'Failing row contains (1, null).',
        table_name: 'jkai_iterations',
        column_name: 'status',
      }),
    );
    expect(out).toContain('23502');
    expect(out).toContain('Failing row contains');
    expect(out).toContain('at jkai_iterations.status');
  });

  it('names the constraint when there is no column', () => {
    const out = describeDbError(
      drizzleError('23505', 'duplicate key', { constraint_name: 'jkai_builds_pkey' }),
    );
    expect(out).toContain('constraint jkai_builds_pkey');
  });

  it('passes an unrecognised code through rather than inventing a meaning', () => {
    const out = describeDbError(drizzleError('XX999', 'internal error'));
    expect(out).toContain('XX999');
    expect(out).toContain('internal error');
  });

  it('falls back to a clipped message when there is no structured cause', () => {
    expect(describeDbError(new Error('connection reset'))).toBe('connection reset');
    expect(describeDbError(new Error('y'.repeat(5000))).length).toBeLessThan(420);
  });

  it.each([[null], [undefined], ['a string'], [{}]])('does not throw on %o', (v) => {
    expect(() => describeDbError(v)).not.toThrow();
    expect(typeof describeDbError(v)).toBe('string');
  });

  it('reads a bare postgres error that was not wrapped by drizzle', () => {
    const bare = Object.assign(new Error('unsupported Unicode escape sequence'), { code: '22P05' });
    expect(describeDbError(bare)).toContain('NUL byte');
  });
});
