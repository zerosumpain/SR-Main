// The watchlist: which entities are being watched, and what moved under them.
//
//   GET               watched entities, their last recorded structure, and the
//                     change alarms raised against each
//   POST { entityId, watched }   put an entity on the list, or take it off
//   POST { action: 'check' }     run the check now rather than waiting
//
// The detection itself lives in $lib/jkai/intel/watchlist — pure diff, tested
// without a database — so this route only shapes the read.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { intelEntities, intelEntityTypes, intelInsights } from '$lib/db/schema';
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { getSetting, setSetting } from '$lib/server/models/settings';
import { isOwnerScope, scopeKey, spaceIn, type IntelScope } from '$lib/jkai/intel/scope';
import { resolveRequestScope } from '$lib/jkai/intel/scope.server';
import {
  readWatchlistSnapshot,
  runWatchlistCheck,
  setWatched,
  WATCH_INSIGHT_KINDS,
  type WatchedSnapshotEntry,
} from '$lib/jkai/intel/watchlist';

/** Enough history to see a pattern; the insights page is where you go for all of it. */
const MAX_CHANGES = 80;

/** When a check last ran, as distinct from when the snapshot was taken. */
const LAST_CHECK_KEY = 'intel.watchlist.last_check';

/**
 * Per scope, like the snapshot (`watchlistSnapshotKey`): a member's "last
 * checked" is their own check, not the owner's. The owner keeps the old key.
 */
function lastCheckKey(scope: IntelScope): string {
  return isOwnerScope(scope) ? LAST_CHECK_KEY : `${LAST_CHECK_KEY}:${scopeKey(scope)}`;
}

export const GET: RequestHandler = async (event) => {
  const scope = await resolveRequestScope(event);
  const [rows, snapshot, changes, lastCheck] = await Promise.all([
    db
      .select({
        id: intelEntities.id,
        name: intelEntities.name,
        summary: intelEntities.summary,
        confidenceScore: intelEntities.confidenceScore,
        lens: intelEntities.lens,
        typeName: intelEntityTypes.name,
        icon: intelEntityTypes.icon,
        color: intelEntityTypes.color,
      })
      .from(intelEntities)
      .leftJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
      .where(
        and(
          eq(intelEntities.watched, true),
          isNull(intelEntities.mergedIntoId),
          spaceIn(intelEntities.spaceId, scope),
        ),
      )
      .orderBy(intelEntities.name),
    readWatchlistSnapshot(scope),
    db
      .select({
        id: intelInsights.id,
        kind: intelInsights.kind,
        title: intelInsights.title,
        explanation: intelInsights.explanation,
        score: intelInsights.score,
        components: intelInsights.components,
        entityIds: intelInsights.entityIds,
        status: intelInsights.status,
        proposedActions: intelInsights.proposedActions,
        createdAt: intelInsights.createdAt,
        updatedAt: intelInsights.updatedAt,
      })
      .from(intelInsights)
      // Dismissed alarms stay out of the way but are not deleted — the
      // insights endpoint can still surface them with ?status=dismissed.
      .where(
        and(
          inArray(intelInsights.kind, [...WATCH_INSIGHT_KINDS]),
          ne(intelInsights.status, 'dismissed'),
          spaceIn(intelInsights.spaceId, scope),
        ),
      )
      .orderBy(desc(intelInsights.updatedAt))
      .limit(MAX_CHANGES),
    getSetting<{ at?: string }>(lastCheckKey(scope)),
  ]);

  const structure = new Map<string, WatchedSnapshotEntry>(
    (snapshot?.entities ?? []).map((e) => [e.id, e]),
  );

  // An alarm's FIRST entity id is its subject; the rest are the other side of
  // the change (a new neighbour), which may not itself be watched.
  const byEntity = new Map<string, typeof changes>();
  for (const change of changes) {
    const subject = change.entityIds?.[0];
    if (!subject) continue;
    const list = byEntity.get(subject);
    if (list) list.push(change);
    else byEntity.set(subject, [change]);
  }

  return json({
    entities: rows.map((row) => {
      const s = structure.get(row.id);
      return {
        id: row.id,
        name: row.name,
        summary: row.summary,
        lens: row.lens,
        type: { name: row.typeName ?? 'unknown', icon: row.icon ?? '🔷', color: row.color ?? '#7dd3fc' },
        confidence: row.confidenceScore,
        // Null until the first check has run — the UI should say "not yet
        // measured" rather than showing a confident zero.
        structure: s
          ? {
              degree: s.degree,
              communitySize: s.communitySize,
              broker: s.broker,
              neighbours: s.neighbours,
            }
          : null,
        changes: byEntity.get(row.id) ?? [],
      };
    }),
    changes,
    snapshotAt: snapshot ? new Date(snapshot.takenAt).toISOString() : null,
    lastCheckAt: lastCheck?.at ?? null,
  });
};

export const POST: RequestHandler = async (event) => {
  const scope = await resolveRequestScope(event);
  const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;

  if (String(body.action ?? '') === 'check') {
    const result = await runWatchlistCheck(scope);
    await setSetting(lastCheckKey(scope), { at: result.takenAt, changes: result.changes.length });
    return json({ ok: true, ...result });
  }

  const entityId = String(body.entityId ?? '').trim();
  if (!entityId) throw error(400, 'entityId is required');
  if (typeof body.watched !== 'boolean') throw error(400, 'watched must be a boolean');

  // Null for an entity that is unknown OR outside the scope — both 404.
  const row = await setWatched(entityId, body.watched, scope);
  if (!row) throw error(404, 'entity not found');
  return json({ ok: true, entity: row });
};
