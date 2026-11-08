// The audience pack a share link opens (8 Nov 2026). A project's app can hold
// more than one pack — the Spine has the DfE pack and a schools pack — and the
// owner chooses, per link, which one its recipient reads. Main stores the
// choice on the `project_share` row (`pack`, null = the app's default); the
// gateway carries it in the project claim (`project.pack`, a share decision
// only, /^[a-z]{2,16}$/) and the app opens that pack and no other.
//
// Pure data, no server imports: the /projects card reads the same list for the
// Share panel (cards.ts `sharePacks`), and the share API refuses any pack the
// project does not offer.

export interface SharePack {
  /** What the claim carries. 2-16 lowercase letters, or the gateway drops the claim. */
  id: string;
  /** What the Share panel shows. */
  label: string;
}

/**
 * The packs each project's app can open, the default first. A project absent
 * here offers none, and a link for it may not name one.
 */
export const SHARE_PACKS: Readonly<Record<string, readonly SharePack[]>> = Object.freeze({
  spine: Object.freeze([
    { id: 'dfe', label: 'DfE pack' },
    { id: 'school', label: 'Schools pack' },
  ]),
});

/** The pattern the gateway's normaliseClaims holds `project.pack` to. */
export const SHARE_PACK_ID = /^[a-z]{2,16}$/;

export function sharePacksFor(key: string): readonly SharePack[] {
  return Object.hasOwn(SHARE_PACKS, key) ? SHARE_PACKS[key] : [];
}

/** The pack id when `key` offers it, else null. */
export function normaliseSharePack(key: string, raw: unknown): string | null {
  if (typeof raw !== 'string' || !SHARE_PACK_ID.test(raw)) return null;
  return sharePacksFor(key).some((p) => p.id === raw) ? raw : null;
}

/** The label a link's pack shows under: its own, or the default's when it names none. */
export function sharePackLabel(packs: readonly SharePack[], pack: string | null): string | null {
  if (!packs.length) return null;
  return (packs.find((p) => p.id === pack) ?? packs[0]).label;
}
