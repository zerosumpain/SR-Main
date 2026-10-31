// Turning what was asked into what the sweep checks — the model half.
//
// ONE call per item, when it is added; never per listing. It runs on the
// `extraction` workload ("mechanical JSON against a fixed schema, the fastest
// cheap model"), so the model is whatever that role is routed to, not a
// constant here. Everything it returns goes through `validateCompiled`.

import { getLLMClient } from '$lib/llm/client';
import { withActivity } from '$lib/context/activity';
import { SITE_WORKLOADS } from '$lib/models/workloads';
import { resolveWorkloadModel } from '$lib/server/models/workload-settings';
import { knownGpus } from './gpu';
import { REDDIT_SUBS } from './sources/reddit';
import { SCAN_CATEGORIES } from './sources/scan';
import { UNITS } from './units';
import { SCHOOL_HOLIDAYS } from './dates';
import { parseModelJson, validateCompiled, type CompiledWish } from './compile';

const MAX_TOKENS = 1_600;

function system(today: string): string {
  return `You turn a shopping wish into a JSON watch specification for a price watcher in the UK. It can be ANYTHING: electronics, a holiday, toys, appliances, a gaming PC, tickets. Today is ${today}.

Reply with ONE JSON object and nothing else:
{
  "kind": "hunt" | "track",          // track = one specific product page given as a URL; otherwise hunt
  "title": string,                    // short, e.g. "Gaming PC (Christmas gift)", "Family week in the sun"
  "maxPricePounds": number | null,    // the ceiling, in pounds
  "targetPricePounds": number | null, // track only: alert when it falls to this
  "pricePer": "total" | "person" | null, // holidays/tickets: is maxPricePounds for everyone or per person?
  "partySize": number | null,         // how many people, if said (a family of four = 4)
  "constraints": [ ... ],             // ONLY these shapes; only what the user asked for:
     {"field":"attr","label":"Screen","unit":"inch","op":"gte","value":55,"essential":true}
     {"field":"attr","label":"Nights","unit":"nights","op":"gte","value":7,"essential":true}
     {"field":"attr","label":"Hotel","unit":"stars","op":"gte","value":4}
     {"field":"attr","label":"Storage","unit":"gb","op":"gte","value":256}
     {"field":"text","op":"contains_any","value":["all inclusive","all-inclusive"]}   // listing must mention one
     {"field":"text","op":"excludes_any","value":["refurbished","laptop"]}
     // PCs only: {"field":"gpu","value":"RTX 5060"} (this GPU or better), {"field":"ram_gb","value":16}, {"field":"storage_gb","value":1000}, {"field":"ram_type","value":["DDR5"]}
  "value": [ ... ],                   // 2–4 things that make one listing better value than another, beyond price:
     {"label":"Screen","measure":"inch","weight":0.5,"ref":55,"better":"higher"}
     // ref = what a typical good one has; for a PC use measures "gpu" (ref 43), "cpu" (ref 65), "ram_gb" (ref 16), "storage_gb" (ref 1000); [] when nothing measurable matters (e.g. one specific LEGO set)
  "hukdTags": string[],               // hotukdeals tag slugs from hotukdeals.com/tag/<slug>, e.g. "gaming-pc", "tv", "lego", "air-fryer", "holiday", "hotel", "flight", "city-breaks", "cruise" (a city break: "city-breaks" AND "hotel"; a package holiday: "holiday" AND "hotel")
  "pricerunnerCategories": string[],  // goods only: PriceRunner "<id>/<Name>" from pricerunner.com/cl/<id>/<Name>, e.g. "223/Desktop-Computers"; [] if unsure
  "overclockersCategories": string[], // PC things only: Overclockers UK category paths, the NARROWEST that fits (each lists only 40), e.g. "pc-systems/pcs-by-price/gaming-pcs-under-1000", "pc-systems/gaming-pcs/nvidia-gaming-pcs"; [] otherwise
  "scanCategories": string[],         // PC parts only, from: ${Object.keys(SCAN_CATEGORIES).join(', ')}; [] otherwise
  "subreddits": string[],             // PC parts or PCs only, from: ${Object.keys(REDDIT_SUBS).join(', ')}; [] otherwise
  "travelDates": null | {"schoolHoliday": string} | {"from": "YYYY-MM-DD", "to": "YYYY-MM-DD", "label": string},
                                      // holidays/travel/tickets only: when. A school holiday by its exact name from: ${SCHOOL_HOLIDAYS.map((h) => h.name).join(', ')}; otherwise the window as dates ("in March" = the whole month; "Christmas" = 20 Dec to 2 Jan), dates in the future
  "holidayPirates": boolean,          // true for package holidays, city breaks, hotels with flights
  "searchQuery": string,              // goods only (it searches PriceRunner product pages): a short search that would find them; "" for holidays, travel and tickets
  "urls": string[],                   // product URLs the user gave, verbatim
  "forPerson": string | null,         // who it is for, if said
  "deadline": "YYYY-MM-DD" | null     // when it is needed by, if said or implied (Christmas = ${today.slice(0, 4)}-12-20)
}

Units for "attr" and "value": ${Object.keys(UNITS).join(', ')} (gb also reads TB). When the user names ONE specific product (a set number, a model name like "LEGO 10316 Rivendell" or "Sony WH-1000XM6"), add {"field":"text","op":"contains_any","value":[...]} with ONLY its model number and that number's spellings (e.g. ["WH-1000XM6","WH1000XM6","1000XM6"], ["10316","Rivendell"]) — NEVER the brand or a generic word, since any one of them matching counts and every product of that brand would match. Mark an attr "essential" when a listing that does not state it cannot be the thing asked for (a TV's screen size, a holiday's nights). Rules: a GPU value must be one of: ${knownGpus().join(', ')}. For a desktop PC, exclude laptops. A "text" constraint must use words a matching listing would LITERALLY contain — a board basis ("all inclusive"), a destination, a brand the user insisted on, a model number — never a description of the wish ("sunny", "big", "good", "cheap", "family"), which listings do not say and would rule out everything. Use only constraints the user actually asked for, with one default: for physical goods (never holidays, travel or tickets), unless the user says used or refurbished is fine, add {"field":"text","op":"excludes_any","value":["refurbished","renewed","used","pre-owned","open box"]}. Never invent a URL.`;
}

export async function compileWish(ask: string, now = new Date()): Promise<CompiledWish> {
  const text = ask.trim().slice(0, 2_000);
  if (!text) throw new Error('Say what you want.');
  const def = SITE_WORKLOADS.find((w) => w.id === 'extraction');
  if (!def) throw new Error('workload extraction missing');
  const { client, model } = await getLLMClient(await resolveWorkloadModel(def));
  // A literal tag, not a constant: workloads.test greps call sites so the
  // spend ledger and the model registry stay joinable on one key.
  const res = await withActivity('extraction', () =>
    client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: system(now.toISOString().slice(0, 10)) },
        { role: 'user', content: text },
      ],
      temperature: 0,
      max_tokens: MAX_TOKENS,
    }),
  );
  const parsed = parseModelJson(res.choices[0]?.message?.content ?? '');
  if (!parsed) throw new Error('Could not read that as a wish — try saying it another way.');
  return validateCompiled(parsed, text);
}
