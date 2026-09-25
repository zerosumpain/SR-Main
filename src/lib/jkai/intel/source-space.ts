// Which intel space a Drive folder's files land in — the owner's, or the
// household's.
//
// Beside ./source-policy rather than inside it: that module is shared
// byte-for-byte with SR-Drive (guarded by shared-with-extracted), and this rule
// is Main's alone — Drive never resolves a space, it asks /api/drive/folders.
// Pure and DB-free for the same reasons as its neighbour.
//
// The MODE's inheritance rule: the NEAREST ancestor that names a space wins,
// and nothing named anywhere means the owner's. Routing `house/` to household
// while keeping `house/private/` as the owner's has to work.
//
// Only the two spaces the owner's Drive can feed. Literals rather than
// ./scope's constants, so this stays importable from a component without
// pulling drizzle into the browser; source-space.test keeps them equal.
import { ancestorPaths, normalisePath } from './source-policy';

export type DriveSpace = 'owner' | 'household';

export const DRIVE_SPACES: readonly DriveSpace[] = ['owner', 'household'];

export function isDriveSpace(value: unknown): value is DriveSpace {
  return typeof value === 'string' && (DRIVE_SPACES as readonly string[]).includes(value);
}

export interface FolderSpaceSetting {
  path: string;
  /** null = inherit. */
  spaceId: string | null;
}

export interface ResolvedSpace {
  spaceId: DriveSpace;
  /** The folder whose explicit space decided it; null when nothing did. */
  decidedBy: string | null;
}

export function resolveFolderSpace(folder: string, settings: readonly FolderSpaceSetting[]): ResolvedSpace {
  const byPath = new Map<string, FolderSpaceSetting>();
  for (const s of settings) byPath.set(normalisePath(s.path), s);
  let spaceId: DriveSpace = 'owner';
  let decidedBy: string | null = null;
  // Root-first, so the last explicit space seen is the nearest ancestor's.
  for (const path of ancestorPaths(folder)) {
    const setting = byPath.get(path);
    if (setting && isDriveSpace(setting.spaceId)) {
      spaceId = setting.spaceId;
      decidedBy = path;
    }
  }
  return { spaceId, decidedBy };
}
