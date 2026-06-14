import { sources, facts, entities } from '$lib/db/schema';

/** The three artefact tables that carry desk position columns. Relationships are edges-only. */
export type ArtefactType = 'source' | 'fact' | 'entity';

/** Allowed values for the desk_state column (mirrors schema default + comment). */
export const DESK_STATES = ['unfiled', 'filed', 'synthesized', 'archived'] as const;
export type DeskState = (typeof DESK_STATES)[number];

/** The column set we will pass to db.update(...).set(...). Keys are Drizzle property names. */
export interface PositionUpdate {
  canvasX: number;
  canvasY: number;
  pinned?: boolean;
  deskState?: DeskState;
  deskCategory?: string | null;
}

export interface PositionPatch {
  artefactType: ArtefactType;
  set: PositionUpdate;
}

export type ParseResult =
  | { ok: true; value: PositionPatch }
  | { ok: false; error: string };

const ARTEFACT_TYPES: ReadonlySet<string> = new Set<ArtefactType>(['source', 'fact', 'entity']);

/**
 * Map an artefactType to its Drizzle table. Returns null for anything we don't persist
 * positions for (e.g. 'relationship', unknown strings).
 */
export function tableForArtefactType(artefactType: string): typeof sources | typeof facts | typeof entities | null {
  switch (artefactType) {
    case 'source':
      return sources;
    case 'fact':
      return facts;
    case 'entity':
      return entities;
    default:
      return null;
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Validate and normalize an artefact position-PATCH request body.
 * Pure: no DB, no I/O. The handler maps `ok:false` → HTTP 400.
 */
export function parsePositionPatch(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.artefactType !== 'string' || !ARTEFACT_TYPES.has(b.artefactType)) {
    return { ok: false, error: "Invalid artefactType (expected 'source', 'fact', or 'entity')" };
  }
  const artefactType = b.artefactType as ArtefactType;

  const position = b.position;
  if (typeof position !== 'object' || position === null || Array.isArray(position)) {
    return { ok: false, error: 'position must be an object { x, y }' };
  }
  const p = position as Record<string, unknown>;
  if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) {
    return { ok: false, error: 'position.x and position.y must be finite numbers' };
  }

  const set: PositionUpdate = { canvasX: p.x, canvasY: p.y };

  if ('pinned' in b && b.pinned !== undefined) {
    if (typeof b.pinned !== 'boolean') {
      return { ok: false, error: 'pinned must be a boolean' };
    }
    set.pinned = b.pinned;
  }

  if ('deskState' in b && b.deskState !== undefined) {
    if (typeof b.deskState !== 'string' || !(DESK_STATES as readonly string[]).includes(b.deskState)) {
      return { ok: false, error: `deskState must be one of ${DESK_STATES.join(', ')}` };
    }
    set.deskState = b.deskState as DeskState;
  }

  if ('deskCategory' in b && b.deskCategory !== undefined) {
    if (b.deskCategory !== null && typeof b.deskCategory !== 'string') {
      return { ok: false, error: 'deskCategory must be a string or null' };
    }
    set.deskCategory = b.deskCategory as string | null;
  }

  return { ok: true, value: { artefactType, set } };
}
