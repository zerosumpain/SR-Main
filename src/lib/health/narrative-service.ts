import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import type { HealthDay } from './series-30d-service';

export type NarrativeStats = {
  recToday: number;
  recAvg7: number;
  hrvToday: number;
  hrvLow: { day: string; ms: number } | null;
  rhrToday: number;
  rhrBaseline: number;
  sleepToday: number;
  sleepAvg7: number;
  hardestDay: { day: string; strain: number } | null;
  stepsToday: number;
};
type Stats = NarrativeStats;

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function dayName(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleString('en', { weekday: 'long', timeZone: 'UTC' });
}

function buildStats(series: HealthDay[], rhrBaseline: number): Stats {
  const today = series[series.length - 1];
  const last7 = series.slice(-7);
  const validHrv = series.filter((d) => d.hrv > 0);
  const lowHrv = validHrv.length
    ? [...validHrv].sort((a, b) => a.hrv - b.hrv)[0]
    : null;
  const last7Strain = last7.filter((d) => d.strain > 0);
  const hardest = last7Strain.length
    ? [...last7Strain].sort((a, b) => b.strain - a.strain)[0]
    : null;

  return {
    recToday: today.rec,
    recAvg7: Math.round(avg(last7.map((d) => d.rec))),
    hrvToday: today.hrv,
    hrvLow: lowHrv ? { day: dayName(lowHrv.date), ms: lowHrv.hrv } : null,
    rhrToday: today.rhr,
    rhrBaseline,
    sleepToday: +today.slept.toFixed(1),
    sleepAvg7: +avg(last7.map((d) => d.slept)).toFixed(1),
    hardestDay: hardest ? { day: dayName(hardest.date), strain: +hardest.strain.toFixed(1) } : null,
    stepsToday: today.steps,
  };
}

const SYSTEM_PROMPT = `You are John's voice writing the weekly note on his /health page.

VOICE: Dry. Self-aware. Pithy. Mildly funny when the numbers are bad. Brutally honest when warranted. The reader is John, talking to himself — not a coach, not a clinician.

RULES:
- Output ONE paragraph, 2–4 sentences, no longer.
- Wrap key numbers and standout values in <em>...</em> tags. Numbers, day names, percentages, deltas — anything quantitative.
- No medical advice. No "consult your doctor". No clichés ("listen to your body", "rest is productive", "you've got this").
- No greetings, no headers, no preamble. Start mid-thought if needed.
- Use British spelling.
- Refer to John in second person ("you") or just describe what happened.
- If recovery is bad, lean into the joke without being precious.
- Avoid the word "journey".

OUTPUT: Just the paragraph. No JSON, no labels, no markdown beyond the inline <em> tags.`;

type CacheEntry = { key: string; text: string; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const RESERVED_KEYS = 32;

function cacheKey(stats: Stats, today: string): string {
  const band = stats.recToday < 40 ? 'red' : stats.recToday < 67 ? 'amber' : 'green';
  return `${today}|${band}|${stats.recToday}|${stats.hrvToday}|${stats.sleepToday}`;
}

function templated(stats: Stats): string {
  const parts: string[] = [];
  if (stats.hardestDay && stats.hardestDay.strain > 8) {
    parts.push(`You went hard on ${stats.hardestDay.day}. <em>Strain ${stats.hardestDay.strain}</em>.`);
  }
  if (stats.hrvLow && stats.hrvLow.ms > 0 && stats.hrvLow.ms < 45) {
    parts.push(`HRV cratered to <em>${stats.hrvLow.ms}ms</em> — your worst this window.`);
  }
  const recBand = stats.recToday < 40 ? 'red' : stats.recToday < 67 ? 'amber' : 'green';
  parts.push(
    `Week's average recovery sits at <em>${stats.recAvg7}%</em> and today is still <em>${recBand}</em>.`,
  );
  parts.push(stats.recToday < 50 ? `The sandwich is earned.` : `Plenty of rope left.`);
  return parts.join(' ');
}

export async function getNarrative(
  series: HealthDay[],
  rhrBaseline: number,
): Promise<{ tag: string; text: string; stats: NarrativeStats }> {
  const today = series[series.length - 1];
  const stats = buildStats(series, rhrBaseline);
  const key = cacheKey(stats, today.date);

  const hit = cache.get(key);
  const now = Date.now();
  if (hit && hit.expiresAt > now) {
    return { tag: 'THIS WEEK · IN PLAIN ENGLISH', text: hit.text, stats };
  }

  const fallback = templated(stats);
  let text = '';
  try {
    const ctx = await resolveDefaultModel();
    const { client, model } = await getLLMClient(ctx);
    const userPayload = JSON.stringify(stats);
    const completion = await Promise.race([
      client.chat.completions.create({
        model,
        temperature: 0.9,
        max_tokens: 220,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPayload },
        ],
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('llm timeout')), 8000)),
    ]);
    const out = completion.choices?.[0]?.message?.content?.trim() ?? '';
    text = out;
  } catch (err) {
    console.warn('[health/narrative] LLM call failed, using templated fallback:', (err as Error).message);
  }

  // Strip wrapping quotes and any stray markdown fences the model sometimes adds.
  text = text.replace(/^"+|"+$/g, '').replace(/^```[a-z]*\n?|\n?```$/g, '').trim();

  // If the LLM returned nothing usable, fall back to the templated narrative.
  if (!text || text.length < 12) text = fallback;
  // Belt-and-braces: templated should never be empty, but if it somehow is, ship something.
  if (!text) text = `Recovery's at <em>${stats.recToday}%</em>. Body's reporting in.`;

  cache.set(key, { key, text, expiresAt: now + CACHE_TTL_MS });
  if (cache.size > RESERVED_KEYS) {
    const oldestKey = [...cache.keys()][0];
    cache.delete(oldestKey);
  }

  return { tag: 'THIS WEEK · IN PLAIN ENGLISH', text, stats };
}
