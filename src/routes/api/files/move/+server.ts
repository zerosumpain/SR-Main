import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowFiles } from '$lib/db/schema';
import { eq, inArray } from 'drizzle-orm';

/**
 * POST { moves: [{ id, name }] } — one atomic batch rename.
 *
 * /drive's folders are virtual, so organising is renaming: dropping a folder on
 * another folder rewrites the prefix of every row beneath it. Doing that as N
 * separate `PATCH /api/files/[id]` calls — which is what the old "Move to…"
 * menu did — has no atomicity, so a 409 on file 40 of 60 leaves a subtree half
 * in each place with no record of which half.
 *
 * The client sends explicit destination names because it has to compute them
 * anyway (see `$lib/drive/move`) to decide whether a drop is legal and to name
 * the operation in the drag ribbon. That grants nothing new: `PATCH
 * /api/files/[id]` already renames to an arbitrary name, and both are
 * owner-gated in hooks. Everything is re-validated here regardless.
 *
 * `updated_at` is deliberately NOT touched. A move is an organisational act,
 * not a change to the bytes; bumping it would reorder the whole listing (it
 * sorts on `updated_at desc`) and make section A's "last added" report the
 * tidy-up instead of the upload.
 */

/** Matches the cap in `PATCH /api/files/[id]`, so a move cannot outgrow a rename. */
const MAX_NAME_LENGTH = 200;
/** A batch this large is a whole-drive restructure; beyond it, something is wrong. */
const MAX_MOVES = 2000;
/**
 * Phase-one parking name. `name` carries a UNIQUE index, so renaming row by row
 * can collide with a row later in the same batch that has not moved yet. Every
 * row is parked under this prefix first, which makes the batch order-independent.
 *
 * Reserved rather than merely unlikely: an incoming name starting with it is
 * refused below, so a parked row can never collide with a real one.
 */
const PARK_PREFIX = '.sr-move/';

interface MoveIn {
  id: string;
  name: string;
}

function parseMoves(raw: unknown): MoveIn[] {
  if (!Array.isArray(raw)) throw error(400, 'moves must be an array');
  if (raw.length === 0) throw error(400, 'moves is empty');
  if (raw.length > MAX_MOVES) throw error(413, `too many moves (max ${MAX_MOVES})`);

  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  return raw.map((entry) => {
    const row = entry as { id?: unknown; name?: unknown };
    if (typeof row?.id !== 'string' || !row.id) throw error(400, 'each move needs an id');
    if (typeof row?.name !== 'string') throw error(400, 'each move needs a name');

    const name = row.name.trim().replace(/^\/+/, '');
    if (!name) throw error(400, 'a move cannot clear a name');
    if (name.length > MAX_NAME_LENGTH) throw error(400, `name too long: ${name.slice(0, 60)}`);
    if (name.startsWith(PARK_PREFIX)) throw error(400, 'that name prefix is reserved');
    // `a//b` and `a/../b` are not paths this store can address — a folder exists
    // only as the text between single slashes.
    if (name.includes('//') || name.split('/').some((seg) => seg === '.' || seg === '..')) {
      throw error(400, `not a usable path: ${name}`);
    }
    if (seenIds.has(row.id)) throw error(400, `file ${row.id} appears twice`);
    if (seenNames.has(name)) throw error(409, `two files would both be called ${name}`);
    seenIds.add(row.id);
    seenNames.add(name);
    return { id: row.id, name };
  });
}

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as { moves?: unknown } | null;
  const moves = parseMoves(body?.moves);
  const ids = moves.map((m) => m.id);

  const existing = await db.select().from(workflowFiles).where(inArray(workflowFiles.id, ids));
  if (existing.length !== moves.length) {
    const found = new Set(existing.map((r) => r.id));
    const missing = ids.filter((id) => !found.has(id));
    throw error(404, `no such file: ${missing.slice(0, 3).join(', ')}`);
  }

  const before = new Map(existing.map((r) => [r.id, r.name]));
  const moving = new Set(ids);

  // A destination is only free if nothing OUTSIDE this batch already holds it.
  // Rows inside the batch may collide with each other's current names, because
  // phase one clears every one of them before phase two writes any.
  const collisions = await db
    .select({ id: workflowFiles.id, name: workflowFiles.name })
    .from(workflowFiles)
    .where(inArray(workflowFiles.name, moves.map((m) => m.name)));
  const blocking = collisions.filter((row) => !moving.has(row.id));
  if (blocking.length > 0) {
    return json(
      {
        error: `already taken: ${blocking.map((r) => r.name).slice(0, 5).join(', ')}`,
        conflicts: blocking.map((r) => r.name),
      },
      { status: 409 },
    );
  }

  const changed = moves.filter((m) => before.get(m.id) !== m.name);
  if (changed.length === 0) return json({ moved: [], skipped: moves.length });

  await db.transaction(async (tx) => {
    for (const m of changed) {
      await tx
        .update(workflowFiles)
        .set({ name: `${PARK_PREFIX}${m.id}` })
        .where(eq(workflowFiles.id, m.id));
    }
    for (const m of changed) {
      await tx.update(workflowFiles).set({ name: m.name }).where(eq(workflowFiles.id, m.id));
    }
  });

  return json({
    moved: changed.map((m) => ({ id: m.id, from: before.get(m.id) ?? null, to: m.name })),
    skipped: moves.length - changed.length,
  });
};
