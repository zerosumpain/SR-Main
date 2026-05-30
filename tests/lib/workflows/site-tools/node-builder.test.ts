import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
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
