import { and, desc, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { orchestratorChats } from '$lib/db/schema';
import type { WorkflowVerification } from './test-runs.server';

/**
 * Whether a canvas is being built from a description, and how the last build
 * ended — durable, so a phone that asks after a restart gets an answer.
 *
 * Kept in the canvas's own chat (`orchestrator_chats`) rather than a new column
 * or table: that is where the generator already writes what it did and where
 * it parks its unfinished draft (`metadata.draftState`), so the web canvas
 * shows the same "Building…" / "Build failed" lines in its chat panel for
 * free. The marker is `metadata.nativeBuild`; the newest row carrying one wins.
 *
 * A build runs in-process. A deploy mid-build would leave `building` true for
 * ever, so a marker older than `BUILD_STALE_MS` reads as a failure instead.
 * `needs_input` (the generator asked a question) waits for the owner, never goes stale.
 */

export type BuildStatus = 'building' | 'done' | 'failed' | 'needs_input';

export interface BuildState {
  building: boolean;
  buildError: string | null;
  /** What jkai asked before it could build — null unless the status is `needs_input`. */
  question: string | null;
  /** The finished build's lint + test-run proof, when it got that far. */
  verification?: WorkflowVerification | null;
}

export const BUILD_STALE_MS = 20 * 60 * 1000;

export const STALE_BUILD_ERROR =
  'The build stopped before it finished. Describe it again, or add the steps by hand.';

export const NO_BUILD: BuildState = { building: false, buildError: null, question: null };

export function buildStateFrom(
  marker: { status?: unknown; error?: unknown; verification?: unknown; question?: unknown } | null | undefined,
  createdAt: Date,
  now = Date.now(),
): BuildState {
  if (!marker) return NO_BUILD;
  if (marker.status === 'building') {
    return now - createdAt.getTime() > BUILD_STALE_MS
      ? { ...NO_BUILD, buildError: STALE_BUILD_ERROR }
      : { ...NO_BUILD, building: true };
  }
  if (marker.status === 'needs_input') return { ...NO_BUILD, question: typeof marker.question === 'string' ? marker.question : 'jkai has a question.' };
  const verification = (marker.verification as WorkflowVerification | undefined) ?? null;
  if (marker.status === 'failed') {
    return {
      ...NO_BUILD,
      buildError: typeof marker.error === 'string' && marker.error ? marker.error : 'The build failed.',
      ...(verification ? { verification } : {}),
    };
  }
  return verification ? { ...NO_BUILD, verification } : NO_BUILD;
}

type Marker = { status?: unknown; error?: unknown; verification?: unknown; question?: unknown; resume?: BuildResumeInfo };

/** The newest marker row per workflow. */
async function latestMarkers(workflowIds: string[]) {
  return db
    .selectDistinctOn([orchestratorChats.workflowId], {
      workflowId: orchestratorChats.workflowId,
      metadata: orchestratorChats.metadata,
      createdAt: orchestratorChats.createdAt,
    })
    .from(orchestratorChats)
    .where(
      and(
        inArray(orchestratorChats.workflowId, workflowIds),
        sql`${orchestratorChats.metadata} -> 'nativeBuild' IS NOT NULL`,
      ),
    )
    .orderBy(orchestratorChats.workflowId, desc(orchestratorChats.createdAt));
}

/** Build state for many workflows in one query. Absent → not built from a description. */
export async function readBuildStates(workflowIds: string[]): Promise<Map<string, BuildState>> {
  const out = new Map<string, BuildState>();
  if (workflowIds.length === 0) return out;
  const now = Date.now();
  for (const r of await latestMarkers(workflowIds)) {
    if (r.workflowId) out.set(r.workflowId, buildStateFrom((r.metadata as { nativeBuild?: Marker } | null)?.nativeBuild, r.createdAt, now));
  }
  return out;
}

/** The open question and what to rebuild from, when the newest marker is `needs_input`. */
export async function readPendingQuestion(workflowId: string): Promise<{ question: string; resume: BuildResumeInfo } | null> {
  const [r] = await latestMarkers([workflowId]);
  const m = (r?.metadata as { nativeBuild?: Marker } | null)?.nativeBuild;
  if (m?.status !== 'needs_input' || typeof m.question !== 'string' || !m.resume?.prompt) return null;
  return { question: m.question, resume: { ...m.resume, qa: Array.isArray(m.resume.qa) ? m.resume.qa : [] } };
}

export async function readBuildState(workflowId: string): Promise<BuildState> {
  return (await readBuildStates([workflowId])).get(workflowId) ?? NO_BUILD;
}

export interface BuildQA { q: string; a: string }
/** What a build restarts from; `qa` is every question jkai asked and the owner's answer ('' = skipped). */
export interface BuildResumeInfo { prompt: string; title: string | null; attempt: number; qa?: BuildQA[] }

export interface BuildMarkerExtra { error?: string; verification?: WorkflowVerification; resume?: BuildResumeInfo; question?: string }

/** Append a marker row. `content` is what the canvas chat panel shows. */
export async function recordBuildState(workflowId: string, status: BuildStatus, content: string, extra: BuildMarkerExtra = {}): Promise<void> {
  await db.insert(orchestratorChats).values({ workflowId, role: 'assistant', content, metadata: { nativeBuild: { status, ...extra } } });
}

export const MAX_BUILD_ATTEMPTS = 2;
export const BUILD_RESUME_WINDOW_MS = 6 * 60 * 60 * 1000;

export interface InterruptedBuild extends BuildResumeInfo { workflowId: string }

/** A `building` marker written before this process booted is a build a deploy killed
 *  (2026-09-25 09:50:58). Older markers carry the prompt only quoted in the chat line. */
export function interruptedBuildFrom(
  row: { workflowId: string | null; content: string; metadata: unknown; createdAt: Date },
  bootedAt: number,
  now = Date.now(),
): InterruptedBuild | null {
  const marker = (row.metadata as { nativeBuild?: { status?: unknown; resume?: Partial<BuildResumeInfo> } } | null)
    ?.nativeBuild;
  if (!row.workflowId || marker?.status !== 'building') return null;
  const at = row.createdAt.getTime();
  if (at >= bootedAt || now - at > BUILD_RESUME_WINDOW_MS) return null;
  const quoted = /“([\s\S]+)”\s*$/.exec(row.content)?.[1];
  const prompt = (typeof marker.resume?.prompt === 'string' && marker.resume.prompt) || quoted || '';
  if (!prompt.trim()) return null;
  const attempt = typeof marker.resume?.attempt === 'number' ? marker.resume.attempt : 1;
  if (attempt >= MAX_BUILD_ATTEMPTS) return null;
  const title = typeof marker.resume?.title === 'string' ? marker.resume.title : null;
  return { workflowId: row.workflowId, prompt, title, attempt, qa: Array.isArray(marker.resume?.qa) ? marker.resume.qa : [] };
}

/** Every build the previous process left mid-flight, newest marker per canvas. */
export async function findInterruptedBuilds(bootedAt: number, now = Date.now()): Promise<InterruptedBuild[]> {
  const c = orchestratorChats;
  const rows = await db
    .selectDistinctOn([c.workflowId], { workflowId: c.workflowId, content: c.content, metadata: c.metadata, createdAt: c.createdAt })
    .from(c)
    .where(and(sql`${c.metadata} -> 'nativeBuild' IS NOT NULL`, sql`${c.createdAt} > ${new Date(now - BUILD_RESUME_WINDOW_MS)}`))
    .orderBy(c.workflowId, desc(c.createdAt));
  return rows.map((r) => interruptedBuildFrom(r, bootedAt, now)).filter((b): b is InterruptedBuild => b !== null);
}
