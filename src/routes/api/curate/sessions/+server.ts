// src/routes/api/curate/sessions/+server.ts
//
// POST /api/curate/sessions  — create a new curate session
// GET  /api/curate/sessions  — list active sessions

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createCuratedSession } from '$lib/curate/session-lifecycle';
import { listActiveSessions } from '$lib/curate/session-store';
import { runScopeChat } from '$lib/curate/engine';
import { randomUUID } from 'node:crypto';

// ── GET ─────────────────────────────────────────────────────────────────

export const GET: RequestHandler = async () => {
  const sessions = await listActiveSessions();
  return json(sessions);
};

// ── POST ─────────────────────────────────────────────────────────────────

export const POST: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  const targetType =
    typeof body.targetType === 'string' && body.targetType.trim()
      ? body.targetType.trim()
      : 'unknown';

  const initialMessage =
    typeof body.initialMessage === 'string' && body.initialMessage.trim()
      ? body.initialMessage.trim()
      : undefined;

  const sessionId = randomUUID();

  try {
    await createCuratedSession({
      sessionId,
      targetType,
      goal: initialMessage,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Homeserv-only guard hits this path on prod — return 400 with the helpful
    // message rather than a generic 500.
    if (msg.includes('Curate runs on homeserv only')) {
      throw error(400, msg);
    }
    throw error(500, `Failed to create curate session: ${msg}`);
  }

  // Fire-and-forget: scope chat runs in the background while the HTTP
  // response returns immediately. The UI subscribes to SSE for progress.
  if (initialMessage) {
    void runScopeChat(sessionId, initialMessage).catch(() => undefined);
  }

  return json({ sessionId }, { status: 201 });
};
