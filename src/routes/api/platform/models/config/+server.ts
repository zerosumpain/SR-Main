import { json, error } from '@sveltejs/kit';
import { modelServiceAppFor } from '$lib/server/model-service-auth';
import { buildModelConfigSnapshot } from '$lib/server/models/service-config';
import type { RequestHandler } from './$types';

/**
 * The model configuration an extracted application resolves its LLM calls
 * against: the model-selection settings, Main's own resolution of them, the
 * Codex flag, and the OpenRouter catalogue reduced to prices, caps, modalities
 * and supported parameters. No secrets — the OpenRouter key is each
 * application's own environment variable now.
 *
 * Per-application credential ($lib/server/model-service-auth). The caller
 * caches it ($lib/llm/model-service-client), so this is a once-a-minute read
 * per application, not one per LLM call.
 */
export const GET: RequestHandler = async ({ request }) => {
	if (!modelServiceAppFor(request)) throw error(401, 'invalid token');
	return json(await buildModelConfigSnapshot(), {
		headers: { 'cache-control': 'private, no-store' }
	});
};
