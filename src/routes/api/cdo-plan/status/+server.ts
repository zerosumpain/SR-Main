import type { RequestHandler } from './$types';
import { getCdoEventEmitter } from '$lib/cdo/orchestrator';
import type { SSEEvent } from '$lib/deepdive/types';

export const GET: RequestHandler = async ({ url }) => {
	const planId = url.searchParams.get('planId');
	if (!planId) {
		return new Response(JSON.stringify({ error: 'planId required' }), { status: 400 });
	}

	const cdoEmitter = getCdoEventEmitter(planId);
	if (!cdoEmitter) {
		return new Response(JSON.stringify({ error: 'No active research run' }), { status: 404 });
	}

	const { emitter } = cdoEmitter;

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();

			function onEvent(event: SSEEvent) {
				try {
					const data = JSON.stringify(event);
					controller.enqueue(encoder.encode(`data: ${data}\n\n`));
				} catch {
					// Stream closed
				}
			}

			emitter.on('event', onEvent);
			controller.enqueue(
				encoder.encode(`data: ${JSON.stringify({ type: 'status', message: 'connected' })}\n\n`)
			);

			const keepalive = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(`: keepalive\n\n`));
				} catch {
					clearInterval(keepalive);
					emitter.off('event', onEvent);
				}
			}, 15000);
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
