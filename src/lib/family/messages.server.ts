// "msg family" — storage and pushes. The rules are in ./messages (PURE); this
// file reads and writes `family_message` and pushes everybody else's phone.

import { and, count, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
import { db } from '$lib/db';
import { familyMessage } from '$lib/db/schema';
import { getOwnerEmails, isOwnerEmail } from '$lib/server/access';
import { pushToEmails } from '$lib/server/push-devices';
import { alarmRecipients, samePerson } from './alarm';
import { familyPersonFor, familyRoster } from './roster.server';
import {
  LIST_DAYS,
  LIST_LIMIT,
  messagePush,
  replyPush,
  SEND_LIMIT,
  SEND_WINDOW_MS,
  type MessageRecord,
} from './messages';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const person = await familyPersonFor(sender, parent);
  const roster = await familyRoster(now.getTime());
  const { emails, people } = alarmRecipients(sender, roster.map((p) => p.email), getOwnerEmails(), isOwnerEmail);
  const [message] = await db
    .insert(familyMessage)
    .values({ fromEmail: sender, fromName: person.name, body, recipientCount: people, createdAt: now })
    .returning();

  const pushed = await pushAndRecord(message, emails, messagePush(message), push);
  return { kind: 'sent', message: { ...message, pushedCount: pushed }, pushed, recipients: people };
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
