// author/review/+server.ts — the Author's deep review. Public + rate-limited (the
// draft is the user's own; nothing is persisted server-side). Reviews the whole
// draft (or one section) against the best-practice rubric, the must-answer
// commitments and the retrieved corpus, plus the current workbench posture for
// contradiction-spotting. SSE like /consider: first byte immediately, tick events
// while the model streams, one validated `result` event.

import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { requireProjectPublic } from '$lib/projects/guard';
import { getOpenAIClient, getModel } from '$lib/deepdive/keys';
import { retrieve } from '../../lib/retrieval.server';
import { coerceJson } from '../../lib/jsonsafe';
import { validateReview } from '../../lib/author/reviewValidate';
import { SECTION_CRITERIA, DOCUMENT_CRITERIA, FAILURE_MODES, COMPONENT_CHECKLIST } from '../../lib/author/rubric';
import { MUST_ANSWER, DOCUMENTS_BY_ID } from '../../lib/commitments';

const HITS = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 6;
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (HITS.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  HITS.set(ip, arr);
  return arr.length > MAX_PER_WINDOW;
}

interface InSection {
  id: string;
  templateId: string | null;
  title: string;
  text: string;
}

const SECTION_CHAR_CAP = 3200;
const TOTAL_CHAR_CAP = 26_000;

