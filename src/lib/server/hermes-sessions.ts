/**
 * Read-only inspector over the Hermes engine's SQLite session store
 * (`$HERMES_HOME/state.db`). Hermes runs on homeserv, so this only works when
 * SvelteKit is on the same host — the VPS deploy degrades gracefully (callers
 * gate on `IS_HOMESERV`).
 *
 * All reads go through `sqlite3 -readonly` (the gateway is actively writing the
 * WAL; read-only never contends for the write lock). The only user-controlled
 * inputs are the session id (regex-validated to a safe charset) and the FTS
 * query (escaped + phrase-wrapped) — both closed below. The dead `hermes_sessions`
 * Postgres table is intentionally NOT used (it's never written).
 */
import { env } from '$env/dynamic/private';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { db } from '$lib/db';
import { conversations } from '$lib/db/schema';
import { inArray } from 'drizzle-orm';

const execFileP = promisify(execFile);

export const IS_HOMESERV = os.hostname() === 'homeserv';
const HERMES_HOME = env.HERMES_HOME ?? '/home/john/.hermes-jkai';
const STATE_DB = `${HERMES_HOME}/state.db`;
const SQLITE_TIMEOUT_MS = 8000;
const MAX_BUFFER = 8 * 1024 * 1024;
const MSG_CONTENT_CAP = 12000;

export const SESSION_SOURCES = ['jkai', 'whatsapp', 'cli', 'tui'] as const;
export type SessionSource = (typeof SESSION_SOURCES)[number];

const SESSION_ID_RE = /^\d{8}_\d{6}_[0-9a-f]{8}$/;
/** Hermes session ids look like `20260601_161404_54636e66`. Validating to this
 *  charset makes interpolating the id into SQL injection-safe. */
export function isValidSessionId(id: string): boolean {
  return SESSION_ID_RE.test(id);
}

function safeSource(source: string | undefined | null): SessionSource {
  return (SESSION_SOURCES as readonly string[]).includes(source ?? '') ? (source as SessionSource) : 'jkai';
}

/**
 * Build a safe FTS5 MATCH literal for the sqlite3 CLI. The query is wrapped as a
 * phrase so FTS operators in user input aren't parsed, then both the FTS quote
 * and the SQL string delimiter are escaped. The CLI receives the whole SQL as a
 * single execFile arg (no shell), so this is the only injection surface.
 */
export function ftsMatchLiteral(query: string): string {
  const phrase = '"' + query.replace(/"/g, '""') + '"'; // FTS5 phrase (double-quote escapes the quote)
  return "'" + phrase.replace(/'/g, "''") + "'"; // SQL single-quoted string literal
}

/** jkai sessions store `user_id = sess_<convId>_chat_<convId>` (see
 *  handleWithHermes). Returns the jkai conversation id, or null. */
export function convIdFromUserId(userId: string | null | undefined): string | null {
  if (!userId) return null;
  const m = userId.match(/^sess_(.+)_chat_/);
  return m ? m[1] : null;
}

async function querySqlite<T>(sql: string): Promise<T[]> {
  const { stdout } = await execFileP('sqlite3', ['-readonly', '-json', STATE_DB, sql], {
    timeout: SQLITE_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
  });
  const trimmed = stdout.toString().trim();
  if (!trimmed) return [];
  return JSON.parse(trimmed) as T[];
}

export interface HermesSessionRow {
  id: string;
  source: string;
  userId: string | null;
  title: string | null;
  model: string | null;
  messageCount: number;
  toolCallCount: number;
  startedAt: number;
  endedAt: number | null;
  costUsd: number | null;
  conversationId: string | null;
  conversationTitle: string | null;
}

const SESSION_COLS = `id, source, user_id AS userId, title, model,
  message_count AS messageCount, tool_call_count AS toolCallCount,
  started_at AS startedAt, ended_at AS endedAt,
  COALESCE(actual_cost_usd, estimated_cost_usd) AS costUsd`;

/** Resolve jkai conversation titles for a batch of session rows (cross-store:
 *  the session lives in SQLite, the conversation row in Postgres). */
async function correlate(rows: { userId: string | null }[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => convIdFromUserId(r.userId)).filter((x): x is string => !!x))];
  if (ids.length === 0) return new Map();
  const convs = await db
    .select({ id: conversations.id, title: conversations.title })
    .from(conversations)
    .where(inArray(conversations.id, ids));
  return new Map(convs.map((c) => [c.id, c.title ?? '']));
}

