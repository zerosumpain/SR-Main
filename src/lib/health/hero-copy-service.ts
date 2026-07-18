import { resolveDefaultModel } from '$lib/server/models/settings';
import { getLLMClient } from '$lib/jkai/llm-client';

export interface HeroCopy {
  headline: { primary: string; ghost: string };
  strap: string;
}

export interface HeroCopyInput {
  date: string;
  rec: number;
  hrv: number;
  rhr: number;
  slept: number;
  rhrBaseline: number;
  hrvDeltaPct: number;
}

export interface HeroCopyFallbackFns {
  pickHeadline: (rec: number) => { primary: string; ghost: string };
  buildStrap: (
    today: { rec: number; hrv: number; rhr: number; slept: number },
    yesterday: { hrv: number },
    rhrBaseline: number,
  ) => string;
}

const TTL_OK_MS = 6 * 60 * 60 * 1000; // successful LLM copy
const TTL_FALLBACK_MS = 5 * 60 * 1000; // failed call — retry soon
// Background-only — page render does not wait, so a generous ceiling is fine.
const TIMEOUT_MS = 90_000;
const MAX_PRIMARY_LEN = 24;
const MAX_GHOST_LEN = 24;
const MAX_STRAP_LEN = 200;

const cache = new Map<string, { copy: HeroCopy; expires: number }>();
const inflight = new Map<string, Promise<void>>();

function cacheKey(input: HeroCopyInput): string {
  // Key on date + recovery only. HRV/RHR/sleep tick throughout the day from
  // the Apple webhook; including them in the key causes the LLM copy to
  // "revert" to the deterministic fallback every time any metric updates,
  // because each tick is a fresh cache miss. Recovery is a once-per-day
  // score from Whoop (set when sleep ends) and is the primary driver of the
  // headline anyway, so keying on it alone gives stable copy + a fresh call
  // if the recovery score itself changes.
  return `${input.date}|${input.rec}`;
}

function buildFallback(input: HeroCopyInput, fb: HeroCopyFallbackFns): HeroCopy {
  return {
    headline: fb.pickHeadline(input.rec),
    strap: fb.buildStrap(
      { rec: input.rec, hrv: input.hrv, rhr: input.rhr, slept: input.slept },
      { hrv: input.hrv / (1 + input.hrvDeltaPct / 100) },
      input.rhrBaseline,
    ),
  };
}

function buildPrompt(input: HeroCopyInput): { system: string; user: string } {
  const baselineWord =
    input.rhr > input.rhrBaseline
      ? `${input.rhr - input.rhrBaseline} bpm above baseline`
      : input.rhr < input.rhrBaseline
        ? `${input.rhrBaseline - input.rhr} bpm below baseline`
        : 'at baseline';
  const hrvWord =
    input.hrvDeltaPct > 0
      ? `up ${input.hrvDeltaPct}% overnight`
      : input.hrvDeltaPct < 0
        ? `down ${Math.abs(input.hrvDeltaPct)}% overnight`
        : 'flat overnight';
  const system = [
    'You write the hero copy for a personal health dashboard.',
    'Tone: dry, brutal, witty, knowing. Never cheerful, never preachy.',
    'You are addressing the dashboard owner — second person, light touch.',
    'Output strict JSON only: {"primary": "...", "ghost": "...", "strap": "..."}.',
    'No code fences, no commentary.',
    'primary: 1-3 words, ALL CAPS, with a full stop. Reflects current recovery.',
    'ghost: 1-3 words, ALL CAPS, with a full stop. The advice or the punchline.',
    'strap: one sentence, max 24 words, must mention at least two of: recovery %, HRV change, RHR vs baseline, sleep hours.',
    'Examples of voice (do not copy verbatim):',
    '  primary "WRECKED.", ghost "DON\'T LIFT.", strap "Recovery 28%. HRV down 14% overnight, RHR 6 bpm above baseline. Walk, eat, repeat."',
    '  primary "READY.", ghost "GO MOVE.", strap "Recovery 78%. HRV up 9%, sleep 8.1h. The body has agreed to one (1) hard effort."',
    '  primary "MEH.", ghost "WALK IT OFF.", strap "Recovery 51%. HRV flat, RHR at baseline, slept 6.4h. A grey day. Go outside anyway."',
  ].join('\n');
  const user = [
    `Today's numbers:`,
    `- recovery: ${input.rec}%`,
    `- HRV: ${input.hrv}ms (${hrvWord})`,
    `- RHR: ${input.rhr} bpm (${baselineWord})`,
    `- sleep: ${input.slept.toFixed(1)} h`,
    '',
    'Return only the JSON object.',
  ].join('\n');
  return { system, user };
}

function validateCopy(parsed: unknown): HeroCopy | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  const primary = typeof o.primary === 'string' ? o.primary.trim() : '';
  const ghost = typeof o.ghost === 'string' ? o.ghost.trim() : '';
  const strap = typeof o.strap === 'string' ? o.strap.trim() : '';
  if (!primary || !ghost || !strap) return null;
  if (primary.length > MAX_PRIMARY_LEN) return null;
  if (ghost.length > MAX_GHOST_LEN) return null;
  if (strap.length > MAX_STRAP_LEN) return null;
  return {
    headline: { primary: primary.toUpperCase(), ghost: ghost.toUpperCase() },
    strap,
  };
}

function tryParseJson(s: string): unknown {
  // The model sometimes wraps JSON in code fences despite the prompt.
  const cleaned = s
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

async function callLLM(input: HeroCopyInput): Promise<HeroCopy | null> {
  const ctx = await resolveDefaultModel('chat');
  const { client, model } = await getLLMClient(ctx);
  const { system, user } = buildPrompt(input);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const completion = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.9,
        // The default model (a GLM) consumes reasoning tokens out of max_tokens
        // before any visible output — 800 was getting truncated mid-strap.
        // Reasoning often eats 700-1500 tokens on its own; give it room for both.
        max_tokens: 3000,
      },
      { signal: controller.signal },
    );
    const text = completion.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text) {
      console.warn('[hero-copy] empty LLM response, finish:', completion.choices?.[0]?.finish_reason);
      return null;
    }
    const parsed = tryParseJson(text);
    const valid = validateCopy(parsed);
    if (!valid) {
      console.warn('[hero-copy] validation failed; raw:', JSON.stringify(text).slice(0, 200));
    }
    return valid;
  } finally {
    clearTimeout(timeout);
  }
}

// Stale-while-revalidate: never block SSR on the LLM. On a cache miss, return
// the deterministic fallback now and fire the LLM call in the background; the
// next request after it lands will get the LLM copy.
export async function getHeroCopy(
  input: HeroCopyInput,
  fallback: HeroCopyFallbackFns,
  llmCall: (i: HeroCopyInput) => Promise<HeroCopy | null> = callLLM,
): Promise<HeroCopy> {
  const key = cacheKey(input);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.copy;

  const fb = buildFallback(input, fallback);
  cache.set(key, { copy: fb, expires: now + TTL_FALLBACK_MS });

  if (!inflight.has(key)) {
    const p = (async () => {
      try {
        const generated = await llmCall(input);
        if (generated) {
          cache.set(key, { copy: generated, expires: Date.now() + TTL_OK_MS });
        }
      } catch (err) {
        console.warn('[hero-copy] background LLM failed', err);
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
  }

  return fb;
}

// Test helper: resolves once any in-flight LLM call for this input completes.
export function _awaitInflight(input: HeroCopyInput): Promise<void> {
  return inflight.get(cacheKey(input)) ?? Promise.resolve();
}

export function clearHeroCopyCache(): void {
  cache.clear();
  inflight.clear();
}
