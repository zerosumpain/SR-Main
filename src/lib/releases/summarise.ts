/**
 * Release summariser — turns the raw git facts of one deploy into feature-level
 * entries a human can read.
 *
 * Design constraints that matter:
 *  - EVIDENCE-BOUND. The model only ever sees commits and file paths from the
 *    release itself, and `normaliseSummary` drops any file/commit reference it
 *    invents. A release log that quietly hallucinates features is worse than no
 *    release log, because it reads exactly as authoritative as a true one.
 *  - `excludes` is the point of the feature. Anyone can list what a diff adds;
 *    the useful part is what it deliberately does NOT do — deferred phases,
 *    stated non-goals, surfaces left untouched. Empty is a valid answer and the
 *    prompt says so, precisely so the model doesn't pad it.
 *  - Runs on the VPS (LLM keys live there), never in the ingest script — hence
 *    the /api/releases/summarise endpoint rather than doing this in CI.
 */
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { releases, releaseItems, type Release } from '$lib/db/schema';
import { jsonCompletion } from '$lib/deepdive/ai';
import { resolveReleasesModel } from '$lib/server/models/workload-settings';
import { withActivity } from '$lib/context/activity';
import { pLimit } from '$lib/llm/resilience';
import {
  RELEASE_ITEM_KINDS,
  RELEASE_IMPACTS,
  RELEASE_CONFIDENCES,
  type CommitFact,
  type FileFact,
  type ReleaseItemKind,
  type ReleaseSummary,
  type ReleaseItemSummary,
} from './types';
import { redactDeep } from '$lib/security/sensitive';
import { voiceBlock } from '$lib/voice/block';

/** Hard ceiling on prompt evidence. Big deploys exist (a 300-file refactor);
 *  past this the extra file paths add noise, not signal. */
const MAX_COMMITS_IN_PROMPT = 60;
const MAX_FILES_IN_PROMPT = 120;
const MAX_BODY_CHARS = 700;
const MAX_ITEMS = 12;

// Built lazily rather than as a module-level constant: voiceBlock() reads the
// Voice Card off disk, and doing that at import time would run a filesystem read
// on module load and freeze the card until the next restart.
/** Exported so the voice wiring can be asserted against the real prompt text
 *  rather than against the helper it is supposed to call. */
export function systemPrompt(): string {
  return `You write the release notes for a personal software project (a SvelteKit site with an AI assistant, workflow engine, admin tooling and several sub-projects).

You are given the complete git evidence for ONE production deploy: its commits and the files it changed. Turn that into a short overview plus a list of the distinct things that went live.

Rules:
1. Ground everything in the evidence. Never mention a file, route, commit or capability that is not in the evidence. If the evidence is thin, say less and set confidence to "low".
2. Group related commits into ONE item. A deploy carrying "add X endpoint", "fix X test" and "style X page" is one item about X, not three. Aim for 1-6 items; never more than ${MAX_ITEMS}.
3. "includes" = the concrete things the change actually covers, as specific as the evidence allows ("adds a /admin/ops/releases page", "backfills history from git", "adds a bearer-token ingest endpoint").
4. "excludes" = what it does NOT cover, and this is the most valuable field. Use it for: work the commits explicitly defer ("phase 2", "TODO", "follow-up"), stated non-goals, obvious adjacent surfaces the diff leaves untouched, and limits a reader would otherwise assume away. Only state an exclusion you can justify from the evidence. An empty list is correct and expected when nothing supports one — do NOT pad it.
5. Titles are sentence case, under 70 characters. Follow the voice notes below.

${voiceBlock('terse', { exemplars: 0 })}
6. "files" and "commits" are evidence pointers: file paths and short commit SHAs copied EXACTLY from the evidence, only the ones belonging to that item.

Return JSON of exactly this shape:
{
  "title": "one line describing the deploy as a whole, under 70 chars",
  "summary": "2-4 sentences: what went live and why it matters. No preamble.",
  "items": [
    {
      "kind": "feature | fix | improvement | infra | content | chore",
      "impact": "user-facing | internal",
      "title": "short sentence-case title",
      "summary": "2-4 sentences on what this does",
      "includes": ["..."],
      "excludes": ["..."],
      "surfaces": ["/admin/ops/releases", "workflow engine", ...],
      "files": ["src/..."],
      "commits": ["abc1234"],
      "confidence": "low | medium | high"
    }
  ]
}`;
}