function attachConv(row: Record<string, unknown>, convMap: Map<string, string>): HermesSessionRow {
  const conversationId = convIdFromUserId(row.userId as string | null);
  return {
    ...(row as unknown as HermesSessionRow),
    conversationId,
    conversationTitle: conversationId ? (convMap.get(conversationId) ?? null) : null,
  };
}

export async function listSessions(opts: { source?: string; limit?: number } = {}): Promise<HermesSessionRow[]> {
  const source = safeSource(opts.source);
  const limit = Math.min(Math.max(opts.limit ?? 60, 1), 200);
  const raw = await querySqlite<Record<string, unknown>>(
    `SELECT ${SESSION_COLS} FROM sessions WHERE source = '${source}' ORDER BY started_at DESC LIMIT ${limit};`,
  );
  const convMap = await correlate(raw as { userId: string | null }[]);
  return raw.map((r) => attachConv(r, convMap));
}

export interface HermesMessage {
  role: string;
  content: string | null;
  toolName: string | null;
  toolCalls: string | null;
  timestamp: number;
  truncated: boolean;
}

export interface SessionDetail {
  session: HermesSessionRow | null;
  messages: HermesMessage[];
}

export async function getSession(id: string): Promise<SessionDetail> {
  if (!isValidSessionId(id)) return { session: null, messages: [] };
  const sessRows = await querySqlite<Record<string, unknown>>(
    `SELECT ${SESSION_COLS} FROM sessions WHERE id = '${id}' LIMIT 1;`,
  );
  if (sessRows.length === 0) return { session: null, messages: [] };
  const convMap = await correlate(sessRows as { userId: string | null }[]);
  const session = attachConv(sessRows[0], convMap);

  const msgRows = await querySqlite<Record<string, unknown>>(
    `SELECT role, substr(content, 1, ${MSG_CONTENT_CAP + 1}) AS content,
            tool_name AS toolName, substr(tool_calls, 1, ${MSG_CONTENT_CAP + 1}) AS toolCalls,
            timestamp, length(content) AS contentLen
     FROM messages WHERE session_id = '${id}' ORDER BY timestamp, id LIMIT 800;`,
  );
  const messages: HermesMessage[] = msgRows.map((m) => ({
    role: String(m.role ?? ''),
    content: (m.content as string | null) ?? null,
    toolName: (m.toolName as string | null) ?? null,
    toolCalls: (m.toolCalls as string | null) ?? null,
    timestamp: Number(m.timestamp ?? 0),
    truncated: typeof m.contentLen === 'number' && (m.contentLen as number) > MSG_CONTENT_CAP,
  }));
  return { session, messages };
}

export interface SearchHit {
  sessionId: string;
  title: string | null;
  source: string;
  snippet: string;
  startedAt: number;
}

export async function searchSessions(
  query: string,
  opts: { source?: string; limit?: number } = {},
): Promise<SearchHit[]> {
  const q = query.trim().slice(0, 100);
  if (!q) return [];
  const source = safeSource(opts.source);
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 100);
  const match = ftsMatchLiteral(q);
  return querySqlite<SearchHit>(
    `SELECT m.session_id AS sessionId, s.title, s.source,
            snippet(messages_fts, 0, '⟦', '⟧', '…', 10) AS snippet, s.started_at AS startedAt
     FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid
     JOIN sessions s ON s.id = m.session_id
     WHERE messages_fts MATCH ${match} AND s.source = '${source}'
     ORDER BY rank LIMIT ${limit};`,
  );
}
