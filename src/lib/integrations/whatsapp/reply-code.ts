import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { FrozenCall } from '$lib/jkai/chat/turn';

/**
 * WhatsApp reply-code confirms (overhaul plan 2026-10-28, decision 2: "read
 * tools plus mutates confirmed with a reply code; no commissioning, no
 * destructive").
 *
 * A WhatsApp turn has nobody on a screen and no job to hold a waiter open, so
 * Core does not run a confirm-by-code tool: it freezes the exact call
 * (`FrozenCall`) and ends the turn. This module asks for it and answers it:
 *
 * 1. `issueReplyCode`, after the turn: a 4-digit code, valid five minutes,
 *    written into `jkai_gates` with the call, a hash of the call, a digest of
 *    the code bound to that gate and that hash, John's resolved NUMBER (never a
 *    LID) and the conversation. Any older open code for him is closed. The
 *    message gains "Reply 4831 within 5 minutes to confirm: …".
 * 2. `answerReplyCode`, on John's next message: a matching code runs that
 *    frozen call, once; ANYTHING else declines it (a wrong code, an expired
 *    one, or any other message, which then carries on to chat as usual).
 *
 * Fails closed throughout: a sender that is not John's number, a LID, a tool
 * no longer eligible, a call whose stored arguments no longer hash to what was
 * asked, or a code row someone else already claimed, runs nothing.
 *
 * The rules are pure and the store, conversation lookup and executor are
 * injected (`./reply-code.server.ts` wires the real ones), so every refusal is
 * unit-tested without a database or a WhatsApp socket.
 */

export const REPLY_CODE_TTL_MS = 5 * 60_000;
export const REPLY_CODE_LENGTH = 4;
/** `jkai_gates.kind` for a reply code. */
export const REPLY_CODE_KIND = 'reply_code';

/** What a reply-code gate row holds (`jkai_gates.payload`). */
export interface ReplyCodeRecord {
  gateKey: string;
  tool: string;
  args: Record<string, unknown>;
  /** `callHash(tool, args)` at the moment of asking. */
  callHash: string;
  /** `codeDigest(code, gateKey, callHash)`; the code itself is never stored. */
  codeDigest: string;
  /** John's number, digits only. */
  sender: string;
  conversationId: string;
  /** ISO time. */
  expiresAt: string;
  prompt: string;
}

export interface ReplyCodeStore {
  /** Write an open gate. */
  open(record: ReplyCodeRecord): Promise<void>;
  /** The newest open reply-code gate for this sender, or null. */
  latestOpen(sender: string): Promise<ReplyCodeRecord | null>;
  /** Close one open gate; true only for the caller that closed it (the claim). */
  close(gateKey: string, answer: Record<string, unknown>): Promise<boolean>;
  /** Close every open gate for this sender (a newer code supersedes them). */
  closeAllFor(sender: string, answer: Record<string, unknown>): Promise<void>;
}

export interface ReplyCodeDeps {
  store: ReplyCodeStore;
  /** Whether `from` is John's own number. */
  isOwner(from: string): boolean;
  /** Whether this call may be confirmed by code now (list, and its per-call tier). */
  eligible(tool: string, args: Record<string, unknown>): Promise<boolean>;
  now?: () => number;
}

/** Digits only. */
const digits = (s: string): string => (s ?? '').replace(/\D+/g, '');

/**
 * John's number from a sender, or null. A JID or a LID (anything with an `@`)
 * is refused: the bridge resolves a LID to its number before this is reached,
 * and one that arrives unresolved cannot be said to be his.
 */
export function ownerSender(from: string, isOwner: (from: string) => boolean): string | null {
  if (!from || from.includes('@') || !isOwner(from)) return null;
  const n = digits(from);
  return n.length >= 7 ? n : null;
}

/** Stable JSON: object keys sorted at every depth, so equal calls hash equal. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export function callHash(tool: string, args: Record<string, unknown>): string {
  return createHash('sha256').update(`${tool}\n${canonical(args)}`).digest('hex');
}

export function codeDigest(code: string, gateKey: string, hash: string): string {
  return createHash('sha256').update(`${gateKey}\n${hash}\n${code}`).digest('hex');
}

export function generateReplyCode(): string {
  return String(randomInt(0, 10 ** REPLY_CODE_LENGTH)).padStart(REPLY_CODE_LENGTH, '0');
}

/** A message that is only a code ("4831", " 4831. "), or null. */
export function parseReplyCode(text: string | null | undefined): string | null {
  const m = /^\s*(\d{4})\s*[.!]?\s*$/.exec(text ?? '');
  return m ? m[1] : null;
}

/** The line added under jkai's reply. */
export function askText(code: string, prompt: string): string {
  return `Reply ${code} within 5 minutes to confirm:\n${prompt}\nAnything else cancels it.`;
}

export type ReplyVerdict =
  | { kind: 'run' }
  | { kind: 'decline'; reason: 'not-a-code' | 'wrong-code' | 'expired' | 'changed' | 'not-eligible' | 'wrong-conversation' };

/**
 * What one owner message means for the open gate. PURE. The sender was already
 * matched by the store lookup (`latestOpen(sender)`); this checks it again.
 */
