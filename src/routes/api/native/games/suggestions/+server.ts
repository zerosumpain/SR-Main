import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { withNativeAccess } from "$lib/server/native-handler";
import { jsonBody } from "$lib/games/api.server";
import {
  changeSuggestions,
  suggestionsFor,
} from "$lib/games/suggestions.server";

/**
 * GET /api/native/games/suggestions — the games the family would like to see
 * one day, most wanted first: `{ suggestions: [{ id, name, note, by, at,
 * votes, voted, mine }], parent }`. Games access and the family (owner,
 * family:circle or family:admin); anyone else 403s. Names only, never an email.
 */
export const GET: RequestHandler = withNativeAccess(
  "games",
  async (_event, identity, role) =>
    suggestionsFor({ email: identity.ownerEmail, role }),
);

/**
 * POST /api/native/games/suggestions — `{ name, note }` suggests a game (a
 * name already there is a +1 on it), `{ id, vote }` +1s or takes it back,
 * `{ id, remove: true }` takes one off (whoever suggested it, or a parent).
 * Answers with the list after it.
 */
export const POST: RequestHandler = withNativeAccess(
  "games",
  async (event, identity, role) => {
    const body = await jsonBody(event.request);
    if (!body) return json({ error: "Body must be JSON" }, { status: 400 });
    return changeSuggestions({ email: identity.ownerEmail, role }, body);
  },
);
