import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withPrivateFootprint } from './private-footprint.server';
import type { SOURCE_FOOTPRINT } from 'virtual:sr-source-footprint';

const temp = mkdtempSync(join(tmpdir(), 'sr-private-footprint-'));
afterEach(() => rmSync(temp, { recursive: true, force: true }));

describe('private site footprint', () => {
  it('adds private repositories to the owner result without changing the public build value', () => {
    const main = {
      lines: 10, files: 1,
      categories: {
        code: { lines: 10, files: 1 },
        documentation: { lines: 2, files: 1 },
        tests: { lines: 3, files: 1 },
      },
      repositories: [{
        id: 'main', name: 'SR-Main', url: 'https://github.com/zerosumpain/SR-Main',
        role: 'Site', revision: 'abc', measuredAt: '2026-09-26', source: 'this build',
        code: { lines: 10, files: 1 }, documentation: { lines: 2, files: 1 },
        tests: { lines: 3, files: 1 },
      }],
      measuredAt: '2026-09-26', snapshotAt: null,
    } satisfies typeof SOURCE_FOOTPRINT;
    const path = join(temp, 'footprint.json');
    writeFileSync(path, JSON.stringify({
      measuredAt: '2026-09-26',
      repositories: Array.from({ length: 7 }, (_, index) => ({
        id: `private-${index}`, name: `Private ${index}`, url: 'https://example.com',
        role: 'Service', revision: 'def', measuredAt: '2026-09-26', source: 'revision snapshot',
        code: { lines: 4, files: 1 }, documentation: { lines: 5, files: 1 },
        tests: { lines: 6, files: 1 },
      })),
    }));

    const owner = withPrivateFootprint(main, path);
    expect(owner.repositories).toHaveLength(8);
    expect(owner.categories.code.lines).toBe(38);
    expect(owner.categories.documentation.lines).toBe(37);
    expect(owner.categories.tests.lines).toBe(45);
    expect(main.repositories).toHaveLength(1);
    expect(main.categories.code.lines).toBe(10);
  });
});
