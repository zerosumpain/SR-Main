import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appleCalendarSpec } from '../../../__fixtures__/curate-codegen/apple-calendar.spec';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '../../../__fixtures__/curate-codegen');

describe('patchPanelRegistry', () => {
  it('adds the import + specialized entry for apple-calendar', async () => {
    const { patchPanelRegistry } = await import('$lib/curate/codegen/registry-patch');
    const base = readFileSync(path.join(FIXTURE, 'registry-base.ts.txt'), 'utf8');
    const got = patchPanelRegistry(base, appleCalendarSpec);
    const want = readFileSync(path.join(FIXTURE, 'expected/registry-patched.ts.txt'), 'utf8');
    expect(got).toBe(want);
  });

  it('is idempotent — patching twice produces the same output', async () => {
    const { patchPanelRegistry } = await import('$lib/curate/codegen/registry-patch');
    const base = readFileSync(path.join(FIXTURE, 'registry-base.ts.txt'), 'utf8');
    const once = patchPanelRegistry(base, appleCalendarSpec);
    const twice = patchPanelRegistry(once, appleCalendarSpec);
    expect(twice).toBe(once);
  });
});
