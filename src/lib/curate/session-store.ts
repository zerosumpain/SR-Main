import { db } from '$lib/db';
import { curateSessions } from '$lib/db/schema';
import { eq, notInArray } from 'drizzle-orm';
import type { CurateSessionRow } from '$lib/db/schema';

const TERMINAL_STATUSES = ['promoted', 'aborted', 'ended'] as const;

interface CreateInput {
  id: string;
  targetType: string;
  goal?: string;
}

export async function createSession(input: CreateInput): Promise<void> {
  const now = new Date();
  await db
    .insert(curateSessions)
    .values({
      id: input.id,
      targetType: input.targetType,
      status: 'scoping',
      goal: input.goal ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: curateSessions.id });
}

export async function getSession(id: string): Promise<CurateSessionRow | null> {
  const rows = await db
    .select()
    .from(curateSessions)
    .where(eq(curateSessions.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listActiveSessions(): Promise<CurateSessionRow[]> {
  return db
    .select()
    .from(curateSessions)
    .where(notInArray(curateSessions.status, TERMINAL_STATUSES as unknown as string[]));
}

interface UpdateInput {
  status?: string;
  targetType?: string;
  goal?: string;
  proposal?: Record<string, unknown>;
  nodeSpec?: Record<string, unknown>;
  worktreePath?: string | null;
  branchName?: string | null;
  devServerPort?: number | null;
  devServerPid?: number | null;
  iterationLog?: unknown[];
  errorTrace?: string | null;
  endedAt?: Date | null;
  promotedAt?: Date | null;
}

export async function updateSession(id: string, patch: UpdateInput): Promise<void> {
  await db
    .update(curateSessions)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(curateSessions.id, id));
}

export async function markEnded(id: string): Promise<void> {
  await updateSession(id, { status: 'ended', endedAt: new Date() });
}
