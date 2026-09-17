/**
 * The work behind a release — Claude Code sessions, joined on pull-request number.
 *
 * `/admin/ops/claude-changelog` and `/releases` were two complete records of the
 * same engineering with no key between them: 296 sessions and 5,404 stages on
 * one side, 1,130 releases and 1,897 items on the other. This is the key.
 *
 * Why PR number and not the obvious alternatives, all measured rather than
 * assumed:
 *
 *  - `claude_sessions.git_branch` is latched at session start, before any
 *    worktree branch is cut, so every development session reports `master`. It
 *    would attach every session to every release.
 *  - Commit SHAs in a transcript are the BRANCH's, pre-squash; master carries
 *    the squashed one. 0 matches out of 105.
 *  - The `Claude-Session:` commit trailer is an account-level id spanning up to
 *    107 commits over 8 days — far too coarse to attribute one deploy.
 *  - PR numbers are exact and present on both sides. 704 of 704 releases
 *    deployed since 2026-08-01 carry them in `stats.prs`, and 139 of the 180
 *    transcripts on disk carry at least one.
 *
 * OWNER-ONLY, and structurally so. This module is imported by the owner branch
 * of the /releases loader and nowhere else: session prose, prompts, transcripts
 * and per-stage costs must never reach the public tree. `{#if owner}` in a
 * template is not a boundary — the bytes still ship — which is the rule
 * $lib/releases/public-filter already enforces for commit prose.
 */
import { sql } from 'drizzle-orm';
import { db } from '$lib/db';

export interface SessionStageSlice {
  stage: string;
  ordinal: number;
  title: string | null;
  costUsd: number | null;
}

export interface ReleaseSession {
  id: string;
  title: string | null;
  project: string;
  startedAt: Date | null;
  endedAt: Date | null;
  messageCount: number;
  toolCallCount: number;
  estCostUsd: number | null;
  costKnown: boolean;
  pullRequests: number[];
  /** The stage timeline, in order — the thing the changelog page was liked for. */
  stages: SessionStageSlice[];
  /** Which of the releases on this page this session is linked to. */
  releaseIds: number[];
}

export interface ReleaseSessionsBand {
  sessions: ReleaseSession[];
  /** releaseId → session ids, so a release card can show "built in" inline. */
  byRelease: Record<number, string[]>;
  /** Sessions overlapping these releases' dates that no PR links. Honest, not hidden. */
  unlinkedInWindow: number;
  /** Total sessions that carry no PR at all, for the band's own caveat line. */
  sessionsWithoutPrs: number;
}

/**
 * `db.execute()` returns the driver's QueryResult — `{ rows, rowCount, … }` —
 * NOT an array of rows. Casting it straight to a row array type compiles
 * perfectly and then throws `rows.map is not a function` at runtime, which is
 * how /releases went 500 for the owner on 2026-09-17.
 *
 * So the unwrap lives in one place and every reader goes through it. The house
 * pattern is `result.rows` (see $lib/jkai/grounding/quality.server.ts).
 */
function rowsOf(result: unknown): Record<string, unknown>[] {
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

const EMPTY: ReleaseSessionsBand = { sessions: [], byRelease: {}, unlinkedInWindow: 0, sessionsWithoutPrs: 0 };

/**
 * Sessions for exactly the releases on the caller's current page.
 *
 * Page-scoped deliberately. Giving the band its own pager would put two
 * competing paginations on one URL, and the join is the organising principle —
 * a session that spans a page boundary appearing on both pages is correct, not
 * a defect.
 */
export async function getReleaseSessions(releaseIds: number[]): Promise<ReleaseSessionsBand> {
  if (!releaseIds.length) return EMPTY;

  // One round trip. `stats->'prs'` is the release's PR list and `pull_requests`
  // is the session's; the overlap is the link. jsonb array overlap has no
  // operator, so both sides are expanded — the GIN index on pull_requests still
  // serves the containment half.
  const rows = await db.execute(sql`
    with page as (
      select id, coalesce(stats->'prs', '[]'::jsonb) as prs, deployed_at
      from releases
      where id in (${sql.join(releaseIds.map((id) => sql`${id}`), sql`, `)})
    ),
    linked as (
      select distinct s.id as session_id, p.id as release_id
      from page p
      join lateral jsonb_array_elements_text(p.prs) as pr(n) on true
      join claude_sessions s on s.pull_requests @> to_jsonb(array[pr.n::int])
    )
    select s.id, s.title, s.project, s.started_at, s.ended_at, s.message_count,
           s.tool_call_count, s.est_cost_usd, s.cost_known, s.pull_requests,
           array_agg(distinct l.release_id) as release_ids
    from linked l
    join claude_sessions s on s.id = l.session_id
    group by s.id, s.title, s.project, s.started_at, s.ended_at, s.message_count,
             s.tool_call_count, s.est_cost_usd, s.cost_known, s.pull_requests
    order by s.started_at desc nulls last
  `);

  const sessions: ReleaseSession[] = rowsOf(rows).map((r) => ({
    id: String(r.id),
    title: (r.title as string) ?? null,
    project: String(r.project ?? 'unknown'),
    startedAt: r.started_at ? new Date(r.started_at as string) : null,
    endedAt: r.ended_at ? new Date(r.ended_at as string) : null,
    messageCount: Number(r.message_count ?? 0),
    toolCallCount: Number(r.tool_call_count ?? 0),
    estCostUsd: r.est_cost_usd === null || r.est_cost_usd === undefined ? null : Number(r.est_cost_usd),
    costKnown: r.cost_known !== false,
    pullRequests: Array.isArray(r.pull_requests) ? (r.pull_requests as number[]) : [],
    stages: [],
    releaseIds: (r.release_ids as number[]) ?? [],
  }));

  if (sessions.length) {
    const ids = sessions.map((s) => s.id);
    const stageRows = await db.execute(sql`
      select session_id, stage, ordinal, title, cost_usd
      from claude_session_stages
      where session_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      order by session_id, ordinal
    `);
    const byId = new Map(sessions.map((s) => [s.id, s]));
    for (const r of rowsOf(stageRows)) {
      byId.get(String(r.session_id))?.stages.push({
        stage: String(r.stage),
        ordinal: Number(r.ordinal ?? 0),
        title: (r.title as string) ?? null,
        costUsd: r.cost_usd === null || r.cost_usd === undefined ? null : Number(r.cost_usd),
      });
    }
  }

  const byRelease: Record<number, string[]> = {};
  for (const s of sessions) {
    for (const rid of s.releaseIds) (byRelease[rid] ??= []).push(s.id);
  }

  // The caveat the band states about itself. A session with no PR is not a
  // failure of the join — it is a session that opened no pull request — but the
  // page must say so rather than quietly showing fewer sessions than exist.
  const [counts] = rowsOf(await db.execute(sql`
    select
      count(*) filter (where jsonb_array_length(pull_requests) = 0) as without_prs,
      count(*) filter (
        where jsonb_array_length(pull_requests) = 0
          and started_at between (select min(deployed_at) from releases where id in (
                ${sql.join(releaseIds.map((id) => sql`${id}`), sql`, `)}))
                            and (select max(deployed_at) from releases where id in (
                ${sql.join(releaseIds.map((id) => sql`${id}`), sql`, `)}))
      ) as unlinked_in_window
    from claude_sessions
  `));

  return {
    sessions,
    byRelease,
    unlinkedInWindow: Number(counts?.unlinked_in_window ?? 0),
    sessionsWithoutPrs: Number(counts?.without_prs ?? 0),
  };
}
