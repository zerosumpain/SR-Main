// Gmail → intel graph.
//
// The mailbox is the largest body of first-hand intelligence the system has and
// the only one it never read: /drive uploads and finished deep dives already
// auto-extract, but who wrote to whom, about what, and when, stayed locked in
// Gmail. This module sweeps DELIBERATELY MARKED threads (starred, or carrying a
// label) into the same pipeline the other sources use — nothing sweeps the whole
// inbox, because an unfiltered mailbox is mostly noise and every noisy thread
// costs an LLM call.
//
// Two halves, and they are worth different amounts:
//
//  1. `structuralEdges` — participants and correspondence edges read straight
//     off the headers. ZERO LLM cost, and it is the higher-value half: an email
//     header is about as reliable as evidence gets, so these edges are asserted
//     at high confidence while the body extraction is a model's opinion.
//
//  2. `threadToNoteText` → the existing `extractIntoIntel()`, which reads the
//     conversation for entities, relationships and dates.
//
// The whole reason (1) exists separately is that (2) is only as good as its
// input, and raw Gmail bodies are terrible input: a five-message thread carries
// the same paragraph five times inside nested `>` quoting, plus a signature and
// a legal disclaimer per message. Re-extracting a 12-deep quote chain as fresh
// content inflates every corroboration count in the graph with what is really
// ONE observation. So the body is cut at the first quote boundary and only the
// new text survives.
//
// Everything above `ingestGmailThreads` is pure and unit-tested. The Gmail
// client, auth and message parsing are reused wholesale from
// $lib/workflows/gmail/service — there is exactly one Gmail client in this
// codebase and this is not a second one.
import { createHash } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import { gmailAccounts, type GmailAccount } from '$lib/db/schema';
import { pgTextArray } from '$lib/db/sql-array';
import { beginBatch } from '$lib/workflows/engine-runtime';
import type { AutoExtractOutcome } from './auto-extract';
import type { ExtractedEntity, ExtractedRelationship, ExtractionResult } from './extract';
import { recencyOf, ROLLING_WINDOW_DAYS } from './staleness';
import {
  planAttachments,
  attachmentSection,
  skippedAttachmentsNote,
  fetchAttachmentText,
  type AttachmentRefInput,
} from './gmail-attachments';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * The parts of a Gmail message this module needs. Structurally satisfied by
 * `GmailMessage` from $lib/workflows/gmail/types, but declared minimally so the
 * pure functions can be tested with a literal and never drag the Gmail client
 * (and its `$env` import) into a unit test.
 */
export interface ThreadMessageInput {
  id?: string;
  headers: {
    from?: string;
    to?: string;
    cc?: string;
    subject?: string;
    date?: string;
  };
  bodyText?: string;
  /** Gmail epoch-ms as a string. Preferred over the `Date` header, which lies. */
  internalDate?: string;
  /** Populated by the Gmail service's MIME walk; empty for a metadata fetch. */
  attachments?: AttachmentRefInput[];
}

export interface ThreadInput {
  id: string;
  messages: ThreadMessageInput[];
}

export interface ParsedAddress {
  name: string;
  email: string;
}

/** `structuralEdges` output — an ExtractionResult persistExtraction can take as-is. */
export interface StructuralExtraction extends ExtractionResult {
  participants: ParsedAddress[];
  /** True when the thread was too wide to be correspondence (see MAX_PARTICIPANTS). */
  broadcast: boolean;
}

// ---------------------------------------------------------------------------
// Address parsing
// ---------------------------------------------------------------------------

/**
 * Split an address header on the separators that are actually separators.
 *
 * `"Kelly, John" <j@x.com>, alice@y.com` has two addresses and three commas.
 * Splitting on `,` naively produces a phantom recipient called `"Kelly` — and
 * because every participant becomes a person entity, that phantom becomes a
 * permanent node in the graph.
 */
