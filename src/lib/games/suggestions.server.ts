// Where the family's game ideas are kept: one `app_settings` row
// (`games.suggestions`), a list of at most a hundred small objects. No table
// of its own on purpose — a few dozen lines of wishes do not need a schema,
// a migration or a runtime grant.
//
// Writes are read-modify-write on one row, so they are queued here: two +1s
// landing together must not lose one. Production is one node process, which
// is what makes an in-process queue enough.

import { error } from "@sveltejs/kit";
import { randomBytes } from "node:crypto";
import { getSetting, setSetting } from "$lib/server/models/settings";
import { familyRole } from "$lib/server/family-access";
import { playerFor } from "./players.server";
import {
  addSuggestion,
  cleanSuggestion,
  parseSuggestions,
  removeSuggestion,
  suggestionsView,
  voteSuggestion,
  type GameSuggestion,
} from "./suggestions";
import type { GameCaller } from "./api.server";

export const SUGGESTIONS_KEY = "games.suggestions";

let queue: Promise<unknown> = Promise.resolve();

/** Run one change after every change before it, whether or not that one failed. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

async function read(): Promise<GameSuggestion[]> {
  return parseSuggestions(await getSetting<unknown>(SUGGESTIONS_KEY));
}

/** The owner, or a member in the family (circle or parent); anyone else is refused. */
async function familyOnly(caller: GameCaller): Promise<{ parent: boolean }> {
  const role =
    caller.role === "owner" ? { parent: true } : await familyRole(caller.email);
  if (!role) error(403, "Game ideas are for the family.");
  return role;
}

/** `GET`: the list, most wanted first, as this person sees it. */
export async function suggestionsFor(caller: GameCaller) {
  const role = await familyOnly(caller);
  const me = await playerFor(caller.email);
  return {
    suggestions: suggestionsView(await read(), me.id),
    parent: role.parent,
  };
}

/**
 * `POST`: `{ name, note }` adds an idea (a name already there is a +1 on it);
 * `{ id, vote: true | false }` +1s or takes a +1 back; `{ id, remove: true }`
 * takes an idea off (its asker, or a parent). Answers with the list after it.
 */
export async function changeSuggestions(
  caller: GameCaller,
  body: Record<string, unknown>,
) {
  const role = await familyOnly(caller);
  const me = await playerFor(caller.email);
  const id = typeof body.id === "string" ? body.id : null;
  let list: GameSuggestion[] = [];
  await serial(async () => {
    const before = await read();
    let after: GameSuggestion[] | string | null;
    if (id && body.remove === true) {
      after = removeSuggestion(before, id, me.id, role.parent);
    } else if (id && typeof body.vote === "boolean") {
      after = voteSuggestion(before, id, me.id, body.vote);
    } else if (!id) {
      const input = cleanSuggestion(body);
      if ("refusal" in input) error(400, input.refusal);
      after = addSuggestion(
        before,
        input,
        { id: me.id, name: me.name },
        Date.now(),
        "s_" + randomBytes(6).toString("hex"),
      );
    } else {
      error(400, "Say what to do with it.");
    }
    if (after === null) error(404, "That idea has gone.");
    if (typeof after === "string")
      error(after.startsWith("Only") ? 403 : 400, after);
    if (after !== before) await setSetting(SUGGESTIONS_KEY, after);
    list = after;
  });
  return { suggestions: suggestionsView(list, me.id), parent: role.parent };
}
