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
import { getLLMClient } from '$lib/llm/client';
import { resolveDefaultModel } from '$lib/server/models/settings';
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
    query?: string;
    registryCandidates?: any[];
    design?: unknown;
    fields?: unknown;
    answers?: { q: string; a: string }[];
  };
  const mode =
    body.mode === 'revise' ? 'revise'
    : body.mode === 'synth-pools' ? 'synth-pools'
    : body.mode === 'legal-advise' ? 'legal-advise'
    : body.mode === 'find-standards' ? 'find-standards'
    : 'design';

  const { client, model } = await getLLMClient(await resolveDefaultModel());

  let system: string;
  let user: string;
  // Candidate set for find-standards, used to validate the model's picks.
  let findCandidates: { refId: string }[] = [];

  if (mode === 'legal-advise') {
    const design = JSON.stringify(body.design ?? {}).slice(0, 8000);
    const answers = (body.answers || []).slice(0, 8).map((x) => `Q: ${x.q}\nA: ${x.a}`).join('\n');
    const cat = LEGAL_LEAVES.map((l) => `${l.id} | ${l.label} | ${l.citation ?? ''} | ${l.layer} | ${l.nature ?? ''}`).join('\n');
    system =
      'You are a UK information-governance adviser helping a team choose the legal basis to SHARE a dataset. A COMPLETE basis = A (UK GDPR Art 6 + an Art 9/10 condition for special-category/criminal data) + B (a SPECIFIC legal power / statutory gateway — the vires that permits or requires the sharing; a lawful basis ALONE never authorises a public body to share) + C (governance: DPIA, sharing agreement, CAG/s.251, Appropriate Policy Document).\n\nYou may ONLY use ids from this catalogue (id | label | citation | layer | nature):\n' +
      cat +
      '\n\nExamine the standard. If material facts needed to choose the basis are MISSING or AMBIGUOUS (e.g. is it for direct care vs secondary analysis; identifiable vs de-identified; consent practical vs not; which statutory function is exercised; will data leave the controller), ask up to 4 sharp clarifying questions. Otherwise — or once the user has answered — recommend a best-fit basis. You may return BOTH a provisional recommendation and residual questions. Be conservative and pick the most specific applicable power. Return STRICT JSON: {"questions":[{"id":string,"question":string,"why":string,"options":[string]}],"recommendation":{"legalBasisIds":[id],"summary":string,"reasoning":[string],"caveats":[string],"confidence":"high|medium|low"}}. Include at least one Layer-A basis, an Art 9 condition where special-category/children data is involved, one Layer-B power, and the key Layer-C governance.';
    user = `STANDARD:\n${design}${answers ? `\n\nANSWERS SO FAR:\n${answers}` : ''}`;
  } else if (mode === 'find-standards') {
    // Find EXISTING standards relevant to a need. The model only selects/ranks
    // from a server-built candidate set (grounded catalog + classified registry
    // entries the client passed in) — it never decides what exists.
    const query = String(body.query ?? '').slice(0, 300);
    const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
    const score = (text: string) => tokens.reduce((a, t) => a + (text.toLowerCase().includes(t) ? 1 : 0), 0);
    const catalogCands = CATALOG.map((s) => ({
      refId: `catalog:${s.id}`,
      source: 'catalog' as const,
      name: s.name,
      owner: s.owner,
      covers: s.dataCovered || s.description || '',
      _score: score(`${s.name} ${s.owner} ${s.dataCovered || ''} ${s.description || ''} ${s.sector}`),
    }));
    const topCatalog = catalogCands.filter((c) => c._score > 0).sort((a, b) => b._score - a._score).slice(0, 28);
    const regCands = (Array.isArray(body.registryCandidates) ? body.registryCandidates : []).slice(0, 18).map((r: any) => ({
      refId: `registry:${String(r.refId || r.url || '')}`.slice(0, 300),
      source: 'registry' as const,
      name: String(r.name || r.title || '').slice(0, 160),
      owner: String(r.owner || r.publisher || '').slice(0, 120),
      covers: String(r.covers || r.summary || '').slice(0, 200),
    }));
    const candidates = [...topCatalog, ...regCands];
    findCandidates = candidates.map((c) => ({ refId: c.refId }));
    const candList = candidates.map((c) => `${c.refId} | ${c.source} | ${c.name} | ${c.owner} | ${(c.covers || '').slice(0, 140)}`).join('\n');
    system =
      'You help a UK government team find EXISTING data standards relevant to a stated need. From the CANDIDATES list ONLY — never invent a standard — select the ones that genuinely fit and rank them best-first. Prefer authoritative, reusable standards (identifiers, schemas, codelists, data dictionaries) over generic guidance. Return STRICT JSON: {"standards":[{"refId":<exactly one candidate refId>,"source":"catalog"|"registry","name":string,"owner":string,"covers":string,"why":string-one-sentence-why-it-fits,"ingestable":boolean-true-when-source-is-catalog}],"note":string-short}. Include at most 8 standards. If nothing fits, return an empty list and say so in note.';
    user = `NEED: ${query || '(none given)'}\n\nCANDIDATES (refId | source | name | owner | covers):\n${candList || '(none)'}`;
  } else if (mode === 'synth-pools') {
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
    });
    const parsed = JSON.parse(res.choices?.[0]?.message?.content ?? '{}');
    // For find-standards, drop any pick whose refId wasn't a real candidate.
    if (mode === 'find-standards' && parsed && Array.isArray(parsed.standards)) {
      const valid = new Set(findCandidates.map((c) => c.refId));
      parsed.standards = parsed.standards.filter((s: any) => valid.has(s?.refId)).slice(0, 8);
    }
    return json(parsed);
  } catch (e: any) {
    throw error(502, `Assistant unavailable: ${(e?.message ?? 'failed').slice(0, 120)}`);
  }
};
