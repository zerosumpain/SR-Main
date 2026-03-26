import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { writeFile, readFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';

const LIVE_STATE_PATH = '/tmp/live-walk-state.json';
const BROADCAST_SECRET = 'offline-maps-live';
// Auto-expire after 4 hours of no updates
const EXPIRE_MS = 4 * 60 * 60 * 1000;

/**
 * POST — receive live walk state from the maps PWA
 * No auth required but needs the broadcast secret header
 */
export const POST: RequestHandler = async ({ request }) => {
  const key = request.headers.get('X-Broadcast-Key');
  if (key !== BROADCAST_SECRET) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const state = await request.json();
  state.receivedAt = Date.now();

  await writeFile(LIVE_STATE_PATH, JSON.stringify(state), 'utf-8');

  // If walk is finished, schedule cleanup after 5 minutes
  if (state.status === 'finished') {
    setTimeout(async () => {
      try { await unlink(LIVE_STATE_PATH); } catch {}
    }, 5 * 60 * 1000);
  }

  return json({ ok: true });
};

/**
 * GET — fetch current live walk state (public, no auth)
 */
export const GET: RequestHandler = async () => {
  if (!existsSync(LIVE_STATE_PATH)) {
    return json({ active: false });
  }

  try {
    const raw = await readFile(LIVE_STATE_PATH, 'utf-8');
    const state = JSON.parse(raw);

    // Check expiry
    if (Date.now() - state.receivedAt > EXPIRE_MS) {
      try { await unlink(LIVE_STATE_PATH); } catch {}
      return json({ active: false });
    }

    return json({ active: true, ...state });
  } catch {
    return json({ active: false });
  }
};

/**
 * DELETE — clear live walk state (requires auth via hooks)
 */
export const DELETE: RequestHandler = async () => {
  try { await unlink(LIVE_STATE_PATH); } catch {}
  return json({ ok: true });
};
