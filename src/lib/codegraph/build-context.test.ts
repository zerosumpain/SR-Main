import { describe, it, expect } from 'vitest';
import { planBuildQuery, pathsInText, editedPathsFromActions } from './build-context';
import { parseCgql } from './query';
import { buildSystemPrompt } from '$lib/jkai/prompt';

describe('the system prompt actually names the command', () => {
  it('substitutes every __*_CMD__ placeholder in every mode', () => {
    // A placeholder that survives into the prompt tells the agent to run a
    // command called `__CODEGRAPH_CMD__`, which fails every time and reports
    // nothing useful — the exact silent-failure shape this system exists to
    // stop repeating. Assert it for all three modes, not just the new one.
    for (const mode of ['app', 'repo', 'studio'] as const) {
      const prompt = buildSystemPrompt('build-123', 8000, mode);
      expect(prompt, `${mode} prompt has an unsubstituted placeholder`).not.toMatch(/__[A-Z_]+_CMD__/);
    }
  });

  it('names the codegraph script by absolute path in repo mode', () => {
    const prompt = buildSystemPrompt('build-123', 8000, 'repo');
    expect(prompt).toContain('/scripts/codegraph-query.mjs');
    expect(prompt).toContain('NO PRECEDENT');
  });
});

describe('planBuildQuery picks the sharpest available key', () => {
  it('prefers the gate fingerprint over the file set', () => {
    // The previous iteration's gate diagnostics are mechanically the best query
    // we will ever have, so they must beat the file heuristic.
    const planned = planBuildQuery({
      prompt: 'fix src/lib/jkai/executor.ts',
      previousEvaluation: 'The gate FAILED.\nsrc/a.ts:3:1 - error TS2345: Argument of type X',
    });
    expect(planned).not.toBeNull();
    expect(planned!.query).toContain('fingerprint:typecheck:TS2345');
    expect(planned!.reason).toMatch(/gate failure/);
    expect(() => parseCgql(planned!.query)).not.toThrow();
  });

  it('falls back to the file set named in the task', () => {
    const planned = planBuildQuery({ prompt: 'please update src/lib/jkai/executor.ts and add a test' });
    expect(planned!.query).toContain('file:src/lib/jkai/executor.ts');
    expect(planned!.reason).toMatch(/file set/);
    expect(() => parseCgql(planned!.query)).not.toThrow();
  });

  it('prefers files the previous iteration actually edited', () => {
    const planned = planBuildQuery({
      prompt: 'crack on',
      previousActions: [
        { tool: 'Edit', args: { file_path: '/home/jkai/workspace/b1/dev/src/lib/db/schema.ts' } },
        { tool: 'Read', args: { file_path: '/home/jkai/workspace/b1/dev/src/app.css' } },
      ],
    });
    // "crack on" carries no information at all — 29% of real prompts are this
    // short, which is exactly why the query is not keyed on prompt text.
    expect(planned!.query).toContain('file:src/lib/db/schema.ts');
    expect(planned!.query).not.toContain('app.css'); // Read, not Edit
  });

  it('returns null when there is genuinely nothing to ask', () => {
    // Null must stay distinguishable from a failed query: the caller logs the
    // first as "nothing to query" and the second as an error.
    expect(planBuildQuery({ prompt: 'crack on' })).toBeNull();
    expect(planBuildQuery({ prompt: '', previousEvaluation: 'all good, 0 errors' })).toBeNull();
  });

  it('does not treat a passing gate as a fingerprint', () => {
    expect(planBuildQuery({ prompt: 'go', previousEvaluation: 'svelte-check found 0 errors' })).toBeNull();
  });
});

describe('path extraction', () => {
  it('finds repo-shaped paths in prose and ignores other text', () => {
    expect(pathsInText('touch src/lib/a.ts and scripts/b.mjs but not /etc/passwd or foo.ts')).toEqual([
      'src/lib/a.ts',
      'scripts/b.mjs',
    ]);
  });

  it('strips the sandbox prefix so a build path matches a repo path', () => {
    // The same file is /home/jkai/workspace/<id>/dev/src/x.ts in a build and
    // src/x.ts in the graph; without this they are two different nodes and
    // every per-file query misses its own history.
    expect(editedPathsFromActions([
      { tool: 'Write', args: { file_path: '/home/jkai/workspace/abc/dev/src/x.ts' } },
    ])).toEqual(['src/x.ts']);
  });

  it('survives junk actions without throwing', () => {
    expect(editedPathsFromActions(null)).toEqual([]);
    expect(editedPathsFromActions([null, 'nope', {}, { tool: 'Edit' }])).toEqual([]);
  });
});
