/**
 * Pure helpers for the InspectorDrawer "explore further" flow.
 * Kept out of the component so the seed-snippet + request-payload logic
 * is unit-testable and the Svelte file stays thin.
 */

export type ExploreType = 'fact' | 'entity';

type ExploreArtefact = { kind: string; id: string } & Record<string, unknown>;

const SNIPPET_MAX = 140;

/**
 * Describe what an "explore further" run would be seeded by, for the in-drawer
 * confirmation card. Only `fact` and `entity` artefacts are addressable by the
 * /explore endpoint via itemId, so everything else returns null.
 */
export function buildExplorePrompt(
  artefact: ExploreArtefact | null | undefined,
): { kind: ExploreType; snippet: string; heading: string } | null {
  if (!artefact) return null;

  let kind: ExploreType;
  let raw: unknown;
  if (artefact.kind === 'fact') {
    kind = 'fact';
    raw = artefact.content;
  } else if (artefact.kind === 'entity') {
    kind = 'entity';
    raw = artefact.name;
  } else {
    return null;
  }

  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return null;

  const snippet = text.length > SNIPPET_MAX ? `${text.slice(0, SNIPPET_MAX)}…` : text;
  return { kind, snippet, heading: 'EXPLORE FURTHER' };
}

/**
 * Build the POST body for /api/deepdive/[id]/explore. The endpoint already
 * accepts an optional `additionalContext`; we only include it when the user
 * actually typed a focus note (trimmed).
 */
export function buildExplorePayload(
  type: ExploreType,
  itemId: string,
  focusNote: string,
): { type: ExploreType; itemId: string; additionalContext?: string } {
  const note = focusNote.trim();
  return note ? { type, itemId, additionalContext: note } : { type, itemId };
}
