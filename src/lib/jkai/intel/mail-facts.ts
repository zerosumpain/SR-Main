// Everything a rule is allowed to know about an email.
//
// The safety story of the learning half rests on one decision, copied wholesale
// from the daydream rules engine ($lib/daydream/rules/spec.ts): **a proposed
// rule is DATA, never code.** Rules are a closed expression tree over the
// allow-list below, interpreted by ./mail-rules/evaluate. There is no `eval`,
// no `new Function`, no property access by string, and no way to name anything
// that is not on this list. A confused or malicious proposal can produce a
// USELESS rule; it cannot produce a dangerous one.
//
// The facts are deliberately SCALAR, and deliberately derived from what is
// already STORED on the note. Both constraints earn their keep:
//
//   - Scalar, so a rule cannot walk an object graph and cannot reach a body, an
//     address book or a document. The worst a leaked rule can say is "bulk mail
//     from example.com, older than 30 days".
//   - Stored, so a backtest can replay a proposed rule across all 2,781 notes
//     without a single Gmail round trip. A rule that could only be evaluated
//     live is a rule that cannot be checked before it is trusted, and checking
//     it before trusting it is the entire point.
//
// PURE — no DB, no clock passed implicitly, no network. `now` is an argument.

export const MAIL_FACT_KEYS = [
  // ── Who sent it ──
  /** Sender domain, lowercased, e.g. `linkedin.com`. */
  'senderDomain',
  /** 'correspondence' | 'notification' | 'bulk', from the address-shape
   *  classifier plus the owner's domain rules. */
  'emailKind',
  /** Distinct human participants on the thread (robots already filtered out). */
  'participantCount',

  // ── What shape the conversation is ──
  /** Messages in the thread. */
  'messageCount',
  /** The owner sent at least one message. The single strongest signal there is
   *  that a thread is a conversation rather than a broadcast — you replied. */
  'ownerReplied',
  /** More than one distinct human sender. A newsletter is never two-way. */
  'twoWay',

  // ── What Google thinks ──
  /** Gmail marked a message in this thread IMPORTANT. Trained on years of what
   *  this mailbox actually reads and replies to; no heuristic here beats it. */
  'gmailImportant',

  // ── What is in it ──
  'hasAttachments',
  /** Characters of thread text. A two-line "thanks" is not intelligence. */
  'bodyChars',
  /** Days since the thread's own receipt time — the observation clock, never
   *  the sweep's. */
  'ageDays',
] as const;

export type MailFactKey = (typeof MAIL_FACT_KEYS)[number];

export function isMailFactKey(v: unknown): v is MailFactKey {
  return typeof v === 'string' && (MAIL_FACT_KEYS as readonly string[]).includes(v);
}

/** Facts whose value is a string. Comparing these with `gt` is meaningless and
 *  is REFUSED rather than coerced — a validator that coerces instead of
 *  refusing hides the mistake until it matters. */
export const STRING_MAIL_FACTS: ReadonlySet<MailFactKey> = new Set(['senderDomain', 'emailKind']);

export const BOOLEAN_MAIL_FACTS: ReadonlySet<MailFactKey> = new Set([
  'ownerReplied',
  'twoWay',
  'gmailImportant',
  'hasAttachments',
]);

export type MailFacts = {
  senderDomain: string;
  emailKind: string;
  participantCount: number;
  messageCount: number;
  ownerReplied: boolean;
  twoWay: boolean;
  gmailImportant: boolean;
  hasAttachments: boolean;
  bodyChars: number;
  ageDays: number;
};

/** The stored shape a note has to offer. Declared minimally so this module can
 *  be tested with a literal and never drags the schema into a unit test. */
export interface NoteForFacts {
  title: string | null;
  rawContent: string | null;
  metadata: Record<string, unknown> | null;
  observedAt: Date | string | null;
  createdAt: Date | string | null;
}

