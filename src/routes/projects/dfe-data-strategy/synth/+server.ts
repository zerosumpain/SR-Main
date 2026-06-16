// synth/+server.ts — owner-only. Two jobs:
//  • POST ?export=docx  {markdown,title} → render a Word brief of the diagnostic.
//  • POST (multipart, `file`) → extract an uploaded Office artefact and synthesise it against
//    Keystone's framework (summary, maturity signals, pressures addressed, suggested nudges).
// Uploaded content is processed in-session and returned to the caller; it is never persisted
// to the corpus.

import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { extractText, synthesize } from '$lib/jkai/extract';
import { getOpenAIClient, getModel } from '$lib/deepdive/keys';
import { MATURITY_DIMENSIONS } from '../lib/maturity';
import { PRESSURES } from '../lib/pressures';
import { POSTURE_AXES } from '../lib/postures';
import { CAPABILITY_AREAS } from '../lib/capabilities';

async function requireOwner(event: Parameters<RequestHandler>[0]) {
  const session = await event.locals.auth();
  if (!session?.user) throw error(404, 'Not found');
}

const MATURITY_IDS = new Set(MATURITY_DIMENSIONS.map((d) => d.id));
const PRESSURE_IDS = new Set(PRESSURES.map((p) => p.id));
const POSTURE_IDS = new Set(POSTURE_AXES.map((p) => p.id));
const CAP_IDS = new Set(CAPABILITY_AREAS.map((c) => c.id));

function vocab(): string {
  return [
    `Maturity dimensions (id — name): ${MATURITY_DIMENSIONS.map((d) => `${d.id} (${d.name})`).join('; ')}`,
    `Pressure ids (id — title): ${PRESSURES.map((p) => `${p.id} (${p.title})`).join('; ')}`,
    `Posture axes (id — left↔right): ${POSTURE_AXES.map((a) => `${a.id} (${a.leftLabel}↔${a.rightLabel}; −1=left,+1=right)`).join('; ')}`,
    `Capability area ids (id — name): ${CAPABILITY_AREAS.map((c) => `${c.id} (${c.name})`).join('; ')}`,
  ].join('\n');
}

function parseJson(s: string): any {
  let t = s.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return JSON.parse(t);
}

export const POST: RequestHandler = async (event) => {
  await requireOwner(event);

  // ---- export mode ----
  if (event.url.searchParams.get('export') === 'docx') {
    const body = await event.request.json().catch(() => ({}));
    const markdown = String(body?.markdown ?? '').slice(0, 60_000);
    const title = String(body?.title ?? 'DfE data strategy brief').slice(0, 200);
    if (!markdown) throw error(400, 'No content.');
    const out = await synthesize({ format: 'docx', source: 'markdown', content: markdown, title });
    return new Response(out.buffer as any, {
      headers: {
        'Content-Type': out.mimeType,
        'Content-Disposition': `attachment; filename="dfe-data-strategy-brief.${out.suggestedExtension}"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  // ---- upload + synthesise mode ----
  const form = await event.request.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') throw error(400, 'No file provided.');

  let extracted: { text: string; kind: string };
  try {
    const buf = Buffer.from(await (file as File).arrayBuffer());
    const res = await extractText(buf, (file as File).type || '', (file as File).name || '');
    extracted = { text: res.text, kind: res.meta.kind };
  } catch (e: any) {
    throw error(415, `Could not read that file: ${e?.message ?? 'unsupported format'}.`);
  }

  const text = extracted.text.slice(0, 14_000);
  if (!text.trim()) throw error(422, 'No readable text found in that file.');

  const sys = `You analyse an uploaded document for a DfE data-strategy lead and map it onto the Keystone framework. Return STRICT JSON only — no prose, no markdown fences — matching exactly:
{"summary": string (2-4 sentences),
 "maturitySignals": [{"dimension": <maturity id>, "level": 1-5, "note": string}],
 "addressedPressures": [<pressure id>],
 "nudges": [{"kind": "posture"|"allocation", "id": <posture id or capability id>, "value": number, "rationale": string}],
 "warnings": [string]}
For posture nudges, value is −1…1 (−1=left label, +1=right label). For allocation nudges, value is 0…30 (relative emphasis). ONLY use ids from this vocabulary; omit anything you cannot map. Be conservative: 1-4 maturity signals, up to 6 addressed pressures, up to 4 nudges. Base everything ONLY on the document.

VOCABULARY:
${vocab()}`;

  let parsed: any;
  try {
    const client = getOpenAIClient();
    const completion = await client.chat.completions.create(
      {
        model: getModel(),
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: `DOCUMENT (${extracted.kind}, "${(file as File).name}"):\n\n${text}` },
        ],
        temperature: 0.2,
        max_tokens: 1200,
        thinking: { type: 'disabled' },
      } as any,
      { signal: AbortSignal.timeout(60_000) as any },
    );
    parsed = parseJson(completion.choices?.[0]?.message?.content ?? '{}');
  } catch (e: any) {
    throw error(502, `Synthesis failed: ${(e?.message ?? 'model error').slice(0, 120)}`);
  }

  // validate against the vocabulary
  const out = {
    kind: extracted.kind,
    summary: String(parsed?.summary ?? '').slice(0, 1200),
    maturitySignals: (Array.isArray(parsed?.maturitySignals) ? parsed.maturitySignals : [])
      .filter((s: any) => MATURITY_IDS.has(s?.dimension))
      .map((s: any) => ({ dimension: s.dimension, level: Math.max(1, Math.min(5, Math.round(Number(s.level) || 2))), note: String(s.note ?? '').slice(0, 240) }))
      .slice(0, 6),
    addressedPressures: (Array.isArray(parsed?.addressedPressures) ? parsed.addressedPressures : [])
      .filter((id: any) => PRESSURE_IDS.has(id))
      .slice(0, 8),
    nudges: (Array.isArray(parsed?.nudges) ? parsed.nudges : [])
      .filter((n: any) => (n?.kind === 'posture' && POSTURE_IDS.has(n.id)) || (n?.kind === 'allocation' && CAP_IDS.has(n.id)))
      .map((n: any) => ({
        kind: n.kind,
        id: n.id,
        value: n.kind === 'posture' ? Math.max(-1, Math.min(1, Number(n.value) || 0)) : Math.max(0, Math.min(30, Number(n.value) || 0)),
        rationale: String(n.rationale ?? '').slice(0, 240),
      }))
      .slice(0, 6),
    warnings: (Array.isArray(parsed?.warnings) ? parsed.warnings : []).map((w: any) => String(w).slice(0, 200)).slice(0, 4),
  };

  return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
};
