import { describe, it, expect } from 'vitest';
import { requiredString, optionalString } from './tool-args';

describe('requiredString', () => {
  it('accepts a present value and trims it', () => {
    expect(requiredString({ name: '  watch-build-1  ' }, 'name')).toEqual({
      ok: true,
      value: 'watch-build-1',
    });
  });

  it('rejects a missing key instead of coercing it to "undefined"', () => {
    // The regression this exists for: `String(args.name)` on a missing key
    // produced the 9-character string "undefined", which then matched no row
    // and reported that the ACTION did not exist rather than that the CALL
    // was mis-keyed. Seen three times in one turn on 2026-08-09.
    const r = requiredString({ id: 'abc' }, 'name');
    expect(r).toEqual({ ok: false, error: 'name is required' });
  });

  it('rejects the literal strings "undefined" and "null" arriving as text', () => {
    expect(requiredString({ name: 'undefined' }, 'name').ok).toBe(false);
    expect(requiredString({ name: 'null' }, 'name').ok).toBe(false);
  });

  it('rejects empty and whitespace-only values', () => {
    expect(requiredString({ name: '' }, 'name').ok).toBe(false);
    expect(requiredString({ name: '   ' }, 'name').ok).toBe(false);
  });

  it('coerces non-strings, since Hermes stringifies tool args', () => {
    expect(requiredString({ n: 42 }, 'n')).toEqual({ ok: true, value: '42' });
  });
});

describe('optionalString', () => {
  it('returns undefined for absent, empty and "undefined"-as-text', () => {
    expect(optionalString({}, 'reason')).toBeUndefined();
    expect(optionalString({ reason: '' }, 'reason')).toBeUndefined();
    expect(optionalString({ reason: 'undefined' }, 'reason')).toBeUndefined();
    expect(optionalString({ reason: null }, 'reason')).toBeUndefined();
  });

  it('returns the trimmed value when present', () => {
    expect(optionalString({ reason: ' done ' }, 'reason')).toBe('done');
  });
});
