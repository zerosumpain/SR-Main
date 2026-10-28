import type { ToolResult } from './registry-internal';

/**
 * The wire contract between a chat process and Main's tool catalogue.
 *
 * PURE, and it must stay so — no database, no environment, no clock. Both ends
 * of the boundary import it: Main's endpoint to read a request, and the caller
 * (today `./remote.ts`, tomorrow the same file inside SR-JKAI) to write one. A
 * second definition of the shape on either side is the bug this file exists to
 * prevent, so `import type` is the only import it may ever carry.
 *
 * See `docs/superpowers/specs/2026-09-17-jkai-tool-invoke-contract.md` for what
 * was measured and why the payload is this small.
 */

export class InvokeContractError extends Error {}

/**
 * The six fields `general-chat.ts` actually builds when it calls a tool.
 *
 * `ToolExecContext` has thirteen. The other seven were each measured rather
 * than assumed: `emit` becomes the NDJSON framing below; `busKey` addresses the
 * tool-step bus, whose only users are chat-intrinsic; `signal` does not
 * serialise and cancellation is already an explicit DELETE; `deadline` becomes
 * the caller's HTTP timeout; `depth` guards one process calling itself; and
 * `buildId`/`iterationId` are build attribution, not chat's.
 */
export interface InvokeContext {
	conversationId?: string;
	/** `null` means an unscoped chat, and is not the same as absent. */
	workflowId?: string | null;
	jobId?: string;
	modelContext?: Record<string, unknown>;
	thinkingLevel?: string | null;
	allowedTools?: string[];
	/**
	 * Whose turn the call serves ('owner' or a member's `u_…`). Added after the
	 * first six; an older caller simply omits it and is read as the owner, as
	 * before. A member call with no `allowedTools` is refused by `executeTool`.
	 */
	principalId?: string;
	/**
	 * Where the turn came from (`TurnEnvelope.surface`). A LABEL, never a
	 * grant: what a call may do is the principal's to decide, not this. Absent
	 * from an older caller, which is read exactly as before.
	 */
	surface?: TurnSurface;
	/**
	 * The paired phone the turn arrived on. Set by the chat process from the
	 * credential it verified (`identifyDevice`), never from a client body.
	 */
	deviceId?: string;
}

export interface InvokeRequest {
	name: string;
	args: Record<string, unknown>;
	context: InvokeContext;
}

export const NDJSON_CONTENT_TYPE = 'application/x-ndjson';

/**
 * A bound on one status frame, not a policy about what a caption may say.
 *
 * The consumer applies its own limit — `general-chat.ts` trims every emit to
 * 200 characters before it reaches a job phase — and that is where the display
 * decision belongs. This is only here so a tool that emits a megabyte cannot
 * make one frame the size of the response.
 */
export const STATUS_FRAME_LIMIT = 1000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read a request body into the contract, reading ONLY the declared fields.
 *
 * The whitelist is the security property. Four `ToolExecContext` fields would
 * be dangerous to accept from a caller — `buildId` and `iterationId` attribute
 * a tool's writes to somebody else's build, `depth` is the recursion guard, and
 * `busKey` addresses the confirmer and credential requester — so nothing here
 * copies an object across wholesale. Same rule as `coercePlan` in the
 * self-improvement engine: an unrecognised field is dropped, never guessed at.
 */
