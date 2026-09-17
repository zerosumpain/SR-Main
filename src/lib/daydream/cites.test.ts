import { describe, it, expect } from 'vitest';
import { citeKey, resolveCites } from './cites';

describe('citeKey', () => {
  it('returns a bare key unchanged', () => {
    expect(citeKey('intent:0')).toBe('intent:0');
    expect(citeKey('F12')).toBe('F12');
  });

  it('strips the brackets a pack renders a key inside', () => {
    // The production failure, exactly: `renderAppetitePack` prints
    // `[intent:0] …` and the prompt asked for the key verbatim.
    expect(citeKey('[intent:0]')).toBe('intent:0');
    expect(citeKey('[F12]')).toBe('F12');
    expect(citeKey('`q:8`')).toBe('q:8');
    expect(citeKey(' [ watches ] ')).toBe('watches');
  });

  it('strips a nested or mixed wrapper', () => {
    expect(citeKey('[[F3]]')).toBe('F3');
    expect(citeKey('`[fault:tool_barren:x]`')).toBe('fault:tool_barren:x');
  });

  it('keeps the colons and dots that are part of a key', () => {
    expect(citeKey('[fault:workflow_failing:canvas:policy-analysis]')).toBe(
      'fault:workflow_failing:canvas:policy-analysis',
    );
    expect(citeKey('[ha:weather.forecast_home#humidity]')).toBe('ha:weather.forecast_home#humidity');
  });

  it('does not fold case or collapse a key into a neighbour', () => {
    expect(citeKey('[Intent:0]')).toBe('Intent:0');
    expect(citeKey('intel:4')).not.toBe('intel:5');
  });

  it('returns empty for anything that is not a string', () => {
    expect(citeKey(null)).toBe('');
    expect(citeKey(12)).toBe('');
    expect(citeKey('[]')).toBe('');
  });
});

describe('resolveCites', () => {
  const keys = new Set(['intent:0', 'q:8', 'source:ha']);

  it('resolves bracketed citations against a bare key set', () => {
    const r = resolveCites(['[intent:0]', '[q:8]'], keys);
    expect(r.hits).toEqual(['intent:0', 'q:8']);
    expect(r.misses).toEqual([]);
  });

  it('still misses a key that is genuinely not in the pack', () => {
    const r = resolveCites(['[intent:99]'], keys);
    expect(r.hits).toEqual([]);
    expect(r.misses).toEqual(['[intent:99]']);
  });

  it('reports a miss as the model wrote it, so a drop message can quote it', () => {
    const r = resolveCites(['made-up'], keys);
    expect(r.misses).toEqual(['made-up']);
  });

  it('deduplicates hits while keeping order', () => {
    const r = resolveCites(['q:8', '[q:8]', 'intent:0'], keys);
    expect(r.hits).toEqual(['q:8', 'intent:0']);
  });

  it('accepts a Map as the key holder, for the ponder card index', () => {
    const byId = new Map([['F1', { text: 'a' }]]);
    expect(resolveCites(['[F1]'], byId).hits).toEqual(['F1']);
  });

  it('treats a non-array as no citations', () => {
    expect(resolveCites(undefined, keys).hits).toEqual([]);
    expect(resolveCites('F1', keys).hits).toEqual([]);
  });
});
