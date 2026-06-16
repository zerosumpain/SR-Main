// consider/+server.ts — the Consideration Builder. Public + rate-limited (the user's policy
// statements are their own; not persisted server-side). Takes a headline policy and reviews
// ALL of this project's strategic material + the Policy Engine data brief, returning pros,
// cons, tensions, tradeoffs, stakeholders and considerations with references to the evidence.

import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { requireProjectPublic } from '$lib/projects/guard';
import { getOpenAIClient, getModel } from '$lib/deepdive/keys';
import { buildStrategyContext, STAKEHOLDERS, VALID_REFS } from '../lib/policy';

const HITS = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (HITS.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  HITS.set(ip, arr);
  return arr.length > MAX_PER_WINDOW;
}

function parseJson(s: string): any {
  let t = (s ?? '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return JSON.parse(t);
}

const consider = (x: any) =>
  (Array.isArray(x) ? x : [])
    .map((c: any) => (typeof c === 'string' ? { point: c } : { point: String(c?.point ?? '').slice(0, 300), detail: c?.detail ? String(c.detail).slice(0, 300) : undefined }))
    .filter((c: any) => c.point)
    .slice(0, 6);

const stake = (x: any) =>
  (Array.isArray(x) ? x : [])
    .map((s: any) => ({ name: String(s?.name ?? s ?? '').slice(0, 80), why: String(s?.why ?? '').slice(0, 200) }))
    .filter((s: any) => s.name)
    .slice(0, 8);

export const POST: RequestHandler = async (event) => {
  await requireProjectPublic('dfe-data-strategy', event);
  const ip = event.getClientAddress?.() ?? 'unknown';
  if (rateLimited(ip)) throw error(429, 'Too many requests — please wait a moment.');

  const body = await event.request.json().catch(() => ({}));
  const title = String(body?.title ?? '').slice(0, 200).trim();
  const statement = String(body?.statement ?? '').slice(0, 2000).trim();
  if (!statement) throw error(400, 'Write a policy statement first.');

  const sys = `You are the Consideration Builder for Keystone, a DfE data-strategy workbench. A user proposes a HEADLINE POLICY for the data strategy. Using ONLY the STRATEGY CONTEXT below (the pressures, the strategy influence map, the legal stack, the frameworks, the maturity model, sector voices, and the Policy Engine's data conclusions), produce a rigorous, balanced appraisal.

Return STRICT JSON only — no prose, no fences — exactly:
{"summary": string (2-3 sentences),
 "pros": [{"point": string, "detail": string}],
 "cons": [{"point": string, "detail": string}],
 "tensions": [{"point": string, "severity": "high"|"medium"|"low"}],
 "tradeoffs": [{"point": string, "detail": string}],
 "considerations": [{"point": string, "detail": string}],
 "stakeholders": {"impacted": [{"name": string, "why": string}], "interested": [{"name": string, "why": string}]},
 "references": {"pressures": [<pressure id>], "strategies": [<strategy id>], "legislation": [<legislation id>]},
 "watchouts": [string]}

Rules:
- Ground every point in the context. Tensions should name genuine conflicts (e.g. open-by-default vs the duty of confidence; centralising against a federated MAT/LA reality; sharing ahead of governance; AI ambition ahead of data quality).
- references: list ONLY ids that appear in the context and that you actually drew on.
- For stakeholders, prefer these names where they fit (free text allowed): ${STAKEHOLDERS.join('; ')}.
- Be specific to DfE and children's data. 3-6 items per list. Neutral, expert tone.

STRATEGY CONTEXT:
${buildStrategyContext()}`;

  let parsed: any;
  try {
    const client = getOpenAIClient();
    const completion = await client.chat.completions.create(
      {
        model: getModel(),
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: `HEADLINE POLICY${title ? ` — "${title}"` : ''}:\n${statement}` },
        ],
        temperature: 0.3,
        max_tokens: 1800,
        thinking: { type: 'disabled' },
      } as any,
      { signal: AbortSignal.timeout(75_000) as any },
    );
    parsed = parseJson(completion.choices?.[0]?.message?.content ?? '{}');
  } catch (e: any) {
    throw error(502, `Consideration builder failed: ${(e?.message ?? 'model error').slice(0, 120)}`);
  }

  const refs = parsed?.references ?? {};
  const out = {
    summary: String(parsed?.summary ?? '').slice(0, 800),
    pros: consider(parsed?.pros),
    cons: consider(parsed?.cons),
    tensions: (Array.isArray(parsed?.tensions) ? parsed.tensions : [])
      .map((t: any) => ({ point: String(t?.point ?? t ?? '').slice(0, 300), severity: ['high', 'medium', 'low'].includes(t?.severity) ? t.severity : 'medium' }))
      .filter((t: any) => t.point)
      .slice(0, 6),
    tradeoffs: consider(parsed?.tradeoffs),
    considerations: consider(parsed?.considerations),
    stakeholders: { impacted: stake(parsed?.stakeholders?.impacted), interested: stake(parsed?.stakeholders?.interested) },
    references: {
      pressures: (Array.isArray(refs.pressures) ? refs.pressures : []).filter((id: any) => VALID_REFS.pressures.has(id)).slice(0, 10),
      strategies: (Array.isArray(refs.strategies) ? refs.strategies : []).filter((id: any) => VALID_REFS.strategies.has(id)).slice(0, 10),
      legislation: (Array.isArray(refs.legislation) ? refs.legislation : []).filter((id: any) => VALID_REFS.legislation.has(id)).slice(0, 10),
    },
    watchouts: (Array.isArray(parsed?.watchouts) ? parsed.watchouts : []).map((w: any) => String(w).slice(0, 200)).slice(0, 5),
  };

  return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
};
