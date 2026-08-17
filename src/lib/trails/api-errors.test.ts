import { describe, expect, it } from 'vitest';
import { describeSaveError } from './api-errors';

describe('describeSaveError', () => {
  it('surfaces the pg cause, not the query dump', () => {
    const err = new Error(
      'Failed query: insert into "planned_routes" (...) params: ' + 'x'.repeat(50_000),
    );
    (err as Error & { cause: Error }).cause = new Error(
      'invalid input syntax for type integer: "3070.9"',
    );
    const msg = describeSaveError(err);
    expect(msg).toBe('invalid input syntax for type integer: "3070.9"');
    expect(msg.length).toBeLessThanOrEqual(200);
  });

  it('passes a plain validation message through untouched', () => {
    expect(describeSaveError(new Error('A route needs at least two points'))).toBe(
      'A route needs at least two points',
    );
  });

  it('caps an uncaused query dump at one short line', () => {
    const msg = describeSaveError(new Error('Failed query: insert...\nparams: ' + 'y'.repeat(9000)));
    expect(msg).toBe('Failed query: insert...');
  });

  it('copes with non-Error throws', () => {
    expect(describeSaveError('boom')).toBe('unknown error');
  });
});
