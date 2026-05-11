import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { hermesSessions } from '$lib/db/schema';
import { desc, isNull } from 'drizzle-orm';

// Hermes Phase 1 — read-only admin view. Shows open sessions tracked in
// Postgres, a live platform-health probe against the Hermes gateway, and
// the `JKAI_HERMES_CANVAS_CHAT` flag state. Full management UI (skills,
// memory, provider config) lands in later phases.

const HERMES_URL = env.HERMES_PLATFORM_URL ?? 'http://127.0.0.1:18790';
const HEALTH_TIMEOUT_MS = 1500;

type HealthPayload = { ok: boolean; ts: number } | null;

async function probeHealth(): Promise<HealthPayload> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(`${HERMES_URL}/platforms/jkai/health`, {
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: boolean; ts?: number };
    if (typeof body?.ok !== 'boolean' || typeof body?.ts !== 'number') return null;
    return { ok: body.ok, ts: body.ts };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export const load: PageServerLoad = async () => {
  const [openSessions, health] = await Promise.all([
    db
      .select({
        id: hermesSessions.id,
        hermesSessionId: hermesSessions.hermesSessionId,
        kind: hermesSessions.kind,
        kindId: hermesSessions.kindId,
        createdAt: hermesSessions.createdAt,
      })
      .from(hermesSessions)
      .where(isNull(hermesSessions.closedAt))
      .orderBy(desc(hermesSessions.createdAt))
      .limit(50),
    probeHealth(),
  ]);

  const flagEnabled = env.JKAI_HERMES_CANVAS_CHAT === '1';

  return { openSessions, health, flagEnabled };
};
