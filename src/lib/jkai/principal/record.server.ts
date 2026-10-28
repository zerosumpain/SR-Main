/**
 * Principal phase 1, written down: each tool invocation's computed principal,
 * stamped onto the turn's `jkai_tool_traces` row as `steps.principal`.
 *
 * ## Why a deferred stamp
 *
 * The trace row is Core's. Core inserts it once, when the turn ENDS, with
 * `onConflictDoNothing` — so Main writing the row first would throw away the
 * whole trace. Main instead remembers what it served per jobId and, once the
 * row exists, merges one key into its `steps` jsonb (`jsonb_set`, no new table
 * or column, so no GRANT: `sr_main_runtime` already has UPDATE). A turn is
 * retried for RETRY_FOR_MS, comfortably past Core's turn cap, then dropped.
 *
 * Calls with no jobId — the service turn (WhatsApp, follow-ups, delegation) and
 * workflow callers — have no trace row to stamp, because Core writes traces for
 * chat-route turns only. Those are logged as one `[principal]` line each and
 * the gap is stated rather than papered over with synthetic rows.
 *
 * Logging only: nothing here can refuse a call, and nothing here may fail one.
 * Pending state is in memory and is lost on restart, which costs a few log rows.
 */

import { computeInvokePrincipal, principalKey, type TurnPrincipal } from './principal';

const FLUSH_MS = 15_000;
const RETRY_FOR_MS = 20 * 60_000;
const MAX_PENDING = 500;

export interface InvocationRecord {
	tool: string;
	lane: 'standard' | 'destructive';
	principalId?: string;
	jobId?: string;
	conversationId?: string;
	allowedTools?: readonly string[];
	/** From the turn envelope, when the caller sent one. */
	surface?: string;
	deviceId?: string;
	/** Phase 2: what the verified seal said, which beats the inference. */
	signed?: { via: TurnPrincipal['via']; attended: boolean };
}

interface Pending {
	jobId: string | null;
	conversationId: string | null;
	firstAt: number;
	lastAt: number;
	calls: InvocationRecord[];
}

const pending = new Map<string, Pending>();
let timer: ReturnType<typeof setTimeout> | null = null;

export interface PrincipalStamp {
	version: 1;
	phase: 1;
	firstAt: string;
	lastAt: string;
	principals: Array<TurnPrincipal & { calls: Record<string, number> }>;
}

/** The stamp for one turn's calls, given its thread's source. PURE. */
export function stampFor(entry: Pick<Pending, 'firstAt' | 'lastAt' | 'calls'>, source: string | null): PrincipalStamp {
	const grouped = new Map<string, TurnPrincipal & { calls: Record<string, number> }>();
	for (const c of entry.calls) {
		const p = computeInvokePrincipal({
			lane: c.lane,
			principalId: c.principalId,
			jobId: c.jobId,
			allowedTools: c.allowedTools,
			conversationSource: source,
			surface: c.surface,
			deviceId: c.deviceId,
			signed: c.signed,
		});
		const key = principalKey(p);
		const g = grouped.get(key) ?? { ...p, calls: {} };
		g.calls[c.tool] = (g.calls[c.tool] ?? 0) + 1;
		grouped.set(key, g);
	}
	return {
		version: 1,
		phase: 1,
		firstAt: new Date(entry.firstAt).toISOString(),
		lastAt: new Date(entry.lastAt).toISOString(),
		principals: [...grouped.values()],
	};
}

/**
 * Remember one invocation. Synchronous and never throws: it is called on the
 * tool path, which must not wait for or fail on logging.
 */
export function recordInvocationPrincipal(rec: InvocationRecord, now = Date.now()): void {
	try {
		const key = rec.jobId ? `job:${rec.jobId}` : `nojob:${rec.conversationId ?? '-'}:${now}:${pending.size}`;
		const entry = pending.get(key) ?? {
			jobId: rec.jobId ?? null,
			conversationId: rec.conversationId ?? null,
			firstAt: now,
			lastAt: now,
			calls: [],
		};
		entry.lastAt = now;
		entry.calls.push({ ...rec, allowedTools: rec.allowedTools ? [...rec.allowedTools] : undefined });
		pending.set(key, entry);
		while (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value as string);
		schedule();
	} catch {
		// Logging must never touch the call.
	}
}

function schedule(): void {
	if (timer) return;
	timer = setTimeout(() => {
		timer = null;
		void flushPrincipals().catch((e) => console.warn('[principal] flush failed:', e instanceof Error ? e.message : e));
	}, FLUSH_MS);
	timer.unref?.();
}

/** Write what can be written; keep what is still waiting for Core's row. Exported for tests. */
export async function flushPrincipals(now = Date.now()): Promise<{ stamped: number; logged: number; waiting: number }> {
	if (pending.size === 0) return { stamped: 0, logged: 0, waiting: 0 };
	const { db } = await import('$lib/db');
	const { sql } = await import('drizzle-orm');

	const convIds = [...new Set([...pending.values()].map((e) => e.conversationId).filter((id): id is string => !!id))];
	const sources = new Map<string, string>();
	if (convIds.length) {
		const res = await db.execute(sql`
			SELECT id, source FROM jkai_conversations
			WHERE id IN (${sql.join(convIds.map((id) => sql`${id}`), sql`, `)})
		`);
		for (const r of (res as unknown as { rows: Array<{ id: string; source: string }> }).rows) sources.set(r.id, r.source);
	}

	let stamped = 0;
	let logged = 0;
	for (const [key, entry] of [...pending]) {
		const stamp = stampFor(entry, entry.conversationId ? (sources.get(entry.conversationId) ?? null) : null);
		if (!entry.jobId) {
			console.info(`[principal] ${JSON.stringify({ conversationId: entry.conversationId, ...stamp })}`);
			pending.delete(key);
			logged++;
			continue;
		}
		try {
			const res = await db.execute(sql`
				UPDATE jkai_tool_traces
				SET steps = jsonb_set(steps, '{principal}', ${JSON.stringify(stamp)}::jsonb, true)
				WHERE id = ${entry.jobId}
			`);
			if (((res as unknown as { rowCount?: number }).rowCount ?? 0) > 0) {
				pending.delete(key);
				stamped++;
				continue;
			}
		} catch (e) {
			console.warn('[principal] stamp failed:', e instanceof Error ? e.message : e);
		}
		if (now - entry.firstAt > RETRY_FOR_MS) {
			// No trace row ever appeared (a tool-less or crashed turn). Say so once.
			console.info(`[principal] ${JSON.stringify({ jobId: entry.jobId, conversationId: entry.conversationId, untraced: true, ...stamp })}`);
			pending.delete(key);
			logged++;
		}
	}
	if (pending.size) schedule();
	return { stamped, logged, waiting: pending.size };
}

/** Tests only. */
export function _resetPrincipalLog(): void {
	pending.clear();
	if (timer) clearTimeout(timer);
	timer = null;
}
