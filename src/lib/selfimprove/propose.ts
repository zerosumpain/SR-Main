// src/lib/selfimprove/propose.ts
//
// PROPOSE phase — ideas too big for a runtime tool become a DRAFT PR.
//
// A runtime custom tool is one async function body: no new routes, no schema,
// no UI. Everything above that ceiling used to become a one-line `proposal`
// string that nobody read. Now the engine writes the code and opens a draft PR
// against master, and CI's gate job runs on it like any other branch.
//
// Deliberate limits (owner decision, 2026-07-29 — "never auto-merge"):
//   * DRAFT PRs only; this module has no merge call and cannot acquire one.
//   * NEW files only. Patching existing files unattended, with no checkout to
//     verify against, is how you get a plausible diff that silently breaks a
//     working module. A new module plus its test is reviewable on its own.
//   * `pathAllowed` in $lib/github/pr blocks CI config, env, deploy scripts.
//
// The PR body states plainly what still needs wiring, so review starts from an
// honest description rather than an overclaim.

import { errMsg, WORK_CAPS, type RunAction } from './types';
import type { Budget } from './run';
import { buildContextPack, renderContext } from './context';
import { listBacklog, markAttempt, pickWork } from './backlog';
import { openDraftPr, pathAllowed, prConfigured, type FileChange } from '$lib/github/pr';
import type { BacklogItemData } from './types';

interface ProposedChange {
  title: string;
  summary: string;
  files: FileChange[];
  wiringNotes: string;
}

function coerceChange(json: unknown): ProposedChange | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  const filesRaw = Array.isArray(o.files) ? o.files : [];
  const files: FileChange[] = filesRaw
    .map((f) => {
      const fo = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>;
      const path = typeof fo.path === 'string' ? fo.path.trim() : '';
      const content = typeof fo.content === 'string' ? fo.content : '';
      return path && content ? { path, content } : null;
    })
    .filter((f): f is FileChange => f !== null)
    .filter((f) => pathAllowed(f.path))
    .slice(0, 6);

  if (files.length === 0) return null;
  return {
    title: typeof o.title === 'string' && o.title ? o.title : 'Self-improvement proposal',
    summary: typeof o.summary === 'string' ? o.summary : '',
    files,
    wiringNotes: typeof o.wiringNotes === 'string' ? o.wiringNotes : '',
  };
}

function buildMessages(
  item: BacklogItemData,
  contextText: string,
): Array<{ role: 'system' | 'user'; content: string }> {
  const system =
    'You are a senior TypeScript engineer working in a SvelteKit 2 + Svelte 5 (runes) codebase that uses Drizzle ' +
    'ORM over PostgreSQL and Vitest for tests. Implement the requested capability as a SELF-CONTAINED set of NEW ' +
    'files — you cannot modify existing files in this change.\n\n' +
    'Rules:\n' +
    '- Write complete, compiling TypeScript. No placeholders, no TODO stubs, no pseudo-code.\n' +
    '- Prefer a pure module in src/lib/<area>/ plus a colocated *.test.ts using Vitest (describe/it/expect).\n' +
    '- Import aliases: $lib/* for src/lib/*. Do not invent dependencies — use what a standard Node 22 + the ' +
    'existing stack provides.\n' +
    '- Keep it small: 1-3 source files plus tests. A tight, correct change beats a broad speculative one.\n' +
    '- Explain in wiringNotes exactly what a human must do to connect this to the app (routes to add, ' +
    'call sites, schema pushes) — be honest that this PR does not do it.\n\n' +
    'Respond with ONLY JSON: {"title": string, "summary": string, "wiringNotes": string, ' +
    '"files": [{"path": "src/lib/…", "content": "<full file contents>"}]}. No prose outside the JSON.';

  const user =
    `Capability to implement:\n${item.title}\n\n${item.detail}\n\n` +
    (item.lastError ? `A previous attempt failed with: ${item.lastError}\n\n` : '') +
    `Platform reference (for context on what already exists):\n${contextText}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function branchName(item: BacklogItemData, runId: string): string {
  return `selfimprove/${item.slug.slice(0, 40)}-${runId.slice(0, 8)}`;
}

function prBody(item: BacklogItemData, change: ProposedChange, runId: string): string {
  return [
    '## What this is',
    '',
    `Authored unattended by the nightly self-improvement engine (run \`${runId}\`) from backlog item \`${item.slug}\`.`,
    '',
    '**This is a draft. Nothing here has been run.** The engine cannot execute the test suite or a build — CI\'s',
    'gate job on this branch is the first real verification. Review it as you would any untrusted patch.',
    '',
    '## Idea',
    '',
    `${item.title}`,
    '',
    item.detail,
    '',
    '## Summary of the change',
    '',
    change.summary,
    '',
    '## Files',
    '',
    ...change.files.map((f) => `- \`${f.path}\``),
    '',
    '## Still needs wiring',
    '',
    change.wiringNotes || '_None stated by the author._',
    '',
    '---',
    '',
    '_Opened by `src/lib/selfimprove/propose.ts`. The engine cannot merge — draft PRs only._',
  ].join('\n');
}

/** PROPOSE: turn `feature`-kind backlog items into draft PRs for review. */
export async function proposeFeatures(budget: Budget, runId: string): Promise<RunAction[]> {
  const actions: RunAction[] = [];

  if (!prConfigured()) {
    // Not an error — a dev host simply has no token. Say so once and move on.
    return [{ kind: 'proposal', detail: 'PR phase skipped — no GitHub token in env' }];
  }

  const backlog = await listBacklog();
  const work = pickWork(backlog, 'feature', WORK_CAPS.maxPullRequests);
  if (work.length === 0) return actions;

  const contextText = renderContext(await buildContextPack());

  for (const item of work) {
    if (budget.timeLeftMs() < WORK_CAPS.reserveWallMs) break;

    try {
      const { json } = await budget.call(buildMessages(item, contextText), {
        maxTokens: 12000,
        temperature: 0.2,
      });
      const change = coerceChange(json);
      if (!change) {
        await markAttempt(item, { status: 'open', error: 'model returned no usable files', runId });
        actions.push({ kind: 'proposal', detail: `${item.slug}: no usable code produced` });
        continue;
      }

      const pr = await openDraftPr({
        branch: branchName(item, runId),
        title: change.title.slice(0, 120),
        body: prBody(item, change, runId),
        files: change.files,
        commitMessage: `feat(selfimprove): ${change.title.slice(0, 80)}\n\nAuthored by the nightly self-improvement engine (run ${runId}).`,
      });

      await markAttempt(item, { status: 'shipped', runId, prUrl: pr.url });
      actions.push({
        kind: 'pr_opened',
        detail: `#${pr.number} ${change.title} — ${pr.url} (${change.files.length} file(s), draft)`,
      });
    } catch (err) {
      const reason = errMsg(err).slice(0, 300);
      await markAttempt(item, { status: 'open', error: reason, runId });
      actions.push({ kind: 'proposal', detail: `PR for "${item.title}" failed: ${reason}` });
    }
  }

  return actions;
}