export function coerceInvokeRequest(body: unknown): InvokeRequest {
	if (!isPlainObject(body)) throw new InvokeContractError('body must be an object');
	const name = body.name;
	if (typeof name !== 'string' || name.length === 0) {
		throw new InvokeContractError('name is required');
	}

	// Refused rather than defaulted: running the tool with no arguments would
	// report whatever that does, which reads as a tool bug rather than a caller
	// one.
	if (body.args !== undefined && !isPlainObject(body.args)) {
		throw new InvokeContractError('args must be an object');
	}
	const args = isPlainObject(body.args) ? body.args : {};

	if (body.context !== undefined && !isPlainObject(body.context)) {
		throw new InvokeContractError('context must be an object');
	}
	const raw = isPlainObject(body.context) ? body.context : {};
	const context: InvokeContext = {};

	if (typeof raw.conversationId === 'string') context.conversationId = raw.conversationId;
	if (typeof raw.workflowId === 'string' || raw.workflowId === null) {
		context.workflowId = raw.workflowId;
	}
	if (typeof raw.jobId === 'string') context.jobId = raw.jobId;
	if (isPlainObject(raw.modelContext)) context.modelContext = raw.modelContext;
	if (typeof raw.thinkingLevel === 'string' || raw.thinkingLevel === null) {
		context.thinkingLevel = raw.thinkingLevel;
	}
	// An empty list stays empty. `executeTool` reads `allowedTools && !includes`,
	// so [] refuses every tool — coercing it to `undefined` would turn the most
	// restrictive scope into no scope at all, which is the fail-open the build
	// bridge already had removed once.
	if (Array.isArray(raw.allowedTools)) {
		context.allowedTools = raw.allowedTools.filter((t): t is string => typeof t === 'string');
	}
	// A non-empty string or nothing. An empty or non-string value is dropped,
	// never defaulted to a member: absent means the owner, exactly as before.
	if (typeof raw.principalId === 'string' && raw.principalId.length > 0) {
		context.principalId = raw.principalId;
	}
	// Known words only: an unrecognised surface is dropped, not passed on.
	if (isTurnSurface(raw.surface)) context.surface = raw.surface;
	if (typeof raw.deviceId === 'string' && ID_PATTERN.test(raw.deviceId)) context.deviceId = raw.deviceId;

	return { name, args, context };
}

// ── The turn envelope ────────────────────────────────────────────────────────

/**
 * Where a chat turn came from and what came with it.
 *
 * One shape for every producer — the web composer, the iPhone app, Main's
 * WhatsApp bridge and follow-up queue — so that the persona's length and
 * format, the thread's channel label and hand-overs ("ask jkai about this
 * note") all read the same fact. Additive on the wire: a receiver that finds
 * no envelope carries on exactly as before, and a producer may send one to a
 * receiver that ignores it.
 *
 * `client.deviceId` is the one field a client never supplies. The chat
 * process sets it from the credential it verified; `coerceTurnEnvelope` drops
 * whatever a body claims and takes only the `server` argument.
 */
export const TURN_SURFACES = [
	'web',
	'ios',
	'watch',
	'siri',
	'whatsapp',
	'followup',
	'heartbeat',
	'daydream',
	'briefing',
	'canvas',
] as const;
export type TurnSurface = (typeof TURN_SURFACES)[number];

export const TURN_REF_KINDS = ['daydream_note', 'trip', 'capture', 'build', 'entity', 'health_day'] as const;
export type TurnRefKind = (typeof TURN_REF_KINDS)[number];

export interface TurnRef {
	kind: TurnRefKind;
	id: string;
}

export interface TurnEnvelope {
	surface?: TurnSurface;
	client?: { app?: string; build?: string; deviceId?: string };
	/** BCP 47, e.g. `en-GB`. */
	locale?: string;
	/** IANA, e.g. `Europe/London`. */
	tz?: string;
	refs?: TurnRef[];
	/** Client-tool names the device can run now. Empty means none. */
	capabilities?: string[];
	requestId?: string;
}

export const MAX_TURN_REFS = 5;
const MAX_CAPABILITIES = 20;
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8}){0,3}$/;
const TZ_PATTERN = /^(?:UTC|[A-Za-z][A-Za-z_]*(?:\/[A-Za-z0-9_+-]+){1,2})$/;
const LABEL_PATTERN = /^[A-Za-z0-9 _.+()-]{1,40}$/;
const CAPABILITY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTurnSurface(value: unknown): value is TurnSurface {
	return typeof value === 'string' && (TURN_SURFACES as readonly string[]).includes(value);
}

/**
 * Read an envelope, keeping only what is well-formed. Never throws: an
 * envelope is context, and a malformed one costs its bad fields, not the turn.
 * `server.deviceId` is the verified device, and the only source of that field.
 */