function splitAddressList(raw: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuote = false;
  let inAngle = false;

  for (const ch of raw) {
    if (ch === '"') {
      inQuote = !inQuote;
      current += ch;
    } else if (ch === '<' && !inQuote) {
      inAngle = true;
      current += ch;
    } else if (ch === '>' && !inQuote) {
      inAngle = false;
      current += ch;
    } else if ((ch === ',' || ch === ';') && !inQuote && !inAngle) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/**
 * A readable name for an address that arrived without a display name.
 *
 * Deliberately conservative: `john.kelly@x.com` is unambiguously "John Kelly",
 * but `j.smith@x.com` is not "J Smith" and `svc-ops2@x.com` is not a person's
 * name. Anything that is not clearly two-or-more real words keeps the raw
 * address, because a wrong entity name is worse than an ugly one — it is what
 * later extractions will try to match against.
 */
function displayNameFor(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return email;
  if (!parts.every((p) => /^[a-z]{2,}$/i.test(p))) return email;
  return parts.map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(' ');
}

/** Parse one address. Returns null for anything that is not a usable mailbox. */
export function parseAddress(raw: string | null | undefined): ParsedAddress | null {
  const s = (raw ?? '').trim();
  if (!s) return null;

  let name = '';
  let email = s;

  const angle = s.match(/^([\s\S]*?)<([^<>]+)>[\s\S]*$/);
  if (angle) {
    name = angle[1].trim();
    email = angle[2].trim();
  }

  email = email.replace(/^mailto:/i, '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return null;

  name = name.replace(/^['"]|['"]$/g, '').trim();
  // Some clients put the address in the display slot too; that is not a name.
  if (!name || name.toLowerCase() === email) name = displayNameFor(email);

  return { name, email };
}

/** Parse an address header into unique addresses, first spelling wins. */
export function parseAddressList(raw: string | null | undefined): ParsedAddress[] {
  const out: ParsedAddress[] = [];
  const seen = new Set<string>();
  for (const part of splitAddressList(raw ?? '')) {
    const parsed = parseAddress(part);
    if (!parsed || seen.has(parsed.email)) continue;
    seen.add(parsed.email);
    out.push(parsed);
  }
  return out;
}

/**
 * Whether an address plausibly belongs to a person.
 *
 * Robots are the majority of most mailboxes and they are not intelligence:
 * `noreply@`, ticketing bots and calendar daemons would otherwise become
 * high-degree person entities wired to everyone they ever notified, which
 * distorts every centrality measure the analytics layer computes.
 */
export function isPersonAddress(email: string): boolean {
  const addr = (email ?? '').toLowerCase();
  const local = addr.split('@')[0] ?? '';
  const domain = addr.split('@')[1] ?? '';
  if (!local || !domain) return false;

  const flat = local.replace(/[._-]/g, '');
  if (/^(no|do not|donot)?reply$/.test(flat)) return false;
  if (/^(noreply|donotreply|dontreply)/.test(flat)) return false;
  if (/(^|[._-])(noreply|no-reply|donotreply)([._-]|$)/.test(local)) return false;
  if (/^(mailer|mailerdaemon|postmaster|bounce|bounces|notification|notifications|alert|alerts|automated|autoreply|daemon|nobody|root|support|admin|info|help|billing|invoices?|newsletter|marketing|updates|news)$/.test(flat)) {
    return false;
  }
  if (/^(bounce|mailer-daemon|notification)/.test(local)) return false;
  if (/^(bounces?|mail|reply|notifications?)\./.test(domain)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Quote / signature stripping
// ---------------------------------------------------------------------------

/** Lines that mean "everything below is a copy of an earlier message". */
const CUT_LINE_PATTERNS: RegExp[] = [
  /^\s*(?:>+\s*)?-{2,}\s*original message\s*-{2,}\s*$/i,
  /^\s*(?:>+\s*)?-{3,}\s*forwarded message\s*-{3,}\s*$/i,
  /^\s*(?:>+\s*)?begin forwarded message:\s*$/i,
  // Outlook's horizontal rule above the quoted header block.
  /^\s*(?:>+\s*)?_{10,}\s*$/,
  // Older Gmail attribution: "2025-05-12 9:14 GMT+01:00 John <j@x.com>:"
  /^\s*(?:>+\s*)?\d{4}-\d{2}-\d{2}[^\n]*<[^<>]+>\s*:\s*$/,
];

/** Lines that mean "everything below is boilerplate, not content". */
const SIGNATURE_PATTERNS: RegExp[] = [
  // RFC 3676 signature delimiter. Clients vary on the trailing space.
  /^--\s*$/,
  /^\s*sent from my \S+/i,
  /^\s*get outlook for \S+/i,
  /^\s*sent (?:from|via) (?:my )?\w+ (?:mail|for \w+)/i,
  /^\s*(?:confidentiality notice|disclaimer)\b/i,
  /^\s*this (?:e-?mail|message)\b[^\n]*\b(?:confidential|intended (?:solely |only )?for|privileged)\b/i,
];

/**
 * How many lines from `i` an "On …, X wrote:" attribution occupies, or 0.
 *
 * Gmail hard-wraps long attributions, so the `wrote:` can land two lines below
 * the `On`. Matching only the single-line form leaves the attribution in place
 * and — worse — leaves the quote uncut, because the quote itself is what the
 * attribution introduces. The `@`/date guard stops a body sentence that happens
 * to start with "On " and end in "wrote:" from truncating a real message.
 */
function attributionSpanAt(lines: string[], i: number): number {
  const first = lines[i];
  if (first === undefined || !/^\s*(?:>+\s*)?on\b/i.test(first)) return 0;

  let joined = first;
  for (let extra = 0; extra <= 2; extra++) {
    if (extra > 0) {
      const next = lines[i + extra];
      if (next === undefined) return 0;
      joined += ` ${next}`;
    }
    if (/\bwrote:\s*$/i.test(joined.trimEnd())) {
      return /@|\d{4}|\d{1,2}:\d{2}/.test(joined) ? extra + 1 : 0;
    }
  }
  return 0;
}

/** Outlook's quoted header block: `From:` immediately followed by `Sent:`/`Date:`. */
function isQuotedHeaderBlockAt(lines: string[], i: number): boolean {
  return (
    /^\s*(?:>+\s*)?from:\s*\S/i.test(lines[i] ?? '') &&
    /^\s*(?:>+\s*)?(?:sent|date):\s*\S/i.test(lines[i + 1] ?? '')
  );
}

/**
 * The text this message actually CONTRIBUTES — quotes, forwarded chains and
 * boilerplate removed.
 *
 * Two mechanisms, because clients need both:
 *   - `>`-prefixed lines are dropped wherever they appear (bottom-posting and
 *     interleaved replies keep their fresh paragraphs)
 *   - the first quote/forward/signature marker truncates the rest, because
 *     everything a top-posting client puts below one of those is a copy
 *
 * A forward is cut like a quote. It reads as fresh content but almost never is:
 * within a swept thread the forwarded body is usually another message of the
 * same thread, and a body pasted twice would be counted as two independent
 * observations of every entity in it.
 */
export function stripQuotedReply(body: string | null | undefined): string {
  const normalised = (body ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '');
  if (!normalised.trim()) return '';

  const lines = normalised.split('\n');
  const kept: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (attributionSpanAt(lines, i) > 0) break;
    if (isQuotedHeaderBlockAt(lines, i)) break;
    if (CUT_LINE_PATTERNS.some((re) => re.test(line))) break;
    if (SIGNATURE_PATTERNS.some((re) => re.test(line))) break;

    // Quoted line at any depth.
    if (/^\s*>+/.test(line)) continue;
    // Inline attachment placeholders carry no meaning once the bytes are gone.
    if (/^\s*\[(?:image|cid):[^\]]*\]\s*$/i.test(line)) continue;

    kept.push(line);
  }

  return kept
    .join('\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Thread → note text
// ---------------------------------------------------------------------------

/** Per-message cap. The whole note is capped again by extractIntoIntel. */
const MAX_MESSAGE_CHARS = 4000;
/** Messages beyond this in one thread add repetition, not information. */
const MAX_MESSAGES_PER_THREAD = 40;
/** Participants listed in the header block before it stops being readable. */
const MAX_LISTED_PARTICIPANTS = 20;

/** ISO day for a message, from `internalDate` if present, else the Date header. */
function messageDay(msg: ThreadMessageInput): string | null {
  const epoch = Number(msg.internalDate);
  if (Number.isFinite(epoch) && epoch > 0) {
    return new Date(epoch).toISOString().slice(0, 10);
  }
  const header = msg.headers?.date;
  if (header) {
    const parsed = new Date(header);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function formatAddress(a: ParsedAddress): string {
  return a.name === a.email ? a.email : `${a.name} <${a.email}>`;
}

function threadSubject(thread: ThreadInput): string {
  for (const m of thread.messages ?? []) {
    const s = (m.headers?.subject ?? '').trim();
    // The first message carries the subject; replies prefix it endlessly.
    if (s) return s.replace(/^((re|fw|fwd|aw|sv)\s*:\s*)+/i, '').trim() || s;
  }
  return '';
}

/**
 * Flatten a thread into clean text for extraction.
 *
 * The shape is deliberately explicit — subject, participants, then one dated
 * block per message — because the extractor resolves relative dates and
 * pronouns from it, and a wall of undifferentiated body text gives it nothing
 * to anchor on. Messages whose contribution is entirely quoted are omitted:
 * they add no text and their existence is already recorded as an edge by
 * `structuralEdges`.
 */
export function threadToNoteText(thread: ThreadInput): string {
  const messages = (thread?.messages ?? []).slice(0, MAX_MESSAGES_PER_THREAD);
  if (messages.length === 0) return '';

  const participants = threadParticipants(thread);
  // Sorted rather than assumed: Gmail returns a thread chronologically, but a
  // reversed span in the header would misdate the whole note for the extractor.
  const days = messages.map(messageDay).filter((d): d is string => Boolean(d)).sort();
  const subject = threadSubject(thread);

  const header: string[] = [];
  if (subject) header.push(`Subject: ${subject}`);
  if (participants.length) {
    const listed = participants.slice(0, MAX_LISTED_PARTICIPANTS).map(formatAddress).join(', ');
    const overflow = participants.length - MAX_LISTED_PARTICIPANTS;
    header.push(`Participants: ${listed}${overflow > 0 ? ` (+${overflow} more)` : ''}`);
  }
  const span = days.length ? ` (${days[0]}${days.length > 1 && days[days.length - 1] !== days[0] ? ` → ${days[days.length - 1]}` : ''})` : '';
  header.push(`Messages: ${messages.length}${span}`);

  const blocks: string[] = [];
  let n = 0;
  for (const msg of messages) {
    const body = stripQuotedReply(msg.bodyText);
    if (!body) continue;
    n++;

    const from = parseAddress(msg.headers?.from);
    const to = [...parseAddressList(msg.headers?.to), ...parseAddressList(msg.headers?.cc)];
    const day = messageDay(msg);

    const parts: string[] = [`[${n}]`];
    if (day) parts.push(day);
    if (from) parts.push(`from ${formatAddress(from)}`);
    if (to.length) parts.push(`to ${to.slice(0, 8).map(formatAddress).join(', ')}`);

    const clipped =
      body.length > MAX_MESSAGE_CHARS
        ? `${body.slice(0, MAX_MESSAGE_CHARS)}\n…[truncated ${body.length - MAX_MESSAGE_CHARS} chars]`
        : body;
    blocks.push(`${parts.join(' · ')}\n${clipped}`);
  }

  return [header.join('\n'), ...blocks].join('\n\n').trim();
}

// ---------------------------------------------------------------------------
// Structural edges
// ---------------------------------------------------------------------------

/**
 * Above this, a thread is a distribution list rather than a conversation.
 * Wiring every recipient of an all-staff email to every other one would add
 * hundreds of meaningless edges and make the sender the most "central" person
 * in the graph purely for having pressed send once.
 */
const MAX_PARTICIPANTS = 25;

/** Every human participant of a thread, deduped by address, in first-seen order. */
export function threadParticipants(thread: ThreadInput): ParsedAddress[] {
  const seen = new Map<string, ParsedAddress>();
  for (const msg of thread?.messages ?? []) {
    const all = [
      ...parseAddressList(msg.headers?.from),
      ...parseAddressList(msg.headers?.to),
      ...parseAddressList(msg.headers?.cc),
    ];
    for (const a of all) {
      if (!isPersonAddress(a.email)) continue;
      const existing = seen.get(a.email);
      // A later message may carry a real display name where the first had none.
      if (!existing) seen.set(a.email, a);
      else if (existing.name === existing.email && a.name !== a.email) seen.set(a.email, a);
    }
  }
  return [...seen.values()];
}

export const CORRESPONDENCE_EDGE_TYPE = 'corresponded_with';

/**
 * Participants and correspondence edges, read straight off the headers.
 *
 * Costs nothing and is more trustworthy than anything the extractor produces
 * from a body, so these are asserted at `high` confidence: a From header is
 * machine-written provenance, not a model's reading of prose.
 *
 * Entities are keyed by DISPLAY NAME because that is what persistExtraction
 * matches on, with the address carried in `properties.email` so a later merge
 * pass has something exact to reconcile on.
 */
export function structuralEdges(thread: ThreadInput): StructuralExtraction {
  const participants = threadParticipants(thread);
  const empty: StructuralExtraction = {
    summary: '',
    entities: [],
    relationships: [],
    timelineEvents: [],
    proposedNewTypes: [],
    participants,
    broadcast: false,
  };

  if (participants.length < 2) return empty;
  if (participants.length > MAX_PARTICIPANTS) return { ...empty, broadcast: true };

  const nameByEmail = new Map(participants.map((p) => [p.email, p.name]));
  const entities: ExtractedEntity[] = participants.map((p) => ({
    name: p.name,
    type: 'person',
    confidence: 'high',
    properties: { email: p.email },
    possibleMatchId: null,
  }));

  const relationships: ExtractedRelationship[] = [];
  const seenEdges = new Set<string>();

  for (const msg of thread?.messages ?? []) {
    const from = parseAddress(msg.headers?.from);
    if (!from || !nameByEmail.has(from.email)) continue;

    const recipients = [
      ...parseAddressList(msg.headers?.to),
      ...parseAddressList(msg.headers?.cc),
    ];
    for (const r of recipients) {
      // Self-addressed copies are an artefact of how mail works, not a relation.
      if (r.email === from.email) continue;
      if (!nameByEmail.has(r.email)) continue;

      const sourceName = nameByEmail.get(from.email)!;
      const targetName = nameByEmail.get(r.email)!;
      // Two participants can share a display name; the edge key must not.
      const key = `${from.email}|${r.email}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);

      relationships.push({
        source: sourceName,
        target: targetName,
        type: CORRESPONDENCE_EDGE_TYPE,
        label: 'Corresponded by email',
        confidence: 'high',
      });
    }
  }

  return { ...empty, entities, relationships };
}

// ---------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------

/**
 * Only threads the mailbox owner MARKED. An unfiltered inbox is mostly
 * transactional noise, and every thread swept costs a model call.
 */
export const DEFAULT_GMAIL_INTEL_QUERY = 'is:starred OR label:intel';

/**
 * The rolling window: everything from the last 12 weeks except bin and spam.
 *
 * This is a deliberate reversal of the module header's argument above, asked
 * for explicitly — the mailbox in full, not just what was marked. The cost
 * objection is answered rather than ignored:
 *
 *   - the STRUCTURAL half (participants and correspondence edges from headers)
 *     costs nothing and runs for every thread, so the connective tissue of the
 *     mailbox lands regardless of budget;
 *   - the BODY half is capped per run by `extractBudget`, so a first sweep of a
 *     large mailbox spreads across several nights instead of arriving as one
 *     enormous bill;
 *   - the content hash means a thread only costs a call again when a new
 *     message actually lands in it;
 *   - and staleness (see ./staleness) stops twelve weeks of ordinary
 *     correspondence from drowning out what was deliberately curated.
 *
 * `category:promotions` and friends are NOT excluded — the brief said bin and
 * spam, and a promotions-tab thread from a real counterparty is still evidence.
 */
export const ROLLING_GMAIL_INTEL_QUERY = `newer_than:${ROLLING_WINDOW_DAYS}d -in:trash -in:spam`;

export type GmailSweepMode = 'marked' | 'rolling';

/** The query a mode sweeps, unless the caller overrides it outright. */
export function queryForMode(mode: GmailSweepMode): string {
  return mode === 'rolling' ? ROLLING_GMAIL_INTEL_QUERY : DEFAULT_GMAIL_INTEL_QUERY;
}

const DEFAULT_THREAD_LIMIT = 20;
const MAX_THREAD_LIMIT = 100;

/**
 * Threads a ROLLING sweep may walk in one run.
 *
 * Much larger than `MAX_THREAD_LIMIT` because listing is cheap — ids and
 * headers only — and the expensive step is separately budgeted below. This is
 * the ceiling on how much mailbox one night can *look at*, not how much it
 * pays for.
 */
const MAX_ROLLING_THREADS = 2_000;

/** Gmail's own page size for threads.list. */
const THREAD_PAGE_SIZE = 100;

/**
 * Body extractions (LLM calls) a single rolling run will pay for. Threads
 * beyond it still get their free structural edges; their bodies are read on a
 * later run, newest first, so the most relevant mail is always done first.
 */
const DEFAULT_EXTRACT_BUDGET = 150;

/** Prefix on the auto-extract refId, so Gmail threads cannot collide with drive file ids. */
export const GMAIL_REF_PREFIX = 'gmail:';

export interface GmailIngestOptions {
  query?: string;
  limit?: number;
  /** Defaults to the most recently used active account. */
  accountId?: number;
  /** 'marked' (the curated sweep) or 'rolling' (12 weeks of everything). */
  mode?: GmailSweepMode;
  /** Rolling only — LLM body extractions this run may pay for. */
  extractBudget?: number;
  /** Rolling only — decode and read attachments. Defaults on. */
  includeAttachments?: boolean;
}

export interface GmailThreadOutcome {
  threadId: string;
  subject: string;
  status: AutoExtractOutcome['status'];
  noteId?: string;
  messages: number;
  participants: number;
  /** New correspondence edges written (0 for an unchanged or broadcast thread). */
  edges: number;
  entityCount?: number;
  /** 0..1 staleness weight applied to this thread's edges (rolling mode). */
  recency?: number;
  /** Attachments decoded and appended to the note text. */
  attachmentsRead?: number;
  /** Structural edges written but the body left for a later run (budget spent). */
  deferred?: boolean;
}

export interface GmailIngestResult {
  account: string;
  query: string;
  mode: GmailSweepMode;
  threads: number;
  extracted: number;
  unchanged: number;
  skipped: number;
  failed: number;
  entities: number;
  edges: number;
  /** Attachments decoded across the sweep. */
  attachments: number;
  /** Threads given their free structural edges, body deferred to a later run. */
  deferred: number;
  /** Model calls left when the run ended. 0 means there is more to do. */
  budgetLeft: number;
  /** Duplicate entities resolved automatically after the sweep. */
  autoMerged: number;
  items: GmailThreadOutcome[];
}

export function clampThreadLimit(limit: unknown): number {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_THREAD_LIMIT;
  return Math.min(Math.floor(n), MAX_THREAD_LIMIT);
}

/** The auto-extract refId for a Gmail thread. Stable across sweeps. */
export function refIdForThread(threadId: string): string {
  return `${GMAIL_REF_PREFIX}${threadId}`;
}

/**
 * Change-detection hash for a thread, from its MESSAGES ALONE.
 *
 * Deliberately excludes attachment content, even though attachment text ends up
 * in the note. Gmail messages are immutable, so a thread's attachment set is
 * fully determined by its message ids — nothing can change inside an attachment
 * without a new message arriving, which changes this hash anyway.
 *
 * That matters for cost, not tidiness. The rolling sweep has to answer "has
 * this thread changed?" BEFORE deciding to spend budget on it, and a hash that
 * covered attachment bytes could only be computed by downloading and parsing
 * every attachment first — on a nightly re-sweep of a large mailbox, thousands
 * of downloads to discover that nothing changed.
 */
export function threadContentHash(thread: ThreadInput): string {
  const parts: string[] = [];
  for (const msg of thread?.messages ?? []) {
    parts.push(
      [
        msg.id ?? '',
        msg.internalDate ?? '',
        msg.headers?.subject ?? '',
        stripQuotedReply(msg.bodyText).slice(0, 4000),
      ].join(' '),
    );
  }
  return createHash('sha256').update(parts.join('')).digest('hex');
}

/** Stored content hashes for a set of thread refIds. */
async function storedHashes(refIds: string[]): Promise<Map<string, string>> {
  if (!refIds.length) return new Map();
  const { db } = await import('$lib/db');
  // `pgTextArray`, not the array itself: interpolating a JS array here binds a
  // parameter LIST, which Postgres reads as a row constructor and refuses to
  // cast ("cannot cast type record to text[]"). That threw on every rolling
  // sweep that found at least one thread — see $lib/db/sql-array.
  const { rows } = await db.execute(sql`
    SELECT metadata->>'refId' AS ref_id, metadata->>'contentHash' AS content_hash
    FROM intel_notes
    WHERE metadata->>'refId' = ANY(${pgTextArray(refIds)}::text[])
  `);
  const out = new Map<string, string>();
  for (const r of rows as Array<Record<string, unknown>>) {
    if (r.ref_id && r.content_hash) out.set(String(r.ref_id), String(r.content_hash));
  }
  return out;
}

async function resolveAccount(accountId?: number): Promise<GmailAccount> {
  const { db } = await import('$lib/db');
  if (accountId) {
    const [acct] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.id, accountId)).limit(1);
    if (!acct) throw new Error(`Gmail account ${accountId} not found`);
    return acct;
  }
  const [acct] = await db
    .select()
    .from(gmailAccounts)
    .where(eq(gmailAccounts.status, 'active'))
    .orderBy(desc(gmailAccounts.updatedAt))
    .limit(1);
  if (!acct) {
    throw new Error('No active Gmail account. Connect one at /admin/connections/gmail.');
  }
  return acct;
}

/** Thread ids matching a query, newest first (Gmail's own ordering). */
async function listThreadIds(acct: GmailAccount, query: string, limit: number): Promise<string[]> {
  const { gmailService } = await import('$lib/workflows/gmail/service');
  const oauth = await gmailService.getAuthenticatedClient(acct);
  const gmail = gmailService.gmailClientFor(oauth);
  const res = await gmail.users.threads.list({ userId: 'me', q: query, maxResults: limit });
  return (res.data.threads ?? []).map((t) => t.id ?? '').filter(Boolean);
}

/**
 * Every thread id matching a query, paging until exhausted or `limit` is hit.
 *
 * `threads.list` caps at 500 per page and a 12-week mailbox is many pages, so
 * the single-request version above cannot see past the first hundred. Newest
 * first throughout — Gmail's own ordering — which is what makes a partial run
 * useful: it always got through the most recent mail.
 */
async function listAllThreadIds(acct: GmailAccount, query: string, limit: number): Promise<string[]> {
  const { gmailService } = await import('$lib/workflows/gmail/service');
  const oauth = await gmailService.getAuthenticatedClient(acct);
  const gmail = gmailService.gmailClientFor(oauth);

  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const res = await gmail.users.threads.list({
      userId: 'me',
      q: query,
      maxResults: Math.min(THREAD_PAGE_SIZE, limit - ids.length),
      ...(pageToken ? { pageToken } : {}),
    });
    for (const t of res.data.threads ?? []) {
      if (t.id) ids.push(t.id);
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && ids.length < limit);

  return ids.slice(0, limit);
}

/**
 * The most recent message instant in a thread, as epoch ms.
 *
 * `internalDate` is Gmail's own receipt time and is preferred over the `Date`
 * header, which is written by the sender and lies often enough to matter when
 * it is driving a decay curve.
 */
export function threadTimestamp(thread: ThreadInput): number | null {
  let newest = 0;
  for (const msg of thread?.messages ?? []) {
    const raw = Number(msg.internalDate);
    if (Number.isFinite(raw) && raw > newest) newest = raw;
    else if (!Number.isFinite(raw) && msg.headers?.date) {
      const parsed = Date.parse(msg.headers.date);
      if (Number.isFinite(parsed) && parsed > newest) newest = parsed;
    }
  }
  return newest > 0 ? newest : null;
}

/**
 * Fetch a thread as parsed messages.
 *
 * `threads.get` with `format: 'metadata'` for the id list, then the service's
 * own `fetchMessage` per message — the same route the `gmail_get_thread` tool
 * takes, so MIME walking and base64url decoding have one implementation.
 */
async function fetchThread(acct: GmailAccount, threadId: string): Promise<ThreadInput> {
  const { gmailService } = await import('$lib/workflows/gmail/service');
  const oauth = await gmailService.getAuthenticatedClient(acct);
  const gmail = gmailService.gmailClientFor(oauth);
  const res = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'metadata' });
  const ids = (res.data.messages ?? []).map((m) => m.id ?? '').filter(Boolean).slice(0, MAX_MESSAGES_PER_THREAD);

  const messages: ThreadMessageInput[] = [];
  for (const id of ids) {
    try {
      messages.push(await gmailService.fetchMessage(acct, id));
    } catch (err) {
      // One unreadable message must not cost the whole thread.
      console.warn(`[intel:gmail] message ${id} unreadable:`, err instanceof Error ? err.message : err);
    }
  }
  return { id: threadId, messages };
}

/**
 * Attachment text for a whole thread, as blocks appended to the note.
 *
 * Planned across the thread rather than per message, so the budget is spent on
 * the five best documents in the conversation rather than five per message.
 * A failure anywhere returns what it has — an unreadable attachment must never
 * cost the thread its body.
 */
async function threadAttachmentText(
  acct: GmailAccount,
  thread: ThreadInput,
): Promise<{ text: string; read: number; skipped: number }> {
  // attachmentId → the message carrying it; `attachments.get` needs both ids.
  // Local to the call: a module-level map would leak across sweeps and let two
  // concurrent accounts read each other's message ids.
  const messageIdFor = new Map<string, string>();
  const all: AttachmentRefInput[] = [];
  for (const msg of thread.messages ?? []) {
    if (!msg.id) continue;
    for (const att of msg.attachments ?? []) {
      if (!att?.attachmentId) continue;
      all.push(att);
      messageIdFor.set(att.attachmentId, msg.id);
    }
  }
  if (!all.length) return { text: '', read: 0, skipped: 0 };

  const plan = planAttachments(all);
  if (!plan.fetch.length) {
    return { text: skippedAttachmentsNote(plan.skipped), read: 0, skipped: plan.skipped.length };
  }

  const { gmailService } = await import('$lib/workflows/gmail/service');
  const oauth = await gmailService.getAuthenticatedClient(acct);
  const gmail = gmailService.gmailClientFor(oauth);

  const blocks: string[] = [];
  let read = 0;
  for (const att of plan.fetch) {
    const messageId = messageIdFor.get(att.attachmentId);
    if (!messageId) continue;
    const text = await fetchAttachmentText(gmail, messageId, att);
    if (!text) continue;
    const block = attachmentSection(att.filename, text);
    if (block) {
      blocks.push(block);
      read++;
    }
  }

  const note = skippedAttachmentsNote(plan.skipped);
  if (note) blocks.push(note);
  return { text: blocks.join('\n\n'), read, skipped: plan.skipped.length };
}

/**
 * Write a thread's FREE half when the model budget for this run is spent.
 *
 * Participants and correspondence edges come off the headers and cost nothing,
 * so a budget-exhausted run still lands the connective tissue of the mailbox
 * and only defers the reading of bodies.
 *
 * The note is created WITHOUT a `contentHash`, deliberately. `extractIntoIntel`
 * short-circuits to `unchanged` when the stored hash matches the incoming one,
 * so writing the hash here would mark the thread as fully ingested and its body
 * would never be read on any later run — the deferral would become permanent
 * silently. No hash means the next run with budget picks it up.
 */
async function persistStructuralOnly(
  structural: StructuralExtraction,
  ctx: { threadId: string; subject: string; account: string; participants: ParsedAddress[] },
  opts: { recency: number; observedAt?: Date },
): Promise<{ entityCount: number; relationshipCount: number }> {
  const { db } = await import('$lib/db');
  const { intelNotes } = await import('$lib/db/schema');
  const { persistExtraction } = await import('./graph');

  const refId = refIdForThread(ctx.threadId);
  const metadata = {
    channel: 'gmail',
    gmailThreadId: ctx.threadId,
    gmailAccount: ctx.account,
    participants: ctx.participants.map((p) => p.email),
    sourceUrl: `https://mail.google.com/mail/u/0/#all/${ctx.threadId}`,
    autoKind: 'file',
    refId,
    sourceTag: 'file',
    // No contentHash — see the note above.
    structuralOnly: true,
  };

  const { rows } = await db.execute(sql`
    SELECT id FROM intel_notes WHERE metadata->>'refId' = ${refId} LIMIT 1
  `);
  const existingId = (rows as Array<Record<string, unknown>>)[0]?.id;

  if (existingId) {
    // Its structural edges are already in the graph from a previous run, and
    // persistExtraction treats a re-observed edge as CORROBORATION — it bumps
    // `observationCount` and recomputes the weight from it. A thread can sit
    // deferred for many nights waiting for budget, so re-persisting here would
    // add a phantom observation per night and quietly inflate the weight and
    // corroboration of every correspondence edge in the mailbox. Nothing new
    // has been read, so there is nothing new to assert.
    return { entityCount: 0, relationshipCount: 0 };
  }

  const [created] = await db
    .insert(intelNotes)
    .values({
      title: ctx.subject.slice(0, 200),
      // Headers only — the body is deliberately not stored yet, so the later
      // full extraction is not fooled into thinking it already has the text.
      rawContent: `Email thread: ${ctx.subject}\nParticipants: ${ctx.participants.map((p) => p.email).join(', ')}`,
      source: 'email',
      format: 'summary',
      status: 'pending',
      metadata,
    })
    .returning({ id: intelNotes.id });

  return persistExtraction(created.id, structural, {
    recency: opts.recency,
    observedAt: opts.observedAt,
  });
}

export interface GmailSweepPreview {
  account: string;
  query: string;
  mode: GmailSweepMode;
  threads: Array<{ threadId: string; subject: string; messages: number; participants: number; alreadyIngested: boolean }>;
  newThreads: number;
  /** Rolling only — the window the count covers. */
  windowDays?: number;
}

/** What a sweep WOULD touch, without extracting anything. No LLM calls. */
export async function previewGmailSweep(opts: GmailIngestOptions = {}): Promise<GmailSweepPreview> {
  const acct = await resolveAccount(opts.accountId);
  const mode: GmailSweepMode = opts.mode === 'rolling' ? 'rolling' : 'marked';
  const fallbackQuery = queryForMode(mode);
  const query = (opts.query ?? fallbackQuery).trim() || fallbackQuery;

  // A rolling preview must not fetch every thread in twelve weeks just to
  // report a count — listing is cheap, per-thread fetching is not. It pages the
  // ids for an honest total and details only the first page.
  if (mode === 'rolling') {
    const ids = await listAllThreadIds(acct, query, MAX_ROLLING_THREADS);
    const { db } = await import('$lib/db');
    const refIds = ids.map(refIdForThread);
    const { rows } = await db.execute(sql`
      SELECT metadata->>'refId' AS ref_id
      FROM intel_notes
      WHERE metadata->>'refId' = ANY(${pgTextArray(refIds)}::text[])
    `);
    const known = new Set((rows as Array<Record<string, unknown>>).map((r) => String(r.ref_id)));
    return {
      account: acct.email,
      query,
      mode,
      threads: ids.map((threadId) => ({
        threadId,
        subject: '',
        messages: 0,
        participants: 0,
        alreadyIngested: known.has(refIdForThread(threadId)),
      })),
      newThreads: ids.filter((id) => !known.has(refIdForThread(id))).length,
      windowDays: ROLLING_WINDOW_DAYS,
    };
  }

  const limit = clampThreadLimit(opts.limit);

  const threadIds = await listThreadIds(acct, query, limit);
  const { db } = await import('$lib/db');
  const refIds = threadIds.map(refIdForThread);
  const { rows } = await db.execute(sql`
    SELECT metadata->>'refId' AS ref_id
    FROM intel_notes
    WHERE metadata->>'refId' = ANY(${pgTextArray(refIds)}::text[])
  `);
  const known = new Set((rows as Array<Record<string, unknown>>).map((r) => String(r.ref_id)));

  const threads: GmailSweepPreview['threads'] = [];
  for (const threadId of threadIds) {
    const thread = await fetchThread(acct, threadId);
    threads.push({
      threadId,
      subject: threadSubject(thread) || '(no subject)',
      messages: thread.messages.length,
      participants: threadParticipants(thread).length,
      alreadyIngested: known.has(refIdForThread(threadId)),
    });
  }

  return {
    account: acct.email,
    query,
    mode,
    threads,
    newThreads: threads.filter((t) => !t.alreadyIngested).length,
  };
}

/**
 * Sweep marked Gmail threads into the intel graph.
 *
 * Sequential, like the /drive backfill: each thread is an LLM call, and running
 * them concurrently buys little while risking a rate limit mid-sweep. Idempotent
 * — the content hash covers the flattened thread text, so a thread only re-costs
 * a call once a NEW message lands in it.
 *
 * Ingested under auto-extract kind `file` rather than a kind of its own: the
 * `AutoKind` union lives in ./auto-extract.ts, which this workstream does not
 * own. `metadata.channel = 'gmail'` distinguishes these notes meanwhile.
 */
export async function ingestGmailThreads(opts: GmailIngestOptions = {}): Promise<GmailIngestResult> {
  const acct = await resolveAccount(opts.accountId);
  if (acct.status === 'auth_expired') {
    throw new Error(`Gmail account ${acct.email} needs re-authentication at /admin/connections/gmail.`);
  }

  const mode: GmailSweepMode = opts.mode === 'rolling' ? 'rolling' : 'marked';
  const fallbackQuery = queryForMode(mode);
  const query = (opts.query ?? fallbackQuery).trim() || fallbackQuery;
  const rolling = mode === 'rolling';
  const includeAttachments = opts.includeAttachments !== false;

  // A rolling sweep pages the whole window and rations the expensive half; the
  // marked sweep keeps its original single-request, everything-extracted shape.
  const limit = rolling
    ? Math.min(Math.max(Number(opts.limit) || MAX_ROLLING_THREADS, 1), MAX_ROLLING_THREADS)
    : clampThreadLimit(opts.limit);
  const budgetRaw = Number(opts.extractBudget);
  let extractBudget = rolling
    ? Number.isFinite(budgetRaw) && budgetRaw >= 0
      ? Math.floor(budgetRaw)
      : DEFAULT_EXTRACT_BUDGET
    : Number.POSITIVE_INFINITY;

  const { extractIntoIntel } = await import('./auto-extract');
  const { persistExtraction } = await import('./graph');

  const threadIds = rolling
    ? await listAllThreadIds(acct, query, limit)
    : await listThreadIds(acct, query, limit);

  // One query for every thread's stored hash, so the per-thread "has this
  // changed?" test below costs nothing.
  const alreadyIngested = await storedHashes(threadIds.map(refIdForThread));
  const result: GmailIngestResult = {
    account: acct.email,
    query,
    mode,
    threads: threadIds.length,
    extracted: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    entities: 0,
    edges: 0,
    attachments: 0,
    deferred: 0,
    budgetLeft: 0,
    autoMerged: 0,
    items: [],
  };

  // Declared to the health probe as work-in-progress. Extraction is genuinely
  // CPU-heavy in bursts, and without this the watchdog reads a stalled loop as
  // a wedged process and restarts the service mid-sweep — which it did, twice,
  // losing the run each time. A beat per thread is what keeps it excused; if
  // the sweep truly hangs the beats stop and the restart happens as before.
  const batch = beginBatch('intel:gmail-sweep', `0/${threadIds.length} threads`);
  try {
  for (const threadId of threadIds) {
    batch.beat(`${result.items.length}/${threadIds.length} threads`);
    let item: GmailThreadOutcome = {
      threadId,
      subject: '',
      status: 'skipped',
      messages: 0,
      participants: 0,
      edges: 0,
    };

    try {
      const thread = await fetchThread(acct, threadId);
      let noteText = threadToNoteText(thread);
      const structural = structuralEdges(thread);
      const subject = threadSubject(thread) || `Gmail thread ${threadId}`;

      // How much this thread's evidence is still worth. Header-derived edges
      // decay too: a correspondence edge from eleven weeks ago is a weaker
      // statement about who works with whom than one from yesterday.
      const observedMs = threadTimestamp(thread);
      const recency = rolling ? recencyOf(observedMs) : 1;
      const observedAt = observedMs ? new Date(observedMs) : undefined;

      item = {
        ...item,
        subject,
        messages: thread.messages.length,
        participants: structural.participants.length,
        recency: Number(recency.toFixed(3)),
      };

      if (!noteText) {
        result.skipped++;
        result.items.push(item);
        continue;
      }

      // Already fully ingested and nothing new has arrived. Checked BEFORE the
      // budget is touched: `extractIntoIntel` would also detect this and return
      // 'unchanged', but only after the budget had been spent on it. Since
      // Gmail lists newest-first, that meant every night re-spent the whole
      // budget on the same newest threads and the backfill never advanced past
      // the first page.
      const hash = threadContentHash(thread);
      if (alreadyIngested.get(refIdForThread(threadId)) === hash) {
        item.status = 'unchanged';
        result.unchanged++;
        result.items.push(item);
        continue;
      }

      // Structural edges are free and land for EVERY thread, budget or not —
      // they are the higher-value half and the reason a partial run is still
      // worth having. Only the model call below is rationed.
      //
      // The budget check comes BEFORE attachments deliberately. Downloading and
      // text-extracting a thread's documents is expensive — several API round
      // trips plus a PDF/docx parse each — and for a deferred thread the result
      // is thrown away, since only the body extraction consumes it. On a first
      // backfill of a large mailbox that is thousands of pointless downloads.
      if (extractBudget <= 0) {
        if (structural.entities.length) {
          const stats = await persistStructuralOnly(
            structural,
            { threadId, subject, account: acct.email, participants: structural.participants },
            { recency, observedAt },
          );
          item.edges = stats.relationshipCount;
          result.edges += stats.relationshipCount;
          result.entities += stats.entityCount;
        }
        item.status = 'skipped';
        item.deferred = true;
        result.deferred++;
        result.items.push(item);
        continue;
      }

      extractBudget--;

      // Only now is it worth reading the attachments: this thread's body IS
      // being extracted, so the document text has somewhere to go.
      if (includeAttachments) {
        const att = await threadAttachmentText(acct, thread);
        if (att.text) noteText = `${noteText}\n\n${att.text}`;
        item.attachmentsRead = att.read;
        result.attachments += att.read;
      }

      const outcome = await extractIntoIntel({
        kind: 'file',
        // Rides the `file` pipeline but is email, and the graph's source filter
        // reads `source`, not `kind`.
        source: 'email',
        refId: refIdForThread(threadId),
        title: subject.slice(0, 200),
        text: noteText,
        // The MESSAGE-only hash computed above, not a hash of `noteText`.
        // noteText now has attachment text appended, and hashing that would
        // store a value the cheap pre-check can never reproduce without
        // re-downloading every attachment — which is the whole thing it exists
        // to avoid. Messages are immutable, so this still changes whenever the
        // thread does.
        contentHash: hash,
        metadata: {
          channel: 'gmail',
          gmailThreadId: threadId,
          gmailAccount: acct.email,
          participants: structural.participants.map((p) => p.email),
          sourceUrl: `https://mail.google.com/mail/u/0/#all/${threadId}`,
        },
      });

      item.status = outcome.status;
      item.noteId = outcome.noteId;
      if (outcome.status === 'extracted') {
        result.extracted++;
        result.entities += outcome.entityCount;
        item.entityCount = outcome.entityCount;
      } else if (outcome.status === 'unchanged') {
        result.unchanged++;
      } else if (outcome.status === 'failed') {
        result.failed++;
      } else {
        result.skipped++;
      }

      // Header-derived edges are only worth writing when the thread actually
      // changed — on an unchanged thread they are already in the graph, and
      // re-persisting them would inflate every observation count for free.
      if (outcome.status === 'extracted' && outcome.noteId && structural.entities.length) {
        const stats = await persistExtraction(outcome.noteId, structural, { recency, observedAt });
        item.edges = stats.relationshipCount;
        result.edges += stats.relationshipCount;
      }
    } catch (err) {
      // A sweep must survive one bad thread; the rest of the mailbox is still
      // worth reading.
      console.error(`[intel:gmail] thread ${threadId} failed:`, err instanceof Error ? err.message : err);
      item.status = 'failed';
      result.failed++;
    }

    result.items.push(item);
  }

  result.budgetLeft = Number.isFinite(extractBudget) ? Math.max(0, extractBudget) : 0;

  // Resolve duplicates as they arrive rather than letting them queue up.
  //
  // A mailbox is the worst source for duplicate people — the same person
  // appears as "John Kelly", "Kelly, John", "J. Kelly" and a bare address
  // depending on who typed the header — so a 12-week sweep without this would
  // hand over hundreds of pairs to review by hand. Only merges at or above the
  // unchanged 0.85 threshold; nothing here lowers the bar.
  if (result.extracted > 0 || result.edges > 0) {
    try {
      batch.beat('resolving duplicates');
      const { autoMergeDuplicates } = await import('./resolve/merge');
      const sweep = await autoMergeDuplicates();
      result.autoMerged = sweep.merged;
      if (sweep.merged) {
        console.log(`[intel:gmail] auto-merged ${sweep.merged} duplicate entities after the sweep`);
      }
    } catch (err) {
      // Resolution is a tidy-up. Failing it must not fail the ingest that just
      // succeeded, or a transient DB error would lose the whole sweep.
      console.warn('[intel:gmail] post-sweep auto-merge failed:', err instanceof Error ? err.message : err);
    }
  }
  } finally {
    batch.end();
  }

  console.log(
    `[intel:gmail] ${mode} sweep "${query}" on ${acct.email} — ${result.threads} threads, ` +
      `${result.extracted} extracted (${result.entities} entities, ${result.edges} edges, ${result.attachments} attachments), ` +
      `${result.unchanged} unchanged, ${result.deferred} deferred, ${result.failed} failed`,
  );
  if (rolling && result.deferred > 0) {
    // Not a warning — a partial run is the designed behaviour — but it must be
    // visible, or a mailbox that never finishes backfilling looks like success.
    console.log(
      `[intel:gmail] ${result.deferred} thread bodies deferred to a later run (budget exhausted); ` +
        `structural edges for them are already in the graph`,
    );
  }
  return result;
}
