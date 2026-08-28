// author/generate/+server.ts — the interview-driven strategy generator.
// Two modes, both signed-in-only (generation is the expensive path — a full run
// is up to 20 model calls, driven one section at a time by the client so progress
// is visible and any section can be retried):
//   • POST {mode:'outline', depth, length, answers}        → the document spine
//   • POST {mode:'section', …, outline, sectionId}          → one section's markdown
// Every section is grounded in the lead's answers (the digest), the section
// template's guidance, and retrieved corpus evidence — same corpus as the deep review.

import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireProjectPublic } from '$lib/projects/guard';
import { isOwnerEmail } from '$lib/server/access';
import { getLLMClient } from '$lib/llm/client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { retrieve } from '../../lib/retrieval.server';
import { coerceJson } from '../../lib/jsonsafe';
import { TEMPLATE_BY_ID } from '../../lib/author/templates';
import { MUST_ANSWER, DOCUMENTS_BY_ID } from '../../lib/commitments';
import {
  SKELETONS,
  questionsForDepth,
  digestAnswers,
  digestForSection,
  type DepthId,
  type LengthId,
  type InterviewAnswer,
} from '../../lib/author/interview';

const HITS = new Map<string, number[]>();
const WINDOW_MS = 5 * 60_000;
const MAX_PER_WINDOW = 40;
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (HITS.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  HITS.set(ip, arr);
  return arr.length > MAX_PER_WINDOW;
}

function cleanAnswers(raw: unknown): InterviewAnswer[] {
  return (Array.isArray(raw) ? raw : [])
    .map((a: any) => ({
      id: String(a?.id ?? '').slice(0, 40),
      optionIds: Array.isArray(a?.optionIds) ? a.optionIds.map((o: any) => String(o).slice(0, 40)).slice(0, 8) : undefined,
      value: typeof a?.value === 'number' && Number.isFinite(a.value) ? Math.max(0, Math.min(100, a.value)) : undefined,
      text: typeof a?.text === 'string' ? a.text.slice(0, 1200) : undefined,
    }))
    .filter((a) => a.id)
    .slice(0, 40);
}

const STYLE = `Style rules — follow all of them:
- British English, plain and active. Say "we will", name owners and dates where the answers imply them.
  (Deliberately NOT $lib/voice — this is institutional departmental voice, not John's. Giving a
   DfE strategy document his first person and his self-deprecation would be the register split failing.)
- Decisions, not aspirations: every paragraph should either decide something, commit to something, or evidence something.
- Ground claims in the EVIDENCE PACK by naming the source in prose (e.g. "the 2025 State of Digital Government review found…"). Never include URLs.
- Mostly flowing paragraphs; a short bulleted list is allowed where it genuinely helps. Use ### sub-headings only in sections over 450 words.
- Do NOT repeat the section title as a heading — the document shell adds it. Start straight into the prose.
- Never mention this interview, the generator, Keystone, or that the text was produced from answers.`;

const isDepth = (d: any): d is DepthId => d === 'quick' || d === 'standard' || d === 'indepth';
const isLength = (l: any): l is LengthId => l === 'concise' || l === 'working' || l === 'full';