/** `Messages: 4 (2026-08-01 → 2026-08-03)` — the count the note text opens with. */
export function messageCountOf(body: string): number {
  const m = /^Messages:\s*(\d+)/m.exec(body ?? '');
  const n = m ? Number(m[1]) : NaN;
  if (Number.isFinite(n) && n > 0) return n;
  // Fall back to counting the per-message blocks the note writes as `[1] …`.
  const blocks = (body ?? '').match(/^\[\d+\]\s/gm);
  return blocks?.length ?? (body?.trim() ? 1 : 0);
}

/** Every address that appears as a message SENDER in the note text. */
export function sendersIn(body: string): string[] {
  const out = new Set<string>();
  // `[1] 2026-08-01 · from Jane Doe <jane@x.com> · to …`
  const re = /^\[\d+\][^\n]*?\bfrom\s+[^<\n]*<([^<>\s]+@[^<>\s]+)>/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body ?? '')) !== null) out.add(m[1].toLowerCase());
  // Some senders have no display name, so `formatAddress` prints the bare
  // address with no angle brackets. Without this branch a whole class of
  // threads reports zero senders and `ownerReplied` is false for all of them.
  const bare = /^\[\d+\][^\n]*?\bfrom\s+([^\s<>·]+@[^\s<>·]+)/gim;
  while ((m = bare.exec(body ?? '')) !== null) out.add(m[1].toLowerCase());
  return [...out];
}

/** Normalised subject, for grouping a mailbox by conversation family.
 *
 *  Strips reply/forward prefixes, digits, dates and bracketed tags — the parts
 *  that differ between "Your order #204-3656 has shipped" and "Your order
 *  #887-1120 has shipped", which are one family and two hundred emails. */
export function subjectFamily(subject: string | null | undefined): string {
  return (subject ?? '')
    .replace(/^(\s*(re|fwd?|aw|tr|antw)\s*:\s*)+/i, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\b[\w.+-]+@[\w.-]+\b/g, ' ')
    .replace(/\b\d[\d.,/-]*\b/g, ' ')
    .replace(/[^\p{L}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .split(' ')
    .slice(0, 6)
    .join(' ');
}

/**
 * Derive every fact from a stored note.
 *
 * `now` is passed in rather than read, so a backtest replaying August against
 * a rule proposed in September gets August's `ageDays` and not today's — a
 * backtest that silently used the wall clock would score every historic thread
 * as ancient and pass any rule with an age condition.
 */
export function factsFor(note: NoteForFacts, now: number): MailFacts {
  const meta = note.metadata ?? {};
  const body = note.rawContent ?? '';
  const owner = String(meta.gmailAccount ?? '').toLowerCase();
  const participants = Array.isArray(meta.participants)
    ? meta.participants.map((p) => String(p).toLowerCase())
    : [];

  const senders = sendersIn(body);
  const humanSenders = senders.filter((s) => s !== owner);

  const observed = note.observedAt ?? note.createdAt;
  const observedMs = observed ? new Date(observed).getTime() : NaN;
  const ageDays = Number.isFinite(observedMs)
    ? Math.max(0, Math.round((now - observedMs) / 86_400_000))
    : 9999;

  return {
    senderDomain: String(meta.senderDomain ?? '').toLowerCase(),
    emailKind: String(meta.emailKind ?? 'correspondence'),
    participantCount: participants.length,
    messageCount: messageCountOf(body),
    ownerReplied: !!owner && senders.includes(owner),
    // Two distinct HUMAN senders, not two participants: a mailshot to fifty
    // people has fifty participants and one sender, and calling that two-way
    // would admit every newsletter in the mailbox.
    twoWay: humanSenders.length > 1 || (humanSenders.length >= 1 && !!owner && senders.includes(owner)),
    gmailImportant: meta.important === true,
    // `attachmentCount` first: a gated sweep never downloads an attachment, so
    // a held note has no `--- filename ---` block in its text and reading the
    // text alone would report every held thread as having no documents. The
    // text marker is the fallback for notes written before the count existed.
    hasAttachments:
      typeof meta.attachmentCount === 'number'
        ? meta.attachmentCount > 0
        : /^---\s.+\s---$/m.test(body),
    bodyChars: body.length,
    ageDays,
  };
}
