import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runProcess } from '$lib/workflows/site-tools/tools/node-builder-shared';

// Ensure registrations fire.
import '$lib/workflows/site-tools/tools/node-builder';
import { getTool } from '$lib/workflows/site-tools/registry';

describe('node_builder_check_clean', () => {
  let repoDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    repoDir = mkdtempSync(path.join(tmpdir(), 'nb-check-'));
    process.chdir(repoDir);
    await runProcess('git', ['init', '-q', '-b', 'master'], {});
    await runProcess('git', ['config', 'user.email', 'test@test.invalid'], {});
    await runProcess('git', ['config', 'user.name', 'test'], {});
    writeFileSync(path.join(repoDir, 'a.txt'), 'hello', 'utf8');
    await runProcess('git', ['add', 'a.txt'], {});
    await runProcess('git', ['commit', '-q', '-m', 'init'], {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns ok:true when on master with clean tree and no merge in progress', async () => {
    const tool = getTool('node_builder_check_clean')!;
    const result = await tool.handler({});
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ok: true });
  });

  it('returns ok:false when working tree is dirty', async () => {
    writeFileSync(path.join(repoDir, 'a.txt'), 'changed', 'utf8');
    const tool = getTool('node_builder_check_clean')!;
    const result = await tool.handler({});
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ ok: false, reason: expect.stringContaining('dirty') });
  });

  it('returns ok:false when on a non-master branch', async () => {
    await runProcess('git', ['checkout', '-q', '-b', 'feature/foo'], {});
    const tool = getTool('node_builder_check_clean')!;
    const result = await tool.handler({});
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ ok: false, reason: expect.stringContaining('branch') });
  });

  it('returns ok:false when a merge is in progress', async () => {
    writeFileSync(path.join(repoDir, '.git', 'MERGE_HEAD'), 'abc123', 'utf8');
    const tool = getTool('node_builder_check_clean')!;
    const result = await tool.handler({});
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ ok: false, reason: expect.stringContaining('merge') });
  });
});

describe('node_builder_list_existing', () => {
  it('returns the registered workflow node types with type and description', async () => {
    const tool = getTool('node_builder_list_existing')!;
    const result = await tool.handler({});
    expect(result.success).toBe(true);
    const data = result.data as { nodes: Array<{ type: string; description: string }> };
    expect(Array.isArray(data.nodes)).toBe(true);
    expect(data.nodes.length).toBeGreaterThan(5); // at least the built-ins
    for (const node of data.nodes) {
      expect(typeof node.type).toBe('string');
      expect(typeof node.description).toBe('string');
    }
  });

  it('includes a known built-in node like gmail-send', async () => {
    const tool = getTool('node_builder_list_existing')!;
    const result = await tool.handler({});
    const data = result.data as { nodes: Array<{ type: string }> };
    const types = data.nodes.map((n) => n.type);
    expect(types).toContain('gmail-send');
  });
});

describe('node_builder_diff', () => {
  let repoDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    repoDir = mkdtempSync(path.join(tmpdir(), 'nb-diff-'));
    process.chdir(repoDir);
    await runProcess('git', ['init', '-q', '-b', 'master'], {});
    await runProcess('git', ['config', 'user.email', 'test@test.invalid'], {});
    await runProcess('git', ['config', 'user.name', 'test'], {});
    writeFileSync(path.join(repoDir, 'a.txt'), 'initial\n', 'utf8');
    await runProcess('git', ['add', 'a.txt'], {});
    await runProcess('git', ['commit', '-q', '-m', 'init'], {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns empty stat and diff when working tree is clean', async () => {
    const tool = getTool('node_builder_diff')!;
    const result = await tool.handler({});
    expect(result.success).toBe(true);
    const data = result.data as { stat: string; diff: string };
    expect(data.stat).toBe('');
    expect(data.diff).toBe('');
  });

  it('returns non-empty stat and diff when there are uncommitted changes', async () => {
    writeFileSync(path.join(repoDir, 'a.txt'), 'changed\n', 'utf8');
    const tool = getTool('node_builder_diff')!;
    const result = await tool.handler({});
    const data = result.data as { stat: string; diff: string };
    expect(data.stat).toContain('a.txt');
    expect(data.diff).toContain('changed');
  });

  it('includes untracked files in the diff/stat', async () => {
    writeFileSync(path.join(repoDir, 'b.txt'), 'new file\n', 'utf8');
    const tool = getTool('node_builder_diff')!;
    const result = await tool.handler({});
    const data = result.data as { stat: string; diff: string };
    expect(data.stat).toContain('b.txt');
  });
});

