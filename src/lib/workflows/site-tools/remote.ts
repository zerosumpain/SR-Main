import http from 'node:http';
import https from 'node:https';
import { env } from '$env/dynamic/private';
import type { ToolExecContext, ToolResult } from './registry-internal';
import {
	createNdjsonReader,
	NDJSON_CONTENT_TYPE,
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

const DEFAULT_TIMEOUT_MS = 120_000;

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
	return { url, token, host: env.JKAI_TOOL_INVOKE_HOST || undefined };
}

/**
 * The six fields that cross, picked one at a time.
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
	// The deadline becomes the transport timeout — it does not serialise, and
	// there is nothing for the callee to do with it that this does not do.
	const timeoutMs = ctx?.deadline
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
		request.setTimeout(timeoutMs, () => {
			request.destroy();
			reject(new RemoteInvokeError(`tool invoke timed out after ${timeoutMs}ms: ${name}`));
		});
		request.on('error', (e) => reject(new RemoteInvokeError(e.message)));
		request.end(body);
	});
}
