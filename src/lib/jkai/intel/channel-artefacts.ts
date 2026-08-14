// Entities that identify the PIPE rather than anything that came down it.
//
// Measured on the production graph:
//
//   Johnkelly Main    1,030 edges, 864 of them from email — the operator's own
//                     address, present in every thread he has ever received.
//                     The largest node in the graph, with neighbours in 72 of
//                     its 106 clusters.
//   jkai                337 edges, 100% chat — on every chat note by
//                     construction, because chat is where the conversation
//                     happened.
//   CI workflow run     119 edges, 100% email — build notifications.
//   User                 79 edges, 100% chat.
//
// None of these is intelligence. They are an artefact of the channel, and the
// provenance they appear to carry is already recorded on the NOTE, where it
// belongs. What they do carry is distortion: they inflate degree and centrality,
// they drag unrelated clusters together, and they are exactly the entities that
// had to be demoted from cluster labelling because a name attached to everything
// distinguishes nothing.
//
// They are FLAGGED, not deleted. The evidence stays intact and the decision is
// reversible — which matters, because "is this a channel artefact" is a
// judgement about how a graph is used rather than a fact about the data.
//
// State lives in the datastore, per the house rule the other engines follow
// (see ./run-log): no dedicated table, no `drizzle-kit push`, no CI TTY-prompt
// risk on deploy.
import { ensureCollection, upsertRecord, queryRecords, deleteRecord } from '$lib/datastore';
import type { PermissionSet } from '$lib/datastore';

export const SYSTEM_ACTOR = 'system';

/** Pinned — renaming this un-flags every artefact at once. */
export const CHANNEL_ARTEFACTS_COLLECTION = 'intel_channel_artefacts';

const PERMISSIONS: PermissionSet = {
  read: ['owner', 'jkai', 'system'],
  write: ['system', 'owner'],
  delete: ['owner', 'system'],
};

const PAGE = 200;

export interface ChannelArtefact {
  entityId: string;
  /** The name at the time it was flagged, so the list reads as something. */
  name: string;
  /** Why it is not intelligence — shown in the admin list. */
  reason: string;
  flaggedAt: string;
}

/**
 * The ones measured on the live graph, seeded on first use.
 *
 * By NAME rather than id, because ids differ between homeserv and production
 * and a seed keyed on production ids would silently do nothing locally. Names
 * are matched exactly and only at seed time; everything after that is by id.
 */
export const SEED_ARTEFACT_NAMES: ReadonlyArray<{ name: string; reason: string }> = [
  { name: 'Johnkelly Main', reason: 'The mailbox owner — present in every email thread by definition.' },
  { name: 'jkai', reason: 'The platform the conversation happened on — on every chat note by construction.' },
  { name: 'User', reason: 'The generic participant in a chat transcript.' },
  { name: 'CI workflow run', reason: 'Build notification emails, not a subject.' },
];

export async function ensureChannelArtefactCollection(): Promise<void> {
  await ensureCollection(
    CHANNEL_ARTEFACTS_COLLECTION,
    {
      name: 'Intel Channel Artefacts',
      description:
        'Entities that identify the channel rather than its content — excluded from graph analysis, never deleted.',
      isSystem: true,
      defaultPermissions: PERMISSIONS,
    },
    SYSTEM_ACTOR,
  );
}

export async function listChannelArtefacts(): Promise<ChannelArtefact[]> {
  await ensureChannelArtefactCollection();
  const out: ChannelArtefact[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { records } = await queryRecords(
      CHANNEL_ARTEFACTS_COLLECTION,
      { limit: PAGE, offset, sort: { path: 'flaggedAt', dir: 'asc' } },
      SYSTEM_ACTOR,
    );
    for (const record of records) out.push(record.data as unknown as ChannelArtefact);
    if (records.length < PAGE) break;
  }
  return out;
}

/** Just the ids — what the snapshot loader needs, and all it needs. */
export async function channelArtefactIds(): Promise<Set<string>> {
  try {
    return new Set((await listChannelArtefacts()).map((a) => a.entityId));
  } catch (err) {
    // A graph that renders with the artefacts in it is far better than a graph
    // that does not render. Same rule the roster read follows.
    console.warn('[intel] channel-artefact list unavailable; analysing the whole graph', err);
    return new Set();
  }
}

export async function flagChannelArtefact(
  entityId: string,
  name: string,
  reason: string,
): Promise<void> {
  await ensureChannelArtefactCollection();
  const record: ChannelArtefact = {
    entityId,
    name,
    reason: reason.trim() || 'Flagged as a channel artefact.',
    flaggedAt: new Date().toISOString(),
  };
  await upsertRecord(
    CHANNEL_ARTEFACTS_COLLECTION,
    { key: entityId, data: record as unknown as Record<string, unknown> },
    SYSTEM_ACTOR,
  );
}

export async function unflagChannelArtefact(entityId: string): Promise<void> {
  await ensureChannelArtefactCollection();
  await deleteRecord(CHANNEL_ARTEFACTS_COLLECTION, { key: entityId }, SYSTEM_ACTOR);
}
