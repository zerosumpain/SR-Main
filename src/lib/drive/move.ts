/**
 * What a drop is allowed to do, and what it would rename.
 *
 * Folders on /drive are virtual (see `./paths`), so "move this folder into that
 * one" is "rewrite the prefix of every row beneath it". That makes two mistakes
 * cheap and catastrophic, and both are refused here rather than at the server:
 *
 *  * dropping a folder into itself or into its own contents, which detaches the
 *    whole subtree from any path the browser can reach;
 *  * a name clash, which the single-file PATCH answers with a 409 halfway
 *    through a batch and leaves a half-moved tree behind.
 *
 * Pure, and deliberately: the same verdict decides whether a drop target lights
 * up, what the drag ribbon says, and which renames get sent. If it lived in the
 * component those three could disagree.
 */
import { baseName, folderOf, isWithin, joinPath, isMarker, type DriveFileLike } from './paths';

/** The name cap in `PATCH /api/files/[id]` — a longer move would 400 there. */
export const MAX_NAME_LENGTH = 200;

export type DragPayload =
  | { kind: 'files'; ids: string[] }
  | { kind: 'folder'; path: string };

export interface PlannedMove {
  id: string;
  from: string;
  to: string;
}

export interface BlockedMove {
  name: string;
  reason: string;
}

export interface MovePlan {
  moves: PlannedMove[];
  blocked: BlockedMove[];
}

export type DropVerdict =
  | { ok: true; label: string; plan: MovePlan }
  | { ok: false; reason: string };

/** `''` → `Drive`, so a refusal or a ribbon never prints an empty string. */
export function pathLabel(path: string): string {
  return path || 'Drive';
}

/** Names already taken directly inside `dir` — markers included, they are real rows. */
function occupants(files: DriveFileLike[], dir: string): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    if (folderOf(f.name) === dir) out.add(baseName(f.name));
  }
  return out;
}

/** Immediate subfolder names of `dir`. A folder can clash with a folder. */
function subfolderNames(files: DriveFileLike[], dir: string): Set<string> {
  const out = new Set<string>();
  const prefix = dir ? dir + '/' : '';
  for (const f of files) {
    if (dir && !f.name.startsWith(prefix)) continue;
    const rem = f.name.slice(prefix.length);
    const slash = rem.indexOf('/');
    if (slash > 0) out.add(rem.slice(0, slash));
  }
  return out;
}

/** Move a set of files into `target`. Files already there are simply not moved. */
function planFiles(files: DriveFileLike[], ids: string[], target: string): MovePlan {
  const picks = files.filter((f) => ids.includes(f.id));
  const taken = occupants(files, target);
  const moves: PlannedMove[] = [];
  const blocked: BlockedMove[] = [];
  for (const f of picks) {
    const leaf = baseName(f.name);
    if (folderOf(f.name) === target) continue;
    const to = joinPath(target, leaf);
    if (taken.has(leaf)) {
      blocked.push({ name: leaf, reason: `already a file called ${leaf} there` });
      continue;
    }
    if (to.length > MAX_NAME_LENGTH) {
      blocked.push({ name: leaf, reason: 'the new path would be too long' });
      continue;
    }
    // Two files with the same leaf in one drag would collide with each other,
    // not with the target — the second is refused rather than silently lost.
    taken.add(leaf);
    moves.push({ id: f.id, from: f.name, to });
  }
  return { moves, blocked };
}

/** Move a folder into `target` — every descendant row gets its prefix rewritten. */
function planFolder(files: DriveFileLike[], folder: string, target: string): MovePlan {
  const leaf = baseName(folder);
  const to = joinPath(target, leaf);
  const moves: PlannedMove[] = [];
  const blocked: BlockedMove[] = [];
  // Strictly what is INSIDE it: a FILE named `notes` can coexist with a folder
  // `notes/`, and dragging the folder must not take that file along.
  const inside = folder + '/';
  for (const f of files) {
    if (!f.name.startsWith(inside)) continue;
    const next = to + f.name.slice(folder.length);
    if (next.length > MAX_NAME_LENGTH) {
      blocked.push({ name: baseName(f.name), reason: 'the new path would be too long' });
      continue;
    }
    moves.push({ id: f.id, from: f.name, to: next });
  }
  return { moves, blocked };
}

/**
 * The one answer three callers share: may this land here, what does it say, and
 * what would it rename.
 */
export function dropVerdict(
  files: DriveFileLike[],
  payload: DragPayload,
  target: string,
): DropVerdict {
  if (payload.kind === 'folder') {
    const folder = payload.path;
    if (!folder) return { ok: false, reason: 'the root is not a folder' };
    if (target === folder) return { ok: false, reason: 'a folder cannot go inside itself' };
    if (isWithin(target, folder)) {
      return { ok: false, reason: 'a folder cannot go inside its own contents' };
    }
    if (folderOf(folder) === target) {
      return { ok: false, reason: `already in ${pathLabel(target)}` };
    }
    const leaf = baseName(folder);
    if (subfolderNames(files, target).has(leaf)) {
      return { ok: false, reason: `a folder called ${leaf} is already there` };
    }
    const plan = planFolder(files, folder, target);
    if (plan.moves.length === 0) {
      return { ok: false, reason: plan.blocked[0]?.reason ?? 'nothing to move' };
    }
    return { ok: true, label: `${leaf} → ${pathLabel(target)}`, plan };
  }

  if (payload.ids.length === 0) return { ok: false, reason: 'nothing to move' };
  const plan = planFiles(files, payload.ids, target);
  if (plan.moves.length === 0) {
    return { ok: false, reason: plan.blocked[0]?.reason ?? `already in ${pathLabel(target)}` };
  }
  const n = plan.moves.length;
  const what = n === 1 ? baseName(plan.moves[0].to) : `${n} files`;
  return { ok: true, label: `${what} → ${pathLabel(target)}`, plan };
}

/** The inverse batch — what Undo sends back. */
export function invertMoves(moves: PlannedMove[]): { id: string; name: string }[] {
  return moves.map((m) => ({ id: m.id, name: m.from }));
}

/** The request body: explicit new names, applied in one transaction. */
export function moveRequest(moves: PlannedMove[]): { id: string; name: string }[] {
  return moves.map((m) => ({ id: m.id, name: m.to }));
}

/**
 * "Moved 3 files to /invoices" — the undo strip's sentence.
 *
 * Marker rows are counted out: a folder move renames its `.keep` too, and
 * "moved 4 files" for three visible files is the kind of small lie that makes
 * a user distrust the count that matters.
 */
export function moveSummary(moves: PlannedMove[], target: string): string {
  const real = moves.filter((m) => !isMarker(m.to)).length;
  const noun = real === 1 ? 'item' : 'items';
  return `Moved ${real} ${noun} to ${pathLabel(target)}`;
}
