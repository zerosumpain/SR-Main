/**
 * A build authenticating as itself, AND still entitled to act.
 *
 * `verifyBridgeToken` proves a token was minted for a build and is recent.
 * It cannot say whether that build is still going: a finished, failed or
 * paused build's token used to keep spending model budget and calling site
 * tools until it aged out. Every route that accepts the bridge token goes
 * through here, so the rule is one place rather than five copies.
 *
 * Kept apart from `bridge-token.ts` on purpose — that file imports nothing but
 * `node:crypto` so it can be tested without a database.
 */
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { jkaiBuilds, type JkaiBuild } from '$lib/db/schema';
import { buildFromAuthHeader } from './bridge-token';

/** The running build named by a `Bearer <bridge token>` header, or null. */
export async function runningBridgeBuild(header: string | null): Promise<JkaiBuild | null> {
  const buildId = buildFromAuthHeader(header);
  if (!buildId) return null;
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
  return build && build.status === 'running' ? build : null;
}