export function coerceTurnEnvelope(raw: unknown, server: { deviceId?: string | null } = {}): TurnEnvelope {
	const out: TurnEnvelope = {};
	const body = isPlainObject(raw) ? raw : {};
	if (isTurnSurface(body.surface)) out.surface = body.surface;

	const client: NonNullable<TurnEnvelope['client']> = {};
	const rawClient = isPlainObject(body.client) ? body.client : {};
	if (typeof rawClient.app === 'string' && LABEL_PATTERN.test(rawClient.app)) client.app = rawClient.app;
	if (typeof rawClient.build === 'string' && LABEL_PATTERN.test(rawClient.build)) client.build = rawClient.build;
	if (typeof server.deviceId === 'string' && ID_PATTERN.test(server.deviceId)) client.deviceId = server.deviceId;
	if (Object.keys(client).length) out.client = client;

	if (typeof body.locale === 'string' && body.locale.length <= 35 && LOCALE_PATTERN.test(body.locale)) out.locale = body.locale;
	if (typeof body.tz === 'string' && body.tz.length <= 64 && TZ_PATTERN.test(body.tz)) out.tz = body.tz;

	if (Array.isArray(body.refs)) {
		const seen = new Set<string>();
		const refs: TurnRef[] = [];
		for (const r of body.refs) {
			if (!isPlainObject(r) || typeof r.kind !== 'string' || typeof r.id !== 'string') continue;
			if (!(TURN_REF_KINDS as readonly string[]).includes(r.kind) || !ID_PATTERN.test(r.id)) continue;
			const key = `${r.kind}:${r.id}`;
			if (seen.has(key)) continue;
			seen.add(key);
			refs.push({ kind: r.kind as TurnRefKind, id: r.id });
			if (refs.length >= MAX_TURN_REFS) break;
		}
		if (refs.length) out.refs = refs;
	}
	// A list that arrives stays a list, even empty: [] means "can run none".
	if (Array.isArray(body.capabilities)) {
		out.capabilities = body.capabilities
			.filter((c): c is string => typeof c === 'string' && CAPABILITY_PATTERN.test(c))
			.slice(0, MAX_CAPABILITIES);
	}
	if (typeof body.requestId === 'string' && UUID_PATTERN.test(body.requestId)) out.requestId = body.requestId;
	return out;
}

/**
 * The label a message carries in a thread: `metadata.channel` where the row
 * was stamped, else the thread's own source (rows from before stamping). A
 * message typed on the web inside the WhatsApp thread reads 'web', because
 * its row says so.
 */
export function messageChannel(metadata: unknown, conversationSource: string | null | undefined): string {
	const stamped = isPlainObject(metadata) ? metadata.channel : undefined;
	if (isTurnSurface(stamped)) return stamped;
	if (conversationSource === 'whatsapp' || conversationSource === 'whatsapp-continuation') return 'whatsapp';
	if (conversationSource === 'app') return 'ios';
	return 'web';
}

/** The two-value label the existing clients draw ('via WhatsApp' or nothing). */
export function messageSource(metadata: unknown, conversationSource: string | null | undefined): 'whatsapp' | 'web' {
	return messageChannel(metadata, conversationSource) === 'whatsapp' ? 'whatsapp' : 'web';
}

export function wantsNdjson(accept: string | null | undefined): boolean {
	return (accept ?? '').toLowerCase().includes(NDJSON_CONTENT_TYPE);
}

/** One status frame, or '' for an empty caption — which is not worth a line. */
export function statusLine(text: string): string {
	const trimmed = text.trim().slice(0, STATUS_FRAME_LIMIT);
	if (!trimmed) return '';
	return `${JSON.stringify({ status: trimmed })}\n`;
}

export function resultLine(result: ToolResult): string {
	return `${JSON.stringify({ result })}\n`;
}

/**
 * Incremental reader for the NDJSON response.
 *
 * Incremental because the point of the framing is that a `scraper` run's five
 * lifecycle stages reach the user while it is still running. Buffering the
 * whole body and parsing at the end would deliver all five after the result,
 * which is the same as not sending them.
 */
