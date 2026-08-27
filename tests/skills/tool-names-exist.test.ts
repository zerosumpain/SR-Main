import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

/**
 * A skill that orders a tool which does not exist costs a round and returns
 * `Unknown function`. The model then either guesses again or answers from
 * training data, and neither is visible as a failure.
 *
 * The corpus was ported wholesale from the Claude Code skill library in #429,
 * so it carries that harness's verbs — `terminal`, `execute_code`, `read_file`,
 * `search_files`. Those are correct where a skill documents *another* agent and
 * wrong where a skill instructs jkai. This guard covers the second case only:
 * jkai's own prompt stack and its own `jkai-*` skills.
 *
 * Deliberately NOT extended to the whole corpus. `autonomous-ai-agents/*`
 * documents Claude Code, Codex and opencode, where `terminal()` is
 * real; rewriting those would make accurate documentation wrong.
 */

/** Names the chat loop cannot call, whatever a ported skill says. */
const DEAD_VERBS = [
  'terminal',
  'execute_code',
  'read_file',
  'search_files',
  'web_search',
  'web_extract',
  'delegate_task',
  'workflow_create',
  'builds_start',
  'write_file',
];

/** Every tool name the registry actually declares. */
function registeredToolNames(): Set<string> {
  const out = execFileSync(
    'bash',
    [
      '-c',
      `grep -rhoE "name: '[a-z0-9_]+'" src/lib/workflows/site-tools/tools/*.ts | sed "s/name: '//;s/'//" | sort -u`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  return new Set(out.trim().split('\n').filter(Boolean));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.md')) out.push(full);
  }
  return out;
}

/** jkai's own instruction surfaces — the prompt stack plus the jkai-* skills. */
function jkaiOwnedDocs(): string[] {
  const files = walk(join(ROOT, 'data/prompts'));
  for (const entry of readdirSync(join(ROOT, 'data/skills'))) {
    if (!entry.startsWith('jkai-')) continue;
    const full = join(ROOT, 'data/skills', entry);
    if (statSync(full).isDirectory()) walk(full, files);
  }
  return files;
}

describe("jkai's own instructions only name tools that exist", () => {
  const docs = jkaiOwnedDocs();

  it('found the docs to check', () => {
    // A silent zero here would make every assertion below vacuous.
    expect(docs.length).toBeGreaterThan(5);
  });

  it.each(DEAD_VERBS)('never tells the model to call %s(...)', (verb) => {
    // Call-shaped only. `terminal` is an ordinary English word — "posts a
    // terminal summary" is prose, not an instruction, and matching it would
    // make this test unpassable for the wrong reason.
    const re = new RegExp(`\\b${verb}\\(`);
    const offenders = docs
      .filter((f) => re.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(`${ROOT}/`, ''));
    expect(offenders, `${verb}() is not a registered tool:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('names only registered tools in the always-on tool prompt', () => {
    // 03-tools.md is prepended to every turn, so a wrong name there is paid for
    // on every request rather than only when a skill is opened. It shipped
    // naming `workflow_create` and `builds_start`, neither of which exists.
    const registered = registeredToolNames();
    expect(registered.size).toBeGreaterThan(100);

    const text = readFileSync(join(ROOT, 'data/prompts/03-tools.md'), 'utf8');
    // Backticked snake_case tokens are how this file refers to tools.
    const referenced = [...text.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)].map((m) => m[1]);

    // Node types and config keys share the snake_case shape, so only assert on
    // tokens that look like tool calls or that we know the registry owns.
    const unknown = [...new Set(referenced)].filter(
      (t) => DEAD_VERBS.includes(t) && !registered.has(t),
    );
    expect(unknown, `named in 03-tools.md but not registered: ${unknown.join(', ')}`).toEqual([]);
  });
});

describe('skill_view is asked for references the way it declares them', () => {
  // The parameter is `reference`. 13 call sites across 7 skills passed
  // `file_path`, and an unrecognised key made readSkillBody fall through to
  // SKILL.md and return success with the MAIN body — so the model believed it
  // had read a reference it never saw, and the unreachable documents are the
  // ones carrying the traps. The handler now aliases `file_path`; these call
  // sites are fixed so nothing depends on the alias.
  it('no skill passes file_path to skill_view', () => {
    const hits = execFileSync(
      'bash',
      ['-c', `grep -rn "skill_view([^)]*file_path" data/skills data/prompts 2>/dev/null || true`],
      { cwd: ROOT, encoding: 'utf8' },
    ).trim();
    expect(hits).toBe('');
  });

  it('still accepts file_path in the handler, for skills we do not own', () => {
    const src = readFileSync(
      join(ROOT, 'src/lib/workflows/site-tools/tools/discovery.ts'),
      'utf8',
    );
    expect(src).toMatch(/optionalString\(args, 'file_path'\)/);
  });
});
