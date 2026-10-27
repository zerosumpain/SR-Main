// Game ideas the family would like to see one day (John, 2026-10-27: "allow
// users to add game types they want to see in the future"). Pure: the list is
// a value in, a value out, and `suggestions.server` keeps it.
//
// Small on purpose — a name, a line about it, who asked and when, and who
// else wants it (+1). The same name asked again is a +1 on the first, not a
// second row, so the list reads as what the family wants most.

/** One idea as it is kept. `byId` and `votes` are player ids (hashed), never an email. */
export interface GameSuggestion {
  id: string;
  name: string;
  note: string;
  byId: string;
  byName: string;
  /** Epoch ms. */
  at: number;
  /** Everyone who wants it, the asker first. */
  votes: string[];
}

/** One idea as a phone is shown it. */
export interface SuggestionView {
  id: string;
  name: string;
  note: string;
  by: string;
  at: number;
  votes: number;
  /** The caller has +1'd it (or asked for it). */
  voted: boolean;
  /** The caller asked for it, so may take it back. */
  mine: boolean;
}

export const MAX_NAME = 60;
export const MAX_NOTE = 280;
/** Kept at most; past it the least wanted, oldest first, make way. */
export const MAX_KEPT = 100;
/** Open ideas one person may have on the list at once. */
export const MAX_PER_PERSON = 20;

/** Whitespace folded, control characters out, cut to a length. */
function tidy(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

/** The same game asked for twice, however it was typed. */
export function sameName(a: string, b: string): boolean {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return key(a) !== "" && key(a) === key(b);
}

/** A new idea's fields, or the sentence refusing it. */
export function cleanSuggestion(
  body: Record<string, unknown>,
): { name: string; note: string } | { refusal: string } {
  const name = tidy(body.name, MAX_NAME);
  if (name.length < 2) return { refusal: "Give the game a name." };
  return { name, note: tidy(body.note, MAX_NOTE) };
}

/**
 * Add an idea. A name already on the list is a +1 on that one instead. A
 * person with MAX_PER_PERSON ideas of their own is refused (a string).
 */
export function addSuggestion(
  list: readonly GameSuggestion[],
  input: { name: string; note: string },
  who: { id: string; name: string },
  now: number,
  id: string,
): GameSuggestion[] | string {
  const twin = list.find((s) => sameName(s.name, input.name));
  if (twin) return voteSuggestion(list, twin.id, who.id, true) ?? [...list];
  if (list.filter((s) => s.byId === who.id).length >= MAX_PER_PERSON) {
    return `That is ${MAX_PER_PERSON} ideas of yours on the list — take one back first.`;
  }
  const next = [
    ...list,
    {
      id,
      name: input.name,
      note: input.note,
      byId: who.id,
      byName: who.name,
      at: now,
      votes: [who.id],
    },
  ];
  return trim(next);
}

/** +1 (on) or take it back (off). Null when there is no such idea. */
export function voteSuggestion(
  list: readonly GameSuggestion[],
  id: string,
  playerId: string,
  on: boolean,
): GameSuggestion[] | null {
  if (!list.some((s) => s.id === id)) return null;
  return list.map((s) => {
    if (s.id !== id) return s;
    const has = s.votes.includes(playerId);
    if (on === has) return s;
    return {
      ...s,
      votes: on
        ? [...s.votes, playerId]
        : s.votes.filter((v) => v !== playerId),
    };
  });
}

/**
 * Take an idea off the list: its asker, or a parent. Null when there is no
 * such idea; a string when this caller may not.
 */
export function removeSuggestion(
  list: readonly GameSuggestion[],
  id: string,
  playerId: string,
  parent: boolean,
): GameSuggestion[] | string | null {
  const it = list.find((s) => s.id === id);
  if (!it) return null;
  if (it.byId !== playerId && !parent)
    return "Only whoever suggested it, or a parent, can take it off.";
  return list.filter((s) => s.id !== id);
}

/** Most wanted first, then newest; past MAX_KEPT the rest are dropped. */
function rank(a: GameSuggestion, b: GameSuggestion): number {
  return b.votes.length - a.votes.length || b.at - a.at;
}

function trim(list: GameSuggestion[]): GameSuggestion[] {
  if (list.length <= MAX_KEPT) return list;
  const keep = new Set(
    [...list]
      .sort(rank)
      .slice(0, MAX_KEPT)
      .map((s) => s.id),
  );
  return list.filter((s) => keep.has(s.id));
}

/** The list as `playerId` sees it, most wanted first. */
export function suggestionsView(
  list: readonly GameSuggestion[],
  playerId: string,
): SuggestionView[] {
  return [...list].sort(rank).map((s) => ({
    id: s.id,
    name: s.name,
    note: s.note,
    by: s.byName,
    at: s.at,
    votes: s.votes.length,
    voted: s.votes.includes(playerId),
    mine: s.byId === playerId,
  }));
}

/** A stored value read back defensively: anything malformed is dropped, not trusted. */
export function parseSuggestions(value: unknown): GameSuggestion[] {
  if (!Array.isArray(value)) return [];
  const out: GameSuggestion[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Record<string, unknown>;
    if (
      typeof s.id !== "string" ||
      typeof s.name !== "string" ||
      typeof s.byId !== "string"
    )
      continue;
    out.push({
      id: s.id,
      name: s.name,
      note: typeof s.note === "string" ? s.note : "",
      byId: s.byId,
      byName: typeof s.byName === "string" ? s.byName : "Someone",
      at: typeof s.at === "number" && Number.isFinite(s.at) ? s.at : 0,
      votes: Array.isArray(s.votes)
        ? [
            ...new Set(
              s.votes.filter((v): v is string => typeof v === "string"),
            ),
          ]
        : [],
    });
  }
  return out;
}
