// POST /projects/data-standard-designer/assist — the thin, project-scoped LLM
// assistant. Three modes:
//   design       — natural-language description → a first-pass brief + schema
//   revise       — current design + a natural-language instruction → updated design
//   synth-pools  — fields → realistic sample-value pools per field (for synthetic data)
//
// Output is constrained to the engine's own vocabulary (domains, field types,
// identifier ids, codelist ids) so the client can apply it directly. Public +
// IP-rate-limited (mirrors policy-engine/chat); not under /api/ so it isn't
// behind the Auth.js gate, and the project is public.

import { json, error } from '@sveltejs/kit';
import { requireProjectPublic } from '$lib/projects/guard';
import { getOpenAIClient, getModel } from '$lib/deepdive/keys';
import { IDENTIFIERS, CATALOG } from '../lib/knowledge';
import { CODELISTS } from '../lib/codelists';
import { LEGAL_LEAVES } from '../lib/legalBasis';
import type { RequestHandler } from './$types';

const DOMAINS = ['education', 'childrens-social-care', 'child-protection', 'health', 'local-gov', 'cross-gov', 'employment', 'justice', 'housing'];
const FIELD_TYPES = ['string', 'integer', 'number', 'boolean', 'date', 'datetime', 'enum', 'identifier', 'geo', 'currency', 'object', 'array'];

const HITS = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (HITS.get(ip) ?? []).filter((t) => now - t < 60_000);
  arr.push(now);
  HITS.set(ip, arr);
  return arr.length > 12;
}

function vocab(): string {
  return [
    `domains: ${DOMAINS.join(', ')}`,
    `fieldTypes: ${FIELD_TYPES.join(', ')}`,
    `identifierIds (set field.identifier to one of these to reuse a real identifier): ${IDENTIFIERS.map((i) => i.id).join(', ')}`,
    `codelistIds (set field.codelistId for enumerated fields): ${CODELISTS.map((c) => c.id).join(', ')}`,
    `standardIds (set field.sourceStandard to cite provenance): ${CATALOG.map((s) => s.id).slice(0, 60).join(', ')}`,
    `legalBasisIds (set brief.legalBasisIds — pick a Layer-A data-protection basis, a Layer-B power/gateway, and Layer-C governance): ${LEGAL_LEAVES.map((l) => l.id).join(', ')}`,
  ].join('\n');
}

const DESIGN_SHAPE = `Return STRICT JSON:
{
 "brief": {
   "name": string, "purpose": string, "domain": one-of-domains,
   "processingPurposes": string[], "containsPersonalData": bool,
   "containsSpecialCategory": bool, "aboutChildren": bool,
   "geographicCoverage": string, "legalBasis": string,
   "legalBasisIds": legalBasisId[],
   "interopGoal": "low"|"medium"|"high",
   "providers": [{"label":string,"sector":string,"ownership":"public"|"private"|"voluntary"|"mixed","existingStandards":standardId[],"systemsHeld":string,"burdenSensitivity":"low"|"medium"|"high"}],
   "consumers": [{"label":string,"sector":string,"use":string}]
 },
 "fields": [{"name":snake_case,"title":string,"type":one-of-fieldTypes,"description":string,"required":bool,"pii":bool,"specialCategory":bool,"identifier":identifierId-or-null,"codelistId":codelistId-or-null,"sourceStandard":standardId-or-null,"format":string-or-null}],
 "rationale": string
}
Prefer reusing identifierIds and codelistIds over bespoke fields. Always include a record id and a date/reference-period field. Keep the mandatory core lean. For children's or special-category data set the flags and a DPIA-aware legalBasis.`;

export const POST: RequestHandler = async (event) => {
  await requireProjectPublic('data-standard-designer', event);
  const ip = event.getClientAddress?.() ?? 'unknown';
  if (rateLimited(ip)) throw error(429, 'Too many requests — give it a minute.');

  const body = (await event.request.json().catch(() => ({}))) as {
    mode?: string;
    prompt?: string;
    design?: unknown;
    fields?: unknown;
  };
  const mode = body.mode === 'revise' ? 'revise' : body.mode === 'synth-pools' ? 'synth-pools' : 'design';

  const client = getOpenAIClient();
  const model = getModel();

  let system: string;
  let user: string;

  if (mode === 'synth-pools') {
    const fields = JSON.stringify(body.fields ?? []).slice(0, 6000);
    system =
      'You produce realistic example values for synthetic test data for a UK government dataset. For each NON-identifier, NON-codelist string field, give up to 10 realistic, varied, plausible UK example values. Do NOT invent values for fields that are identifiers or have a codelist. Return STRICT JSON: {"pools": {"<field_name>": ["value", ...]}}. Keep values short and realistic; no PII of real people.';
    user = `Fields:\n${fields}`;
  } else if (mode === 'revise') {
    const design = JSON.stringify(body.design ?? {}).slice(0, 9000);
    system = `You revise an existing data-standard design per the user's instruction. Use ONLY this vocabulary:\n${vocab()}\n\n${DESIGN_SHAPE}\nReturn the FULL updated design (brief + fields), not a diff.`;
    user = `CURRENT DESIGN:\n${design}\n\nINSTRUCTION: ${String(body.prompt ?? '').slice(0, 1500)}`;
  } else {
    system = `You design a first-pass UK government data standard from a natural-language description. Use ONLY this vocabulary:\n${vocab()}\n\n${DESIGN_SHAPE}`;
    user = `DESCRIPTION: ${String(body.prompt ?? '').slice(0, 2000)}`;
  }

  try {
    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
      max_tokens: 6000,
      response_format: { type: 'json_object' },
      // GLM burns reasoning tokens from max_tokens, which can starve the JSON
      // output and truncate `fields`. This is structured generation, not a
      // reasoning task — disable thinking so the whole object is emitted.
      ...( { thinking: { type: 'disabled' } } as any),
    } as any);
    const parsed = JSON.parse(res.choices?.[0]?.message?.content ?? '{}');
    return json(parsed);
  } catch (e: any) {
    throw error(502, `Assistant unavailable: ${(e?.message ?? 'failed').slice(0, 120)}`);
  }
};
