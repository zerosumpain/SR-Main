import { describe, it, expect } from 'vitest';
import {
  checkCopy,
  validateGenerated,
  parseBatchResponse,
  generateBatch,
  pickVariant,
  type GenParams,
} from './hero-titles-service';
import { enumerateGrid } from './hero-titles-buckets';

const LIMITS = { headlineWords: 3, strapWords: 22 };
const PARAMS: GenParams = { style: '', headlineWords: 3, strapWords: 22 };

describe('validateGenerated', () => {
  const good = {
    primary: 'still.',
    ghost: 'but plotting.',
    strap: '{bpm} beats, {steps} steps, {temp} of {sky} London.',
  };

  it('accepts a well-formed entry and upper-cases the headline', () => {
    const r = validateGenerated(good, LIMITS);
    expect(r).not.toBeNull();
    expect(r!.primary).toBe('STILL.');
    expect(r!.ghost).toBe('BUT PLOTTING.');
    expect(r!.strapTemplate).toBe(good.strap);
  });

  it('rejects a missing field', () => {
    expect(validateGenerated({ primary: 'A.', ghost: 'B.' }, LIMITS)).toBeNull();
  });

  it('rejects digits in the headline', () => {
    expect(validateGenerated({ ...good, primary: '62 BPM.' }, LIMITS)).toBeNull();
  });

  it('rejects digits in the strap', () => {
    expect(
      validateGenerated({ ...good, strap: '62 beats and {bpm} more.' }, LIMITS),
    ).toBeNull();
  });

  it('rejects a strap with no {bpm} token', () => {
    expect(
      validateGenerated({ ...good, strap: 'a quiet morning of {sky}.' }, LIMITS),
    ).toBeNull();
  });

  it('rejects a headline with more words than the limit', () => {
    expect(
      validateGenerated({ ...good, primary: 'one two three four.' }, LIMITS),
    ).toBeNull();
  });

  it('accepts a longer headline when the limit allows it', () => {
    const r = validateGenerated(
      { ...good, primary: 'one two three four.' },
      { headlineWords: 6, strapWords: 22 },
    );
    expect(r).not.toBeNull();
  });

  it('rejects a strap with more words than the limit', () => {
    const longStrap = '{bpm} ' + Array(30).fill('word').join(' ');
    expect(validateGenerated({ ...good, strap: longStrap }, LIMITS)).toBeNull();
  });

  it('rejects a non-object', () => {
    expect(validateGenerated('nope', LIMITS)).toBeNull();
    expect(validateGenerated(null, LIMITS)).toBeNull();
  });
});

describe('checkCopy', () => {
  it('rejects an absurdly long single-word headline via the char ceiling', () => {
    expect(
      checkCopy('A'.repeat(70) + '.', 'OK.', '{bpm} and {sky}.', LIMITS),
    ).toBeNull();
  });
});

describe('parseBatchResponse', () => {
  const units = enumerateGrid().slice(0, 3);

  it('maps a full array of valid objects to rows', () => {
    const text = JSON.stringify(
      units.map(() => ({
        primary: 'still.',
        ghost: 'but here.',
        strap: '{bpm} beats, {steps} steps of {sky}.',
      })),
    );
    const rows = parseBatchResponse(text, units, PARAMS);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => !r.failed)).toBe(true);
    expect(rows[0].primary).toBe('STILL.');
  });

  it('fills missing entries with flagged fallback copy', () => {
    const text = JSON.stringify([
      { primary: 'still.', ghost: 'but here.', strap: '{bpm} beats of {sky}.' },
    ]);
    const rows = parseBatchResponse(text, units, PARAMS);
    expect(rows).toHaveLength(3);
    expect(rows[0].failed).toBe(false);
    expect(rows[1].failed).toBe(true);
    expect(rows[2].failed).toBe(true);
  });

  it('returns all-fallback rows for unparseable text', () => {
    const rows = parseBatchResponse('not json at all', units, PARAMS);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.failed)).toBe(true);
  });

  it('extracts a JSON array embedded in surrounding prose', () => {
    const text =
      'Here you go:\n[{"primary":"lit.","ghost":"go.","strap":"{bpm} and {sky}."}]';
    const rows = parseBatchResponse(text, units.slice(0, 1), PARAMS);
    expect(rows[0].failed).toBe(false);
    expect(rows[0].primary).toBe('LIT.');
  });

  it('records the style on each row', () => {
    const rows = parseBatchResponse('garbage', units, { ...PARAMS, style: 'noir' });
    expect(rows[0].style).toBe('noir');
  });
});

describe('generateBatch', () => {
  const units = enumerateGrid().slice(0, 2);

  it('retries up to three times then returns fallback rows', async () => {
    let calls = 0;
    const rows = await generateBatch(units, PARAMS, async () => {
      calls++;
      return null;
    });
    expect(calls).toBe(3);
    expect(rows.every((r) => r.failed)).toBe(true);
  });

  it('uses the first successful response', async () => {
    let calls = 0;
    const rows = await generateBatch(units, PARAMS, async () => {
      calls++;
      if (calls < 2) return null;
      return JSON.stringify(
        units.map(() => ({
          primary: 'lit up.',
          ghost: "don't stop.",
          strap: '{bpm} beats and {sky}.',
        })),
      );
    });
    expect(calls).toBe(2);
    expect(rows.every((r) => !r.failed)).toBe(true);
    expect(rows[0].primary).toBe('LIT UP.');
  });
});

describe('pickVariant', () => {
  const mk = (id: number, hr: number, steps: number, temp: number) =>
    ({ id, hrBucket: hr, stepsBucket: steps, tempBucket: temp }) as never;

  it('returns a row matching the bucket key', () => {
    const rows = [mk(1, 0, 0, 0), mk(2, 1, 1, 1), mk(3, 0, 0, 0)];
    const picked = pickVariant(rows, { hrBucket: 0, stepsBucket: 0, tempBucket: 0 });
    expect(picked).not.toBeNull();
    expect([1, 3]).toContain(picked!.id);
  });

  it('returns null when no row matches', () => {
    const rows = [mk(1, 0, 0, 0)];
    expect(
      pickVariant(rows, { hrBucket: 4, stepsBucket: 4, tempBucket: 5 }),
    ).toBeNull();
  });
});
