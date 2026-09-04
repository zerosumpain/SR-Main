import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { db } from '$lib/db';
import { jkaiBuilds, workflows, workflowRuns, projectVisibility } from '$lib/db/schema';
import { desc, eq, like, isNotNull, sql } from 'drizzle-orm';
import { isProjectSlug, defaultsPublic } from '$lib/projects/visibility';
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
 * Health/BPM is NOT here — the Health tile reads the shared biome store
 * (already public via /api/biome/state) client-side, with its 5s lerp.
 */

const LIVE_STATE_PATH = '/tmp/live-walk-state.json';
const CACHE_MS = 5_000; // shield the DB from many concurrent visitor polls

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

let cache: { at: number; data: VitalsPayload } | null = null;

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

async function compute(): Promise<VitalsPayload> {
  const [latestArr, publishedRows, canvasCountArr, canvasRunArr, walk] = await Promise.all([
    db
      .select({
        status: jkaiBuilds.status,
        planStatus: jkaiBuilds.planStatus,
        publishedSlug: jkaiBuilds.publishedSlug,
      })
      .from(jkaiBuilds)
      .orderBy(desc(jkaiBuilds.createdAt))
      .limit(1),
    // "Shipped" = published to a real /projects/<slug> page that is PUBLIC.
    // Forge/git-target builds park a PR URL or branch ref in publishedSlug
    // rather than a slug; both are dropped by isProjectSlug below. (A SQL
    // `not like 'http%'` used to do it, and matched neither
    // `master...agent/ab2-…` nor anything else that is not a URL.) Visibility
    // then applies: a build is private unless an explicit row publishes it —
    // never name a private project to an anon visitor.
    db
      .select({
        title: jkaiBuilds.title,
        publishedSlug: jkaiBuilds.publishedSlug,
        isPublic: projectVisibility.isPublic,
      })
      .from(jkaiBuilds)
      .leftJoin(projectVisibility, eq(projectVisibility.projectKey, jkaiBuilds.publishedSlug))
      .where(isNotNull(jkaiBuilds.publishedSlug))
      .orderBy(desc(jkaiBuilds.createdAt)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(workflows)
      .where(like(workflows.name, 'canvas:%')),
    db
      .select({ ts: sql<string | null>`max(${workflowRuns.startedAt})` })
      .from(workflowRuns)
      .innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
      .where(like(workflows.name, 'canvas:%')),
    readWalk(),
  ]);

  // shippedCount counts every real-slug publish (a bare number is not
  // sensitive); but only a PUBLIC project's title/link may be surfaced — naming
  // a private project to an anon visitor is the actual leak. No visibility row
  // means public for a static page and private for a build, so ask
  // defaultsPublic rather than assuming either way.
  const slugPublishes = publishedRows.filter((r) => isProjectSlug(r.publishedSlug));
  const publicPublished = slugPublishes.filter(
    (r) => r.isPublic ?? defaultsPublic(r.publishedSlug!),
  );
  const builder = deriveBuilder(latestArr[0], publicPublished[0], slugPublishes.length);
  const lastRunTs = canvasRunArr[0]?.ts ?? null;

  return {
    jkai: { activeJobs: listRunningJobsByConversation().size },
    builder,
    canvas: {
      count: canvasCountArr[0]?.n ?? 0,
      lastRunAt: lastRunTs ? new Date(lastRunTs).toISOString() : null,
    },
    walk,
    generatedAt: new Date().toISOString(),
  };
}

export const GET: RequestHandler = async () => {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return json(cache.data);
  }
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
  cache = { at: Date.now(), data };
  return json(data);
};
