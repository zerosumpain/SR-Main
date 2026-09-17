import { json, error } from '@sveltejs/kit';
import { invokeLaneFor } from '$lib/server/invoke-auth';
import {
	coerceInvokeRequest,
	InvokeContractError,
	NDJSON_CONTENT_TYPE,
	resultLine,
	statusLine,
	wantsNdjson,
} from '$lib/workflows/site-tools/invoke-contract';
import { loadToolRegistry } from '$lib/workflows/site-tools/load-registry';
import { remoteInvokeTarget } from '$lib/workflows/site-tools/remote';
import { rateLimit } from '$lib/server/rate-limit';
import type { InvokeContext } from '$lib/workflows/site-tools/invoke-contract';
import type { ToolExecContext, ToolResult } from '$lib/workflows/site-tools/registry-internal';
import { coerceModelContext } from '$lib/constants/default-models';
import { isThinkingLevel } from '$lib/models/thinking';
import type { RequestHandler } from './$types';

/**
 * Main serving its tool catalogue to a chat process that does not live inside
 * it.
 *
 * ## Why it is here and not under `/api/jkai`
 *
 * `jkai-core.excludePaths` decides which prefixes the edge router hands to
 * SR-JKAI, and an endpoint whose whole purpose is "Main serves this to that
 * application" must not sit on a prefix a future registry edit could give away.
 * `/api/platform` is already Main's own-machinery namespace for exactly this
 * reason — `/api/platform/workflow-engine` was moved there so the health
 * extraction could not take the watchdog probe with it, and that probe's failure
 * action restarts the site.
 *
 * ## What it is not
 *
 * Not the build bridge. `/api/jkai/tools/invoke` authenticates a per-build token
 * and refuses every destructive tool, because a build is headless and the
 * confirmation gate has nobody to ask. Chat is the opposite case: it confirms
 * BEFORE invoking and then has to be able to run exactly the tools the bridge
 * exists to refuse. The two cannot be one endpoint, and the difference is the
 * credential, not the code path — see `$lib/server/invoke-auth`.
 *
 * Spec: `docs/superpowers/specs/2026-09-17-jkai-tool-invoke-contract.md`.
 */
export const POST: RequestHandler = async ({ request }) => {
	const lane = invokeLaneFor(request);
	if (lane === 'none') throw error(401, 'invalid token');

	/**
	 * A process that delegates its tools does not also serve them.
	 *
	 * `depth` is deliberately not on the wire — a caller that could set it has
	 * removed `executeTool`'s recursion guard — which means the guard cannot
	 * span a hop. Point `JKAI_TOOL_INVOKE_URL` at this same process and a tool
	 * that re-enters the seam (the workflow-engine nodes do: `nodes/jkai.ts`,
	 * `deep-research`, `deep-dive`) would go round the wire again with the depth
	 * reset every pass. One refusal at the door is a structural answer to that,
	 * rather than a comment asking nobody to misconfigure it.
	 */
	if (remoteInvokeTarget()) {
		throw error(409, 'this process delegates its tools and does not serve them');
	}

	/**
	 * A ceiling, because the hook bypass skips the rate limiter.
	 *
	 * `/api/jkai/studio` documents the same thing fifteen lines away in
	 * `hooks.server.ts`: a tokened call returns before `RATE_LIMITS` is
	 * consulted, so a route that bypasses has to bring its own. This is a
	 * runaway guard, not a security control — a leaked token already has the
	 * catalogue — so it is set well above what a chat turn legitimately does
	 * (a turn making dozens of calls is ordinary) and only bites a retry loop
	 * hammering something that spends money.
	 */
	const within = rateLimit('platform-tools-invoke', { capacity: 600, refillPerSecond: 10 });
	if (!within.allowed) throw error(429, 'too many tool invocations');

	let parsed;
	try {
		parsed = coerceInvokeRequest(await request.json());
	} catch (e) {
		if (e instanceof InvokeContractError) throw error(400, e.message);
		throw error(400, 'body must be JSON');
	}
	const { name, args, context } = parsed;
	const registry = await loadToolRegistry();

	/**
	 * Decided once, and every exit below obeys it.
	 *
	 * A response that answers plain JSON on one path and frames on another is
	 * unparseable by a caller that asked for frames — it reads as a stream that
	 * ended without a result, which is indistinguishable from the process
	 * dying. The integration test caught exactly that on the destructive
	 * refusal, which is the one path that answers without running anything.
	 */
	const streaming = wantsNdjson(request.headers.get('accept'));
	const single = (result: ToolResult) =>
		streaming
			? new Response(resultLine(result), {
					headers: { 'content-type': NDJSON_CONTENT_TYPE, 'cache-control': 'no-store' },
				})
			: json(result);

	/**
	 * The destructive lane, checked here rather than inside the registry.
	 *
	 * This is a refusal in the RESULT, not an HTTP status, and deliberately so:
	 * it is the same class of thing as `executeTool`'s own "outside this
	 * caller's capability scope", which is how a tool outside `allowedTools`
	 * comes back. Both mean "your credential is fine, this tool is not in
	 * scope", and both have to reach the model as a tool result so it can tell
	 * the user what to do instead. A 403 would reach the caller as a transport
	 * failure and lose the sentence.
	 */
	if (lane !== 'destructive') {
		if (registry.getTool(name)?.destructive === true) {
			return single({
				success: false,
				error:
					`${name} makes a change that needs confirming, and the destructive lane to this ` +
					`site is closed. Ask again in /jkai, where the confirmation can be shown.`,
			});
		}
	}

	/**
	 * `registry.executeTool`, NOT `executeSiteTool`.
	 *
	 * The executor means "run this tool, wherever tools run" — which for the
	 * terminus of the call is wrong by definition. Going straight to the
	 * catalogue also makes a misconfiguration structurally safe rather than
	 * safe-by-documentation: point Main's own `JKAI_TOOL_INVOKE_URL` at Main and
	 * the worst case is one wasted loopback hop, not a tool call that recurses
	 * through the wire forever with `depth` reset to zero on every pass.
	 *
	 * `allowedTools`, unknown names and argument validation are all enforced in
	 * there already (registry.ts) and none of it is re-checked here: a seam that
	 * reshapes errors is a seam that has to be debugged twice.
	 */
	if (!streaming) {
		// Guarded for the same reason the streamed branch below is: `executeTool`
		// catches a handler's throw but not everything after it — `retainEvidence`
		// calls `sourceReferences(result.data)` outside its own try — and a result
		// that will not serialise throws in `json()`. The framed path already
		// turned both into a failed result; the debug path should not answer 500
		// where it answers cleanly.
		return single(await runTool(registry, name, args, execContextFrom(context, () => {})));
	}

	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		async start(controller) {
			let closed = false;
			const write = (line: string) => {
				if (closed || !line) return;
				try {
					controller.enqueue(encoder.encode(line));
				} catch {
					// The caller went away mid-run. The tool keeps going and
					// still writes whatever it writes — the stream was only ever
					// a spinner caption.
					closed = true;
				}
			};
			const result = await runTool(
				registry,
				name,
				args,
				execContextFrom(context, (text) => write(statusLine(text))),
			);
			write(resultLine(result));
			if (!closed) controller.close();
		},
	});

	return new Response(stream, {
		headers: { 'content-type': NDJSON_CONTENT_TYPE, 'cache-control': 'no-store' },
	});
};

