import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { createForgeBuild } from '$lib/jkai/forge';

// Owner allowlist — mirrors getAllowedEmails() in src/hooks.server.ts and
// /api/auth/me (the AUTH_ALLOWED_EMAILS env var, comma-separated, lower-cased
// for comparison).
function allowedEmails(): string[] {
  return (env.AUTH_ALLOWED_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// Hard scope: the Forge may only ever drive the brass-and-rails game repo.
const ALLOWED_REPO = 'brass-and-rails';

/**
 * POST /api/jkai/forge/propose — owner-gated. Creates a git-target jkai build
 * that autonomously extends the brass-and-rails game on a branch, runs the
 * gate, and opens a PR for human merge. Hard-scoped to brass-and-rails.
 *
 * Body: { repo: 'brass-and-rails', prompt: string, trigger?: string }
 * Returns: { buildId }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  const session = await locals.auth();
  const email = (session?.user?.email || '').toLowerCase();
  const isOwner = !!email && allowedEmails().includes(email);
  if (!isOwner) {
    return json({ error: 'forbidden' }, { status: 403 });
  }

  let body: { repo?: unknown; prompt?: unknown; trigger?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { repo, prompt, trigger } = body;

  // Hard scope — reject anything that isn't the one allowed repo.
  if (repo !== ALLOWED_REPO) {
    return json({ error: `repo must be '${ALLOWED_REPO}'` }, { status: 400 });
  }
  if (!prompt || typeof prompt !== 'string') {
    return json({ error: 'prompt is required' }, { status: 400 });
  }
  const MAX_PROMPT_LEN = 20_000;
  if (prompt.length > MAX_PROMPT_LEN) {
    return json({ error: `prompt too long (max ${MAX_PROMPT_LEN} chars)` }, { status: 400 });
  }

  try {
    const { buildId } = await createForgeBuild({
      prompt,
      trigger: typeof trigger === 'string' && trigger ? trigger : undefined,
    });
    return json({ buildId }, { status: 201 });
  } catch (err: any) {
    return json(
      { error: `Build created but failed to start: ${err?.message ?? String(err)}` },
      { status: 500 },
    );
  }
};
