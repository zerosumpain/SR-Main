// Natural-language commissioning: free text in, planner fields out.
//
// The model extracts ONLY what was said. Anything unstated stays null, so the
// health-driven defaults (suggestTarget / proposeSession) keep choosing — a
// request that names no distance must not have one invented for it.

import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { ORS_PROFILES, type PlannerSport } from './ors';

export interface InterpretedCommission {
  sport: PlannerSport | null;
  mode: 'loop' | 'point' | null;
  targetKm: number | null;
  climbPerKm: number | null;
  prefer: 'steady' | 'spiky' | 'any' | null;
  allowOutAndBack: boolean | null;
  startPlace: string | null;
  finishPlace: string | null;
}

export class InterpretError extends Error {}

const SYSTEM_PROMPT = `You turn a request for a running/cycling/walking route into strict JSON. Output ONLY a JSON object with exactly these fields (null when the request does not state it):
{
  "sport": one of ${Object.keys(ORS_PROFILES).join(' | ')} | null,
  "mode": "loop" (circular) | "point" (A to B) | null,
  "targetKm": number | null,
  "climbPerKm": metres of climb per km as a number | null,
  "prefer": "steady" (even climbing) | "spiky" (one big climb) | "any" | null,
  "allowOutAndBack": true only if an out-and-back is explicitly wanted | null,
  "startPlace": the named start location as free text | null,
  "finishPlace": the named finish location as free text | null
}
Rules: never invent a value that was not stated; "hilly" alone is climbPerKm 30, "very hilly" 50, "flat" 5; a named finish implies "point" mode; distances in miles must be converted to km. No prose, no markdown fences.`;

// Common ways of saying a sport that are not our exact keys. Coerce, never
// reject — a near-miss from the model must not fail the whole commission.
const SPORT_ALIASES: Record<string, PlannerSport> = {
  running: 'run',
  jog: 'run',
  jogging: 'run',
  'trail run': 'trail_run',
  trailrun: 'trail_run',
  'trail running': 'trail_run',
  cycle: 'ride',
  cycling: 'ride',
  bike: 'ride',
  'road bike': 'ride',
  'mountain bike': 'mtb',
  'mountain biking': 'mtb',
  walking: 'walk',
  hiking: 'hike',
};

function coerceNumber(value: unknown, min: number, max: number): number | null {
  const n = typeof value === 'string' ? Number(value.replace(/[^0-9.]/g, '')) : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(max, Math.max(min, n));
}

function coerceBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'yes') return true;
  if (value === 'false' || value === 'no') return false;
  return null;
}

function coerceString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed || null;
}

/** Pure: whatever shape came back → a clamped, typed commission. */
export function coerceCommission(raw: unknown): InterpretedCommission {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  let sport: PlannerSport | null = null;
  if (typeof obj.sport === 'string') {
    const key = obj.sport.trim().toLowerCase();
    if (key in ORS_PROFILES) sport = key as PlannerSport;
    else if (key in SPORT_ALIASES) sport = SPORT_ALIASES[key];
  }

  const mode = obj.mode === 'loop' || obj.mode === 'point' ? obj.mode : null;
  const prefer =
    obj.prefer === 'steady' || obj.prefer === 'spiky' || obj.prefer === 'any' ? obj.prefer : null;

  return {
    sport,
    mode,
    targetKm: coerceNumber(obj.targetKm, 1, 100),
    climbPerKm: coerceNumber(obj.climbPerKm, 1, 200),
    prefer,
    allowOutAndBack: coerceBoolean(obj.allowOutAndBack),
    startPlace: coerceString(obj.startPlace, 120),
    finishPlace: coerceString(obj.finishPlace, 120),
  };
}

/** Pure: model text (possibly fenced) → commission. Throws InterpretError on junk. */
export function parseCommissionJson(raw: string): InterpretedCommission {
  const cleaned = raw
    .trim()
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/\n?```$/, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new InterpretError('The model did not return valid JSON');
  }
  return coerceCommission(parsed);
}

export async function interpretCommission(text: string): Promise<InterpretedCommission> {
  const ctx = await resolveDefaultModel();
  const { client, model } = await getLLMClient(ctx);

  const completion = await Promise.race([
    client.chat.completions.create({
      model,
      temperature: 0,
      max_tokens: 300,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new InterpretError('The model took too long')), 12_000),
    ),
  ]);

  const out = completion.choices?.[0]?.message?.content?.trim() ?? '';
  if (!out) throw new InterpretError('The model returned nothing');
  return parseCommissionJson(out);
}
