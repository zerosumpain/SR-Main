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

// ——— Team memory (shared scratchpad) visibility ———

export interface TeamMemoryEntry {
  id: string;
  key: string | null;
  preview: string;
  updatedBy: string | null;
  updatedAt: string;
}

/** Recent shared team-memory records for the /jkai/agents page. */
export async function listTeamMemory(limit = 50): Promise<TeamMemoryEntry[]> {
  await ensureAgentInfra();
  const { records } = await queryRecords(
    TEAM_MEMORY_COLLECTION,
    { sort: { field: 'updatedAt', dir: 'desc' }, limit },
    ACTOR,
  );
  return records.map((r) => {
    let preview = '';
    try {
      preview = JSON.stringify(r.data);
    } catch {
      preview = String(r.data);
    }
    return {
      id: r.id,
      key: r.key,
      preview: preview.length > 240 ? `${preview.slice(0, 237)}…` : preview,
      updatedBy: r.updatedBy ?? r.createdBy,
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

/** Delete a team-memory record by id (the /jkai/agents "forget" action). */
export async function deleteTeamMemory(id: string): Promise<{ deleted: boolean }> {
  await ensureAgentInfra();
  try {
    // The collection's delete perm is owner/system — run this owner-level
    // action as 'owner' (the page is owner-gated by hooks).
    await deleteRecord(TEAM_MEMORY_COLLECTION, { id }, 'owner');
    return { deleted: true };
  } catch (err) {
    if (err instanceof DatastoreError && err.code === 'not_found') return { deleted: false };
    throw err;
  }
}