export function createNdjsonReader(handlers: {
	onStatus?: (text: string) => void;
	onResult?: (result: ToolResult) => void;
}): { push(chunk: string): void; end(): ToolResult } {
	let buffer = '';
	let result: ToolResult | null = null;

	function frame(line: string): void {
		const text = line.trim();
		if (!text) return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			// Not skipped. A malformed frame means the stream is not what it
			// claims to be, and carrying on would report whatever arrived after
			// it as the answer.
			throw new InvokeContractError(`malformed frame: ${text.slice(0, 120)}`);
		}
		if (!isPlainObject(parsed)) return;
		if (typeof parsed.status === 'string') {
			handlers.onStatus?.(parsed.status);
			return;
		}
		if ('result' in parsed) {
			result = parsed.result as ToolResult;
			handlers.onResult?.(result);
		}
		// Anything else is a frame this version does not know. Ignored on
		// purpose, so the callee can add one without breaking older callers.
	}

	return {
		push(chunk: string): void {
			buffer += chunk;
			let newline = buffer.indexOf('\n');
			while (newline !== -1) {
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				frame(line);
				newline = buffer.indexOf('\n');
			}
		},
		end(): ToolResult {
			if (buffer) {
				const last = buffer;
				buffer = '';
				frame(last);
			}
			if (!result) {
				throw new InvokeContractError('stream ended with no result frame');
			}
			return result;
		},
	};
}

// ── The catalogue ────────────────────────────────────────────────────────────

/**
 * Everything a chat process needs to KNOW about the tools, as opposed to run.
 *
 * The first cut of this contract served `{name, destructive}` and said a chat
 * process composing a prompt "gets the full definitions from the same place it
 * always did". That was wrong: the place it always did is `site-tools/registry`,
 * which is the 175-module barrel the boundary exists to leave behind. Six
 * modules on chat's path read it — the prompt builder, the meta-tools, the
 * platform guard, the custom-tool loader, the executor and the chat loop itself
 * — and converting only the executor left the other five holding the catalogue.
 *
 * So the payload is the catalogue. One document, fetched once and cached, rather
 * than an endpoint per question: the questions are all views of the same list,
 * and five endpoints would be five things to keep in step.
 */
export interface CatalogueTool {
	name: string;
	description: string;
	parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
	toolset: string;
	category: string;
	destructive: boolean;
}

export interface CataloguePayload {
	tools: CatalogueTool[];
	toolsets: string[];
	manifest: Array<{
		toolset: string;
		description: string;
		tools: Array<{ name: string; description: string }>;
	}>;
	/** The prose block the system prompt carries, built by the owning process. */
	promptSection: string;
}

export function coerceCataloguePayload(body: unknown): CataloguePayload {
	if (!isPlainObject(body)) throw new InvokeContractError('catalogue must be an object');
	const tools = Array.isArray(body.tools) ? body.tools : null;
	if (!tools) throw new InvokeContractError('catalogue has no tools');
	return {
		tools: tools.filter(isPlainObject).flatMap((t) =>
			typeof t.name === 'string' && t.name
				? [
						{
							name: t.name,
							description: typeof t.description === 'string' ? t.description : '',
							parameters: isPlainObject(t.parameters)
								? (t.parameters as CatalogueTool['parameters'])
								: { type: 'object', properties: {} },
							toolset: typeof t.toolset === 'string' ? t.toolset : '',
							category: typeof t.category === 'string' ? t.category : '',
							destructive: t.destructive === true
						}
					]
				: []
		),
		toolsets: Array.isArray(body.toolsets) ? body.toolsets.filter((t): t is string => typeof t === 'string') : [],
		manifest: Array.isArray(body.manifest)
			? body.manifest.filter(isPlainObject).map((m) => ({
					toolset: typeof m.toolset === 'string' ? m.toolset : '',
					description: typeof m.description === 'string' ? m.description : '',
					tools: Array.isArray(m.tools)
						? m.tools.filter(isPlainObject).map((t) => ({
								name: typeof t.name === 'string' ? t.name : '',
								description: typeof t.description === 'string' ? t.description : ''
							}))
						: []
				}))
			: [],
		promptSection: typeof body.promptSection === 'string' ? body.promptSection : ''
	};
}