export const POST: RequestHandler = async (event) => {
  await requireProjectPublic('dfe-data-strategy', event);
  const ip = event.getClientAddress?.() ?? 'unknown';
  if (rateLimited(ip)) throw error(429, 'Too many reviews — give it a minute.');

  const body = await event.request.json().catch(() => ({}));
  const title = String(body?.title ?? 'Education data strategy draft').slice(0, 200);
  const focus = typeof body?.focus === 'string' ? body.focus : null;
  const scenario = body?.scenario
    ? { name: String(body.scenario.name ?? '').slice(0, 120), postures: String(body.scenario.postures ?? '').slice(0, 900) }
    : null;

  let sections: InSection[] = (Array.isArray(body?.sections) ? body.sections : [])
    .map((s: any) => ({
      id: String(s?.id ?? '').slice(0, 60),
      templateId: typeof s?.templateId === 'string' ? s.templateId.slice(0, 60) : null,
      title: String(s?.title ?? '').slice(0, 140),
      text: String(s?.text ?? ''),
    }))
    .filter((s: InSection) => s.id && s.title);
  if (!sections.length) throw error(400, 'Send at least one section.');
  if (focus) sections = sections.filter((s) => s.id === focus || s.text.trim().length > 0);

  // budget: cap per-section and total characters, keeping every non-empty section represented
  let total = 0;
  sections = sections.map((s) => {
    let text = s.text.slice(0, SECTION_CHAR_CAP);
    if (total + text.length > TOTAL_CHAR_CAP) text = text.slice(0, Math.max(0, TOTAL_CHAR_CAP - total));
    total += text.length;
    return { ...s, text };
  });

  const nonEmpty = sections.filter((s) => s.text.trim().length > 0);
  if (!nonEmpty.length) throw error(400, 'The draft is empty — write something first.');

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* closed */
        }
      };
      try {
        controller.enqueue(encoder.encode(': keystone-review\n\n'));
      } catch {
        /* noop */
      }
      try {
        send({ type: 'status', step: 'retrieve', message: 'Gathering the evidence base…' });
        const query = `${title}\n${nonEmpty.map((s) => `${s.title}: ${s.text.slice(0, 160)}`).join('\n')}`;
        const chunks = await retrieve(query, 10);
        send({ type: 'status', step: 'review', message: `Reviewing ${nonEmpty.length} section${nonEmpty.length === 1 ? '' : 's'} against the rubric…` });

        const criteriaFor = (s: InSection) =>
          s.templateId && SECTION_CRITERIA[s.templateId] ? SECTION_CRITERIA[s.templateId].map((c) => `- ${c}`).join('\n') : '- (custom section — judge on clarity, decisions and evidence)';

        const mustAnswer = MUST_ANSWER.slice(0, 18)
          .map((c) => `- ${c.title} (${DOCUMENTS_BY_ID[c.docId]?.shortName ?? c.docId}${c.timeframe ? `, ${c.timeframe}` : ''}): ${c.strategyImplication}`)
          .join('\n');

        const sys = `You are the deep reviewer inside Keystone, an education strategy authoring workbench. The user is drafting the department's data strategy. Review their DRAFT rigorously against the RUBRIC, the FAILURE MODES seen in real departmental strategies, the MUST-ANSWER COMMITMENTS (statutory/in-delivery obligations from the 2024–26 white-paper landscape), and the RETRIEVED EVIDENCE. Be a demanding, constructive senior reviewer: specific, quotable, never generic.

Return STRICT JSON only — no prose, no fences — exactly:
{"sections": [{"id": string (MUST be one of the given section ids), "score": number 0-100, "verdict": string (<=200 chars, decisive), "strengths": [string], "weaknesses": [string], "suggestions": [string (concrete edits, each naming WHERE)]}],
 "document": {"score": number 0-100, "verdict": string (2-3 sentences), "contradictions": [string (real internal contradictions between sections, or between the draft and the declared posture — name both sides)], "topFixes": [string (the 3 highest-leverage changes)], "missingComponents": [string (canonical strategy components absent from the draft)]}}

Scoring guide: 0-30 placeholder/aspiration only; 31-55 says things but decides nothing; 56-75 credible with gaps; 76-90 strong, specific, funded, owned; 91+ exemplary. Score EVERY section provided (empty sections score 0 with verdict "Not written yet.").

DOCUMENT CRITERIA:\n${DOCUMENT_CRITERIA.map((c) => `- ${c}`).join('\n')}

FAILURE MODES (watch for these):\n${FAILURE_MODES.map((f) => `- ${f}`).join('\n')}

CANONICAL COMPONENTS (for missingComponents — use these titles):\n${COMPONENT_CHECKLIST.map((c) => `- ${c.title}`).join('\n')}

MUST-ANSWER COMMITMENTS:\n${mustAnswer || '- (ledger not yet loaded)'}
${scenario ? `\nDECLARED WORKBENCH POSTURE (flag contradictions with the draft):\nScenario "${scenario.name}": ${scenario.postures}` : ''}

RETRIEVED EVIDENCE:\n${chunks.map((c, i) => `[${i + 1}] ${c.title}\n${c.text.slice(0, 500)}`).join('\n\n')}`;

        const user = `DRAFT — "${title}"${focus ? ` (deep-dive on section "${focus}"; still score the others briefly)` : ''}:\n\n${sections
          .map((s) => `SECTION id="${s.id}" [${s.templateId ?? 'custom'}] — ${s.title}\nCRITERIA:\n${criteriaFor(s)}\nTEXT:\n${s.text.trim() || '(empty)'}`)
          .join('\n\n---\n\n')}`;

        const messages = [
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ];
        const generate = async (): Promise<string> => {
          const client = getOpenAIClient();
          const completion = await client.chat.completions.create(
            { model: getModel(), messages, temperature: 0.2, max_tokens: 7000, stream: true, thinking: { type: 'disabled' }, response_format: { type: 'json_object' } } as any,
            { signal: AbortSignal.timeout(140_000) as any },
          );
          let acc = '';
          for await (const chunk of completion as any) {
            const delta = chunk?.choices?.[0]?.delta?.content;
            if (delta) {
              acc += delta;
              send({ type: 'tick' });
            }
          }
          return acc;
        };

        let parsed: any;
        try {
          parsed = coerceJson(await generate());
        } catch {
          send({ type: 'status', step: 'review', message: 'Tidying the review…' });
          parsed = coerceJson(await generate());
        }
        const out = validateReview(parsed, sections.map((s) => s.id));
        send({ type: 'result', data: out });
      } catch (e: any) {
        send({ type: 'error', message: (e?.message ?? 'review failed').slice(0, 160) });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
};
