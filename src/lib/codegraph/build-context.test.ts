import { describe, it, expect } from 'vitest';
import {
  planBuildQuery,
  pathsInText,
  editedPathsFromActions,
  bareNamesInText,
  dirHintsInText,
  pickNamedFiles,
} from './build-context';
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

describe('bare filenames — the way people actually write a task', () => {
  /*
   * Build f85ed296 (2026-08-17) asked to fix a duplication "in src/lib/jkai/"
   * between `orchestrator.ts` and `rescue-body.ts`. planBuildQuery returned
   * null: no query, no serve, no context. The three builds that DID retrieve
   * only did so because their prompts were written with full paths, by the
   * same person who wrote the regex.
   */
  const REAL_PROMPT =
    'In src/lib/jkai/, the first line of the gate diagnostics is duplicated. ' +
    'orchestrator.ts embeds it into the failure message, and rescue-body.ts renders it again.';

  it('finds the names a full-path regex misses', () => {
    expect(bareNamesInText(REAL_PROMPT)).toEqual(['orchestrator.ts', 'rescue-body.ts']);
    expect(pathsInText(REAL_PROMPT)).toEqual([]);
  });

  it('does not offer a name that is already part of a full path', () => {
    // Otherwise `src/lib/jkai/executor.ts` resolves once as a path and again,
    // ambiguously, as `executor.ts`.
    expect(bareNamesInText('update src/lib/jkai/executor.ts please')).toEqual([]);
  });

  it('picks up the directory a task mentions', () => {
    expect(dirHintsInText(REAL_PROMPT)).toEqual(['src/lib/jkai/']);
  });

  it('resolves a name that lands on exactly one file', () => {
    const { resolved, ambiguous } = pickNamedFiles(
      ['orchestrator.ts'],
      [],
      ['src/lib/jkai/orchestrator.ts', 'src/lib/jkai/executor.ts'],
    );
    expect(resolved).toEqual(['src/lib/jkai/orchestrator.ts']);
    expect(ambiguous).toEqual([]);
  });

  it('refuses to guess when a name is ambiguous', () => {
    // `types.ts` matches 39 files in this repo and `+server.ts` 369. Seeding
    // from whichever sorted first would inject a precedent from an unrelated
    // part of the tree, which reads as authoritative and is worse than nothing.
    const { resolved, ambiguous } = pickNamedFiles(
      ['types.ts'],
      [],
      ['src/lib/jkai/types.ts', 'src/lib/trails/types.ts', 'src/lib/intel/types.ts'],
    );
    expect(resolved).toEqual([]);
    expect(ambiguous).toEqual(['types.ts']);
  });

  it('uses a mentioned directory to break the tie', () => {
    const { resolved, ambiguous } = pickNamedFiles(
      ['types.ts'],
      ['src/lib/jkai/'],
      ['src/lib/jkai/types.ts', 'src/lib/trails/types.ts', 'src/lib/intel/types.ts'],
    );
    expect(resolved).toEqual(['src/lib/jkai/types.ts']);
    expect(ambiguous).toEqual([]);
  });

  it('matches on the whole basename, not a suffix', () => {
    // `body.ts` must not resolve to `rescue-body.ts`.
    expect(pickNamedFiles(['body.ts'], [], ['src/lib/jkai/rescue-body.ts']).resolved).toEqual([]);
  });

  it('plans a query from resolved names, which is the whole point', () => {
    // Without the resolved name there is no FILE query — the topic lane below
    // now catches it, but a topic match is the weak signal and must never
    // stand in for the path the prompt actually named.
    expect(planBuildQuery({ prompt: REAL_PROMPT })?.query).not.toContain('file:');
    const planned = planBuildQuery({ prompt: REAL_PROMPT }, ['src/lib/jkai/orchestrator.ts']);
    expect(planned?.query).toContain('file:src/lib/jkai/orchestrator.ts');
    // Still no fingerprints — a file-set serve is not evidence and must not be
    // credited when the build passes first time.
    expect(planned?.fingerprints).toEqual([]);
  });
});

