// Briefing boot hook. The `canvas:morning-briefing` workflow in SR-Workflows
// produces every briefing on its own schedule and writes it into the
// `briefings` collection; Main only makes sure that collection exists with
// permissions the workflow's actor can write through.
import { ensureCollection, updateCollection } from '$lib/datastore';
import { BRIEFINGS_COLLECTION, BRIEFING_PERMS, SYSTEM_ACTOR, errMsg } from './types';

let started = false;

export async function ensureBriefingsCollection(): Promise<void> {
  const existing = await ensureCollection(
    BRIEFINGS_COLLECTION,
    { name: 'Briefings', description: 'Personalised briefings', isSystem: true, defaultPermissions: BRIEFING_PERMS },
    SYSTEM_ACTOR,
  );

  // ensureCollection is create-only, so a collection made before the workflow
  // became the producer still carries the old permissions and rejects the
  // `workflow:<id>` actor with `forbidden`. Reconcile on boot rather than
  // requiring a manual DB edit on every environment.
  const current = (existing.defaultPermissions ?? {}) as Record<string, string[] | undefined>;
  const missing = (['read', 'write'] as const).some((cap) => !(current[cap] ?? []).includes('workflow:*'));
  if (missing) {
    try {
      await updateCollection(BRIEFINGS_COLLECTION, { defaultPermissions: BRIEFING_PERMS }, SYSTEM_ACTOR);
      console.log('[briefing] collection permissions reconciled (added workflow:*)');
    } catch (err) {
      console.error('[briefing] failed to reconcile collection permissions:', errMsg(err));
    }
  }
}

export function startBriefingEngine(): void {
  if (started) return;
  started = true;
  void ensureBriefingsCollection().catch((err) => console.error('[briefing] ensure collection failed:', errMsg(err)));
}

export function stopBriefingEngine(): void {
  started = false;
}
