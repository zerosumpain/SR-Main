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
    const originalCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const result = await writeNodeFiles(appleCalendarSpec, srDocsDir);
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
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('is idempotent — running twice produces identical files', async () => {
    const { writeNodeFiles } = await import('$lib/node-builder/codegen/write-files');
    const originalCwd = process.cwd();
    process.chdir(tempDir);
    try {
      await writeNodeFiles(appleCalendarSpec, srDocsDir);
      const snapshot1 = fs.readFileSync(
        path.join(tempDir, 'src/lib/canvas/nodes/panels/registry.ts'),
        'utf8',
      );
      await writeNodeFiles(appleCalendarSpec, srDocsDir);
      const snapshot2 = fs.readFileSync(
        path.join(tempDir, 'src/lib/canvas/nodes/panels/registry.ts'),
        'utf8',
      );
      expect(snapshot2).toBe(snapshot1);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('writes node files relative to process.cwd() when no worktreeDir is passed', async () => {
    const { writeNodeFiles } = await import('$lib/node-builder/codegen/write-files');
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-cwd-'));
    const cwdSrDocsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-srdocs-'));

    // Seed registry.ts and index.ts so the patch emitters have something to read.
    fs.mkdirSync(path.join(repoRoot, 'src/lib/canvas/nodes/panels'), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, 'src/lib/canvas/nodes/panels/registry.ts'),
      fs.readFileSync(
        path.join(__dirname, '../../../__fixtures__/node-builder-codegen/registry-base.ts.txt'),
        'utf8',
      ),
      'utf8',
    );
    fs.mkdirSync(path.join(repoRoot, 'src/lib/workflows'), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, 'src/lib/workflows/index.ts'),
      fs.readFileSync(
        path.join(__dirname, '../../../__fixtures__/node-builder-codegen/index-base.ts.txt'),
        'utf8',
      ),
      'utf8',
    );

    const originalCwd = process.cwd();
    process.chdir(repoRoot);
    try {
      const { written } = await writeNodeFiles(appleCalendarSpec, cwdSrDocsDir);
      expect(written).toContain('src/lib/workflows/nodes/apple-calendar.ts');
      expect(written).toContain('src/lib/workflows/nodes/apple-calendar.def.ts');
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(repoRoot, { recursive: true, force: true });
      fs.rmSync(cwdSrDocsDir, { recursive: true, force: true });
    }
  });
});
