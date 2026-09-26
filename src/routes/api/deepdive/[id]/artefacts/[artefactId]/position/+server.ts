import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { eq, and } from 'drizzle-orm';
import { parsePositionPatch, tableForArtefactType } from '$lib/deepdive/position-patch';
import { requireResearchSession } from '$lib/deepdive/session-access.server';

/**
 * PATCH /api/deepdive/[id]/artefacts/[artefactId]/position
 *
 * Persists desk position (canvas_x/canvas_y) plus optional pinned/deskState/deskCategory
 * onto the matching sources|facts|entities row, scoped to this session.
 *
 * Body: { artefactType:'source'|'fact'|'entity', position:{x:number,y:number},
 *         pinned?:boolean, deskState?:string, deskCategory?:string|null }
 *
 * Auth: the caller must be able to change the session (requireResearchSession
 * 'write'), and the UPDATE is scoped to that session id.
 * Mirrors the canvas drag-persist pattern (jkai/canvas/[slug]/+page.svelte onNodePointerUp).
 */
export const PATCH: RequestHandler = async (event) => {
  const { params, request } = event;
  await requireResearchSession(event, params.id, 'write');
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = parsePositionPatch(body);
  if (!parsed.ok) {
    return json({ error: parsed.error }, { status: 400 });
  }

  const { artefactType, set } = parsed.value;
  const table = tableForArtefactType(artefactType);
  if (!table) {
    // parsePositionPatch already guarantees a valid type; defensive only.
    return json({ error: 'Unsupported artefactType' }, { status: 400 });
  }

  // Scope the update to this session so an artefactId from another session can't be mutated.
  const updated = await db
    .update(table)
    .set(set)
    .where(and(eq(table.id, params.artefactId), eq(table.sessionId, params.id)))
    .returning({ id: table.id });

  if (updated.length === 0) {
    return json({ error: 'Artefact not found in this session' }, { status: 404 });
  }

  return json({
    id: updated[0].id,
    artefactType,
    position: { x: set.canvasX, y: set.canvasY },
    pinned: set.pinned,
    deskState: set.deskState,
    deskCategory: set.deskCategory,
  });
};