export const POST: RequestHandler = async (event) => {
  await requireProjectPublic('dfe-data-strategy', event);
  // same auth ladder as the intel sweep: bearer secret (service/scripted) or a
  // signed-in session; secret unset → open (dev convenience)
  const secret = env.KEYSTONE_INTEL_SECRET;
  let ok = !secret || (event.request.headers.get('authorization') ?? '') === `Bearer ${secret}`;
  if (!ok) {
    const session = await event.locals.auth?.();
    ok = isOwnerEmail(session?.user?.email);
  }
  if (!ok) throw error(404, 'Not found');
  const ip = event.getClientAddress?.() ?? 'unknown';
  if (rateLimited(ip)) throw error(429, 'Generating too fast — give it a minute.');

  const body = await event.request.json().catch(() => ({}));
  const mode = body?.mode === 'outline' ? 'outline' : 'section';
  if (!isDepth(body?.depth) || !isLength(body?.length)) throw error(400, 'Bad depth/length.');
  const depth: DepthId = body.depth;
  const length: LengthId = body.length;
  const answers = cleanAnswers(body?.answers);
  const questions = questionsForDepth(depth);
  const skeleton = SKELETONS[length];
  const { client, model } = await getLLMClient(await resolveDefaultModel());

  if (mode === 'outline') {
    const digest = digestAnswers(questions, answers) || '- (no answers given — write a balanced, evidence-led strategy)';
    const sys = `You are the drafting engine for the department's data strategy. From the strategy lead's interview answers, produce the document spine that will keep ${skeleton.length} independently-drafted sections coherent. Return STRICT JSON only — no prose, no fences — exactly:
{"title": string (a real strategy title, <90 chars, no colon-cliché if you can avoid it),
 "arc": string (2-3 sentences: the through-line of the document, in the register the answers imply),
 "shifts": [string, string, string] (the 2-4 big shifts, each <90 chars, consistent with the answers),
 "sectionBriefs": [{"id": string (MUST be one of the section ids given), "brief": string (1-2 sentences: what THIS section must argue/decide, consistent with the answers and the arc)}]}
Provide a brief for EVERY section id.`;
    const user = `SECTIONS (id — title):\n${skeleton.map((s) => `- ${s.id} — ${s.title}`).join('\n')}\n\nTHE LEAD'S ANSWERS:\n${digest}`;
    const generate = async () => {
      const completion = await client.chat.completions.create(
        {
          model,
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: user },
          ],
          temperature: 0.4,
          max_tokens: 2200,
          response_format: { type: 'json_object' },
        },
        { signal: AbortSignal.timeout(90_000) as any },
      );
      return coerceJson<any>(completion.choices?.[0]?.message?.content ?? '{}');
    };
    let parsed: any;
    try {
      parsed = await generate();
    } catch {
      parsed = await generate(); // one retry — JSON slips happen
    }
    const briefs: Record<string, string> = {};
    for (const b of Array.isArray(parsed?.sectionBriefs) ? parsed.sectionBriefs : []) {
      if (typeof b?.id === 'string' && skeleton.some((s) => s.id === b.id)) briefs[b.id] = String(b.brief ?? '').slice(0, 500);
    }
    return json({
      title: String(parsed?.title ?? 'Education data strategy').slice(0, 140),
      arc: String(parsed?.arc ?? '').slice(0, 900),
      shifts: (Array.isArray(parsed?.shifts) ? parsed.shifts : []).map((s: any) => String(s).slice(0, 160)).slice(0, 4),
      briefs,
    });
  }

  // ---- section mode ----
  const sectionId = String(body?.sectionId ?? '');
  const section = skeleton.find((s) => s.id === sectionId);
  if (!section) throw error(400, 'Unknown section for this length.');
  const outline = {
    title: String(body?.outline?.title ?? 'Education data strategy').slice(0, 140),
    arc: String(body?.outline?.arc ?? '').slice(0, 900),
    shifts: (Array.isArray(body?.outline?.shifts) ? body.outline.shifts : []).map((s: any) => String(s).slice(0, 160)).slice(0, 4),
    briefs: (typeof body?.outline?.briefs === 'object' && body.outline.briefs) || {},
  };
  const brief = String((outline.briefs as any)[section.id] ?? '').slice(0, 500);
  const template = section.templateId ? TEMPLATE_BY_ID[section.templateId] : null;

  const digest =
    section.templateId === null
      ? digestAnswers(questions, answers)
      : digestForSection(section.templateId, questions, answers) || digestAnswers(questions, answers);

  // evidence: the same corpus the deep review uses
  let evidence = '';
  try {
    const chunks = await retrieve(`${section.title} ${template?.guidance?.slice(0, 240) ?? ''}`, 6);
    evidence = chunks.map((c, i) => `[${i + 1}] ${c.title}\n${c.text.slice(0, 420)}`).join('\n\n');
  } catch {
    /* generate without evidence rather than fail */
  }

  const mustAnswer =
    section.templateId === 'commitments-obligations' || section.templateId === 'delivery-roadmap'
      ? MUST_ANSWER.slice(0, 16)
          .map((c) => `- ${c.title} (${DOCUMENTS_BY_ID[c.docId]?.shortName ?? c.docId}${c.timeframe ? `, ${c.timeframe}` : ''}): ${c.strategyImplication}`)
          .join('\n')
      : '';

  const lo = Math.round(section.words * 0.8);
  const hi = Math.round(section.words * 1.25);
  const sys = `You write sections of the department's data strategy — the real, publishable document. You are drafting ONE section; other sections are drafted separately, so stay inside this section's remit and trust the outline to carry the rest.

${STYLE}

Target length: ${section.words} words (stay within ${lo}–${hi}). Return ONLY the section body as markdown.`;

  const user = [
    `DOCUMENT: "${outline.title}"`,
    outline.arc ? `THROUGH-LINE: ${outline.arc}` : '',
    outline.shifts.length ? `THE BIG SHIFTS:\n${outline.shifts.map((s: string) => `- ${s}`).join('\n')}` : '',
    `THIS SECTION: "${section.title}" (${section.templateId ?? 'executive summary of the whole strategy'})`,
    brief ? `SECTION BRIEF: ${brief}` : '',
    template ? `WHAT A STRONG VERSION DOES: ${template.guidance}\nQUESTIONS IT ANSWERS:\n${template.prompts.map((p) => `- ${p}`).join('\n')}` : '',
    section.templateId === null ? `SECTION LIST (summarise across these):\n${skeleton.slice(1).map((s) => `- ${s.title}${(outline.briefs as any)[s.id] ? `: ${(outline.briefs as any)[s.id]}` : ''}`).join('\n')}` : '',
    `THE LEAD'S ANSWERS (the strategy MUST reflect these):\n${digest || '- (none — take balanced, evidence-led positions)'}`,
    mustAnswer ? `MUST-ANSWER COMMITMENTS (statutory / in-delivery — address the relevant ones):\n${mustAnswer}` : '',
    evidence ? `EVIDENCE PACK (cite by name in prose, never by URL):\n${evidence}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const maxTokens = Math.max(900, Math.min(3400, Math.round(section.words * 2.2) + 400));
  let md = '';
  try {
    const completion = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ],
        temperature: 0.45,
        max_tokens: maxTokens,
      },
      { signal: AbortSignal.timeout(150_000) as any },
    );
    md = String(completion.choices?.[0]?.message?.content ?? '').trim();
  } catch (e: any) {
    throw error(502, `Generation failed: ${(e?.message ?? 'model error').slice(0, 120)}`);
  }
  // strip an accidental leading heading that repeats the title
  md = md.replace(/^#{1,3}\s+.{0,120}\n+/, (m) => (m.toLowerCase().includes(section.title.slice(0, 18).toLowerCase()) ? '' : m)).trim();
  if (!md) throw error(502, 'The model returned an empty section.');

  return json({ markdown: md.slice(0, 24_000), words: md.split(/\s+/).filter(Boolean).length });
};
