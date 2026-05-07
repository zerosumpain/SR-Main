// src/routes/api/curate/sessions/+server.ts
//
// POST /api/curate/sessions  — create a new curate session
// GET  /api/curate/sessions  — list active sessions

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createCuratedSession } from '$lib/curate/session-lifecycle';
import { listActiveSessions } from '$lib/curate/session-store';
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
    throw error(500, `Failed to create curate session: ${msg}`);
  }

  // TODO(curate-phase-7): if initialMessage is present, kick the scope chat:
  //   engine.runScopeChat(sessionId, initialMessage)
  // This will be wired once Phase 7 lands.

  return json({ sessionId }, { status: 201 });
};
