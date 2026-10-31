// src/lib/home/presence/place-types.server.ts
//
// What each place actually is — "Lidl / Homebargains" is a discount
// supermarket, "Headlam Hall" a hotel, 97 Grange Road a Sainsbury's — found
// by a web search, for the patterns report's categories. Most places carry no
// owner kind, and the map geocoder answers with addresses, never businesses.
//
// One grounded model call looks up a batch of places and answers with a type
// and one of the fixed categories. Results are kept in app_settings by place
// id, with the text that was searched: a renamed place is looked up again, an
// unchanged one never is. What goes out is a place's name and town or its
// street address — no person, no time, no coordinates — and never the address
// of a house the owner has marked as somebody's home. OWNER ONLY: the caller
// is the nightly report or the owner's rebuild.

import { getSetting, setSetting } from '$lib/server/models/settings';
import { LOOKUP_CATEGORIES, parsePlaceTypes, placeQuery, type PatternPlace, type PlaceType } from './patterns';

export const PLACE_TYPES_KEY = 'home.patterns.placeTypes';
const BATCH = 8;
/** Bump when the prompt changes what an answer means: every place is asked again. */
const VERSION = 2;
const CONCURRENCY = 3;

export type PlaceTypeCache = Record<string, PlaceType & { query: string; at: string; v?: number }>;

export const loadPlaceTypes = () => getSetting<PlaceTypeCache>(PLACE_TYPES_KEY).then((v) => v ?? {}).catch((): PlaceTypeCache => ({}));

const SYSTEM = `You identify what kind of place each entry in a list is, for a family's private record of where they go.
Search the live web for every entry before answering. Entries are UK unless the text says otherwise.
An entry is either a named place with its town, or a street address; for an address, find the business or venue at that address, if any.

Answer with ONLY a JSON array, one object per entry, in this shape:
[{"id": "1", "category": "shops", "type": "Discount supermarket", "name": null}]

category is exactly one of: ${LOOKUP_CATEGORIES.join(', ')}
- shops: supermarkets, retail parks, shopping centres, town centres, any shop
- food: cafes, restaurants, pubs, takeaways
- daysout: theme parks, zoos, museums, castles, stately homes, heritage sites and visitor attractions
- leisure: cinemas, bowling, soft play, trampoline parks, arcades, activity centres, theatres
- outdoors: parks, woods, beaches, countryside, nature reserves
- sport: gyms, leisure centres, pools, pitches, clubs, ski slopes
- health: hospitals, GP surgeries, dentists, pharmacies, opticians
- services: banks, post offices, hairdressers, garages, petrol stations, council and other offices
- community: churches, libraries, community centres, village halls
- stay: hotels, holiday parks, B&Bs
- transport: stations, airports, bus stations, ports
- school, work: schools, colleges, universities; offices and workplaces
- homes: a private house or residential street with no business at it
- other: you cannot tell
Choose by the place's main purpose: a theme park with lodges is daysout, a pub with rooms is food, a garden centre with a cafe is shops.
type is a short plain description of the place (at most five words). name is the business or venue at a street address when you are sure of it, else null; always null for a named entry.`;

/**
 * Look up every place the cache lacks or whose name has changed, `maxBatches`
 * batches at most (the rest wait for the next run). Returns the cache with any
 * new answers merged, so the caller can use it straight away.
 */
export async function refreshPlaceTypes(
  places: Array<PatternPlace & { suggestedAddress?: string | null }>,
  homeId: string | null,
  maxBatches = 20,
): Promise<{ cache: PlaceTypeCache; looked: number; failed: number }> {
  const cache = await loadPlaceTypes();
  const pending = places
    .map((p) => ({ id: p.id, query: placeQuery(p, homeId) }))
    .filter((p): p is { id: string; query: string } => !!p.query && (cache[p.id]?.query !== p.query || cache[p.id]?.v !== VERSION));
  const batches: Array<typeof pending> = [];
  for (let i = 0; i < pending.length && batches.length < maxBatches; i += BATCH) batches.push(pending.slice(i, i + BATCH));
  if (!batches.length) return { cache, looked: 0, failed: 0 };

  const [{ groundedCompletion }, { groundedRoute }, models] = await Promise.all([
    import('$lib/deepdive/ai'),
    import('$lib/deepdive/grounding'),
    import('$lib/server/models/workload-settings'),
  ]);
  // research_web_search's choice: Codex's own grounding when it is the chat
  // model (it costs nothing), else the research-fast model's route.
  const chat = await models.resolveChatTurnModel();
  const model = chat.provider === 'codex'
    ? (chat.modelId.startsWith('codex/') ? chat.modelId : `codex/${chat.modelId}`)
    : (await models.resolveResearchFastModel()).modelId;

  let looked = 0, failed = 0, next = 0;
  const at = new Date().toISOString();
  async function lane() {
    while (next < batches.length) {
      const batch = batches[next++];
      const ids = batch.map((_, i) => String(i + 1));
      try {
        const { text } = await groundedCompletion(SYSTEM, batch.map((p, i) => `${i + 1}. ${p.query}`).join('\n'),
          { mode: groundedRoute('fast', model), model, maxTokens: 1500 });
        const found = parsePlaceTypes(text, ids);
        batch.forEach((p, i) => {
          const t = found.get(ids[i]);
          // An entry the model skipped is asked again next run.
          if (t) { cache[p.id] = { ...t, query: p.query, at, v: VERSION }; looked++; }
        });
      } catch {
        failed++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, lane));
  if (looked) await setSetting(PLACE_TYPES_KEY, cache);
  return { cache, looked, failed };
}
