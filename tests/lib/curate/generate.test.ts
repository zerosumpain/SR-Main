import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { appleCalendarSpec } from '../../__fixtures__/curate-codegen/apple-calendar.spec';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '../../__fixtures__/curate-codegen');

// ── Temp dirs ────────────────────────────────────────────────────────────

let worktreeDir: string;
let srDocsDir: string;

// ── DB cleanup ───────────────────────────────────────────────────────────

beforeEach(async () => {
  const { db } = await import('$lib/db');
  const { curateSessions } = await import('$lib/db/schema');
  const { like } = await import('drizzle-orm');
  await db.delete(curateSessions).where(like(curateSessions.id, 'test-gen-%'));

  worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curate-gen-wt-'));
  srDocsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curate-gen-docs-'));

  fs.mkdirSync(path.join(worktreeDir, 'src/lib/canvas/nodes/panels'), { recursive: true });
  fs.mkdirSync(path.join(worktreeDir, 'src/lib/workflows/nodes'), { recursive: true });
  fs.mkdirSync(path.join(srDocsDir, 'content/internal/features/workflows/nodes'), { recursive: true });

  fs.writeFileSync(
    path.join(worktreeDir, 'src/lib/canvas/nodes/panels/registry.ts'),
    fs.readFileSync(path.join(FIXTURE, 'registry-base.ts.txt'), 'utf8'),
  );
  fs.writeFileSync(
    path.join(worktreeDir, 'src/lib/workflows/index.ts'),
    fs.readFileSync(path.join(FIXTURE, 'index-base.ts.txt'), 'utf8'),
  );
});

afterEach(() => {
  fs.rmSync(worktreeDir, { recursive: true, force: true });
  fs.rmSync(srDocsDir, { recursive: true, force: true });
});

// ── Stubs ────────────────────────────────────────────────────────────────

type ExecFn = (
  cmd: string,
  args: string[],
  opts: { cwd: string; timeout: number },
) => Promise<{ stdout: string; stderr: string }>;

/** Succeeds for everything. */
const execOk: ExecFn = async () => ({ stdout: '', stderr: '' });

/** Succeeds for npm install but fails for tsc. */
const execTscFails: ExecFn = async (_cmd, args) => {
  if (args.includes('tsc')) {
    const err = Object.assign(new Error('tsc error'), {
      stdout: 'error TS2345: Argument of type',
      stderr: '',
    });
    throw err;
  }
  return { stdout: '', stderr: '' };
};

// ── DB seeder ────────────────────────────────────────────────────────────

async function seedSession(
  id: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const { db } = await import('$lib/db');
  const { curateSessions } = await import('$lib/db/schema');
  const now = new Date();
  await db.insert(curateSessions).values({
    id,
    targetType: 'apple-calendar',
    status: 'generating',
    goal: 'Test generation',
    nodeSpec: appleCalendarSpec as unknown as Record<string, unknown>,
    worktreePath: worktreeDir,
    branchName: `curate/${id}`,
    devServerPort: 5190,
    iterationLog: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('runGenerate', () => {
  it('writes all expected node files into the temp worktree', async () => {
    await seedSession('test-gen-1');

    const { runGenerate } = await import('$lib/curate/generate');
    const result = await runGenerate('test-gen-1', { srDocsDir, exec: execOk });

    expect(result.written).toContain('src/lib/workflows/nodes/apple-calendar.def.ts');
    expect(result.written).toContain('src/lib/workflows/nodes/apple-calendar.ts');
    expect(result.written).toContain('src/lib/canvas/nodes/panels/AppleCalendarPanel.svelte');

    expect(
      fs.existsSync(path.join(worktreeDir, 'src/lib/workflows/nodes/apple-calendar.def.ts')),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(srDocsDir, 'content/internal/features/workflows/nodes/apple-calendar.md'),
      ),
    ).toBe(true);
  });

  it('transitions session from generating to live-testing on success', async () => {
    await seedSession('test-gen-2');

    const { runGenerate } = await import('$lib/curate/generate');
    await runGenerate('test-gen-2', { srDocsDir, exec: execOk });

    const { getSession } = await import('$lib/curate/session-store');
    const row = await getSession('test-gen-2');
    expect(row!.status).toBe('live-testing');
  });

  it('appends a generate log entry to iterationLog', async () => {
    await seedSession('test-gen-3');

    const { runGenerate } = await import('$lib/curate/generate');
    await runGenerate('test-gen-3', { srDocsDir, exec: execOk });

    const { getSession } = await import('$lib/curate/session-store');
    const row = await getSession('test-gen-3');
    const log = row!.iterationLog as Array<{ phase: string; tscOk: boolean }>;
    const generateEntry = log.find((e) => e.phase === 'generate');
    expect(generateEntry).toBeDefined();
    expect(generateEntry!.tscOk).toBe(true);
  });

  it('transitions to error when tsc fails', async () => {
    await seedSession('test-gen-4');

    const { runGenerate } = await import('$lib/curate/generate');
    await expect(
      runGenerate('test-gen-4', { srDocsDir, exec: execTscFails }),
    ).rejects.toThrow('tsc check failed');

    const { getSession } = await import('$lib/curate/session-store');
    const row = await getSession('test-gen-4');
    expect(row!.status).toBe('error');
  });

  it('throws if session is not found', async () => {
    const { runGenerate } = await import('$lib/curate/generate');
    await expect(
      runGenerate('test-gen-missing', { srDocsDir, exec: execOk }),
    ).rejects.toThrow('not found');
  });

  it('returns deps from spec', async () => {
    await seedSession('test-gen-5');

    const { runGenerate } = await import('$lib/curate/generate');
    const result = await runGenerate('test-gen-5', { srDocsDir, exec: execOk });

    // apple-calendar spec has dep: tsdav
    expect(result.deps).toEqual(
      expect.arrayContaining([{ name: 'tsdav', version: '^2.0.0' }]),
    );
  });
});
