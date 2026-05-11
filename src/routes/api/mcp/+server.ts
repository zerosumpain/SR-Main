import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { createMcpToolHandler, listMcpTools } from '$lib/mcp/server';

const handler = createMcpToolHandler();

export const GET: RequestHandler = async () => {
	const tools = await listMcpTools();
	return json({ tools });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { name?: string; arguments?: Record<string, unknown> };
	const bridgeToken = request.headers.get('Bridge-Token') ?? '';

	try {
		const result = await handler({
			name: String(body.name ?? ''),
			arguments: body.arguments ?? {},
			bridgeToken,
		});
		return json(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'unknown error';
		// Auth-related errors (missing token, scope mismatch, signature/expired)
		// map to 403; anything else is a 500.
		const status = /scope|token|missing|signature|expired|malformed/i.test(message) ? 403 : 500;
		return json({ error: message }, { status });
	}
};
