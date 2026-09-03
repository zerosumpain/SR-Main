import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { writeFile, readFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';

import { env } from '$env/dynamic/private';
import { secretsMatch } from '$lib/workflows/webhook-secret';
import { readLimitedJson } from '$lib/server/service-auth';
import { assertPublicRequestBudget } from '$lib/server/public-request-guard';

const LIVE_STATE_PATH = '/tmp/live-walk-state.json';
const EXPIRE_MS = 4 * 60 * 60 * 1000;

function getBroadcastSecret(): string {
  return env.LIVE_WALK_BROADCAST_SECRET || '';
}

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
export const POST: RequestHandler = async (event) => {
  const { request } = event;
  assertPublicRequestBudget(event, {
    scope: 'live-walk-write',
    perClient: { capacity: 30, refillPerSecond: 30 / 60 },
    global: { capacity: 180, refillPerSecond: 180 / 60 },
  });
  const secret = getBroadcastSecret();
  const key = request.headers.get('X-Broadcast-Key');
  if (!secret || !secretsMatch(secret, key)) {
    return json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS });
  }

  const incoming = await readLimitedJson<Record<string, any>>(request, 256 * 1024);
  incoming.receivedAt = Date.now();
  const track = Array.isArray(incoming.track)
    ? incoming.track
        .slice(-2_000)
        .filter((p: any) =>
          Number.isFinite(p?.lat) && p.lat >= -90 && p.lat <= 90 &&
          Number.isFinite(p?.lng) && p.lng >= -180 && p.lng <= 180 &&
          Number.isFinite(p?.timestamp),
        )
        .map((p: any) => ({ lat: p.lat, lng: p.lng, timestamp: p.timestamp }))
    : [];

  // Merge: append incoming track points to existing accumulated track
  let existingTrack: { lat: number; lng: number; timestamp: number }[] = [];
  try {
    const raw = await readFile(LIVE_STATE_PATH, 'utf-8');
    const prev = JSON.parse(raw);
    // Only carry forward track from the same session
    if (prev.startedAt === incoming.startedAt && Array.isArray(prev.track)) {
      existingTrack = prev.track;
    }
  } catch {
    // No existing state — start fresh
  }

  const state = {
    ...incoming,
    track: [...existingTrack, ...track].slice(-2_000),
  };

  await writeFile(LIVE_STATE_PATH, JSON.stringify(state), 'utf-8');

  if (incoming.status === 'finished') {
    setTimeout(async () => {
      try { await unlink(LIVE_STATE_PATH); } catch {}
    }, 5 * 60 * 1000);
  }

  return json({ ok: true }, { headers: CORS_HEADERS });
};

/**
 * GET — fetch current live walk state (owner-only via hooks.server.ts)
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
export const DELETE: RequestHandler = async (event) => {
  const { request } = event;
  assertPublicRequestBudget(event, {
    scope: 'live-walk-delete',
    perClient: { capacity: 6, refillPerSecond: 6 / 60 },
    global: { capacity: 30, refillPerSecond: 30 / 60 },
  });
  const secret = getBroadcastSecret();
  const key = request.headers.get('X-Broadcast-Key');
  if (!secret || !secretsMatch(secret, key)) {
    return json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS });
  }
  try { await unlink(LIVE_STATE_PATH); } catch {}
  return json({ ok: true }, { headers: CORS_HEADERS });
};
