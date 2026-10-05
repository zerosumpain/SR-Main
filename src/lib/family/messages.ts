// "msg family" — the pure half: reading what the phone sent, the list the phone
// shows and the exact push each phone receives. No database, no clock of its
// own. Storage and sending are ./messages.server.
//
// Anyone in the family writes a line in the iPhone app's chat ("msg family")
// and every OTHER family member's phone is pushed. They answer from the
// notification or the app with an emoji (REACTIONS) or a line of text; that
// reply is pushed to the message's sender only.

import type { PushMessage } from '$lib/server/apns';

export const MESSAGE_CATEGORY = 'family-msg';
export const REPLY_CATEGORY = 'family-msg-reply';
export const BODY_MAX = 500;
/** The quick replies, in the order the phone shows them. */
export const REACTIONS = ['👍', '👎', '❤️', '😂', '😮', '✅'] as const;
/** The list the phone reads: this many messages, none older than this. */
export const LIST_LIMIT = 50;
export const LIST_DAYS = 30;
/** At most this many messages per sender in SEND_WINDOW_MS. Replies are not counted. */
export const SEND_LIMIT = 5;
export const SEND_WINDOW_MS = 60_000;

/** A message or reply as stored (the columns of `family_message`, camel-cased). */
export interface MessageRecord {
  id: string;
  fromEmail: string;
  fromName: string;
  body: string;
  replyTo: string | null;
  recipientCount: number;
  pushedCount: number;
  createdAt: Date;
}

/** `{ body }` from the phone, trimmed; one of REACTIONS or up to BODY_MAX characters. */
export function parseBody(input: unknown): { body: string } | { error: string } {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>).body : undefined;
  if (typeof raw !== 'string') return { error: 'Write a message first.' };
  const body = raw.replace(/\s+$/u, '').replace(/^\s+/u, '');
  if (!body) return { error: 'Write a message first.' };
  if ([...body].length > BODY_MAX) return { error: `Keep it under ${BODY_MAX} characters.` };
  return { body };
}

export function isReaction(body: string): boolean {
  return (REACTIONS as readonly string[]).includes(body);
}

/** A line short enough for a notification's quote of the message. */
export function quote(body: string, max = 40): string {
  const chars = [...body.replace(/\s+/gu, ' ')];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

export interface ReplyView {
  id: string;
  fromId: string;
  fromName: string;
  mine: boolean;
  body: string;
  reaction: boolean;
  at: string;
}

export interface MessageView extends Omit<ReplyView, 'reaction'> {
  pushed: number;
  recipients: number;
  replies: ReplyView[];
}

/**
 * The list the phone shows, newest message first, each with its replies
 * oldest first. People are ids and names: no email leaves the server.
 */
export function messageViews(
  rows: readonly MessageRecord[],
  idOf: (email: string) => string,
  mine: (email: string) => boolean,
): MessageView[] {
  const replies = new Map<string, MessageRecord[]>();
  for (const r of rows) {
    if (!r.replyTo) continue;
    const list = replies.get(r.replyTo) ?? [];
    list.push(r);
    replies.set(r.replyTo, list);
  }
  const byTime = (a: MessageRecord, b: MessageRecord) => a.createdAt.getTime() - b.createdAt.getTime();
  return rows
    .filter((r) => !r.replyTo)
    .sort((a, b) => byTime(b, a))
    .map((m) => ({
      id: m.id,
      fromId: idOf(m.fromEmail),
      fromName: m.fromName,
      mine: mine(m.fromEmail),
      body: m.body,
      at: m.createdAt.toISOString(),
      pushed: m.pushedCount,
      recipients: m.recipientCount,
      replies: (replies.get(m.id) ?? []).sort(byTime).map((r) => replyView(r, idOf, mine)),
    }));
}

export function replyView(r: MessageRecord, idOf: (email: string) => string, mine: (email: string) => boolean): ReplyView {
  return {
    id: r.id,
    fromId: idOf(r.fromEmail),
    fromName: r.fromName,
    mine: mine(r.fromEmail),
    body: r.body,
    reaction: isReaction(r.body),
    at: r.createdAt.toISOString(),
  };
}

/** The push every other family member gets. The app gives it the reply buttons. */
export function messagePush(message: MessageRecord): PushMessage {
  return {
    title: `${message.fromName} · Family`,
    body: message.body,
    category: MESSAGE_CATEGORY,
    threadId: MESSAGE_CATEGORY,
    level: 'active',
    collapseId: `msg-${message.id}`,
    // A phone that is off for the evening still gets it in the morning.
    ttlSeconds: 86_400,
    userInfo: { category: MESSAGE_CATEGORY, messageId: message.id },
  };
}

/** The push the message's sender gets for each reply. */
export function replyPush(reply: MessageRecord, message: Pick<MessageRecord, 'id' | 'body'>): PushMessage {
  const reaction = isReaction(reply.body);
  return {
    title: reaction ? `${reply.fromName} ${reply.body}` : `${reply.fromName} replied`,
    body: reaction ? `to “${quote(message.body)}”` : reply.body,
    category: REPLY_CATEGORY,
    threadId: MESSAGE_CATEGORY,
    level: 'active',
    collapseId: `msg-reply-${reply.id}`,
    ttlSeconds: 86_400,
    userInfo: { category: REPLY_CATEGORY, messageId: message.id },
  };
}
