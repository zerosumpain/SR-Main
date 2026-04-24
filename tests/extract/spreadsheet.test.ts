import { describe, it, expect } from 'vitest';
import { extractSpreadsheet } from '../../src/lib/jkai/extract/spreadsheet';

describe('spreadsheet extractor', () => {
  it('reads csv into text + meta', async () => {
    const csv = 'name,age\nAlice,30\nBob,25\n';
    const r = await extractSpreadsheet(Buffer.from(csv, 'utf8'), 'text/csv', 'people.csv');
    expect(r.text).toContain('Alice');
    expect(r.text).toContain('Bob');
    if (r.meta.kind !== 'spreadsheet') throw new Error();
    expect(r.meta.sheets[0].rowCount).toBe(2);
    expect(r.meta.sheets[0].columns).toEqual(['name', 'age']);
  });
});
