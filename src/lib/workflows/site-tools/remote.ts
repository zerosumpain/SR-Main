import http from 'node:http';
import https from 'node:https';
import { env } from '$env/dynamic/private';
import type { ToolExecContext, ToolResult } from './registry-internal';
import {
	coerceCataloguePayload,
	createNdjsonReader,
	NDJSON_CONTENT_TYPE,
	type CataloguePayload,
	type InvokeContext,
} from './invoke-contract';

/**
 * The caller half of the tool-invoke contract.
 *
 * This is the file that MOVES. Today nothing in Main sets the environment that
 * turns it on — `executeSiteTool` runs the catalogue in-process, exactly as it
 * always has. When chat becomes SR-JKAI, this module goes with it and its
 * target points back at Main; that is the whole of the transport change, and it
 * is why `executor.ts` was made a seam in the first place.
 *
 * It uses `node:http` rather than `fetch`, for the reason
 * `$lib/server/extracted-app.ts` records: undici silently DROPS a `Host` header,
 * and a gateway that answers only for its canonical host 400s everything else.
 * Main has no gateway today, so a `fetch` would work right now and break later
 * in a way that reads as an auth problem.
 */

export class RemoteInvokeError extends Error {}

export interface RemoteInvokeTarget {
	/** Absolute URL of Main's invoke endpoint. */
	url: string;
	token: string;
	/** Canonical Host, when the call goes through a gateway that checks it. */
	host?: string;
	timeoutMs?: number;
}

/**
 * The default idle window, and why it is not two minutes.
 *
 * In-process a tool has no timeout at all, and some legitimately run for a very
 * long time: `workflow_run` takes an `awaitMs` up to 600000, and only three
 * tools in the catalogue emit anything while they work, so the other 137 are
 * silent for their whole duration. A 120s idle cap would have destroyed the
 * socket under a ten-minute wait and surfaced it as a transport error, where
 * the same call in-process simply finishes.
 *
 * So the floor is above the longest wait a tool can legitimately ask for, and
 * `JKAI_TOOL_INVOKE_IDLE_MS` moves it. This is a guard against a dead peer, not
 * a policy about how long work may take.
 */
const DEFAULT_TIMEOUT_MS = 900_000;
const CATALOGUE_TIMEOUT_MS = 10_000;

/**
 * The target, or `null` when the lane is not configured — which is what Main
 * ships and what makes "route tool calls over the wire" a deployment fact
 * rather than a code path. Both halves or neither: a URL with no token is not a
 * half-open lane, it is a closed one.
 */
export function remoteInvokeTarget(): RemoteInvokeTarget | null {
	const url = env.JKAI_TOOL_INVOKE_URL;
	const token = env.JKAI_TOOL_INVOKE_TOKEN;
	if (!url || !token) return null;
	const configured = Number(env.JKAI_TOOL_INVOKE_IDLE_MS);
	return {
		url,
		token,
		host: env.JKAI_TOOL_INVOKE_HOST || undefined,
		timeoutMs: Number.isFinite(configured) && configured > 0 ? configured : undefined,
	};
}

/**
 * The catalogue, cached, with the last good answer kept.
 *
 * A GET per tool call would be absurd, and a permanent cache would be wrong the
 * other way: the self-improvement engine registers tools live, with no restart.
 * So it is refreshed on a short TTL.
 *
 * The failure mode is what shapes the rest. If a refresh fails and the last
 * answer is served instead, chat carries on with a catalogue that is at most a
 * minute stale — which is the same staleness it tolerates anyway. If there has
 * NEVER been an answer, this throws rather than returning an empty catalogue:
 * empty would report every tool unknown, and the chat would tell the owner his
 * tools do not exist rather than that it could not reach them.
 */
let catalogueCache: { at: number; payload: CataloguePayload } | null = null;
let cataloguePending: Promise<CataloguePayload> | null = null;
const CATALOGUE_TTL_MS = 60_000;

export function resetRemoteCatalogue(): void {
	catalogueCache = null;
	cataloguePending = null;
}

