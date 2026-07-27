// POST /api/releases/ingest — record one production deploy.
//
// Called by scripts/ci-deploy.sh AFTER the public-URL check passes (so only
// deploys that actually reached production are recorded), and by
// scripts/release-log/ingest.mjs --backfill for the pre-table history.
//
// Auth: a matching `Authorization: Bearer RELEASE_LOG_SECRET`, OR an owner
// session / LAN-dev bypass. The POST is exempted from Auth.js in
// hooks.server.ts, so this is the only gate on it — and unlike
// /api/claude-changelog/ingest it deliberately does NOT fall open when the
// secret is unset. On the VPS that bypass would let anyone on the internet
// write fabricated entries into the release log, which is a record people are
// meant to trust; on homeserv the LAN bypass still keeps local ingest easy.
//
// Idempotent on `sha`: a re-deploy of the same commit is a no-op, which is what
// makes it safe to call from a CI step that may retry.
//
// GET → counts, owner-gated by the normal /api gate. Used for debugging.
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { releases } from '$lib/db/schema';
import { nextVersionLabel, summariseRelease } from '$lib/releases/summarise';
import { isOwnerRequest } from '$lib/server/owner';
import { RELEASE_VIA, type CommitFact, type FileFact, type ReleaseIngestPayload, type ReleaseVia } from '$lib/releases/types';
import type { RequestEvent, RequestHandler } from './$types';

async function authorized(event: RequestEvent): Promise<boolean> {
  const secret = env.RELEASE_LOG_SECRET;
  if (secret && (event.request.headers.get('authorization') ?? '') === `Bearer ${secret}`) return true;
  return isOwnerRequest(event);
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function ts(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function cleanCommits(input: unknown): CommitFact[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((raw) => {
      const c = (raw ?? {}) as Record<string, unknown>;
      const sha = typeof c.sha === 'string' ? c.sha : '';
      if (!sha) return null;
      const prRaw = num(c.pr);
      return {
        sha,
        short: typeof c.short === 'string' && c.short ? c.short : sha.slice(0, 8),
        author: typeof c.author === 'string' ? c.author : '',
        date: typeof c.date === 'string' ? c.date : '',
        subject: typeof c.subject === 'string' ? c.subject : '',
        body: typeof c.body === 'string' ? c.body.slice(0, 4000) : '',
        pr: prRaw > 0 ? prRaw : null,
      } satisfies CommitFact;
    })
    .filter((c): c is CommitFact => c !== null);
}

function cleanFiles(input: unknown): FileFact[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((raw) => {
      const f = (raw ?? {}) as Record<string, unknown>;
      const path = typeof f.path === 'string' ? f.path : '';
      if (!path) return null;
      return {
        path,
        status: typeof f.status === 'string' && f.status ? f.status.slice(0, 4) : 'M',
        insertions: num(f.insertions),
        deletions: num(f.deletions),
      } satisfies FileFact;
    })
    .filter((f): f is FileFact => f !== null);
}

export const POST: RequestHandler = async (event) => {
  if (!(await authorized(event))) throw error(401, 'unauthorized');
  const { request, url } = event;
  const body = (await request.json().catch(() => null)) as ReleaseIngestPayload | null;
  if (!body?.sha) throw error(400, 'missing sha');

  const deployedAt = ts(body.deployedAt) ?? new Date();
  const force = url.searchParams.get('force') === '1';

  // One row per deployed commit. A CI re-run, a service restart or a retried
  // ingest step therefore can't duplicate a release.
  const [existing] = await db
    .select({ id: releases.id, version: releases.version, hash: releases.contentHash })
    .from(releases)
    .where(eq(releases.sha, body.sha))
    .limit(1);
  if (existing && !force) {
    return json({ ok: true, id: existing.id, version: existing.version, skipped: 'already-recorded' });
  }

  const commits = cleanCommits(body.commits);
  const files = cleanFiles(body.files);
  const stats = {
    commits: num(body.stats?.commits) || commits.length,
    files: num(body.stats?.files) || files.length,
    insertions: num(body.stats?.insertions) || files.reduce((n, f) => n + f.insertions, 0),
    deletions: num(body.stats?.deletions) || files.reduce((n, f) => n + f.deletions, 0),
    prs: Array.isArray(body.stats?.prs) ? body.stats.prs.map(num).filter((n) => n > 0) : [],
  };

  const via: ReleaseVia = RELEASE_VIA.includes(body.via as ReleaseVia) ? (body.via as ReleaseVia) : 'github-actions';
  const row = {
    sha: body.sha,
    shortSha: body.shortSha || body.sha.slice(0, 8),
    prevSha: body.prevSha ?? null,
    branch: body.branch || 'master',
    via,
    deployedAt,
    builtAt: ts(body.builtAt),
    commits,
    files,
    stats,
    contentHash: body.contentHash ?? null,
    summaryStatus: 'pending' as const,
    ingestedAt: new Date(),
  };

  let id: number;
  let version: string;
  if (existing) {
    id = existing.id;
    version = existing.version;
    await db.update(releases).set({ ...row, summaryStatus: 'pending' }).where(eq(releases.id, id));
  } else {
    version = await nextVersionLabel(deployedAt);
    const [inserted] = await db
      .insert(releases)
      .values({ ...row, version })
      // Belt and braces: two deploys racing on the same sha (CI retry) resolve
      // to one row rather than a 500 on the unique index.
      .onConflictDoUpdate({ target: releases.sha, set: { ...row, id: sql`${releases.id}` } })
      .returning({ id: releases.id, version: releases.version });
    id = inserted.id;
    version = inserted.version;
  }

  // Summarise out of band: the deploy step must never wait on (or fail
  // because of) an LLM call. The admin page and the summarise endpoint both
  // pick up anything this misses.
  const summarise = url.searchParams.get('summarise') !== '0';
  if (summarise) {
    void summariseRelease(id, { force: true }).catch((err) => {
      console.error('[releases] background summarise failed:', err);
    });
  }

  return json({ ok: true, id, version, commits: commits.length, files: files.length });
};

export const GET: RequestHandler = async () => {
  const [counts] = await db
    .select({
      releases: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${releases.summaryStatus} = 'pending')::int`,
      failed: sql<number>`count(*) filter (where ${releases.summaryStatus} = 'failed')::int`,
      latest: sql<string | null>`max(${releases.version})`,
    })
    .from(releases);
  return json(counts ?? { releases: 0, pending: 0, failed: 0, latest: null });
};
