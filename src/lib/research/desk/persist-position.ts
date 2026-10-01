/**
 * Persist an artefact's desk position to the deepdive position route.
 * Mirrors the canvas drag-persist pattern (jkai/canvas onNodePointerUp): PATCH,
 * and on failure the caller keeps its optimistic client override so the card
 * doesn't snap back on a network blip.
 */
export interface PersistPositionBody {
  artefactType: 'source' | 'fact' | 'entity';
  position: { x: number; y: number };
  pinned?: boolean;
  deskState?: string;
  deskCategory?: string | null;
}

export async function persistArtefactPosition(
  sessionId: string,
  artefactId: string,
  body: PersistPositionBody,
): Promise<{ ok: boolean }> {
  try {
    const res = await fetch(
      `/api/deepdive/${encodeURIComponent(sessionId)}/artefacts/${encodeURIComponent(artefactId)}/position`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    return { ok: res.ok };
  } catch {
    // Network failure → caller keeps the optimistic override (no snap-back).
    return { ok: false };
  }
}
