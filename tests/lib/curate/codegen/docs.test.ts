import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appleCalendarSpec } from '../../../__fixtures__/curate-codegen/apple-calendar.spec';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '../../../__fixtures__/curate-codegen/expected');

describe('emitDocs', () => {
  it('emits markdown matching golden for apple-calendar', async () => {
    const { emitDocs } = await import('$lib/curate/codegen/docs');
    const got = emitDocs(appleCalendarSpec);
    const want = readFileSync(path.join(FIXTURE, 'apple-calendar.md.txt'), 'utf8');
    expect(got).toBe(want);
  });
});
