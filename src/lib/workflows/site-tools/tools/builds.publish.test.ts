import { describe, it, expect, vi } from 'vitest';
import { coerceFilesArg, coerceChecksArg } from './builds';
import { resolvePublishSlug, slugifyTitle } from '$lib/jkai/publish-slug';

// The module registers its tools at import time and pulls in the db client to
// do it. None of the helpers under test touch the database.
vi.mock('$lib/db', () => ({ db: {} }));

/**
 * The four shapes `files` actually arrives in. Hermes stringifies nested
 * argument values, so a well-formed call from the model reaches the tool
 * JSON-encoded to some depth. Before 2026-08-08 anything but the first shape
 * was rejected outright with "each file needs string path + string content",
 * and the model's response was to give up on the tool and edit a scratch file
 * in /tmp instead.
 */
describe('coerceFilesArg', () => {
  const one = { path: 'index.html', content: '<!doctype html><p>hi</p>' };

  it('takes a real array of objects', () => {
    expect(coerceFilesArg([one])).toEqual({ ok: true, files: [one] });
  });

  it('takes the whole array as a JSON string', () => {
    expect(coerceFilesArg(JSON.stringify([one]))).toEqual({ ok: true, files: [one] });
  });

  it('takes an array holding one stringified array — the shape that failed in production', () => {
    expect(coerceFilesArg([JSON.stringify([one])])).toEqual({ ok: true, files: [one] });
  });

  it('takes an array of per-file JSON strings', () => {
    const two = { path: 'app.js', content: 'console.log(1)' };
    expect(coerceFilesArg([JSON.stringify(one), JSON.stringify(two)])).toEqual({
      ok: true,
      files: [one, two],
    });
  });

  it('accepts a bare single object', () => {
    expect(coerceFilesArg(one)).toEqual({ ok: true, files: [one] });
  });

  it('accepts name/body as aliases for path/content', () => {
    const r = coerceFilesArg([{ name: 'index.html', body: '<p>x</p>' }]);
    expect(r).toEqual({ ok: true, files: [{ path: 'index.html', content: '<p>x</p>' }] });
  });

  it('keeps content verbatim when it merely looks like JSON', () => {
    const f = { path: 'data.json', content: '{"a":1}' };
    expect(coerceFilesArg([f])).toEqual({ ok: true, files: [f] });
  });

  it('names the missing key rather than restating the rule', () => {
    const r = coerceFilesArg([{ content: '<p>x</p>' }]);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain('no "path"');
    expect((r as { error: string }).error).toContain('content');
  });

  it('names the shape it got when an entry is not an object', () => {
    const r = coerceFilesArg([42]);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain('a number');
  });

  it('rejects an empty list', () => {
    expect(coerceFilesArg([]).ok).toBe(false);
  });
});

/**
 * `checks` arrives stringified for exactly the same reason `files` does. Were
 * it dropped on the floor, an app would register with no behavioural coverage
 * while looking, from the outside, as though it had been tested — which is the
 * precise failure this whole feature exists to prevent.
 */
describe('coerceChecksArg', () => {
  const c = { description: '7 + 8 gives 15', script: 'return true;' };

  it('takes a real array', () => {
    expect(coerceChecksArg([c])).toEqual([c]);
  });

  it('takes the array as a JSON string', () => {
    expect(coerceChecksArg(JSON.stringify([c]))).toEqual([c]);
  });

  it('takes an array holding one stringified array', () => {
    expect(coerceChecksArg([JSON.stringify([c])])).toEqual([c]);
  });

  it('is empty when absent', () => {
    expect(coerceChecksArg(undefined)).toEqual([]);
    expect(coerceChecksArg(null)).toEqual([]);
  });

  it('drops malformed entries rather than failing the whole registration', () => {
    expect(coerceChecksArg([c, { description: 'no script' }, 'nonsense', 7])).toEqual([c]);
  });

  it('names an unlabelled check rather than dropping it', () => {
    expect(coerceChecksArg([{ script: 'return true;' }])).toEqual([
      { description: 'unnamed check', script: 'return true;' },
    ]);
  });
});

describe('resolvePublishSlug', () => {
  const build = { id: 'fd30c69b-016c-43c1', title: 'Graphing Calculator', prompt: 'rewrite it' };

  it('honours an explicit slug — this is how a page gets replaced', () => {
    expect(resolvePublishSlug(build, 'simple-calculator')).toEqual({
      ok: true,
      slug: 'simple-calculator',
    });
  });

  it('normalises a scruffy explicit slug', () => {
    expect(resolvePublishSlug(build, '  Simple Calculator!  ')).toEqual({
      ok: true,
      slug: 'simple-calculator',
    });
  });

  it('derives from the title when no slug is given', () => {
    expect(resolvePublishSlug(build, '')).toEqual({ ok: true, slug: 'graphing-calculator' });
  });

  it('falls back to the prompt, then the id', () => {
    expect(resolvePublishSlug({ ...build, title: null }, '')).toEqual({ ok: true, slug: 'rewrite-it' });
    expect(resolvePublishSlug({ id: 'abcdef123456', title: null, prompt: '' }, '')).toEqual({
      ok: true,
      slug: 'abcdef12',
    });
  });

  it('refuses a slug with nothing usable in it', () => {
    const r = resolvePublishSlug(build, '!!!');
    expect(r.ok).toBe(false);
  });
});

describe('slugifyTitle', () => {
  it('matches what the publish route produces', () => {
    expect(slugifyTitle('Simple Calculator')).toBe('simple-calculator');
    expect(slugifyTitle('--Trimmed--')).toBe('trimmed');
    expect(slugifyTitle('x'.repeat(80))).toHaveLength(60);
  });
});
