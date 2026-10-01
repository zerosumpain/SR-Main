/**
 * The design linter and the codebase digest read a repository build's DIFF.
 *
 * They used to read `listDevFiles` — a `find | head -500` that on a ~3,100-file
 * clone is an arbitrary sixth of the tree and rarely held the agent's own new
 * files. The shell half runs for real here against throwaway repositories laid
 * out like each lane: the legacy clone (origin kept) and the broker clone
 * (origin removed, snapshot commits on top).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changedDevFilesCommand, focusDevFiles, parseChangedDevFiles, type DevFileEntry } from './sandbox';
import { selectDigestCandidates } from './codebase-digest';

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const sh = (cwd: string, command: string) => execSync(command, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const git = 'git -c user.name=t -c user.email=t@example.test -c init.defaultBranch=master';

/** An upstream with history, then a clone of it at `dev`. */
function cloneLane(removeOrigin: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'changed-files-'));
  roots.push(root);
  const upstream = join(root, 'upstream');
  mkdirSync(join(upstream, 'src/routes'), { recursive: true });
  for (let i = 0; i < 20; i++) writeFileSync(join(upstream, `src/old-${i}.ts`), `export const v${i} = ${i};\n`);
  writeFileSync(join(upstream, 'src/routes/+page.svelte'), '<h1>old</h1>\n');
  writeFileSync(join(upstream, '.gitignore'), '.env\n');
  sh(upstream, `${git} init -q && ${git} add -A && ${git} commit -qm base`);
  const dev = join(root, 'dev');
  sh(root, `${git} clone -q upstream dev`);
  if (removeOrigin) sh(dev, 'git remote remove origin');
  return dev;
}

function run(dev: string, baseBranch?: string) {
  return parseChangedDevFiles(execSync(changedDevFilesCommand(dev, baseBranch), { encoding: 'utf8', shell: '/bin/bash' }));
}

describe('changedDevFilesCommand', () => {
  it('broker lane: no origin, snapshot commits on top — diffs against the clone point', () => {
    const dev = cloneLane(true);
    writeFileSync(join(dev, 'src/routes/new.svelte'), '<p>new</p>\n');
    sh(dev, `${git} add -A && ${git} commit -qm "Local feature candidate"`);
    writeFileSync(join(dev, 'src/old-3.ts'), 'export const v3 = 33;\n'); // uncommitted edit
    writeFileSync(join(dev, 'src/untracked.css'), '.a{}\n'); // never added
    writeFileSync(join(dev, 'src/café.ts'), 'export const c = 1;\n'); // non-ASCII, untracked
    writeFileSync(join(dev, '.env'), 'SECRET=1\n'); // ignored
    rmSync(join(dev, 'src/old-4.ts')); // deletion
    const changed = run(dev, 'master');
    expect(changed?.map((f) => f.path).sort()).toEqual(['src/café.ts', 'src/old-3.ts', 'src/routes/new.svelte', 'src/untracked.css'].sort());
    expect(changed?.every((f) => f.size > 0 && f.mtime > 0)).toBe(true);
  });

  it('legacy lane: merge-base with origin/<base> survives the agent committing', () => {
    const dev = cloneLane(false);
    sh(dev, `${git} checkout -qB forge/abc master`);
    writeFileSync(join(dev, 'src/feature.ts'), 'export const f = 1;\n');
    sh(dev, `${git} add -A && ${git} commit -qm wip`);
    expect(run(dev, 'master')?.map((f) => f.path)).toEqual(['src/feature.ts']);
  });

  it('a resolved base with no changes is an empty list, not a fallback', () => {
    expect(run(cloneLane(true))).toEqual([]);
  });

  it('no repository means null, so the caller keeps the find list', () => {
    const root = mkdtempSync(join(tmpdir(), 'changed-files-none-'));
    roots.push(root);
    expect(run(root, 'master')).toBeNull();
  });

  it('never splices an unsafe branch name into the shell', () => {
    expect(changedDevFilesCommand('/w/dev', 'master; rm -rf /')).not.toContain('rm -rf');
    expect(changedDevFilesCommand('/w/dev', '../../etc')).not.toContain('origin/../');
  });
});

const entry = (path: string, mtime = 1): DevFileEntry => ({ path, size: 10, mtime });

describe('focusDevFiles', () => {
  const all = [entry('src/app.css'), entry('src/lib/x.ts'), entry('README.md')];

  it('app lane (no diff): both consumers keep the find list unchanged', () => {
    const focus = focusDevFiles(all, null);
    expect(focus.lint).toBe(all);
    expect(focus.digest).toBe(all);
    expect(focus.changedPaths.size).toBe(0);
  });

  it('repo lane: lint reads only the diff; the digest leads with it, without duplicates', () => {
    const changed = [entry('src/routes/new/+page.svelte', 5), entry('src/lib/x.ts', 5)];
    const focus = focusDevFiles(all, changed);
    expect(focus.lint).toEqual(changed);
    expect(focus.digest.map((f) => f.path)).toEqual(['src/routes/new/+page.svelte', 'src/lib/x.ts', 'src/app.css', 'README.md']);
    expect([...focus.changedPaths]).toEqual(['src/routes/new/+page.svelte', 'src/lib/x.ts']);
  });

  it('a Svelte project stays in lint scope when the diff touches only CSS', () => {
    expect(focusDevFiles([entry('src/routes/+page.svelte')], [entry('src/app.css')]).hasSvelte).toBe(true);
    expect(focusDevFiles([entry('index.html')], [entry('style.css')]).hasSvelte).toBe(false);
  });
});

describe('selectDigestCandidates', () => {
  it('puts the diff ahead of newer clone files, then newest first, capped', () => {
    const clone = Array.from({ length: 80 }, (_, i) => entry(`src/clone-${i}.ts`, 100));
    const picked = selectDigestCandidates([...clone, entry('src/mine.ts', 50)], new Set(['src/mine.ts']));
    expect(picked[0].path).toBe('src/mine.ts');
    expect(picked).toHaveLength(60);
  });
});
