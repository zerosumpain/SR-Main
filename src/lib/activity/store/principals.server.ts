import { db, type DbExecutor } from '$lib/db';
import { activityPrincipals, type ActivityPrincipal } from '$lib/db/schema';

export const OWNER_ACTIVITY_PRINCIPAL_ID = 'owner';

/**
 * Seed the phase-one owner principal. Its auth reference is deliberately not an
 * email address: owner membership remains env-backed and email never needs to
 * be copied into the activity store.
 */
export async function ensureOwnerActivityPrincipal(
  executor: DbExecutor = db,
): Promise<ActivityPrincipal> {
  const [row] = await executor
    .insert(activityPrincipals)
    .values({
      id: OWNER_ACTIVITY_PRINCIPAL_ID,
      kind: 'owner',
      externalRef: OWNER_ACTIVITY_PRINCIPAL_ID,
      label: 'Owner',
    })
    .onConflictDoUpdate({
      target: activityPrincipals.id,
      set: { kind: 'owner', externalRef: OWNER_ACTIVITY_PRINCIPAL_ID, updatedAt: new Date() },
    })
    .returning();
  return row;
}