/** Compact one commit for the prompt: subject always, body only when it says something. */
function renderCommit(c: CommitFact): string {
  const head = `- ${c.short} ${c.subject}${c.pr ? ` [PR #${c.pr}]` : ''}`;
  const body = (c.body || '').trim();
  if (!body) return head;
  const trimmed = body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) + '…' : body;
  return `${head}\n${trimmed.split('\n').map((l) => `    ${l}`).join('\n')}`;
}

/** Roll files up by top-level area so the model sees shape, not just a flat list. */
function groupFiles(files: FileFact[]): string {
  const byDir = new Map<string, FileFact[]>();
  for (const f of files) {
    const parts = f.path.split('/');
    const dir = parts.length > 2 ? parts.slice(0, 3).join('/') : parts.slice(0, -1).join('/') || '.';
    const list = byDir.get(dir);
    if (list) list.push(f);
    else byDir.set(dir, [f]);
  }
  const churn = (f: FileFact) => f.insertions + f.deletions;
  return [...byDir.entries()]
    .sort((a, b) => b[1].reduce((n, f) => n + churn(f), 0) - a[1].reduce((n, f) => n + churn(f), 0))
    .map(([dir, fs]) => {
      const lines = fs
        .sort((a, b) => churn(b) - churn(a))
        .map((f) => `    ${f.path} (${f.status} +${f.insertions}/-${f.deletions})`)
        .join('\n');
      return `  ${dir}/\n${lines}`;
    })
    .join('\n');
}

/**
 * Pure — exported for tests. Builds the user prompt from a release row.
 *
 * `compact` halves the evidence for the retry pass: the biggest releases (60+
 * files) push a slow reasoning model past the gateway's 90s non-streaming
 * ceiling, and a shorter prompt with fewer requested items lands inside it.
 */
export function buildSummaryPrompt(
  r: Pick<Release, 'version' | 'shortSha' | 'deployedAt' | 'commits' | 'files' | 'stats'>,
  compact = false,
): string {
  const commits = (r.commits as CommitFact[]) ?? [];
  const files = (r.files as FileFact[]) ?? [];
  const stats = (r.stats as { commits?: number; files?: number; insertions?: number; deletions?: number; prs?: number[] }) ?? {};

  const shownCommits = commits.slice(0, compact ? Math.ceil(MAX_COMMITS_IN_PROMPT / 3) : MAX_COMMITS_IN_PROMPT);
  const shownFiles = [...files]
    .sort((a, b) => b.insertions + b.deletions - (a.insertions + a.deletions))
    .slice(0, compact ? Math.ceil(MAX_FILES_IN_PROMPT / 3) : MAX_FILES_IN_PROMPT);

  const parts = [
    `RELEASE ${r.version} (${r.shortSha}) deployed ${r.deployedAt instanceof Date ? r.deployedAt.toISOString() : r.deployedAt}`,
    `${stats.commits ?? commits.length} commits · ${stats.files ?? files.length} files · +${stats.insertions ?? 0}/-${stats.deletions ?? 0}` +
      (stats.prs?.length ? ` · PRs ${stats.prs.map((n) => `#${n}`).join(', ')}` : ''),
    '',
    'COMMITS:',
    shownCommits.map(renderCommit).join('\n'),
  ];
  if (commits.length > shownCommits.length) {
    parts.push(`  …and ${commits.length - shownCommits.length} more commits not shown.`);
  }
  parts.push('', 'FILES CHANGED:', groupFiles(shownFiles));
  if (files.length > shownFiles.length) {
    parts.push(`  …and ${files.length - shownFiles.length} more files not shown.`);
  }
  if (compact) {
    parts.push('', 'Keep this one short: at most 4 items, at most 4 bullets in each list.');
  }
  return parts.join('\n');
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function strList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, max);
}

