/**
 * Autopilot — one editorial pass over a whole post, streamed.
 *
 * Owner-gated by hooks.server.ts because it lives under /api/admin; there is
 * deliberately no auth code here.
 *
 * NDJSON rather than SSE, matching `review-claims` next door. The run does a
 * model call, a voice score per candidate and a filter pass, which is tens of
 * seconds — long enough that a silent spinner reads as a hang. Every stage
 * announces itself.
 *
 * THREE THINGS THIS ROUTE WILL NOT DO, and each is deliberate:
 *  - it never writes `content`. Every rewrite comes back as a proposal the
 *    author accepts in the margin, through the same path the chat assistant
 *    already uses, which is also what keeps the `proposal_resolved` taste
 *    signal accumulating.
 *  - it never changes `status`. Nothing here can publish.
 *  - it stamps `authorship = 'assisted'` the moment a pass runs. The Voice Card
 *    is built from FIVE posts and 3,198 words; feeding generated prose back
 *    into that corpus is model collapse in miniature, and the authorship
 *    column exists precisely to stop it. A post that has been through
 *    autopilot is not `human` any more, whether or not the author accepts a
 *    single suggestion — he read machine phrasings before writing the next
 *    sentence either way.
 */

import { getPostById, updatePostFields } from '$lib/blog';
import { getLLMClient } from '$lib/llm/client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { voiceBlock } from '$lib/voice/block';
import { scoreVoiceServer } from '$lib/voice/score.server';
import { segmentBody, getSentence } from '$lib/blog/assistant/segment';
import { proseProposal } from '$lib/blog/assistant/tools';
import {
  autopilotSystemPrompt,
  filterRewrites,
  parseRewrites,
  renderForAutopilot,
  riskyParagraphs,
  type AutopilotMode,
} from '$lib/blog/assistant/autopilot';
import type { RequestHandler } from './$types';

const MODES = new Set<AutopilotMode>(['readability', 'context', 'voice']);
const MAX_REWRITES = 8;
/** `scoreVoice` needs a reasonable sample; below this it reports noise. */
const MIN_WORDS_TO_SCORE = 60;

function stripTags(s: string): string {
  return s.replace(/<\/?[^>]+>/g, '');
}
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ');
}

export const POST: RequestHandler = async ({ params, request }) => {
  const id = Number.parseInt(params.id, 10);
  if (!Number.isFinite(id)) {
    return new Response(JSON.stringify({ error: 'Invalid id' }), { status: 400 });
  }

  let mode: AutopilotMode = 'readability';
  try {
    const body = (await request.json()) as { mode?: string };
    if (body.mode && MODES.has(body.mode as AutopilotMode)) mode = body.mode as AutopilotMode;
  } catch {
    // Default mode is fine; a malformed body is not worth a 400 here.
  }

  const post = await getPostById(id);
  if (!post) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

  const html = post.content ?? '';

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: object) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      };

      try {
        const seg = segmentBody(html);
        const sentenceCount = seg.paragraphs.reduce((n, p) => n + p.sentences.length, 0);
        if (sentenceCount < 3) {
          send({ type: 'done', proposals: [], reason: 'too-short' });
          controller.close();
          return;
        }

        const risky = riskyParagraphs(html);
        send({
          type: 'phase',
          phase: 'reading',
          message: `Reading ${sentenceCount} sentences across ${seg.paragraphs.length} paragraphs${
            risky.size ? ` (${risky.size} held back — links or embedded media)` : ''
          }…`,
        });

        const ctx = await resolveDefaultModel();
        const { client, model } = await getLLMClient(ctx);

        send({ type: 'phase', phase: 'thinking', message: `Running the ${mode} pass…` });

        const completion = await client.chat.completions.create({
          model,
          temperature: 0.4,
          max_tokens: 2400,
          response_format: { type: 'json_object' },
          messages: [
            // voiceBlock is called HERE, per request, not at module load — it
            // reads the Voice Card off disk and a module-level constant would
            // freeze the card until the process restarted.
            { role: 'system', content: autopilotSystemPrompt(mode, voiceBlock('public-prose', { exemplars: 2 })) },
            { role: 'user', content: renderForAutopilot(seg, risky) },
          ],
        });

        const raw = completion.choices[0]?.message?.content ?? '';
        const parsed = parseRewrites(raw, MAX_REWRITES);
        const { kept, dropped } = filterRewrites(parsed, html, risky);

        send({
          type: 'candidates',
          proposed: parsed.length,
          kept: kept.length,
          // Reported, never swallowed. A pass that quietly discards half its
          // output looks like a weak model rather than a working guard.
          dropped: dropped.map((d) => ({ at: `${d.rewrite.paragraphIdx}.${d.rewrite.sentenceIdx}`, why: d.why })),
        });

        send({ type: 'phase', phase: 'scoring', message: 'Checking each suggestion against the voice card…' });

        const haystack = collapse(stripTags(html));
        const proposals = [];
        let offVoice = 0;

        for (const r of kept) {
          const original = getSentence(seg, r.paragraphIdx, r.sentenceIdx);
          if (!original) continue;

          const needle = collapse(original).trim();
          const from = haystack.indexOf(needle);
          if (from < 0) continue;

          // The voice gate. It is free, offline and deterministic, so there is
          // no reason not to run it — but it needs a real sample, and a single
          // sentence is not one. Below the floor the score is noise, so the
          // suggestion passes rather than being rejected on a number that
          // means nothing.
          const words = r.suggested.trim().split(/\s+/).length;
          if (words >= MIN_WORDS_TO_SCORE) {
            const score = scoreVoiceServer(r.suggested, 'public-prose');
            if (score.verdict === 'not his voice') {
              offVoice += 1;
              continue;
            }
          }

          proposals.push(
            proseProposal(needle, r.suggested, from, from + needle.length, r.reason),
          );
          send({ type: 'proposal', proposal: proposals[proposals.length - 1] });
        }

        // Best-effort: the pass has already happened, and failing the whole run
        // because a metadata write lost a race would throw away the author's
        // suggestions for nothing.
        try {
          if (post.authorship === 'human' || post.authorship === 'unknown') {
            await updatePostFields(id, { authorship: 'assisted' });
          }
        } catch (e) {
          console.error('[autopilot] could not stamp authorship:', e);
        }

        send({ type: 'done', count: proposals.length, offVoice });
      } catch (e) {
        send({ type: 'error', error: e instanceof Error ? e.message : 'Autopilot failed' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
};