/**
 * The wire's context, made into the one the registry takes.
 *
 * Two fields cannot simply be cast across, and both are better for it.
 *
 * `modelContext` arrives as plain JSON and goes through `coerceModelContext`,
 * which this codebase already states is the single decider of provider — it
 * recovers `codex` from the id PREFIX rather than trusting a stored field,
 * because persisted state all over the site carries a bare model string with no
 * provider at all. Running it here means a caller cannot smuggle a mismatched
 * pair across the boundary: send `provider: 'openrouter'` with a `codex/` id and
 * it comes out as Codex regardless, which is what every other reader of a
 * stored model setting already gets.
 *
 * `thinkingLevel` is checked against the ladder rather than accepted as a
 * string. An unrecognised rung is dropped, not passed on — the tools that read
 * it write it onto a row that a sidecar picks up hours later, so a bad value
 * would surface a long way from here.
 */
function execContextFrom(context: InvokeContext, emit: (text: string) => void): ToolExecContext {
	const raw = context.modelContext;
	const modelId = typeof raw?.modelId === 'string' ? raw.modelId : '';
	return {
		conversationId: context.conversationId,
		workflowId: context.workflowId,
		jobId: context.jobId,
		allowedTools: context.allowedTools,
		modelContext: modelId
			? coerceModelContext({
					provider: typeof raw?.provider === 'string' ? raw.provider : undefined,
					modelId,
				})
			: undefined,
		thinkingLevel: isThinkingLevel(context.thinkingLevel) ? context.thinkingLevel : null,
		emit,
	};
}

/** `executeTool`, with everything it does not catch turned into a result. */
async function runTool(
	registry: Awaited<ReturnType<typeof loadToolRegistry>>,
	name: string,
	args: Record<string, unknown>,
	ctx: ToolExecContext,
): Promise<ToolResult> {
	try {
		const result = await registry.executeTool(name, args, ctx);
		// Serialising here rather than at the edge: a result that will not
		// stringify would otherwise throw inside `json()` or `resultLine()`,
		// after the status is chosen and — on the framed path — after bytes have
		// already gone out.
		JSON.stringify(result);
		return result;
	} catch (e) {
		return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
	}
}
