import { describe, it, expect } from 'vitest';
import { summarizeStoreValue, STORE_VALUE_PREVIEW_LIMIT } from './data-store-summary';

describe('summarizeStoreValue', () => {
  it('serialises a small value without truncating', () => {
    const r = summarizeStoreValue({ a: 1, b: 'x' });
    expect(r.value).toBe('{"a":1,"b":"x"}');
    expect(r.truncated).toBe(false);
    expect(r.itemCount).toBeNull();
  });

  it('reports array length as itemCount', () => {
    const r = summarizeStoreValue(['a', 'b', 'c']);
    expect(r.itemCount).toBe(3);
    expect(r.value).toBe('["a","b","c"]');
  });

  it('truncates to the limit and sets the truncated flag', () => {
    const big = 'x'.repeat(5000);
    const r = summarizeStoreValue(big);
    expect(r.truncated).toBe(true);
    expect(r.value.length).toBe(STORE_VALUE_PREVIEW_LIMIT);
  });

  it('respects a custom limit', () => {
    const r = summarizeStoreValue([1, 2, 3, 4, 5], 5);
    expect(r.truncated).toBe(true);
    expect(r.value.length).toBe(5);
    expect(r.itemCount).toBe(5);
  });

  it('serialises null as the JSON literal', () => {
    const r = summarizeStoreValue(null);
    expect(r.value).toBe('null');
    expect(r.truncated).toBe(false);
    expect(r.itemCount).toBeNull();
  });

  it('falls back to String() for non-serialisable values', () => {
    expect(summarizeStoreValue(undefined).value).toBe('undefined');
  });
});
