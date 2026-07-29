import { describe, it, expect } from 'vitest';
import { registryName, schemaSupportsBatching, validateOverride } from './optimise';

describe('resolving a pattern back to a registry tool', () => {
  it('strips the jkai_extended display prefix', () => {
    expect(registryName('jkai:fetch_url')).toBe('fetch_url');
  });
  it('leaves a directly-called tool name alone', () => {
    expect(registryName('api_call')).toBe('api_call');
  });
});

describe('detecting whether a tool can actually batch', () => {
  it('finds an array parameter', () => {
    expect(
      schemaSupportsBatching({ type: 'object', properties: { urls: { type: 'array' } } }),
    ).toBe(true);
  });
  it('finds a union that includes array', () => {
    expect(
      schemaSupportsBatching({ type: 'object', properties: { url: { type: ['string', 'array'] } } }),
    ).toBe(true);
  });
  it('rejects a single-value schema', () => {
    expect(
      schemaSupportsBatching({ type: 'object', properties: { url: { type: 'string' } } }),
    ).toBe(false);
  });
  it('rejects malformed or absent schemas rather than assuming', () => {
    expect(schemaSupportsBatching(null)).toBe(false);
    expect(schemaSupportsBatching({})).toBe(false);
    expect(schemaSupportsBatching('nonsense')).toBe(false);
  });
});

describe('overlay validation — the guard against promising what the schema cannot do', () => {
  const singleValue = { type: 'object', properties: { url: { type: 'string' } } };
  const batchable = { type: 'object', properties: { urls: { type: 'array' } } };

  it('rejects an overlay telling the caller to pass an array to a single-value tool', () => {
    const r = validateOverride(
      { description: 'Fetch pages. Accepts an array of URLs.' },
      singleValue,
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no parameter accepts an array/);
  });

  it('rejects the same claim phrased as "all in one call"', () => {
    expect(validateOverride({ guidance: 'Pass all URLs in one call.' }, singleValue).ok).toBe(false);
  });

  it('rejects "batch" phrasing', () => {
    expect(validateOverride({ guidance: 'Batch your requests.' }, singleValue).ok).toBe(false);
  });

  it('allows the batching claim when the schema genuinely supports it', () => {
    expect(validateOverride({ guidance: 'Pass an array of URLs.' }, batchable).ok).toBe(true);
  });

  it('allows non-batching advice on a single-value tool', () => {
    const r = validateOverride(
      { guidance: 'Repeating this with near-identical arguments returns the same data.' },
      singleValue,
    );
    expect(r.ok).toBe(true);
  });

  it('rejects an empty overlay', () => {
    expect(validateOverride({}, batchable).ok).toBe(false);
    expect(validateOverride({ description: '   ' }, batchable).ok).toBe(false);
  });
});
