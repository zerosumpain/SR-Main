import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { db } from '$lib/db';
import { jkaiBuilds, workflows, workflowRuns, projectVisibility } from '$lib/db/schema';
import { and, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import { STATIC_PROJECT_KEYS } from '$lib/projects/visibility';
import { listRunningJobsByConversation } from '$lib/workflows/chat/job-store';
import { publishedLink } from '$lib/builds/published-link';
import { publicWalkState } from '$lib/landing/public-walk';

/**
 * Public, read-only aggregator for the landing-page "Vital Signs" tiles.
 *
 * Whitelisted in src/lib/auth.ts PUBLIC_PATHS so anonymous visitors can read it
 * (the rest of /api/* returns 401 without a session). It exposes ONLY safe
 * aggregate values — counts, a derived build stage, the already-public
 * live-walk state, and the title/link of a build that is ALREADY published at
 * a public /projects/<slug> URL. It deliberately never leaks in-progress build
 * prompts/titles, conversation ids, or canvas slugs/titles.
 *
 * Health/BPM is NOT here — the Health tile reads the shared vitals store
 * (already public via /api/vitals/state) client-side, with its 5s lerp.
 */

const LIVE_STATE_PATH = '/tmp/live-walk-state.json';
const BUILD_CACHE_MS = 10_000;
const SUMMARY_CACHE_MS = 60_000;
const PROJECT_SLUG_PATTERN = '^[a-z0-9][a-z0-9-]*$';

// A build counts as "in flight" while in one of these statuses (and not yet
// published). Mirrors the bucket() logic in $lib/builds/BuildsListV2.svelte.
const ACTIVE_BUILD = new Set([
  'running',
  'queued',
  'paused',
  'awaiting_plan_approval',
  'awaiting_iter_approval',
  'pending',
]);

interface VitalsPayload {
  jkai: { activeJobs: number };
  builder: {
    stage: 'planning' | 'building' | 'shipped' | 'ready' | 'failed' | 'idle';
    active: boolean;
    shippedCount: number;
    lastShippedTitle: string | null;
    lastShippedHref: string | null;
  };
  canvas: { count: number; lastRunAt: string | null };
  walk: { active: boolean };
  generatedAt: string;
}

type LatestBuild = { status: string; planStatus: string; publishedSlug: string | null } | undefined;
type PublicSummary = {
  shippedCount: number;
  latestPublished: { title: string | null; publishedSlug: string | null } | undefined;
  canvasCount: number;
  canvasLastRunAt: string | null;
};

let buildCache: { at: number; data: LatestBuild } | null = null;
let buildPending: Promise<LatestBuild> | null = null;
let summaryCache: { at: number; data: PublicSummary } | null = null;
let summaryPending: Promise<PublicSummary> | null = null;

async function readWalk(): Promise<VitalsPayload['walk']> {
  const idle: VitalsPayload['walk'] = { active: false };
  try {
    if (!existsSync(LIVE_STATE_PATH)) return idle;
    return publicWalkState(JSON.parse(await readFile(LIVE_STATE_PATH, 'utf-8')));
  } catch {
    return idle;
  }
}

function deriveBuilder(
  latest: { status: string; planStatus: string; publishedSlug: string | null } | undefined,
  latestPublished: { title: string | null; publishedSlug: string | null } | undefined,
  shippedCount: number,
): VitalsPayload['builder'] {
  const rawTitle = latestPublished?.title ?? null;
  const lastShippedTitle = rawTitle ? rawTitle.slice(0, 48) : null;
  // Public surface: only ever link to a page on this site. A git-target build
  // stores a PR url here, which is neither a project nor ours to advertise.
  const shippedLink = publishedLink(latestPublished?.publishedSlug);
  const lastShippedHref = shippedLink && !shippedLink.external ? shippedLink.href : null;

  if (!latest) {
    return { stage: 'idle', active: false, shippedCount, lastShippedTitle, lastShippedHref };
  }

  const active = !latest.publishedSlug && ACTIVE_BUILD.has(latest.status);
  let stage: VitalsPayload['builder']['stage'];
  if (active) {
    stage = latest.status === 'running' || latest.status === 'paused' ? 'building' : 'planning';
  } else if (latest.publishedSlug) {
    stage = 'shipped';
  } else if (latest.status === 'completed') {
    stage = 'ready';
  } else if (latest.status === 'failed') {
    stage = 'failed';
  } else {
    stage = 'idle';
  }
  return { stage, active, shippedCount, lastShippedTitle, lastShippedHref };
}

async function latestBuild(): Promise<LatestBuild> {
  if (buildCache && Date.now() - buildCache.at < BUILD_CACHE_MS) return buildCache.data;
  buildPending ??= db
    .select({
      status: jkaiBuilds.status,
      planStatus: jkaiBuilds.planStatus,
      publishedSlug: jkaiBuilds.publishedSlug,
    })
    .from(jkaiBuilds)
    .orderBy(desc(jkaiBuilds.createdAt))
    .limit(1)
    .then((rows) => {
      const data = rows[0];
      buildCache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      buildPending = null;
    });
  return buildPending;
}

async function publicSummary(): Promise<PublicSummary> {
  if (summaryCache && Date.now() - summaryCache.at < SUMMARY_CACHE_MS) return summaryCache.data;
  summaryPending ??= Promise.all([
    // Count only values that can form a real /projects/<slug> URL. Git URLs and
    // branch refs share this column, so `is not null` alone is not sufficient.
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(jkaiBuilds)
      .where(sql`${jkaiBuilds.publishedSlug} ~ ${PROJECT_SLUG_PATTERN}`),
    // A generated build is private unless project_visibility explicitly makes
    // it public. The static project keys retain their documented public default.
    // Do this in SQL with LIMIT 1 instead of loading every historic publish and
    // filtering it in the Node process on every poll.
    db
      .select({ title: jkaiBuilds.title, publishedSlug: jkaiBuilds.publishedSlug })
      .from(jkaiBuilds)
      .leftJoin(projectVisibility, eq(projectVisibility.projectKey, jkaiBuilds.publishedSlug))
      .where(
        and(
          sql`${jkaiBuilds.publishedSlug} ~ ${PROJECT_SLUG_PATTERN}`,
          or(
            eq(projectVisibility.isPublic, true),
            and(
              isNull(projectVisibility.projectKey),
              inArray(jkaiBuilds.publishedSlug, [...STATIC_PROJECT_KEYS]),
            ),
          ),
        ),
      )
      .orderBy(desc(jkaiBuilds.createdAt))
      .limit(1),
    // One aggregate replaces separate count and max queries. DISTINCT keeps a
    // workflow with many runs from inflating the canvas count.
    db
      .select({
        n: sql<number>`count(distinct ${workflows.id})::int`,
        ts: sql<string | null>`max(${workflowRuns.startedAt})`,
      })
      .from(workflows)
      .leftJoin(workflowRuns, eq(workflowRuns.workflowId, workflows.id))
      .where(like(workflows.name, 'canvas:%')),
  ]).then(([countRows, publishedRows, canvasRows]) => {
    const data: PublicSummary = {
      shippedCount: countRows[0]?.n ?? 0,
      latestPublished: publishedRows[0],
      canvasCount: canvasRows[0]?.n ?? 0,
      canvasLastRunAt: canvasRows[0]?.ts ?? null,
    };
    summaryCache = { at: Date.now(), data };
    return data;
  }).finally(() => {
    summaryPending = null;
  });
  return summaryPending;
}

async function compute(): Promise<VitalsPayload> {
  const [latest, summary, walk] = await Promise.all([
    latestBuild(),
    publicSummary(),
    readWalk(),
  ]);

  const builder = deriveBuilder(latest, summary.latestPublished, summary.shippedCount);

  return {
    jkai: { activeJobs: listRunningJobsByConversation().size },
    builder,
    canvas: {
      count: summary.canvasCount,
      lastRunAt: summary.canvasLastRunAt
        ? new Date(summary.canvasLastRunAt).toISOString()
        : null,
    },
    walk,
    generatedAt: new Date().toISOString(),
  };
}

export const GET: RequestHandler = async () => {
  let data: VitalsPayload;
  try {
    data = await compute();
  } catch (err) {
    // Fail soft — the landing page must never 500 on a tile.
    console.error('[landing/vitals] compute failed:', err);
    data = {
      jkai: { activeJobs: 0 },
      builder: { stage: 'idle', active: false, shippedCount: 0, lastShippedTitle: null, lastShippedHref: null },
      canvas: { count: 0, lastRunAt: null },
      walk: { active: false },
      generatedAt: new Date().toISOString(),
    };
  }
  return json(data, {
    headers: {
      // The live fields were already allowed to be five seconds old by the old
      // in-process cache. Let the edge share that same safe window across
      // visitors instead of every app instance receiving identical polls.
      'Cache-Control': 'public, max-age=5, s-maxage=5, stale-while-revalidate=30',
    },
  });
};
