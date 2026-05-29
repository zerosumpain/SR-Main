import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appleCalendarSpec } from '../../../__fixtures__/node-builder-codegen/apple-calendar.spec';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '../../../__fixtures__/node-builder-codegen/expected');

describe('emitExecutor', () => {
  it('emits executor matching golden for apple-calendar', async () => {
    const { emitExecutor } = await import('$lib/node-builder/codegen/executor');
    const got = emitExecutor(appleCalendarSpec);
    const want = readFileSync(path.join(FIXTURE, 'apple-calendar.ts.txt'), 'utf8');
    expect(got).toBe(want);
  });
});
