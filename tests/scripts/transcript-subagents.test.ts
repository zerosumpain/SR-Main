/**
 * Schema v5 of the transcript parser: a session's cost includes the subagents it
 * spawned, and a worktree folder resolves to the repository it checks out.
 *
 * Both were measured gaps, not hypotheticals. On porkserv (2026-10-04) subagent
 * transcripts held $1,014 of spend against $1,353 on the main threads, none of
 * it counted; and every porkserv session reported its worktree folder
 * (`sr-main-foo-20261003`) as its project.
 *
 * The parser is imported through a non-literal specifier so `svelte-check` does
 * not pull the untyped `.mjs` into the TypeScript program (see
 * pr-extraction.test.ts for the 76 errors a literal import costs).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PARSER = join(process.cwd(), 'scripts/claude-changelog/parse-transcript.mjs');

type Parser = {
  parseTranscript: (file: string, opts?: Record<string, unknown>) => {
    session: { estCostUsd: number; costBreakdown: { source: string; costUsd: number }[]; touchedPaths: { path: string }[] };
    stages: { costUsd: number; metadata: { subagentCostUsd: number } }[];
  };
  projectOfFolder: (top: string, home?: string) => string;
};

let parser: Parser;
let dir: string;

const line = (o: unknown) => JSON.stringify(o);
const user = (ts: string, text: string) => line({ type: 'user', timestamp: ts, message: { role: 'user', content: text } });
const assistant = (ts: string, usage: Record<string, number>, content: unknown[] = []) =>
  line({ type: 'assistant', timestamp: ts, message: { model: 'claude-opus-5-5', usage, content } });

beforeAll(async () => {
  const specifier = PARSER;
  parser = (await import(/* @vite-ignore */ specifier)) as Parser;
  dir = mkdtempSync(join(tmpdir(), 'transcript-'));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('subagent cost', () => {
  it('adds subagent spend to the session and to the stage open when it ran', () => {
    const id = 'aaaaaaaa-0000-0000-0000-000000000001';
    // 1M output tokens at $25/MTok on the main thread; 2M at the same rate in a subagent.
    writeFileSync(
      join(dir, `${id}.jsonl`),
      [
        user('2026-10-01T10:00:00Z', 'Build the thing'),
        assistant('2026-10-01T10:01:00Z', { output_tokens: 1_000_000 }),
        user('2026-10-01T11:00:00Z', 'Now polish it'),
        assistant('2026-10-01T11:01:00Z', { output_tokens: 10 }),
      ].join('\n'),
    );
    mkdirSync(join(dir, id, 'subagents'), { recursive: true });
    writeFileSync(
      join(dir, id, 'subagents', 'agent-1.jsonl'),
      assistant('2026-10-01T10:30:00Z', { output_tokens: 2_000_000 }, [
        { type: 'tool_use', name: 'Edit', input: { file_path: '/home/john/proj/src/a.ts' } },
      ]),
    );

    const { session, stages } = parser.parseTranscript(join(dir, `${id}.jsonl`));
    expect(session.estCostUsd).toBeCloseTo(75, 2);
    const bySource = Object.fromEntries(session.costBreakdown.map((c) => [c.source, c.costUsd]));
    expect(bySource.main).toBeCloseTo(25, 2);
    expect(bySource.subagent).toBeCloseTo(50, 2);
    // Stage costs still sum to the session total…
    expect(stages.reduce((sum, s) => sum + s.costUsd, 0)).toBeCloseTo(session.estCostUsd, 2);
    // …and the subagent landed in the first request's stages, not the follow-up's.
    const sub = stages.map((s) => s.metadata.subagentCostUsd);
    expect(sub.slice(0, 2).reduce((a, b) => a + b, 0)).toBeCloseTo(50, 2);
    expect(sub.slice(2).every((v) => v === 0)).toBe(true);
    expect(session.touchedPaths.map((p) => p.path)).toContain('proj/src/a.ts');
  });

  it('can be told to ignore subagents', () => {
    const id = 'aaaaaaaa-0000-0000-0000-000000000001';
    const { session } = parser.parseTranscript(join(dir, `${id}.jsonl`), { subagents: false });
    expect(session.estCostUsd).toBeCloseTo(25, 2);
  });
});

describe('project of a folder', () => {
  it('follows a worktree to its repository, through a local-path clone', () => {
    const home = join(dir, 'home');
    // upstream clone → GitHub
    mkdirSync(join(home, 'upstream', '.git'), { recursive: true });
    writeFileSync(join(home, 'upstream', '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/zerosumpain/SR-Main.git\n');
    // a clone of the clone
    mkdirSync(join(home, 'clone', '.git', 'worktrees', 'feature'), { recursive: true });
    writeFileSync(join(home, 'clone', '.git', 'config'), `[remote "origin"]\n\turl = ${join(home, 'upstream')}\n`);
    // a worktree of the clone
    mkdirSync(join(home, 'odd-name-20261004'), { recursive: true });
    writeFileSync(join(home, 'odd-name-20261004', '.git'), `gitdir: ${join(home, 'clone', '.git', 'worktrees', 'feature')}\n`);

    expect(parser.projectOfFolder('odd-name-20261004', home)).toBe('strange-rambling-svelte');
  });

  it('falls back to the folder name when the worktree is gone', () => {
    const home = join(dir, 'empty-home');
    expect(parser.projectOfFolder('sr-main-landing-20261003', home)).toBe('strange-rambling-svelte');
    expect(parser.projectOfFolder('sr-health-worker-20260926', home)).toBe('sr-health');
    expect(parser.projectOfFolder('marbler', home)).toBe('marbler');
  });
});
