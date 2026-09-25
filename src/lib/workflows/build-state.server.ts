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

/** Append a marker row. `content` is what the canvas chat panel shows. */
export async function recordBuildState(
  workflowId: string,
  status: BuildStatus,
  content: string,
  error?: string,
  verification?: WorkflowVerification,
): Promise<void> {
  await db.insert(orchestratorChats).values({
    workflowId,
    role: 'assistant',
    content,
    metadata: { nativeBuild: { status, ...(error ? { error } : {}), ...(verification ? { verification } : {}) } },
  });
}
