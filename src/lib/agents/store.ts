// Agent-team persistence — definitions + shared memory live in the datastore
// (collections `jkai-agents` / `team-memory`), all accessed as the `jkai` actor
// so every agent shares the same grants. Import from `$lib/datastore` only.
import {
  DatastoreError,
  deleteRecord,
  ensureCollection,
  getRecordByKey,
  queryRecords,
  upsertRecord,
} from '$lib/datastore';
import {
  AGENTS_COLLECTION,
  TEAM_MEMORY_COLLECTION,
  DEFAULT_AGENTS,
  agentSlug,
  type AgentDef,
} from './types';

const ACTOR = 'jkai';
const PERMS = {
  read: ['owner', 'jkai', 'system'],
  write: ['owner', 'jkai', 'system'],
  delete: ['owner', 'system'],
};

let seeded = false;

/** Create the agent + team-memory collections and seed the default team once. */
export async function ensureAgentInfra(): Promise<void> {
  await ensureCollection(
    AGENTS_COLLECTION,
    { name: 'JKAI Agents', description: 'Persistent specialist agent definitions', isSystem: true, defaultPermissions: PERMS },
    ACTOR,
  );
  await ensureCollection(
    TEAM_MEMORY_COLLECTION,
    { name: 'Team Memory', description: 'Shared scratchpad for the agent team', isSystem: true, defaultPermissions: PERMS },
    ACTOR,
  );
  if (seeded) return;
  const { records } = await queryRecords(AGENTS_COLLECTION, { limit: 1 }, ACTOR);
  if (records.length === 0) {
    const now = new Date().toISOString();
    for (const a of DEFAULT_AGENTS) {
      await upsertRecord(
        AGENTS_COLLECTION,
        { key: a.name, data: { ...a, createdAt: now, updatedAt: now } as unknown as Record<string, unknown> },
        ACTOR,
      );
    }
  }
  seeded = true;
}

export async function listAgents(): Promise<AgentDef[]> {
  await ensureAgentInfra();
  const { records } = await queryRecords(AGENTS_COLLECTION, { sort: { field: 'key', dir: 'asc' }, limit: 100 }, ACTOR);
  return records.map((r) => r.data as unknown as AgentDef);
}

export async function getAgent(name: string): Promise<AgentDef | null> {
  await ensureAgentInfra();
  try {
    const rec = await getRecordByKey(AGENTS_COLLECTION, agentSlug(name), ACTOR);
    return rec.data as unknown as AgentDef;
  } catch (err) {
    if (err instanceof DatastoreError && err.code === 'not_found') return null;
    throw err;
  }
}

export interface AgentUpsertInput {
  name: string;
  role?: string;
  persona?: string;
  allowedTools?: string[];
  model?: string;
}

export async function upsertAgent(input: AgentUpsertInput): Promise<AgentDef> {
  await ensureAgentInfra();
  const name = agentSlug(input.name);
  if (!name) throw new Error('agent name is required');
  const existing = await getAgent(name);
  const now = new Date().toISOString();
  const def: AgentDef = {
    name,
    role: input.role ?? existing?.role ?? name,
    persona: input.persona ?? existing?.persona ?? '',
    allowedTools: input.allowedTools ?? existing?.allowedTools ?? [],
    model: input.model ?? existing?.model,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await upsertRecord(AGENTS_COLLECTION, { key: name, data: def as unknown as Record<string, unknown> }, ACTOR);
  return def;
}

export async function deleteAgent(name: string): Promise<{ deleted: boolean }> {
  await ensureAgentInfra();
  try {
    await deleteRecord(AGENTS_COLLECTION, { key: agentSlug(name) }, ACTOR);
    return { deleted: true };
  } catch (err) {
    if (err instanceof DatastoreError && err.code === 'not_found') return { deleted: false };
    throw err;
  }
}
