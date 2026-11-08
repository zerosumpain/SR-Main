// "msg family" — storage and pushes. The rules are in ./messages (PURE); this
// file reads and writes `family_message` and pushes everybody else's phone.

import { and, count, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
import { db } from '$lib/db';
import { familyMessage } from '$lib/db/schema';
import { getOwnerEmails, isOwnerEmail } from '$lib/server/access';
import { pushToEmails } from '$lib/server/push-devices';
import { alarmRecipients, samePerson } from './alarm';
import { familyPersonFor, familyRoster } from './roster.server';
import { listMembers } from '$lib/home/presence/members';
import {
  BODY_MAX,
  LIST_DAYS,
  LIST_LIMIT,
  messagePush,
  replyPush,
  SEND_LIMIT,
  SEND_WINDOW_MS,
  type MessageRecord,
  type SubjectOf,
} from './messages';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Each sender's household subject, for the circle the phone draws beside a
 * message: the household row whose email is theirs (any of the owner's
 * addresses for the owner). A failed read is no subjects — plain circles.
 */
export async function senderSubjects(): Promise<SubjectOf> {
  const rows = (await listMembers().catch(() => [])).filter((m) => m.email);
  return (email) => rows.find((m) => samePerson(m.email as string, email, isOwnerEmail))?.subject ?? null;
}

/** The newest LIST_LIMIT messages of the last LIST_DAYS days, and their replies. */
export async function recentMessages(now = new Date()): Promise<MessageRecord[]> {
  const since = new Date(now.getTime() - LIST_DAYS * 86_400_000);
  const messages = await db
    .select()
    .from(familyMessage)
    .where(and(isNull(familyMessage.replyTo), gte(familyMessage.createdAt, since)))
    .orderBy(desc(familyMessage.createdAt))
    .limit(LIST_LIMIT);
  if (!messages.length) return [];
  const replies = await db
    .select()
    .from(familyMessage)
    .where(inArray(familyMessage.replyTo, messages.map((m) => m.id)));
  return [...messages, ...replies];
}

export async function getMessage(id: string): Promise<MessageRecord | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db.select().from(familyMessage).where(eq(familyMessage.id, id)).limit(1);
  return row ?? null;
}

export type SendResult =
  | { kind: 'sent'; message: MessageRecord; pushed: number; recipients: number }
  | { kind: 'limited'; retryAfterSeconds: number };

/**
 * Store a message from `email` and push it to every other family member. The
 * row is written first: the list is the floor a phone that cannot be pushed
 * reads, and it must exist even when Apple is unreachable.
 */
export async function sendMessage(
  email: string,
  parent: boolean,
  body: string,
  now = new Date(),
  push = pushToEmails,
): Promise<SendResult> {
  const sender = email.trim().toLowerCase();
  const senderEmails = isOwnerEmail(sender) ? getOwnerEmails().map((e) => e.trim().toLowerCase()) : [sender];
  const [recent] = await db
    .select({ n: count() })
    .from(familyMessage)
    .where(
      and(
        inArray(familyMessage.fromEmail, senderEmails),
        isNull(familyMessage.replyTo),
        gte(familyMessage.createdAt, new Date(now.getTime() - SEND_WINDOW_MS)),
      ),
    );
  if ((recent?.n ?? 0) >= SEND_LIMIT) return { kind: 'limited', retryAfterSeconds: Math.ceil(SEND_WINDOW_MS / 1000) };

  const roster = await familyRoster(now.getTime());
  const person = await familyPersonFor(sender, parent, roster);
  const { emails, people } = alarmRecipients(sender, roster.map((p) => p.email), getOwnerEmails(), isOwnerEmail);
  const [message] = await db
    .insert(familyMessage)
    .values({ fromEmail: sender, fromName: person.name, body, recipientCount: people, createdAt: now })
    .returning();

  const pushed = await pushAndRecord(message, emails, messagePush(message), push);
  return { kind: 'sent', message: { ...message, pushedCount: pushed }, pushed, recipients: people };
}

/**
 * Store a message WITHOUT pushing it: the family's record of something that
 * was already pushed another way (a Bat phone alarm). `recipients` and
 * `pushed` are that push's, so the list reads as it was delivered. Not
 * rate-limited — the push it records was.
 */
export async function recordMessage(
  email: string,
  fromName: string,
  body: string,
  counts: { recipients: number; pushed: number },
  now = new Date(),
): Promise<MessageRecord> {
  const [message] = await db
    .insert(familyMessage)
    .values({
      fromEmail: email.trim().toLowerCase(),
      fromName,
      body: body.slice(0, BODY_MAX),
      recipientCount: counts.recipients,
      pushedCount: counts.pushed,
      createdAt: now,
    })
    .returning();
  return message;
}

/** Store a reply to `message` and push it to the message's sender (not to themselves). */
export async function replyToMessage(
  message: MessageRecord,
  email: string,
  parent: boolean,
  body: string,
  now = new Date(),
  push = pushToEmails,
): Promise<{ reply: MessageRecord; pushed: number }> {
  const sender = email.trim().toLowerCase();
  const person = await familyPersonFor(sender, parent);
  const [reply] = await db
    .insert(familyMessage)
    .values({ fromEmail: sender, fromName: person.name, body, replyTo: message.id, createdAt: now })
    .returning();
  if (samePerson(message.fromEmail, sender, isOwnerEmail)) return { reply, pushed: 0 };
  const to = isOwnerEmail(message.fromEmail) ? getOwnerEmails() : [message.fromEmail];
  const pushed = await pushAndRecord(reply, to, replyPush(reply, message), push);
  return { reply: { ...reply, pushedCount: pushed }, pushed };
}

async function pushAndRecord(
  row: MessageRecord,
  emails: readonly string[],
  message: Parameters<typeof pushToEmails>[1],
  push: typeof pushToEmails,
): Promise<number> {
  try {
    const outcome = await push(emails, message);
    await db.update(familyMessage).set({ pushedCount: outcome.sent }).where(eq(familyMessage.id, row.id));
    return outcome.sent;
  } catch (error) {
    console.error(`[family] message ${row.id}: push failed`, (error as Error).message);
    return 0;
  }
}

export type DeleteOutcome = 'deleted' | 'gone' | 'not-yours';

/**
 * Take back a message or a reply — its sender only, as the list's `mine`
 * says. A message goes with every reply under it; a reply goes alone. A push
 * already delivered stays on the phones it reached: Apple has no recall.
 */
export async function deleteMessage(id: string, email: string): Promise<DeleteOutcome> {
  const message = await getMessage(id);
  if (!message) return 'gone';
  if (!samePerson(message.fromEmail, email, isOwnerEmail)) return 'not-yours';
  await db.transaction(async (tx) => {
    if (!message.replyTo) await tx.delete(familyMessage).where(eq(familyMessage.replyTo, message.id));
    await tx.delete(familyMessage).where(eq(familyMessage.id, message.id));
  });
  return 'deleted';
}
