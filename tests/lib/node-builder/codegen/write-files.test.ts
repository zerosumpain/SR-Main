import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { appleCalendarSpec } from '../../../__fixtures__/node-builder-codegen/apple-calendar.spec';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tempDir: string;
let srDocsDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-write-'));
  srDocsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-srdocs-'));

  // Seed fake panels/registry.ts and workflows/index.ts in tempDir so the
  // patchers have something to write into.
  fs.mkdirSync(path.join(tempDir, 'src/lib/canvas/nodes/panels'), { recursive: true });
  fs.mkdirSync(path.join(tempDir, 'src/lib/workflows/nodes'), { recursive: true });
  fs.mkdirSync(path.join(srDocsDir, 'content/internal/features/workflows/nodes'), { recursive: true });

  const FIXTURE = path.join(__dirname, '../../../__fixtures__/node-builder-codegen');
  fs.writeFileSync(
    path.join(tempDir, 'src/lib/canvas/nodes/panels/registry.ts'),
    fs.readFileSync(path.join(FIXTURE, 'registry-base.ts.txt'), 'utf8'),
  );
  fs.writeFileSync(
    path.join(tempDir, 'src/lib/workflows/index.ts'),
    fs.readFileSync(path.join(FIXTURE, 'index-base.ts.txt'), 'utf8'),
  );
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.rmSync(srDocsDir, { recursive: true, force: true });
});

describe('writeNodeFiles', () => {
  it('writes all expected files for apple-calendar', async () => {
    const { writeNodeFiles } = await import('$lib/node-builder/codegen/write-files');
    const result = await writeNodeFiles(appleCalendarSpec, tempDir, srDocsDir);
    expect(result.written).toEqual(
      expect.arrayContaining([
        'src/lib/workflows/nodes/apple-calendar.def.ts',
        'src/lib/workflows/nodes/apple-calendar.ts',
        'src/lib/canvas/nodes/panels/AppleCalendarPanel.svelte',
        'src/lib/canvas/nodes/panels/registry.ts',
        'src/lib/workflows/index.ts',
      ]),
    );
    // sr-docs path is relative to srDocsDir.
    expect(
      fs.existsSync(
        path.join(srDocsDir, 'content/internal/features/workflows/nodes/apple-calendar.md'),
      ),
    ).toBe(true);
  });

  it('is idempotent — running twice produces identical files', async () => {
    const { writeNodeFiles } = await import('$lib/node-builder/codegen/write-files');
    await writeNodeFiles(appleCalendarSpec, tempDir, srDocsDir);
    const snapshot1 = fs.readFileSync(
      path.join(tempDir, 'src/lib/canvas/nodes/panels/registry.ts'),
      'utf8',
    );
    await writeNodeFiles(appleCalendarSpec, tempDir, srDocsDir);
    const snapshot2 = fs.readFileSync(
      path.join(tempDir, 'src/lib/canvas/nodes/panels/registry.ts'),
      'utf8',
    );
    expect(snapshot2).toBe(snapshot1);
  });
});
