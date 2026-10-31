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
import { parseModelJson, validateCompiled, type CompiledWish } from './compile';

const MAX_TOKENS = 1_200;

function system(today: string): string {
  return `You turn a shopping wish into a JSON watch specification for a price watcher in the UK. Today is ${today}.

Reply with ONE JSON object and nothing else:
{
  "kind": "hunt" | "track",          // track = one specific product page given as a URL; otherwise hunt
  "title": string,                    // short, e.g. "Gaming PC (Christmas gift)"
  "maxPricePounds": number | null,    // the ceiling, in pounds
  "targetPricePounds": number | null, // track only: alert when it falls to this
  "constraints": [ ... ],             // ONLY these shapes:
     {"field":"gpu","value":"RTX 5060"}                    // means this GPU or better
     {"field":"ram_gb","value":16}                         // at least
     {"field":"storage_gb","value":1000}                   // at least, in GB
     {"field":"ram_type","value":["DDR5"]}
     {"field":"text","op":"contains_any","value":["lego"]} // listing must mention one
     {"field":"text","op":"excludes_any","value":["laptop","refurbished"]}
  "hukdTags": string[],               // hotukdeals tag slugs from hotukdeals.com/tag/<slug>, e.g. "gaming-pc", "lego", "air-fryer"
  "pricerunnerCategories": string[],  // PriceRunner "<id>/<Name>" from pricerunner.com/cl/<id>/<Name>, e.g. "223/Desktop-Computers"; [] if unsure
  "overclockersCategories": string[], // PC things only: Overclockers UK category paths, the NARROWEST that fits (each lists only 40), e.g. "pc-systems/pcs-by-price/gaming-pcs-under-1000", "pc-systems/pcs-by-price/budget-gaming-pcs", "pc-systems/gaming-pcs/nvidia-gaming-pcs", "pc-systems/gaming-pcs"; [] otherwise
  "scanCategories": string[],         // PC parts only, from this list: ${Object.keys(SCAN_CATEGORIES).join(', ')}; [] otherwise
  "subreddits": string[],             // PC parts or PCs only, from this list: ${Object.keys(REDDIT_SUBS).join(', ')}; [] otherwise
  "searchQuery": string,              // a short web search that would find matching UK product pages
  "urls": string[],                   // product URLs the user gave, verbatim
  "forPerson": string | null,         // who it is for, if said
  "deadline": "YYYY-MM-DD" | null     // when it is needed by, if said or implied (Christmas = ${today.slice(0, 4)}-12-20)
}

Rules: a GPU value must be one of: ${knownGpus().join(', ')}. For a desktop PC, exclude laptops. Use only constraints the user actually asked for. Never invent a URL.`;
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
