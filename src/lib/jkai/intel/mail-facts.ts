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

import { classifyEmail } from './email-kind';

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

  // ── What it has to do with the graph you already have ──
  // Written by ./mail-relevance, which scores every held thread against the
  // entities the graph knows from somewhere OTHER than email. Read from stored
  // metadata like every other fact, so a backtest replays them without a single
  // vector probe. An unscored thread reports zeroes, which makes any condition
  // over them false — a rule can never admit mail on a score nobody computed.
  /** Distinct anchored entities the thread names. */
  'graphEntityHits',
  /** Weight of the most important one: 3 watched or in a dossier, 2 well
   *  corroborated, 1 merely known, 0 none. The difference between a thread that
   *  names something you actively track and one that names a passing mention. */
  'graphTopHitWeight',
  /** 1 − cosine distance to the nearest anchored entity, 0..1. The topical
   *  half: it catches a thread plainly about your work that happens to share no
   *  vocabulary with the graph. */
  'graphSimilarity',
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
  graphEntityHits: number;
  graphTopHitWeight: number;
  graphSimilarity: number;
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

/**
 * Every address that appears as a message SENDER in the note text.
 *
 * The note writes one line per message:
 *
 *   [1] · 2026-08-01 · from Jane Doe <jane@x.com> · to John Kelly <me@x.com>
 *   [1] · 2026-08-27 · from service@paypal.co.uk · to John Kelly <me@x.com>
 *
 * The `from` field is read up to the next `·` and no further, which is the
 * whole trick. An earlier version matched `from\s+[^<\n]*<(…)>` — and on the
 * SECOND line above `[^<\n]*` sails straight past the bare sender and captures
 * the RECIPIENT's angle-bracketed address. Every transactional email where the
 * sender has no display name and the owner does was therefore read as a message
 * the owner had sent, making `ownerReplied` and `twoWay` true for a large slice
 * of the mailbox. A PayPal receipt with one message backtested as a two-way
 * conversation; the seed rule's samples are what caught it.
 */
export function sendersIn(body: string): string[] {
  const out = new Set<string>();
  const re = /^\[\d+\][^\n]*?\bfrom\s+([^\n·]*)/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body ?? '')) !== null) {
    const field = m[1];
    // Prefer the angle-bracketed address: a display name can itself contain
    // something that looks like an address.
    const angled = /<([^<>\s]+@[^<>\s]+)>/.exec(field);
    if (angled) {
      out.add(angled[1].toLowerCase());
      continue;
    }
    // No display name — `formatAddress` printed the bare address. Without this
    // branch a whole class of threads reports zero senders.
    const bare = /([^\s<>,;]+@[^\s<>,;]+)/.exec(field);
    if (bare) out.add(bare[1].toLowerCase());
  }
  return [...out];
}

/**
 * Addresses on the note's own `Participants:` header line.
 *
 * The note text opens with `Participants: a@x.com, John Kelly <me@y.com>`, and
 * unlike `metadata.participants` this line is NOT robot-filtered. That is the
 * whole reason it is worth parsing: see `counterpartyOf`.
 */
export function participantsLineIn(body: string): string[] {
  const line = /^Participants:\s*(.+)$/m.exec(body ?? '');
  if (!line) return [];
  const out = new Set<string>();
  const re = /([^\s<>,;]+@[^\s<>,;]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line[1])) !== null) out.add(m[1].toLowerCase().replace(/[.,;]+$/, ''));
  return [...out];
}

/**
 * The address this thread came FROM, as best it can be known.
 *
 * `metadata.participants` is the obvious source and is not enough on its own:
 * it is written from `threadParticipants`, which runs every address through
 * `isPersonAddress` to keep `noreply@` robots from becoming high-degree person
 * entities. Excellent for the graph, useless here — for automated mail it
 * filters out the only counterparty, leaving a participant list containing the
 * owner and nobody else. Measured on the live queue: 1,048 of 2,862 held
 * threads, 37%, every one of them landing in a single cluster called "unknown"
 * with 733 of them flagged important by Gmail.
 *
 * So fall through three sources, cheapest and most trustworthy first:
 *
 *   1. `metadata.participants` — robot-filtered, but a real header when present
 *   2. the `from` line of each message in the note body — not filtered
 *   3. the note's `Participants:` header line — not filtered, and the only one
 *      a header-only stub has
 *
 * PURE, and it reads only what the sweep already stored.
 */
export function counterpartyOf(
  body: string,
  participants: readonly string[],
  owner: string,
): string | null {
  const notOwner = (a: string) => a && a !== owner;
  const fromMeta = participants.find(notOwner);
  if (fromMeta) return fromMeta;
  const fromBody = sendersIn(body).find(notOwner);
  if (fromBody) return fromBody;
  return participantsLineIn(body).find(notOwner) ?? null;
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
/** A stored score, defensively — the value is jsonb somebody else wrote. */
function numberFrom(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function factsFor(note: NoteForFacts, now: number): MailFacts {
  const meta = note.metadata ?? {};
  const relevance = (meta.graphRelevance ?? null) as { hits?: unknown; topWeight?: unknown; similarity?: unknown } | null;
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

  // `senderDomain` and `emailKind` are written at ingest by `emailFacets`, and a
  // large slice of the corpus never went through it: the 837 structural stubs
  // were written by `persistStructuralOnly`, which builds its own metadata and
  // has no classifier step. Left as-is that put 1,043 of 2,857 held threads —
  // 37% of the queue — into a single cluster called "unknown", which is not a
  // decision anybody can make.
  //
  // So classify from the participants when the stored value is missing. The
  // classifier is pure and the participant list is on every email note, so this
  // costs nothing and needs no re-sweep. Domain RULES are not applied here (they
  // need a database), which is the one difference from ingest-time facets: a
  // fallback classification reads the shape of the address only. The stored
  // value always wins where there is one.
  const stored = {
    domain: String(meta.senderDomain ?? '').toLowerCase(),
    kind: String(meta.emailKind ?? ''),
  };
  // Classify the counterparty found across all three sources, not the
  // robot-filtered participant list alone — see `counterpartyOf`.
  const counterparty = stored.domain ? null : counterpartyOf(body, participants, owner);
  const derived = counterparty ? classifyEmail([counterparty], owner ? [owner] : []) : null;

  return {
    senderDomain: stored.domain || derived?.domain?.toLowerCase() || '',
    // The DERIVED kind wins where ingest stored no domain, because in that case
    // the stored kind is `classifyEmail`'s "no counterparty recorded" default —
    // it says 'correspondence' about every robot in the mailbox, which is how
    // 733 automated threads came to look like personal mail.
    emailKind: (stored.domain ? stored.kind : derived?.kind) || stored.kind || 'correspondence',
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
    // Zero rather than undefined when the note has never been scored. An absent
    // fact would make `graphEntityHits gte 2` false either way, but a zero also
    // makes `lt 2` TRUE — which is what a reject rule for irrelevant mail needs,
    // and what an undefined value would silently deny it.
    graphEntityHits: numberFrom(relevance?.hits),
    graphTopHitWeight: numberFrom(relevance?.topWeight),
    graphSimilarity: numberFrom(relevance?.similarity),
  };
}
