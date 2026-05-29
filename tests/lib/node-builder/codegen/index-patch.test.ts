import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appleCalendarSpec } from '../../../__fixtures__/node-builder-codegen/apple-calendar.spec';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '../../../__fixtures__/node-builder-codegen');

describe('patchWorkflowsIndex', () => {
  it('adds the import + register call for apple-calendar', async () => {
    const { patchWorkflowsIndex } = await import('$lib/node-builder/codegen/index-patch');
    const base = readFileSync(path.join(FIXTURE, 'index-base.ts.txt'), 'utf8');
    const got = patchWorkflowsIndex(base, appleCalendarSpec);
    const want = readFileSync(path.join(FIXTURE, 'expected/index-patched.ts.txt'), 'utf8');
    expect(got).toBe(want);
  });

  it('is idempotent — patching twice produces the same output', async () => {
    const { patchWorkflowsIndex } = await import('$lib/node-builder/codegen/index-patch');
    const base = readFileSync(path.join(FIXTURE, 'index-base.ts.txt'), 'utf8');
    const once = patchWorkflowsIndex(base, appleCalendarSpec);
    const twice = patchWorkflowsIndex(once, appleCalendarSpec);
    expect(twice).toBe(once);
  });
});
