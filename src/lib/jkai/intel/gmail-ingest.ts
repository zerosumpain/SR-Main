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
import type { AutoExtractOutcome } from './auto-extract';
import type { ExtractedEntity, ExtractedRelationship, ExtractionResult } from './extract';

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

const DEFAULT_THREAD_LIMIT = 20;
const MAX_THREAD_LIMIT = 100;

/** Prefix on the auto-extract refId, so Gmail threads cannot collide with drive file ids. */
export const GMAIL_REF_PREFIX = 'gmail:';

export interface GmailIngestOptions {
  query?: string;
  limit?: number;
  /** Defaults to the most recently used active account. */
  accountId?: number;
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
}

export interface GmailIngestResult {
  account: string;
  query: string;
  threads: number;
  extracted: number;
  unchanged: number;
  skipped: number;
  failed: number;
  entities: number;
  edges: number;
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

export interface GmailSweepPreview {
  account: string;
  query: string;
  threads: Array<{ threadId: string; subject: string; messages: number; participants: number; alreadyIngested: boolean }>;
  newThreads: number;
}

/** What a sweep WOULD touch, without extracting anything. No LLM calls. */
export async function previewGmailSweep(opts: GmailIngestOptions = {}): Promise<GmailSweepPreview> {
  const acct = await resolveAccount(opts.accountId);
  const query = (opts.query ?? DEFAULT_GMAIL_INTEL_QUERY).trim() || DEFAULT_GMAIL_INTEL_QUERY;
  const limit = clampThreadLimit(opts.limit);

  const threadIds = await listThreadIds(acct, query, limit);
  const { db } = await import('$lib/db');
  const refIds = threadIds.map(refIdForThread);
  const { rows } = await db.execute(sql`
    SELECT metadata->>'refId' AS ref_id
    FROM intel_notes
    WHERE metadata->>'refId' = ANY(${refIds}::text[])
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

  const query = (opts.query ?? DEFAULT_GMAIL_INTEL_QUERY).trim() || DEFAULT_GMAIL_INTEL_QUERY;
  const limit = clampThreadLimit(opts.limit);

  const { extractIntoIntel } = await import('./auto-extract');
  const { persistExtraction } = await import('./graph');

  const threadIds = await listThreadIds(acct, query, limit);
  const result: GmailIngestResult = {
    account: acct.email,
    query,
    threads: threadIds.length,
    extracted: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    entities: 0,
    edges: 0,
    items: [],
  };

  for (const threadId of threadIds) {
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
      const noteText = threadToNoteText(thread);
      const structural = structuralEdges(thread);
      const subject = threadSubject(thread) || `Gmail thread ${threadId}`;

      item = {
        ...item,
        subject,
        messages: thread.messages.length,
        participants: structural.participants.length,
      };

      if (!noteText) {
        result.skipped++;
        result.items.push(item);
        continue;
      }

      const outcome = await extractIntoIntel({
        kind: 'file',
        refId: refIdForThread(threadId),
        title: subject.slice(0, 200),
        text: noteText,
        contentHash: createHash('sha256').update(noteText).digest('hex'),
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
        const stats = await persistExtraction(outcome.noteId, structural);
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

  console.log(
    `[intel:gmail] sweep "${query}" on ${acct.email} — ${result.threads} threads, ${result.extracted} extracted (${result.entities} entities, ${result.edges} edges), ${result.unchanged} unchanged, ${result.failed} failed`,
  );
  return result;
}