describe('node_builder_abort', () => {
  let repoDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    repoDir = mkdtempSync(path.join(tmpdir(), 'nb-abort-'));
    process.chdir(repoDir);
    await runProcess('git', ['init', '-q', '-b', 'master'], {});
    await runProcess('git', ['config', 'user.email', 'test@test.invalid'], {});
    await runProcess('git', ['config', 'user.name', 'test'], {});

    mkdirSync(path.join(repoDir, 'src/lib/workflows'), { recursive: true });
    writeFileSync(path.join(repoDir, 'src/lib/workflows/index.ts'), 'export const initial = 1;\n', 'utf8');
    mkdirSync(path.join(repoDir, 'src/lib/canvas/nodes/panels'), { recursive: true });
    writeFileSync(path.join(repoDir, 'src/lib/canvas/nodes/panels/registry.ts'), 'export const reg = {};\n', 'utf8');
    writeFileSync(path.join(repoDir, 'package.json'), '{"name":"x"}\n', 'utf8');
    await runProcess('git', ['add', '-A'], {});
    await runProcess('git', ['commit', '-q', '-m', 'init'], {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('reverts modified allowlist files', async () => {
    writeFileSync(path.join(repoDir, 'src/lib/workflows/index.ts'), 'export const changed = 2;\n', 'utf8');
    const tool = getTool('node_builder_abort')!;
    const result = await tool.handler({});
    expect(result.success).toBe(true);
    expect(readFileSync(path.join(repoDir, 'src/lib/workflows/index.ts'), 'utf8'))
      .toBe('export const initial = 1;\n');
  });

  it('removes untracked allowlist files', async () => {
    mkdirSync(path.join(repoDir, 'src/lib/workflows/nodes'), { recursive: true });
    writeFileSync(path.join(repoDir, 'src/lib/workflows/nodes/new-node.ts'), 'export {};\n', 'utf8');
    const tool = getTool('node_builder_abort')!;
    await tool.handler({});
    expect(existsSync(path.join(repoDir, 'src/lib/workflows/nodes/new-node.ts'))).toBe(false);
  });

  it('does NOT touch files outside the allowlist', async () => {
    mkdirSync(path.join(repoDir, 'unrelated'), { recursive: true });
    writeFileSync(path.join(repoDir, 'unrelated/x.txt'), 'untouched\n', 'utf8');
    const tool = getTool('node_builder_abort')!;
    await tool.handler({});
    expect(existsSync(path.join(repoDir, 'unrelated/x.txt'))).toBe(true);
  });
});

describe('node_builder_write_files', () => {
  let repoDir: string;
  let srDocsDir: string;
  let originalCwd: string;
  let originalSrDocs: string | undefined;

  beforeEach(async () => {
    originalCwd = process.cwd();
    originalSrDocs = process.env.SR_DOCS_DIR;
    repoDir = mkdtempSync(path.join(tmpdir(), 'nb-write-'));
    srDocsDir = mkdtempSync(path.join(tmpdir(), 'nb-srdocs-'));
    process.env.SR_DOCS_DIR = srDocsDir;
    // Seed the registry + index that codegen patches.
    mkdirSync(path.join(repoDir, 'src/lib/canvas/nodes/panels'), { recursive: true });
    writeFileSync(
      path.join(repoDir, 'src/lib/canvas/nodes/panels/registry.ts'),
      readFileSync(
        path.join(originalCwd, 'tests/__fixtures__/node-builder-codegen/registry-base.ts.txt'),
        'utf8',
      ),
      'utf8',
    );
    mkdirSync(path.join(repoDir, 'src/lib/workflows'), { recursive: true });
    writeFileSync(
      path.join(repoDir, 'src/lib/workflows/index.ts'),
      readFileSync(
        path.join(originalCwd, 'tests/__fixtures__/node-builder-codegen/index-base.ts.txt'),
        'utf8',
      ),
      'utf8',
    );
    process.chdir(repoDir);
  });

  afterEach(() => {
    if (originalSrDocs === undefined) delete process.env.SR_DOCS_DIR;
    else process.env.SR_DOCS_DIR = originalSrDocs;
    process.chdir(originalCwd);
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(srDocsDir, { recursive: true, force: true });
  });

  it('writes all expected files for a valid spec', async () => {
    const fixture = await import(
      path.join(originalCwd, 'tests/__fixtures__/node-builder-codegen/apple-calendar.spec.ts')
    );
    // Adjust the export name below to match the actual export (likely `appleCalendarSpec` or `spec`).
    const spec = (fixture as Record<string, unknown>).appleCalendarSpec
      ?? (fixture as Record<string, unknown>).spec
      ?? (fixture as Record<string, unknown>).default;
    const tool = getTool('node_builder_write_files')!;
    const result = await tool.handler({ spec });
    expect(result.success).toBe(true);
    const data = result.data as { written: string[] };
    expect(data.written.some((p) => p.endsWith('apple-calendar.ts'))).toBe(true);
    expect(data.written.some((p) => p.endsWith('apple-calendar.def.ts'))).toBe(true);
  });

  it('returns success:false when spec is missing required fields', async () => {
    const tool = getTool('node_builder_write_files')!;
    const result = await tool.handler({ spec: { type: 'incomplete' } });
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
  });
});

describe('node_builder_commit_and_deploy', () => {
  let originalCwd: string;
  let repoDir: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    repoDir = mkdtempSync(path.join(tmpdir(), 'nb-cad-'));
    process.chdir(repoDir);
    await runProcess('git', ['init', '-q', '-b', 'master'], {});
    await runProcess('git', ['config', 'user.email', 'test@test.invalid'], {});
    await runProcess('git', ['config', 'user.name', 'test'], {});
    mkdirSync(path.join(repoDir, 'src/lib/workflows'), { recursive: true });
    writeFileSync(path.join(repoDir, 'src/lib/workflows/index.ts'), 'export {};\n', 'utf8');
    await runProcess('git', ['add', '-A'], {});
    await runProcess('git', ['commit', '-q', '-m', 'init'], {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('refuses if any changed file is outside the allowlist', async () => {
    writeFileSync(path.join(repoDir, 'src/lib/workflows/index.ts'), 'export const a = 1;\n', 'utf8');
    writeFileSync(path.join(repoDir, 'src/unrelated.ts'), 'export {};\n', 'utf8');
    const tool = getTool('node_builder_commit_and_deploy')!;
    const result = await tool.handler({ commitMessage: 'feat: x' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('src/unrelated.ts');
  });

  it('refuses if the working tree has nothing to commit', async () => {
    const tool = getTool('node_builder_commit_and_deploy')!;
    const result = await tool.handler({ commitMessage: 'feat: x' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/nothing|clean/i);
  });

  it('happy path: stages allowlist files, commits, push+deploy invoked, returns ok', async () => {
    writeFileSync(path.join(repoDir, 'src/lib/workflows/index.ts'), 'export const a = 1;\n', 'utf8');
    const stub = path.join(repoDir, 'fake-deploy.sh');
    writeFileSync(stub, '#!/bin/sh\necho "deploy ok"\n', 'utf8');
    chmodSync(stub, 0o755);
    process.env.NODE_BUILDER_DEPLOY_CMD = stub;
    process.env.NODE_BUILDER_SKIP_PUSH = '1';
    process.env.NODE_BUILDER_VERIFY_URL = '';
    try {
      const tool = getTool('node_builder_commit_and_deploy')!;
      const result = await tool.handler({ commitMessage: 'feat(test): a' });
      expect(result.success).toBe(true);
      const data = result.data as { ok: boolean; log: string };
      expect(data.ok).toBe(true);
      expect(data.log).toContain('deploy ok');
      const log = await runProcess('git', ['log', '--oneline', '-1'], {});
      expect(log.stdout).toContain('feat(test): a');
    } finally {
      delete process.env.NODE_BUILDER_DEPLOY_CMD;
      delete process.env.NODE_BUILDER_SKIP_PUSH;
      delete process.env.NODE_BUILDER_VERIFY_URL;
    }
  });

  it('bubbles up deploy-script failure', async () => {
    writeFileSync(path.join(repoDir, 'src/lib/workflows/index.ts'), 'export const a = 1;\n', 'utf8');
    const stub = path.join(repoDir, 'fake-deploy-fail.sh');
    writeFileSync(stub, '#!/bin/sh\necho "deploy broke" >&2\nexit 2\n', 'utf8');
    chmodSync(stub, 0o755);
    process.env.NODE_BUILDER_DEPLOY_CMD = stub;
    process.env.NODE_BUILDER_SKIP_PUSH = '1';
    process.env.NODE_BUILDER_VERIFY_URL = '';
    try {
      const tool = getTool('node_builder_commit_and_deploy')!;
      const result = await tool.handler({ commitMessage: 'feat(test): b' });
      expect(result.success).toBe(true);
      const data = result.data as { ok: boolean; log: string };
      expect(data.ok).toBe(false);
      expect(data.log).toMatch(/deploy.*broke|exit 2|deploy/i);
    } finally {
      delete process.env.NODE_BUILDER_DEPLOY_CMD;
      delete process.env.NODE_BUILDER_SKIP_PUSH;
      delete process.env.NODE_BUILDER_VERIFY_URL;
    }
  });
});