export function judgeReply(
  rec: ReplyCodeRecord,
  input: { sender: string; conversationId: string | null; text: string; now: number; eligible: boolean },
): ReplyVerdict | { kind: 'ignore' } {
  if (input.sender !== rec.sender) return { kind: 'ignore' };
  const code = parseReplyCode(input.text);
  if (!code) return { kind: 'decline', reason: 'not-a-code' };
  const expires = Date.parse(rec.expiresAt);
  if (!Number.isFinite(expires) || expires <= input.now) return { kind: 'decline', reason: 'expired' };
  // The arguments as stored must still be the call that was asked about, and
  // the code must be the one issued for exactly that gate and that call.
  const hash = callHash(rec.tool, rec.args);
  if (hash !== rec.callHash) return { kind: 'decline', reason: 'changed' };
  if (codeDigest(code, rec.gateKey, hash) !== rec.codeDigest) return { kind: 'decline', reason: 'wrong-code' };
  if (!input.conversationId || input.conversationId !== rec.conversationId) return { kind: 'decline', reason: 'wrong-conversation' };
  if (!input.eligible) return { kind: 'decline', reason: 'not-eligible' };
  return { kind: 'run' };
}

const DECLINE_REPLY: Record<Exclude<Extract<ReplyVerdict, { kind: 'decline' }>['reason'], 'not-a-code'>, string> = {
  'wrong-code': "That code doesn't match, so I haven't done it. Ask me again if you still want it.",
  expired: "That code has expired, so I haven't done it. Ask me again if you still want it.",
  changed: "That request changed after I asked, so I haven't done it. Ask me again.",
  'not-eligible': "That can't be confirmed from WhatsApp any more, so I haven't done it. It can be done from /jkai.",
  'wrong-conversation': "That code belongs to another conversation, so I haven't done it.",
};

/**
 * After a WhatsApp turn: ask John to confirm the call Core froze. Returns the
 * text to add under the reply. Never throws; a code that cannot be issued says
 * so and nothing waits.
 */
export async function issueReplyCode(
  input: { from: string; conversationId: string; call: FrozenCall },
  deps: ReplyCodeDeps,
): Promise<string> {
  const notDone = `I couldn't ask you to confirm that here, so I haven't done it. It can be done from /jkai.`;
  try {
    const sender = ownerSender(input.from, deps.isOwner);
    if (!sender || !(await deps.eligible(input.call.tool, input.call.args))) return notDone;
    const now = deps.now?.() ?? Date.now();
    const gateKey = `${REPLY_CODE_KIND}:${randomUUID()}`;
    const code = generateReplyCode();
    const hash = callHash(input.call.tool, input.call.args);
    await deps.store.closeAllFor(sender, { decision: 'declined', reason: 'superseded' });
    await deps.store.open({
      gateKey,
      tool: input.call.tool,
      args: input.call.args,
      callHash: hash,
      codeDigest: codeDigest(code, gateKey, hash),
      sender,
      conversationId: input.conversationId,
      expiresAt: new Date(now + REPLY_CODE_TTL_MS).toISOString(),
      prompt: input.call.prompt,
    });
    return askText(code, input.call.prompt);
  } catch (err) {
    console.error('[whatsapp-reply-code] issue failed:', err instanceof Error ? err.message : err);
    return notDone;
  }
}

export interface ReplyCodeAnswer {
  /** True: the message was a code for an open gate and is consumed here. */
  handled: boolean;
  reply?: string;
  /** What ran, for the thread rows and tests. */
  ran?: { tool: string; success: boolean };
}

/**
 * On an owner message: run the open gate's call if this is its code, decline
 * it otherwise. A non-code message declines silently and is NOT handled, so it
 * carries on to chat; a code-shaped message is handled whatever the outcome.
 */
export async function answerReplyCode(
  input: { from: string; text: string; conversationId: string | null },
  deps: ReplyCodeDeps & { execute(tool: string, args: Record<string, unknown>): Promise<{ success: boolean; error?: string }> },
): Promise<ReplyCodeAnswer> {
  const sender = ownerSender(input.from, deps.isOwner);
  if (!sender) return { handled: false };
  const rec = await deps.store.latestOpen(sender);
  if (!rec) return { handled: false };
  const now = deps.now?.() ?? Date.now();
  const verdict = judgeReply(rec, {
    sender,
    conversationId: input.conversationId,
    text: input.text,
    now,
    eligible: await deps.eligible(rec.tool, rec.args),
  });
  if (verdict.kind === 'ignore') return { handled: false };
  if (verdict.kind === 'decline') {
    await deps.store.close(rec.gateKey, { decision: 'declined', reason: verdict.reason });
    if (verdict.reason === 'not-a-code') return { handled: false };
    return { handled: true, reply: DECLINE_REPLY[verdict.reason] };
  }
  // The claim: of two deliveries of the same reply, only one runs it.
  if (!(await deps.store.close(rec.gateKey, { decision: 'approved' }))) {
    return { handled: true, reply: 'That code was already used.' };
  }
  const result = await deps.execute(rec.tool, rec.args).catch((err: unknown) => ({
    success: false,
    error: err instanceof Error ? err.message : String(err),
  }));
  const what = rec.prompt.replace(/\?\s*$/, '').split('\n')[0].replace(/^Proceed with /, '');
  return result.success
    ? { handled: true, reply: `Done: ${what}.`, ran: { tool: rec.tool, success: true } }
    : { handled: true, reply: `I tried, and it didn't work: ${(result.error ?? 'no reason given').slice(0, 300)}`, ran: { tool: rec.tool, success: false } };
}
