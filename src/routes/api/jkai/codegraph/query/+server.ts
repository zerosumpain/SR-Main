/**
 * POST /api/jkai/codegraph/query — run one CGQL query.
 *
 * Three callers, three credentials:
 *   - a running build, via `scripts/codegraph-query.mjs` over bash, carrying
 *     the per-build token `executor.ts` put in its environment;
 *   - homeserv, service-to-service, carrying the same bearer the ingest uses;
 *   - the owner, from chat or the UI, via the normal Auth.js session.
 *
 * The build case was documented here from the start and did not work: the
 * script sends `JKAI_BRIDGE_TOKEN`, which `executor.ts` sets to the tool-bridge
 * token, while this route only ever accepted the changelog secret. Every pull
 * from inside a build 401'd, and the comment claiming otherwise is why nobody
 * looked. A contract in a docstring is not a tested one.
 *
 * Every call is written to `codegraph_queries`, INCLUDING the ones that return
 * nothing. That is not bookkeeping: the builder's site-tool bridge logged
 * "Tool bridge OK — 167 site tools" every iteration for sixty days while never
 * once being called, and the only reason anyone could eventually prove it was
 * SQL over recorded actions. A retrieval system that logs only its hits cannot
 * be distinguished from one that is quietly doing nothing.
 */
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { codegraphQueries } from '$lib/db/schema';
import {
  codegraphAuthFailure,
  codegraphBuildAuthorized,
  codegraphServiceAuthorized,
} from '$lib/codegraph/auth';
import { CgqlError, parseCgql } from '$lib/codegraph/query';
import { buildContextBlock, runPlan } from '$lib/codegraph/retrieve';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  const service = codegraphServiceAuthorized(request);
  // A running build authenticates with the per-build token `executor.ts` puts
  // in its environment. Until this existed the pull channel returned 401 to
  // every build that ever tried it, because the script sends that token and
  // only the changelog secret was accepted — see `codegraphBuildAuthorized`.
  const tokenBuildId = service ? null : codegraphBuildAuthorized(request);
  if (!service && !tokenBuildId) {
    // Not a build: fall back to the owner session. `locals.session` is set by
    // the Auth.js handle; this route is NOT in the hooks bypass for anything
    // other than an exact-path service call, so an anonymous request never
    // reaches here without a token.
    const session = await locals.auth?.();
    if (!session?.user) throw error(401, codegraphAuthFailure(request));
  }

  const body = (await request.json().catch(() => null)) as {
    query?: string; repo?: string; buildId?: string; iterationId?: string; channel?: string;
  } | null;

  // The TOKEN's build wins over the body's claim. A build proved which build
  // it is by holding a credential; the body is just an assertion, and letting
  // it override would let one build's queries be recorded against another's.
  const attributedBuildId = tokenBuildId ?? body?.buildId ?? null;

  const queryText = (body?.query ?? '').trim();
  if (!queryText) throw error(400, 'missing query');

  const channel = body?.channel === 'push' || body?.channel === 'pull' ? body.channel : 'chat';
  const started = Date.now();

  let plan;
  try {
    plan = parseCgql(queryText);
  } catch (e) {
    if (e instanceof CgqlError) {
      // Log the parse failure too — a caller generating bad CGQL is a bug we
      // want visible in SQL, not a silent 400 nobody counts.
      await db.insert(codegraphQueries).values({
        channel, buildId: attributedBuildId, iterationId: body?.iterationId ?? null,
        query: queryText, outcome: 'failed', errorMessage: `${e.message} (at ${e.position})`,
        durationMs: Date.now() - started,
      }).catch(() => {});
      throw error(400, `${e.message} (at character ${e.position})`);
    }
    throw e;
  }

  try {
    const result = await runPlan(plan, { repo: body?.repo });
    const block = buildContextBlock(result);

    await db.insert(codegraphQueries).values({
      channel,
      buildId: attributedBuildId,
      iterationId: body?.iterationId ?? null,
      query: queryText,
      outcome: result.outcome,
      episodeIds: result.episodes.map((e) => e.id),
      lessonIds: result.lessons.map((l) => l.id),
      charsServed: block.length,
      durationMs: result.durationMs,
    }).catch(() => {});

    return json({
      ok: true,
      outcome: result.outcome,
      block,
      lessons: result.lessons,
      episodes: result.episodes,
      nodes: result.nodes,
      durationMs: result.durationMs,
    });
  } catch (e) {
    const message = (e as Error).message ?? 'query failed';
    await db.insert(codegraphQueries).values({
      channel, buildId: attributedBuildId, iterationId: body?.iterationId ?? null,
      query: queryText, outcome: 'failed', errorMessage: message.slice(0, 500),
      durationMs: Date.now() - started,
    }).catch(() => {});
    // 502, not 200-with-empty: an infrastructure fault must never be
    // indistinguishable from "there is no precedent for this".
    throw error(502, `codegraph query failed: ${message}`);
  }
};