export async function remoteCatalogue(target: RemoteInvokeTarget): Promise<CataloguePayload> {
	if (catalogueCache && Date.now() - catalogueCache.at < CATALOGUE_TTL_MS) {
		return catalogueCache.payload;
	}
	// Cache the PROMISE, not the result, so concurrent callers in the same tick
	// share one request — the same reason `load-registry.ts` does it.
	cataloguePending ??= (async () => {
		try {
			const payload = coerceCataloguePayload(await getJson(target, '/api/platform/tools/catalogue'));
			catalogueCache = { at: Date.now(), payload };
			return payload;
		} catch (e) {
			// A refresh that fails serves the last good answer; with no answer
			// ever, throw rather than return an empty catalogue, which would
			// report every tool unknown and tell the owner his tools do not
			// exist rather than that they could not be reached.
			if (catalogueCache) return catalogueCache.payload;
			throw e instanceof Error ? e : new RemoteInvokeError(String(e));
		} finally {
			cataloguePending = null;
		}
	})();
	return cataloguePending;
}

/**
 * The seven fields that cross, picked one at a time.
 *
 * Deliberately not a spread-and-delete: the danger is a NEW field on
 * `ToolExecContext` being carried across by default, and only an allow-list
 * fails safe when that happens. `remote.test.ts` puts this function's output
 * through the callee's reader so the two halves cannot drift apart.
 */
export function contextForWire(ctx?: ToolExecContext): InvokeContext {
	const wire: InvokeContext = {};
	if (!ctx) return wire;
	if (ctx.conversationId !== undefined) wire.conversationId = ctx.conversationId;
	if (ctx.workflowId !== undefined) wire.workflowId = ctx.workflowId;
	if (ctx.jobId !== undefined) wire.jobId = ctx.jobId;
	if (ctx.modelContext !== undefined) {
		wire.modelContext = ctx.modelContext as unknown as Record<string, unknown>;
	}
	if (ctx.thinkingLevel !== undefined) wire.thinkingLevel = ctx.thinkingLevel;
	if (ctx.allowedTools !== undefined) wire.allowedTools = ctx.allowedTools;
	// Crosses so the callee's `executeTool` can fail closed on a member call
	// that arrives without a scope — the same check it makes in-process.
	if (ctx.principalId !== undefined) wire.principalId = ctx.principalId;
	return wire;
}

/**
 * Always NDJSON.
 *
 * The caller cannot tell a meaningful `emit` from the no-op one chat passes
 * when there is no job attached, so choosing a response shape per call would
 * mean guessing. 137 of the 140 tools send a single line either way, and one
 * code path that is always exercised beats two where the streaming one only
 * runs for three tools. The endpoint still answers plain JSON by default, which
 * is what makes it debuggable with curl.
 */