/** Guess a kind from a conventional-commit subject; used when the model omits one. */
export function kindFromSubject(subject: string): ReleaseItemKind {
  const s = subject.toLowerCase();
  if (/^fix|^revert|\bbugfix\b/.test(s)) return 'fix';
  if (/^feat/.test(s)) return 'feature';
  if (/^perf|^refactor/.test(s)) return 'improvement';
  if (/^ci|^build|^chore\(deps/.test(s)) return 'infra';
  if (/^docs|^content/.test(s)) return 'content';
  if (/^chore|^style|^test/.test(s)) return 'chore';
  return 'improvement';
}

/**
 * Pure — exported for tests. Clamps the model's output to the schema and drops
 * evidence pointers that don't exist in the release (the anti-hallucination
 * step: a plausible-but-invented file path is the failure mode that would make
 * the whole log untrustworthy).
 */
/**
 * Storage-time scrub for secrets and personal data.
 *
 * The summariser is reading commit messages, and commit messages quote the
 * data that provoked the change — a WhatsApp JID fix quoted the real phone
 * number it was failing on, and that reached the public /releases page. The
 * evidence-binding above cannot catch this: the number was not invented, it
 * was faithfully reported from the commits.
 *
 * So sensitive spans are removed HERE, before the row is written, rather than
 * only being filtered at render. $lib/releases/public-filter still gates the
 * public view — this is the layer that keeps it out of the database at all,
 * which also protects every other reader of the table.
 *
 * Redact rather than drop: the release log is the owner's own record and
 * should stay complete. Only the sensitive span goes.
 */
function scrub<T>(value: T): T {
  return redactDeep(value);
}

export function normaliseSummary(
  raw: unknown,
  evidence: { commits: CommitFact[]; files: FileFact[] },
): ReleaseSummary {
  const validShas = new Set(evidence.commits.flatMap((c) => [c.short, c.sha]));
  const validFiles = new Set(evidence.files.map((f) => f.path));
  const obj = (raw ?? {}) as Record<string, unknown>;
  const fallbackTitle = evidence.commits[0]?.subject ?? 'Production deploy';

  const items = (Array.isArray(obj.items) ? obj.items : [])
    .slice(0, MAX_ITEMS)
    .map((entry): ReleaseItemSummary | null => {
      const it = (entry ?? {}) as Record<string, unknown>;
      const title = typeof it.title === 'string' ? it.title.trim() : '';
      if (!title) return null;
      return {
        kind: pick(it.kind, RELEASE_ITEM_KINDS, 'improvement'),
        impact: pick(it.impact, RELEASE_IMPACTS, 'internal'),
        title: scrub(title.slice(0, 140)),
        summary: scrub((typeof it.summary === 'string' ? it.summary.trim() : '').slice(0, 1200)),
        includes: scrub(strList(it.includes, 12)),
        excludes: scrub(strList(it.excludes, 12)),
        surfaces: scrub(strList(it.surfaces, 10)),
        // Evidence pointers must exist in the release, or they're dropped.
        files: strList(it.files, 40).filter((f) => validFiles.has(f)),
        commits: strList(it.commits, 40)
          .map((c) => c.trim())
          .filter((c) => validShas.has(c) || validShas.has(c.slice(0, 8)))
          .map((c) => c.slice(0, 8)),
        confidence: pick(it.confidence, RELEASE_CONFIDENCES, 'medium'),
      };
    })
    .filter((i): i is ReleaseItemSummary => i !== null);

  return {
    title: scrub(
      (typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : fallbackTitle).slice(0, 200),
    ),
    summary: scrub((typeof obj.summary === 'string' ? obj.summary.trim() : '').slice(0, 2000)),
    items,
  };
}

/**
 * Deterministic fallback used when the LLM is unavailable or returns nothing
 * usable. One item per commit subject, no invented detail — the page stays
 * readable during an OpenRouter outage instead of showing a wall of "pending".
 */
export function fallbackSummary(evidence: { commits: CommitFact[]; files: FileFact[] }): ReleaseSummary {
  const items = evidence.commits.slice(0, MAX_ITEMS).map((c): ReleaseItemSummary => ({
    kind: kindFromSubject(c.subject),
    impact: 'internal',
    title: c.subject.slice(0, 140),
    summary: (c.body || '').trim().slice(0, 600),
    includes: [],
    excludes: [],
    surfaces: [],
    files: evidence.files.map((f) => f.path).slice(0, 20),
    commits: [c.short],
    confidence: 'low',
  }));
  return {
    title: evidence.commits[0]?.subject.slice(0, 200) ?? 'Production deploy',
    summary: `${evidence.commits.length} commit(s) across ${evidence.files.length} file(s). Written from commit subjects — no model summary available.`,
    items,
  };
}

/**
 * Persist a summary over a release, replacing any previous items.
 *
 * The scrub is repeated here even though normaliseSummary already ran it,
 * because this is the single choke point every producer passes through —
 * including fallbackSummary, which copies commit subjects and bodies verbatim
 * and is therefore the likeliest source of raw personal data of all. Redaction
 * is idempotent, so running it twice costs nothing and means a future code
 * path cannot bypass it by accident.
 */
async function writeSummary(id: number, rawSummary: ReleaseSummary, model: string, status: 'ok' | 'failed', errorText?: string) {
  const summary = redactDeep(rawSummary);
  const kinds = [...new Set(summary.items.map((i) => i.kind))];
  await db.transaction(async (tx) => {
    await tx
      .update(releases)
      .set({
        title: summary.title,
        summary: summary.summary,
        kinds,
        summaryStatus: status,
        summaryError: errorText ?? null,
        summaryModel: model,
        summarisedAt: new Date(),
      })
      .where(eq(releases.id, id));
    await tx.delete(releaseItems).where(eq(releaseItems.releaseId, id));
    if (summary.items.length) {
      await tx.insert(releaseItems).values(
        summary.items.map((it, ordinal) => ({
          releaseId: id,
          ordinal,
          kind: it.kind,
          impact: it.impact,
          title: it.title,
          summary: it.summary,
          includes: it.includes,
          excludes: it.excludes,
          surfaces: it.surfaces,
          files: it.files,
          commits: it.commits,
          confidence: it.confidence,
        })),
      );
    }
  });
}

/** Summarise one release. Returns what happened; never throws for LLM failures. */
export async function summariseRelease(id: number, opts: { force?: boolean } = {}): Promise<'ok' | 'skipped' | 'failed'> {
  const [row] = await db.select().from(releases).where(eq(releases.id, id)).limit(1);
  if (!row) return 'skipped';
  if (!opts.force && row.summaryStatus === 'ok') return 'skipped';

  const evidence = {
    commits: (row.commits as CommitFact[]) ?? [],
    files: (row.files as FileFact[]) ?? [],
  };
  if (!evidence.commits.length) {
    // An empty range is a re-deploy of the same tree (CI re-run, manual restart).
    await writeSummary(
      id,
      { title: 'Re-deploy — no code changes', summary: 'This deploy shipped the same commit as the one before it.', items: [] },
      'none',
      'ok',
    );
    return 'ok';
  }

  // Resolved AND passed to the call below. It used to be resolved here and only
  // written into the row for display, while `jsonCompletion` picked its own
  // model — so the release log named one model and the bill carried another.
  let model = 'unknown';
  try {
    model = (await resolveReleasesModel()).modelId;
  } catch {
    /* keep 'unknown' — the call then falls back to the deepdive default */
  }

  // Two passes: full evidence, then compact. The compact retry exists because
  // the largest releases (60+ files) reliably blew the LLM gateway's 90s
  // non-streaming ceiling on a reasoning model — a shorter prompt asking for
  // fewer items lands inside it, and a slightly terser real summary beats the
  // deterministic commit-subject fallback every time.
  let lastError = 'unknown';
  for (const compact of [false, true]) {
    try {
      const raw = await withActivity('releases', () =>
        jsonCompletion<unknown>(systemPrompt(), buildSummaryPrompt(row, compact), {
          temperature: 0.2,
          maxTokens: compact ? 3500 : 6000,
          ...(model === 'unknown' ? {} : { model }),
        }),
      );
      const summary = normaliseSummary(raw, evidence);
      if (!summary.items.length) throw new Error('model returned no usable items');
      await writeSummary(id, summary, model, 'ok');
      return 'ok';
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(
        `[releases] summarise ${row.version} (${row.shortSha})${compact ? ' [compact retry]' : ''} failed:`,
        lastError,
      );
    }
  }

  // Still write the deterministic fallback so the row is readable, but flag it
  // as failed so the admin page can offer a retry.
  try {
    await writeSummary(id, fallbackSummary(evidence), model, 'failed', lastError.slice(0, 500));
  } catch (writeErr) {
    console.error('[releases] fallback write failed:', writeErr);
  }
  return 'failed';
}

/** How many releases are still waiting for (or failed) a summary. */
export async function countPending(includeFailed = false): Promise<number> {
  const statuses = includeFailed ? ['pending', 'failed'] : ['pending'];
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(releases)
    .where(inArray(releases.summaryStatus, statuses));
  return row?.n ?? 0;
}

/**
 * Summarise up to `limit` un-summarised releases, oldest first (so the log fills
 * in chronological order during a backfill). Concurrency is deliberately low:
 * the site shares one OpenRouter key with chat, and a backfill must never
 * rate-limit an interactive /jkai conversation.
 */
export async function summarisePending(
  limit: number,
  opts: { includeFailed?: boolean } = {},
): Promise<{ processed: number; ok: number; failed: number; remaining: number }> {
  const statuses = opts.includeFailed ? ['pending', 'failed'] : ['pending'];
  const rows = await db
    .select({ id: releases.id })
    .from(releases)
    .where(inArray(releases.summaryStatus, statuses))
    .orderBy(asc(releases.deployedAt))
    .limit(limit);

  const run = pLimit(3);
  const results = await Promise.all(rows.map((r) => run(() => summariseRelease(r.id, { force: opts.includeFailed }))));

  return {
    processed: results.length,
    ok: results.filter((r) => r === 'ok').length,
    failed: results.filter((r) => r === 'failed').length,
    remaining: await countPending(opts.includeFailed),
  };
}

/** Newest release, for the admin header and the "current version" badge. */
export async function latestRelease(): Promise<Release | null> {
  const [row] = await db.select().from(releases).orderBy(desc(releases.deployedAt)).limit(1);
  return row ?? null;
}

/**
 * Allocate the next `YYYY.MM.DD.N` label for a deploy date. Takes MAX(suffix)+1
 * rather than COUNT+1 so a deleted or re-ingested release can never collide
 * with a label already in use (the version column is user-visible and shows up
 * in the UI as the release's identity).
 */
export async function nextVersionLabel(deployedAt: Date): Promise<string> {
  const day = deployedAt.toISOString().slice(0, 10).replace(/-/g, '.');
  const [row] = await db
    .select({
      maxN: sql<number>`coalesce(max(nullif(split_part(${releases.version}, '.', 4), '')::int), 0)`,
    })
    .from(releases)
    .where(sql`${releases.version} like ${day + '.%'}`);
  return `${day}.${(row?.maxN ?? 0) + 1}`;
}
