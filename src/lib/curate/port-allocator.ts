import { db } from '$lib/db';
import { curateSessions } from '$lib/db/schema';
import { eq, isNotNull } from 'drizzle-orm';
import { CURATE_PORT_MIN, CURATE_PORT_MAX } from './constants';

/**
 * Allocates a free curate port to the given session id.
 *
 * Strategy: pick the lowest port in [MIN, MAX] not currently held by any
 * session row. The DB unique index on dev_server_port prevents a race
 * where two callers grab the same port between read and write.
 */
export async function allocatePort(sessionId: string): Promise<number> {
  const used = await db
    .select({ port: curateSessions.devServerPort })
    .from(curateSessions)
    .where(isNotNull(curateSessions.devServerPort));
  const inUse = new Set(used.map((r) => r.port).filter((p): p is number => p !== null));
  for (let port = CURATE_PORT_MIN; port <= CURATE_PORT_MAX; port++) {
    if (inUse.has(port)) continue;
    try {
      // Caller is expected to have a curateSessions row for this id.
      // For unit tests where no row exists yet, insert a minimal one.
      const existing = await db
        .select({ id: curateSessions.id })
        .from(curateSessions)
        .where(eq(curateSessions.id, sessionId))
        .limit(1);
      if (existing.length === 0) {
        const now = new Date();
        await db.insert(curateSessions).values({
          id: sessionId,
          targetType: 'pending',
          status: 'scoping',
          devServerPort: port,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        await db
          .update(curateSessions)
          .set({ devServerPort: port, updatedAt: new Date() })
          .where(eq(curateSessions.id, sessionId));
      }
      return port;
    } catch (err) {
      // Unique-index violation: race lost; try next port.
      if (String(err).includes('curate_sessions_port_uniq')) continue;
      throw err;
    }
  }
  throw new Error(`No free curate ports in range ${CURATE_PORT_MIN}-${CURATE_PORT_MAX}`);
}

export async function releasePort(sessionId: string): Promise<void> {
  await db
    .update(curateSessions)
    .set({ devServerPort: null, updatedAt: new Date() })
    .where(eq(curateSessions.id, sessionId));
}

export async function usedPorts(): Promise<number[]> {
  const rows = await db
    .select({ port: curateSessions.devServerPort })
    .from(curateSessions)
    .where(isNotNull(curateSessions.devServerPort));
  return rows.map((r) => r.port).filter((p): p is number => p !== null);
}
