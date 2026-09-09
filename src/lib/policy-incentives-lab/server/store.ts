import { randomUUID, createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { policyLabProjects, policyLabRuns, policyLabVersions } from '$lib/db/schema';
import type { Candidate, PolicySource } from '../schemas';
import { reviewItems, validateModel } from '../validation';
import { canonical } from './engine';

export interface ExtractionAttempt { task: string; prompt_version: string; model: string; response: string; error: string | null; timestamp: string }
export interface Draft {
  first_look?: import('../first-look').FirstLook;
  attachment_path?: string; source: PolicySource | null; candidate: Candidate | null; attempts: ExtractionAttempt[];
  activity: { at: string; action: string; item_ids: string[] }[];
  hypotheses: { statement: string; evidence_refs: string[]; assumption_refs: string[]; limitation: string }[];
}
export const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
export async function createProject(owner: string, title: string) {
  const [row] = await db.insert(policyLabProjects).values({ id: randomUUID(), owner, title, payload: { source: null, candidate: null, attempts: [], activity: [], hypotheses: [] } satisfies Draft }).returning();
  return row;
}
export async function listProjects(owner: string) {
  const rows = await db.select({ id: policyLabProjects.id, title: policyLabProjects.title, revision: policyLabProjects.revision, updatedAt: policyLabProjects.updatedAt, payload: policyLabProjects.payload }).from(policyLabProjects).where(eq(policyLabProjects.owner, owner)).orderBy(desc(policyLabProjects.updatedAt));
  return rows.map(({ payload, ...row }) => {
    const draft = payload as Draft;
    const items = draft.candidate ? reviewItems(draft.candidate.game) : [];
    return { ...row, source_title: draft.source?.title ?? null, synthetic: draft.source?.synthetic ?? false,
      model_status: !draft.source ? 'Awaiting source' : !draft.candidate ? 'Awaiting candidate model' : `${items.filter(i => i.approval_status.status === 'approved').length}/${items.length} items approved` };
  });
}
export async function getProject(owner: string, id: string) {
  const [row] = await db.select().from(policyLabProjects).where(and(eq(policyLabProjects.id, id), eq(policyLabProjects.owner, owner)));
  if (!row) throw new Error('Project not found');
  return { ...row, payload: row.payload as Draft };
}
export async function saveDraft(owner: string, id: string, revision: number, payload: Draft) {
  const [row] = await db.update(policyLabProjects).set({ payload, revision: revision + 1, updatedAt: new Date() }).where(and(eq(policyLabProjects.id, id), eq(policyLabProjects.owner, owner), eq(policyLabProjects.revision, revision))).returning();
  if (!row) throw new Error('Revision conflict; reload before editing');
  return { ...row, payload: row.payload as Draft };
}
export async function versions(owner: string, projectId: string) {
  await getProject(owner, projectId);
  return db.select().from(policyLabVersions).where(eq(policyLabVersions.projectId, projectId)).orderBy(desc(policyLabVersions.version));
}
export async function runs(owner: string, projectId: string) {
  await getProject(owner, projectId);
  return db.select().from(policyLabRuns).where(eq(policyLabRuns.projectId, projectId)).orderBy(desc(policyLabRuns.createdAt));
}
export async function sealVersion(owner: string, id: string, revision: number) {
  return db.transaction(async tx => {
    const [project] = await tx.select().from(policyLabProjects).where(and(eq(policyLabProjects.id, id), eq(policyLabProjects.owner, owner))).for('update');
    if (!project || project.revision !== revision) throw new Error('Revision conflict; reload before sealing');
    const payload = project.payload as Draft;
    if (!payload.source || !payload.candidate) throw new Error('Source and model required');
    const errors = validateModel(payload.candidate.game, payload.candidate.evidence, payload.source);
    if (errors.length) throw new Error(errors.join('\n'));
    const prior = await tx.select().from(policyLabVersions).where(eq(policyLabVersions.projectId, id)).orderBy(desc(policyLabVersions.version)).limit(1);
    const version = (prior[0]?.version ?? 0) + 1;
    const snapshot = structuredClone(payload);
    snapshot.candidate!.game.version = version;
    snapshot.candidate!.game.approval_status = { status: 'approved', approved_by: owner, approved_at: new Date().toISOString() };
    const modelHash = hash(snapshot);
    const [row] = await tx.insert(policyLabVersions).values({ id: randomUUID(), projectId: id, version, modelHash, payload: snapshot }).returning();
    await tx.update(policyLabProjects).set({ revision: revision + 1, updatedAt: new Date() }).where(eq(policyLabProjects.id, id));
    return row;
  });
}
export async function loadVersion(owner: string, projectId: string, versionId: string) {
  await getProject(owner, projectId);
  const [row] = await db.select().from(policyLabVersions).where(and(eq(policyLabVersions.id, versionId), eq(policyLabVersions.projectId, projectId)));
  if (!row) throw new Error('Model version not found');
  return { ...row, payload: row.payload as Draft };
}
export async function saveRun(projectId: string, versionId: string, engineVersion: string, payload: unknown) {
  const [row] = await db.insert(policyLabRuns).values({ id: randomUUID(), projectId, versionId, engineVersion, payload }).returning();
  return row;
}
