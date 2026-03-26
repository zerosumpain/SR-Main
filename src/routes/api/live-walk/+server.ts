import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { writeFile, readFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';

const LIVE_STATE_PATH = '/tmp/live-walk-state.json';
const BROADCAST_SECRET = 'offline-maps-live';
const EXPIRE_MS = 4 * 60 * 60 * 1000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Broadcast-Key'
};

/**
 * OPTIONS — CORS preflight
 */
export const OPTIONS: RequestHandler = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

/**
 * POST — receive live walk state from the maps PWA
 */
export const POST: RequestHandler = async ({ request }) => {
  const key = request.headers.get('X-Broadcast-Key');
  if (key !== BROADCAST_SECRET) {
    return json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS });
  }

  const state = await request.json();
  state.receivedAt = Date.now();

  await writeFile(LIVE_STATE_PATH, JSON.stringify(state), 'utf-8');

  if (state.status === 'finished') {
    setTimeout(async () => {
      try { await unlink(LIVE_STATE_PATH); } catch {}
    }, 5 * 60 * 1000);
  }

  return json({ ok: true }, { headers: CORS_HEADERS });
};

/**
 * GET — fetch current live walk state (public)
 */
export const GET: RequestHandler = async () => {
  if (!existsSync(LIVE_STATE_PATH)) {
    return json({ active: false }, { headers: CORS_HEADERS });
  }

  try {
    const raw = await readFile(LIVE_STATE_PATH, 'utf-8');
    const state = JSON.parse(raw);

    if (Date.now() - state.receivedAt > EXPIRE_MS) {
      try { await unlink(LIVE_STATE_PATH); } catch {}
      return json({ active: false }, { headers: CORS_HEADERS });
    }

    return json({ active: true, ...state }, { headers: CORS_HEADERS });
  } catch {
    return json({ active: false }, { headers: CORS_HEADERS });
  }
};

/**
 * DELETE — clear live walk state
 */
export const DELETE: RequestHandler = async () => {
  try { await unlink(LIVE_STATE_PATH); } catch {}
  return json({ ok: true }, { headers: CORS_HEADERS });
};