/*
 * The lane that exists because "add a Notion connector" is a real task.
 *
 * Both sharp keys are retrospective: one needs a gate that already failed, the
 * other a file that already exists and was already named. A greenfield task
 * satisfies neither, and the graph's connector knowledge — which service a
 * credential binds to, why one in node config spreads to nine tables, that
 * Strava is parked by design — was unreachable from it.
 */
describe('the topic fallback', () => {
  it('asks about a task that names no file and follows no failure', () => {
    const planned = planBuildQuery({ prompt: 'Add a Notion connector with OAuth refresh' });
    expect(planned?.reason).toBe('task topic');
    expect(planned?.query).toContain('topic:"');
    expect(planned?.query).toContain('notion');
    expect(planned?.query).toContain('connector');
    // Unattributable: no error was in play, so no gate result can credit it.
    expect(planned?.fingerprints).toEqual([]);
  });

  it('stays BELOW both sharp keys', () => {
    // A named path wins, even though the prose would also have matched.
    const withPath = planBuildQuery({
      prompt: 'Add a Notion connector in src/lib/connectors/probes.ts with OAuth refresh',
    });
    expect(withPath?.reason).toContain('file set');
    expect(withPath?.query).toContain('file:src/lib/connectors/probes.ts');

    // A gate failure wins over both.
    const withGate = planBuildQuery({
      prompt: 'Add a Notion connector with OAuth refresh',
      previousEvaluation: 'src/lib/connectors/probes.ts(4,1): error TS2345: bad arg',
    });
    expect(withGate?.query).toContain('fingerprint:');
  });

  it('still refuses the prompts that motivated keying on code', () => {
    // 29% of real prompts are 25 characters or fewer. These must plan nothing,
    // not something vague — "nothing to query" is an honest log line.
    for (const prompt of ['crack on', 'go ahead', 'fix the header', 'yup', '']) {
      expect(planBuildQuery({ prompt })).toBeNull();
    }
  });
});

/*
 * The file lane used to claim every query whose prompt happened to contain a
 * path-shaped string, whether or not the graph held anything for it — and an
 * unresolvable seed was answered with the newest lessons in the corpus.
 *
 * Measured on build 4cda9a8d, seeded `file:scripts/codegraph-stats.mjs` (a file
 * the task was about to CREATE): four lessons served, about the Landgrab
 * territory game, the jkai model picker, the nightly conflation detector and
 * pgvector neighbour ranking. None related to the task; all logged as `served`.
 */
describe('the file lane declines paths the graph does not know', () => {
  const task = {
    prompt: 'Add a new script scripts/codegraph-stats.mjs that prints the corpus counts from the database.',
    previousEvaluation: null,
    previousActions: null,
  };

  it('still uses the file lane when the path IS known', () => {
    const planned = planBuildQuery(task, [], new Set(['scripts/codegraph-stats.mjs']));
    expect(planned?.query).toContain('file:scripts/codegraph-stats.mjs');
  });

  it('falls through to the topic lane when the path is NOT known', () => {
    // Not merely "serves less" — the topic lane is the one that had the answer.
    // For this very build it returned project_codegraph, which carries the rule
    // the task needed: a new file under scripts/ needs its own rsync line in
    // ci-release.sh or it is silently absent in production.
    const planned = planBuildQuery(task, [], new Set());
    expect(planned?.query.startsWith('file:')).toBe(false);
    expect(planned?.query).toContain('topic:');
  });

  it('preserves the old behaviour when the caller has not checked', () => {
    // null means "not checked", so nothing changes for callers that cannot look
    // paths up — the planner stays pure and database-free.
    const planned = planBuildQuery(task, [], null);
    expect(planned?.query).toContain('file:scripts/codegraph-stats.mjs');
  });

  it('never lets an unknown path shadow a real gate failure', () => {
    // The fingerprint lane is checked first and must stay first: it is the only
    // key that can produce attributable evidence.
    const planned = planBuildQuery(
      { ...task, previousEvaluation: 'FAIL x.test.ts\nAssertionError: expected 1 to be 2 // Object.is equality' },
      [],
      new Set(),
    );
    expect(planned?.query).toContain('fingerprint:');
    expect(planned?.fingerprints.length).toBeGreaterThan(0);
  });
});
