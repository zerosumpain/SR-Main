import { describe, it, expect } from 'vitest';
import {
  parseCgql,
  cgqlForFingerprints,
  cgqlForFiles,
  CgqlError,
  MAX_HOPS,
  MAX_LIMIT,
  MAX_BUDGET,
} from './query';

describe('CGQL seeds', () => {
  it('parses a fingerprint seed — the hot lane', () => {
    const p = parseCgql('fingerprint:tsc:TS2345 | episodes limit=2');
    expect(p.seed).toEqual({ type: 'fingerprint', fingerprints: ['tsc:TS2345'] });
    expect(p.picks).toEqual([{ kind: 'episodes', limit: 2 }]);
  });

  it('parses a multi-file seed with a walk and a budget', () => {
    const p = parseCgql(
      'file:src/lib/jkai/executor.ts,src/lib/jkai/prompt.ts | hops 1 | lessons | episodes verdict=verified,landed limit=3 | budget 4000',
    );
    expect(p.seed).toEqual({
      type: 'file',
      paths: ['src/lib/jkai/executor.ts', 'src/lib/jkai/prompt.ts'],
    });
    expect(p.hops).toBe(1);
    expect(p.budgetChars).toBe(4000);
    expect(p.picks).toHaveLength(2);
    expect(p.picks[1].verdicts).toEqual(['verified', 'landed']);
  });

  it('accepts a quoted topic seed, single or double quotes', () => {
    expect(parseCgql('topic:"how the tool bridge authenticates"').seed).toEqual({
      type: 'topic',
      text: 'how the tool bridge authenticates',
    });
    expect(parseCgql("topic:'gate failures'").seed).toEqual({ type: 'topic', text: 'gate failures' });
  });

  it('gives a seed with no picks the useful default shape', () => {
    // Machine callers write bare seeds; returning nothing would be a silent miss.
    const p = parseCgql('file:src/hooks.server.ts');
    expect(p.picks.map((x) => x.kind)).toEqual(['lessons', 'episodes']);
    expect(p.budgetChars).toBe(5000);
  });
});

describe('CGQL rejects what it does not understand', () => {
  // The parser is the security boundary: every one of these would otherwise
  // reach a SQL builder or widen a match the caller did not intend.
  it.each([
    ['', 'empty query'],
    ['episodes limit=2', 'must start with a seed'],
    ['file:src/a.ts | frobnicate', 'unknown stage'],
    ['file:src/a.ts | episodes verdict=probably', 'unknown verdict'],
    ['file:src/a.ts | episodes bogus=1', 'unknown option'],
    ['file:src/a.ts | episodes limit', 'key=value'],
    ['file:src/a.ts | hops', 'hops needs a number'],
    ['file:src/a.ts | hops 9', 'capped'],
    ['file:src/a.ts | hops 1 nonsense_edge', 'unknown edge kind'],
    ['file:src/a.ts | | lessons', 'empty stage'],
    ['topic:unquoted text', 'must be quoted'],
    ['fingerprint:has space', 'invalid character'],
  ])('rejects %j', (input) => {
    expect(() => parseCgql(input)).toThrow(CgqlError);
  });

  it('refuses LIKE wildcards and traversal in a path', () => {
    // '%' and '_' are wildcards in LIKE but not in this grammar — allowing them
    // would let a caller silently widen its own match.
    expect(() => parseCgql('file:src/%')).toThrow(/not allowed/);
    expect(() => parseCgql('file:../../etc/passwd')).toThrow(/not allowed/);
    expect(() => parseCgql('file:src\\lib')).toThrow(/not allowed/);
  });

  it('reports a character position so the caller can point at the fault', () => {
    try {
      parseCgql('file:src/a.ts | hops 9');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CgqlError);
      expect((e as CgqlError).position).toBeGreaterThan(0);
    }
  });

  it('rejects an over-long query outright', () => {
    expect(() => parseCgql('file:' + 'a/'.repeat(1200) + '.ts')).toThrow(/too long/);
  });
});

describe('CGQL caps', () => {
  it('clamps an over-large limit instead of failing the whole query', () => {
    // Losing the retrieval entirely over a harmless overreach is worse than
    // giving the caller the most it may have.
    expect(parseCgql('file:src/a.ts | episodes limit=999').picks[0].limit).toBe(MAX_LIMIT);
  });

  it('clamps the budget at both ends', () => {
    expect(parseCgql('file:src/a.ts | budget 99999').budgetChars).toBe(MAX_BUDGET);
    expect(parseCgql('file:src/a.ts | budget 1').budgetChars).toBe(200);
  });

  it('allows a glob in a path', () => {
    expect(parseCgql('file:src/lib/jkai/*').seed).toEqual({ type: 'file', paths: ['src/lib/jkai/*'] });
  });

  it('accepts the documented maximum hop count', () => {
    expect(parseCgql(`file:src/a.ts | hops ${MAX_HOPS}`).hops).toBe(MAX_HOPS);
  });
});

describe('mechanical query builders', () => {
  it('accepts every fingerprint its own extractor can emit', () => {
    // The parser used to refuse '@', while fingerprint.ts emits
    // `vitest:missing-module:@openai/codex-sdk` — the second most common
    // recurring error in the corpus. A generator whose output its own parser
    // rejects makes the hot lane useless for precisely the repeat offenders.
    for (const fp of [
      'typecheck:TS2345',
      'svelte-check:a11y_click_events_have_key_events',
      'vitest:missing-module:@openai/codex-sdk',
      'vitest:errors.test.ts',
      'build:exit-1',
    ]) {
      expect(() => parseCgql(`fingerprint:${fp}`), fp).not.toThrow();
      expect(cgqlForFingerprints([fp])).toContain(fp);
    }
  });

  it('builds a fingerprint query and drops junk fingerprints', () => {
    const q = cgqlForFingerprints(['tsc:TS2345', 'bad fingerprint', 'vitest:AssertionError']);
    expect(q).toBe('fingerprint:tsc:TS2345,vitest:AssertionError | episodes verdict=verified,landed limit=3');
    expect(parseCgql(q!).seed).toEqual({
      type: 'fingerprint',
      fingerprints: ['tsc:TS2345', 'vitest:AssertionError'],
    });
  });

  it('returns null rather than an unusable query when nothing survives', () => {
    // An empty query would parse-error at the call site and be logged as a
    // FAILURE, when the truth is simply "there was nothing to ask about".
    expect(cgqlForFingerprints(['%%%'])).toBeNull();
    expect(cgqlForFingerprints([])).toBeNull();
    expect(cgqlForFiles([])).toBeNull();
    expect(cgqlForFiles(['../escape'])).toBeNull();
  });

  it('builds a file query that parses back to the same intent', () => {
    const q = cgqlForFiles(['src/lib/jkai/executor.ts'], { hops: 1, budget: 3000 });
    const p = parseCgql(q!);
    expect(p.seed).toEqual({ type: 'file', paths: ['src/lib/jkai/executor.ts'] });
    expect(p.hops).toBe(1);
    expect(p.budgetChars).toBe(3000);
  });

  it('never exceeds the hop cap even when asked to', () => {
    expect(parseCgql(cgqlForFiles(['src/a.ts'], { hops: 99 })!).hops).toBe(MAX_HOPS);
  });
});