export async function invokeRemoteTool(
	name: string,
	args: Record<string, unknown>,
	ctx: ToolExecContext | undefined,
	target: RemoteInvokeTarget,
): Promise<ToolResult> {
	const url = new URL(target.url);
	const body = Buffer.from(
		JSON.stringify({ name, args, context: contextForWire(ctx) }),
	);
	/**
	 * An INACTIVITY window, bounded by the deadline when one is set — not a hard
	 * cut-off, and the distinction matters for the three tools that stream.
	 *
	 * `setTimeout` on a request arms the socket's idle timer, so every status
	 * frame resets it. That is the behaviour wanted: bytes flowing mean the work
	 * is alive, which is the real objection to holding a plain JSON response
	 * open for the length of a scraper run. A tool that keeps emitting past its
	 * deadline is therefore not cut off — and that matches what it gets
	 * in-process, where `executeTool` checks `deadline` once on entry and never
	 * again.
	 *
	 * With no frames at all, this behaves exactly like a deadline, which is the
	 * case the other 137 tools are in.
	 */
	const idleMs = ctx?.deadline
		? Math.max(1, ctx.deadline - Date.now())
		: (target.timeoutMs ?? DEFAULT_TIMEOUT_MS);

	const reader = createNdjsonReader({ onStatus: (text) => ctx?.emit(text) });
	const transport = url.protocol === 'https:' ? https : http;

	return new Promise<ToolResult>((resolve, reject) => {
		const request = transport.request(
			{
				host: url.hostname,
				port: url.port || (url.protocol === 'https:' ? 443 : 80),
				path: `${url.pathname}${url.search}`,
				method: 'POST',
				headers: {
					authorization: `Bearer ${target.token}`,
					'content-type': 'application/json',
					accept: NDJSON_CONTENT_TYPE,
					'content-length': String(body.byteLength),
					host: target.host ?? url.host,
				},
			},
			(response) => {
				if (response.statusCode !== 200) {
					const chunks: Buffer[] = [];
					response.on('data', (c: Buffer) => chunks.push(c));
					response.on('end', () => {
						reject(
							new RemoteInvokeError(
								`tool invoke failed: ${response.statusCode} ${Buffer.concat(chunks).toString().slice(0, 500)}`,
							),
						);
					});
					return;
				}
				response.setEncoding('utf8');

				/**
				 * Trust the content type, not the Accept we sent.
				 *
				 * Asking for frames does not guarantee getting them: a Main that
				 * predates this contract, or a proxy that normalises the header,
				 * answers one JSON object. Parsing that as NDJSON finds no
				 * `result` frame and reports "the stream ended without a
				 * result" — which is what a dead process looks like, so the
				 * wrong thing gets investigated. Reading what actually arrived
				 * costs one branch.
				 */
				if (!(response.headers['content-type'] ?? '').toLowerCase().includes(NDJSON_CONTENT_TYPE)) {
					let whole = '';
					response.on('data', (chunk: string) => {
						whole += chunk;
					});
					response.on('end', () => {
						try {
							resolve(JSON.parse(whole) as ToolResult);
						} catch {
							reject(
								new RemoteInvokeError(`tool invoke returned unreadable body: ${whole.slice(0, 500)}`),
							);
						}
					});
					return;
				}

				response.on('data', (chunk: string) => {
					try {
						reader.push(chunk);
					} catch (e) {
						request.destroy();
						reject(e instanceof Error ? e : new RemoteInvokeError(String(e)));
					}
				});
				response.on('end', () => {
					try {
						resolve(reader.end());
					} catch (e) {
						reject(e instanceof Error ? e : new RemoteInvokeError(String(e)));
					}
				});
			},
		);
		request.setTimeout(idleMs, () => {
			request.destroy();
			reject(new RemoteInvokeError(`tool invoke timed out after ${idleMs}ms with no data: ${name}`));
		});
		request.on('error', (e) => reject(new RemoteInvokeError(e.message)));
		request.end(body);
	});
}

/** A small GET for the catalogue, sharing this module's transport decisions. */
function getJson(target: RemoteInvokeTarget, path: string): Promise<unknown> {
	const url = new URL(target.url);
	const transport = url.protocol === 'https:' ? https : http;
	return new Promise((resolve, reject) => {
		const request = transport.request(
			{
				host: url.hostname,
				port: url.port || (url.protocol === 'https:' ? 443 : 80),
				path,
				method: 'GET',
				headers: {
					authorization: `Bearer ${target.token}`,
					accept: 'application/json',
					// Same reason as the POST: node:http sends what it is given and
					// undici would not.
					host: target.host ?? url.host,
				},
			},
			(response) => {
				let whole = '';
				response.setEncoding('utf8');
				response.on('data', (chunk: string) => {
					whole += chunk;
				});
				response.on('end', () => {
					if (response.statusCode !== 200) {
						reject(
							new RemoteInvokeError(
								`tool catalogue failed: ${response.statusCode} ${whole.slice(0, 500)}`,
							),
						);
						return;
					}
					try {
						resolve(JSON.parse(whole));
					} catch {
						reject(new RemoteInvokeError(`tool catalogue was unreadable: ${whole.slice(0, 500)}`));
					}
				});
			},
		);
		request.setTimeout(CATALOGUE_TIMEOUT_MS, () => {
			request.destroy();
			reject(new RemoteInvokeError(`tool catalogue timed out after ${CATALOGUE_TIMEOUT_MS}ms`));
		});
		request.on('error', (e) => reject(new RemoteInvokeError(e.message)));
		request.end();
	});
}
