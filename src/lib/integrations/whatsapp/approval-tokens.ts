/**
 * D2 — Approval-via-WhatsApp: one-time approval codes.
 *
 * Pure, dependency-light helpers for the WhatsApp approval flow: generating a
 * short unambiguous code, parsing an owner's `APPROVE <code>` / `DENY <code>`
 * reply (with `YES`/`NO` aliases), and checking a token's 24h expiry. Kept free
 * of DB / WhatsApp-service imports so they can be unit-tested in isolation; the
 * stateful glue lives in `approval-notify.ts`.
 */

import { randomInt } from 'node:crypto';

/**
 * Unambiguous code alphabet: uppercase letters + digits, minus the visually
 * confusable characters (I/1, O/0, and the ambiguous-when-handwritten Z/2 pair
 * is kept but 0/O and 1/I/L are the real offenders). We drop I, O, 0, 1, and L
 * so a code read off a phone screen can't be mistyped into a different valid
 * code. 31 symbols → 31^6 ≈ 8.9e8 combinations, ample for concurrent approvals.
 */
export const APPROVAL_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const APPROVAL_CODE_LENGTH = 6;

/** How long an issued approval code stays valid (24 hours). */
export const APPROVAL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** The verdict an inbound reply carries. Matches the approval node's handles. */
export type ApprovalVerdict = 'approved' | 'rejected';

export interface ParsedApprovalReply {
  verdict: ApprovalVerdict;
  /** The 6-char code, upper-cased. */
  code: string;
}

/**
 * Generate a cryptographically-random 6-char approval code from the unambiguous
 * alphabet. `randomInt` gives an unbiased index (rejection-sampled internally).
 */
export function generateApprovalCode(): string {
  let code = '';
  for (let i = 0; i < APPROVAL_CODE_LENGTH; i++) {
    code += APPROVAL_CODE_ALPHABET[randomInt(APPROVAL_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Matches an owner's approval reply. Accepts the verbs approve/deny plus the
 * yes/no aliases, case-insensitive, tolerant of surrounding whitespace, followed
 * by exactly one 6-char alphanumeric code. `approve`/`yes` → approved;
 * `deny`/`no` → rejected. Returns null for anything that isn't an approval reply
 * (those messages fall through to normal chat).
 */
const APPROVAL_REPLY_RE = /^\s*(approve|deny|yes|no)\s+([A-Za-z0-9]{6})\s*$/i;

export function parseApprovalReply(text: string | null | undefined): ParsedApprovalReply | null {
  if (!text) return null;
  const m = APPROVAL_REPLY_RE.exec(text);
  if (!m) return null;
  const verb = m[1].toLowerCase();
  const verdict: ApprovalVerdict = verb === 'approve' || verb === 'yes' ? 'approved' : 'rejected';
  return { verdict, code: m[2].toUpperCase() };
}

/**
 * Whether an approval token has passed its expiry. Accepts an ISO string or
 * Date; a missing/invalid value is treated as expired (fail-closed).
 */
export function isApprovalTokenExpired(
  expiresAt: string | Date | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!expiresAt) return true;
  const ts = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  if (Number.isNaN(ts)) return true;
  return ts <= now;
}
