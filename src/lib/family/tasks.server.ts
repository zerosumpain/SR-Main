// The family task list — storage and pushes. The rules are in ./tasks (PURE);
// this file reads and writes `family_task` and tells people what happened.
//
// Spec: docs/superpowers/specs/2026-09-28-family-steps-and-tasks.md

import { and, eq, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { familyTask } from '$lib/db/schema';
import { pushToEmails } from '$lib/server/push-devices';
import type { PushMessage } from '$lib/server/apns';
import { familyRoster, nameFromEmail } from './roster.server';
import {
  COMPLETED_DAYS,
  assignedText,
  confirmedText,
  doneText,
  sentBackText,
  type TaskFields,
  type TaskRecord,
  type Transition,
} from './tasks';

export const TASKS_URL = 'sr://family/tasks';
export const TASKS_CATEGORY = 'family-tasks';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every task a list could show: open and done, confirmed in the last 90 days,
 * and anything still owed however old. Never deleted ones.
 */
export async function loadTasks(now = new Date()): Promise<TaskRecord[]> {
  const since = new Date(now.getTime() - COMPLETED_DAYS * 86_400_000);
  return db
    .select()
    .from(familyTask)
    .where(
      or(
        inArray(familyTask.status, ['open', 'done']),
        and(eq(familyTask.status, 'confirmed'), gte(familyTask.confirmedAt, since)),
        and(eq(familyTask.status, 'confirmed'), sql`${familyTask.rewardKind} IS NOT NULL`, isNull(familyTask.rewardPaidAt)),
      ),
    );
}

/** A task by id, or null — also for a malformed id and for a deleted task. */
export async function getTask(id: string): Promise<TaskRecord | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db
    .select()
    .from(familyTask)
    .where(and(eq(familyTask.id, id), ne(familyTask.status, 'deleted')))
    .limit(1);
  return row ?? null;
}

export async function createTask(fields: TaskFields & { title: string }, createdByEmail: string): Promise<TaskRecord> {
  const [row] = await db
    .insert(familyTask)
    .values({ ...fields, createdByEmail, status: 'open' })
    .returning();
  return row;
}

/**
 * Apply a transition, but only if the row still holds the status it was read
 * in: two parents confirming at once get one confirm and one 409. Null = the
 * row moved underneath us.
 */
export async function applyTransition(id: string, t: Transition, now = new Date(), expectedUpdatedAt?: Date): Promise<TaskRecord | null> {
  const [row] = await db
    .update(familyTask)
    .set({ ...t.patch, updatedAt: now })
    .where(and(eq(familyTask.id, id), eq(familyTask.status, t.from), expectedUpdatedAt ? eq(familyTask.updatedAt, expectedUpdatedAt) : undefined))
    .returning();
  return row ?? null;
}

function taskPush(title: string, body: string, taskId: string): PushMessage {
  return {
    title,
    body,
    category: TASKS_CATEGORY,
    threadId: TASKS_CATEGORY,
    level: 'active',
    relevance: 0.6,
    collapseId: `task-${taskId}`,
    userInfo: { category: TASKS_CATEGORY, url: TASKS_URL, taskId },
  };
}

async function nameOf(email: string): Promise<string> {
  const p = (await familyRoster()).find((x) => x.email === email);
  return p?.name ?? nameFromEmail(email);
}

/**
 * Tell the people a change concerns. Fire-and-forget from the route: the
 * write has happened, and a push that fails loses nothing the list does not
 * show. Never throws.
 *
 * - assigned (by someone else) → the assignee
 * - done → every parent but the one who did it
 * - confirmed / sent back → whoever did it, unless they are the parent acting
 */
export async function notifyTaskChange(
  kind: 'assigned' | 'done' | 'confirmed' | 'sent_back',
  task: TaskRecord,
  actorEmail: string,
  opts: { doerEmail?: string | null; push?: typeof pushToEmails } = {},
): Promise<number> {
  const push = opts.push ?? pushToEmails;
  try {
    let to: string[] = [];
    let message: PushMessage | null = null;
    if (kind === 'assigned') {
      if (!task.assigneeEmail || task.assigneeEmail === actorEmail) return 0;
      to = [task.assigneeEmail];
      message = taskPush('New task', assignedText(await nameOf(actorEmail), task.title), task.id);
    } else if (kind === 'done') {
      to = (await familyRoster()).filter((p) => p.parent && p.email !== actorEmail).map((p) => p.email);
      message = taskPush('Task done', doneText(await nameOf(actorEmail), task.title), task.id);
    } else {
      const doer = opts.doerEmail ?? null;
      if (!doer || doer === actorEmail) return 0;
      to = [doer];
      message =
        kind === 'confirmed'
          ? taskPush('Task confirmed', confirmedText(task), task.id)
          : taskPush('Task sent back', sentBackText(task.title, task.sentBackNote ?? ''), task.id);
    }
    if (!to.length || !message) return 0;
    const outcome = await push(to, message);
    return outcome.reached.size;
  } catch (error) {
    console.error(`[family] task ${task.id}: ${kind} push failed`, (error as Error).message);
    return 0;
  }
}
