import { error } from '@sveltejs/kit';
import { verifyBridgeToken } from '$lib/jkai/tool-bridge';
import { generateExplainerImage } from '$lib/jkai/studio-image.server';
import type { RequestHandler } from './$types';

/**
 * Draw an illustration for a studio chapter and return the bytes.
 *
 * Called by scripts/studio-image.mjs, which the build agent runs via bash and
 * which writes the result into the build's own tree. Bytes rather than a URL
 * so the explainer never hotlinks a third party, and so the image never passes
 * through the agent's context — a base64 PNG in a tool result would cost more
 * tokens than the chapter it illustrates.
 *
 * Auth is the existing build bridge token, same as /api/jkai/tools/*: signed
 * per build, so only a running build can spend model budget here.
 */
export const POST: RequestHandler = async ({ request }) => {
  const auth = request.headers.get('authorization') ?? '';
  const buildId = verifyBridgeToken(auth.replace(/^Bearer\s+/i, ''));
  if (!buildId) throw error(401, 'invalid token');

  let body: { subject?: unknown };
  try {
    body = await request.json();
  } catch {
    throw error(400, 'expected a JSON body');
  }
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  if (!subject) throw error(400, 'subject is required');
  // A prompt this long is a chapter, not a subject, and the cost is real.
  if (subject.length > 600) throw error(400, 'subject must be under 600 characters');

  try {
    const { bytes, mime } = await generateExplainerImage(subject);
    return new Response(new Uint8Array(bytes), {
      headers: { 'content-type': mime, 'cache-control': 'no-store' },
    });
  } catch (err) {
    // The caller is a script that must degrade to "write the chapter with an
    // SVG instrument instead", so the reason has to reach it as text.
    throw error(502, err instanceof Error ? err.message : 'image generation failed');
  }
};
