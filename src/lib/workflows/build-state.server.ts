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
 */

export type BuildStatus = 'building' | 'done' | 'failed';

export interface BuildState {
  building: boolean;
  buildError: string | null;
  /** The finished build's lint + test-run proof, when it got that far. */
  verification?: WorkflowVerification | null;
}

export const BUILD_STALE_MS = 20 * 60 * 1000;

export const STALE_BUILD_ERROR =
  'The build stopped before it finished. Describe it again, or add the steps by hand.';

export const NO_BUILD: BuildState = { building: false, buildError: null };

export function buildStateFrom(
  marker: { status?: unknown; error?: unknown; verification?: unknown } | null | undefined,
  createdAt: Date,
  now = Date.now(),
): BuildState {
  if (!marker) return NO_BUILD;
  if (marker.status === 'building') {
    return now - createdAt.getTime() > BUILD_STALE_MS
      ? { building: false, buildError: STALE_BUILD_ERROR }
      : { building: true, buildError: null };
  }
  const verification = (marker.verification as WorkflowVerification | undefined) ?? null;
  if (marker.status === 'failed') {
    return {
      building: false,
      buildError: typeof marker.error === 'string' && marker.error ? marker.error : 'The build failed.',
      ...(verification ? { verification } : {}),
    };
  }
  return verification ? { ...NO_BUILD, verification } : NO_BUILD;
}

/** Build state for many workflows in one query. Absent → not built from a description. */
export async function readBuildStates(workflowIds: string[]): Promise<Map<string, BuildState>> {
  const out = new Map<string, BuildState>();
  if (workflowIds.length === 0) return out;
  const rows = await db
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
  const now = Date.now();
  for (const r of rows) {
    if (!r.workflowId) continue;
    const marker = (r.metadata as { nativeBuild?: { status?: unknown; error?: unknown; verification?: unknown } } | null)?.nativeBuild;
    out.set(r.workflowId, buildStateFrom(marker, r.createdAt, now));
  }
  return out;
}

export async function readBuildState(workflowId: string): Promise<BuildState> {
  return (await readBuildStates([workflowId])).get(workflowId) ?? NO_BUILD;
}

export interface BuildResumeInfo { prompt: string; title: string | null; attempt: number }

/** Append a marker row. `content` is what the canvas chat panel shows. */
export async function recordBuildState(
  workflowId: string,
  status: BuildStatus,
  content: string,
  error?: string,
  verification?: WorkflowVerification,
  resume?: BuildResumeInfo,
): Promise<void> {
  await db.insert(orchestratorChats).values({
    workflowId,
    role: 'assistant',
    content,
    metadata: { nativeBuild: { status, ...(error ? { error } : {}), ...(verification ? { verification } : {}), ...(resume ? { resume } : {}) } },
  });
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
  return { workflowId: row.workflowId, prompt, title, attempt };
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
