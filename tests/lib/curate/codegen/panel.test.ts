import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appleCalendarSpec } from '../../../__fixtures__/curate-codegen/apple-calendar.spec';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '../../../__fixtures__/curate-codegen/expected');

describe('emitPanel', () => {
  it('emits Svelte panel matching golden for apple-calendar', async () => {
    const { emitPanel } = await import('$lib/curate/codegen/panel');
    const got = emitPanel(appleCalendarSpec);
    const want = readFileSync(path.join(FIXTURE, 'AppleCalendarPanel.svelte.txt'), 'utf8');
    expect(got).toBe(want);
  });
});
